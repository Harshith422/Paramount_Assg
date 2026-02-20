/**
 * Multi-Agent Orchestration- Frontend
 * Mission-control layout: left sidebar tracks session history,
 * right panel shows live pipeline progress with a numbered stepper,
 * animated agent dots, and a full activity log per agent.
 * Resilience: the normalizeTask / normalizeLogEntry helpers translate both
 * the old backend schema (status, history, report, feedback, subtasks) and
 * the new schema (phase, activity_log, initial_report, reviewer_feedback,
 * sub_tasks) into a single internal model so the UI is backend-agnostic.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Types - internal model that both old and new backends are normalised into
type Phase =
  // New backend values
  | "queued" | "planning" | "researching" | "drafting"
  | "reviewing" | "revising" | "done" | "errored"
  // Old backend values that normalizeTask must also handle
  | "pending" | "writing" | "completed" | "failed";

interface SubTask { id: number; description: string; }
interface Finding { sub_task_id: number; sub_task: string; finding: string; }
interface LogEntry { agent: string; phase: string; success: boolean; data: Record<string, unknown>; logged_at: string; }

interface TaskSnapshot {
  id: string;
  description: string;
  phase: Phase;
  active_agent: string | null;
  sub_tasks: SubTask[];
  findings: Finding[];
  initial_report: string;
  revised_report: string;
  reviewer_feedback: string;
  approved: boolean;
  activity_log: LogEntry[];
  queued_at: string;
  error?: string;
}

// Schema normaliser - makes the UI work regardless of which backend version
// is running. Maps old field names to new, and normalises log entries so
// the LogCard component never receives unexpected shapes.

function normalizeLogEntry(raw: Record<string, unknown>): LogEntry {
  const data = { ...(raw.data ?? raw.output ?? {}) } as Record<string, unknown>;
  // Old Planner put sub-tasks under 'subtasks'; rename for LogCard
  if (data.subtasks && !data.sub_tasks) { data.sub_tasks = data.subtasks; delete data.subtasks; }
  return {
    agent: String(raw.agent ?? "Unknown"),
    phase: String(raw.phase ?? ""),
    success: raw.success !== false,
    data,
    logged_at: String(raw.logged_at ?? raw.timestamp ?? ""),
  };
}

function normalizeTask(raw: Record<string, unknown>): TaskSnapshot {
  const phase = (raw.phase ?? raw.status ?? "queued") as Phase;
  const sub_tasks = (raw.sub_tasks ?? raw.subtasks ?? []) as SubTask[];
  const initial_report = String(raw.initial_report ?? raw.report ?? "");
  const revised_report = String(raw.revised_report ?? "");
  const reviewer_feedback = String(raw.reviewer_feedback ?? raw.feedback ?? "");

  const rawLog = (raw.activity_log ?? raw.history ?? []) as Record<string, unknown>[];
  const activity_log: LogEntry[] = rawLog.map(normalizeLogEntry);

  const findings: Finding[] = [];
  if (Array.isArray(raw.findings)) {
    findings.push(...raw.findings as Finding[]);
  } else if (Array.isArray(raw.researches)) {
    (raw.researches as string[]).forEach((r, i) => {
      const st = sub_tasks[i] ?? { id: i + 1, description: `Sub-task ${i + 1}` };
      findings.push({ sub_task_id: st.id, sub_task: st.description, finding: r });
    });
  }

  return {
    id: String(raw.id ?? ""),
    description: String(raw.description ?? ""),
    phase,
    active_agent: (raw.active_agent ?? raw.current_agent ?? null) as string | null,
    sub_tasks,
    findings,
    initial_report,
    revised_report,
    reviewer_feedback,
    approved: Boolean(raw.approved ?? false),
    activity_log,
    queued_at: String(raw.queued_at ?? raw.submitted_at ?? ""),
    error: raw.error as string | undefined,
  };
}

// Pipeline stages configuration

const PIPELINE: { phase: Phase; label: string; agent: string; note: string }[] = [
  { phase: "planning", label: "Plan", agent: "Planner", note: "Decompose the request into focused sub-tasks" },
  { phase: "researching", label: "Research", agent: "Researcher", note: "Gather findings concurrently across sub-tasks" },
  { phase: "drafting", label: "Draft", agent: "Writer", note: "Synthesise findings into a structured report" },
  { phase: "reviewing", label: "Review", agent: "Reviewer", note: "Evaluate quality and request revision if needed" },
];

const PHASE_ORDER: Phase[] = [
  "queued", "pending", "planning", "researching",
  "drafting", "writing", "reviewing", "revising", "done", "completed", "errored", "failed",
];

const SAMPLES = [
  "Compare microservices and monolithic architecture - when does each approach actually make sense?",
  "Analyse the real trade-offs of remote work for software engineering teams.",
  "Evaluate SQL versus NoSQL for a high-traffic e-commerce platform.",
  "Research the practical challenges of adopting Kubernetes in production.",
];

// Utility helpers

function phaseIndex(p: Phase): number {
  if (p === "revising") return PHASE_ORDER.indexOf("reviewing") - 0.5;
  const i = PHASE_ORDER.indexOf(p);
  return i >= 0 ? i : 0;
}

function isFinal(p: Phase) {
  return p === "done" || p === "errored" || p === "completed" || p === "failed";
}

function agentColour(agent: string): string {
  const map: Record<string, string> = {
    Planner: "bg-violet-600", Researcher: "bg-amber-500",
    Writer: "bg-sky-600", Reviewer: "bg-emerald-600",
  };
  return map[agent] ?? "bg-slate-500";
}

function phaseBadge(p: Phase): string {
  if (p === "done" || p === "completed") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (p === "errored" || p === "failed") return "bg-red-100 text-red-800 border-red-200";
  if (p === "queued" || p === "pending") return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-blue-100 text-blue-800 border-blue-200";
}

function phaseLabel(p: Phase): string {
  const labels: Record<string, string> = {
    queued: "Queued", pending: "Queued",
    planning: "Planning",
    researching: "Researching",
    drafting: "Drafting", writing: "Drafting",
    reviewing: "Reviewing",
    revising: "Revising",
    done: "Done", completed: "Done",
    errored: "Error", failed: "Error",
  };
  return labels[p] ?? p;
}

function shortTime(iso: string): string {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
}

// Small reusable components

function LiveDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1.5" aria-label="processing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-1.5 h-1.5 rounded-full bg-current"
          style={{ animation: `dotBounce 1.4s ease-in-out ${i * 0.2}s infinite` }} />
      ))}
    </span>
  );
}

function AgentBadge({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const sz = size === "md" ? "w-8 h-8 text-sm" : "w-6 h-6 text-xs";
  return (
    <span className={`inline-flex flex-shrink-0 items-center justify-center rounded-full font-bold text-white ${sz} ${agentColour(name)}`}>
      {name[0]}
    </span>
  );
}

function PipelineStepper({ phase }: { phase: Phase }) {
  const current = phaseIndex(phase);

  const planIdx = phaseIndex("planning");
  const resIdx = phaseIndex("researching");
  const draftIdx = phaseIndex("drafting");
  const reviewIdx = phaseIndex("reviewing");

  const stepIndices = [planIdx, resIdx, draftIdx, reviewIdx];

  return (
    <div className="space-y-2">
      {PIPELINE.map(({ phase: stepPhase, label, agent, note }, idx) => {
        const stepIndex = stepIndices[idx];
        const done = current > stepIndex + 0.5;
        const active = Math.floor(current) === Math.floor(stepIndex);
        const revising = phase === "revising" && stepPhase === "drafting";

        return (
          <div key={stepPhase}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-all duration-300 ${revising ? "bg-amber-50 border-amber-200"
              : active ? "bg-blue-50  border-blue-200"
                : done ? "bg-emerald-50 border-emerald-200"
                  : "bg-white border-slate-200"
              }`}
          >
            <div
              className={`mt-0.5 flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors ${done ? "bg-emerald-500 text-white"
                : active ? "bg-blue-500 text-white"
                  : revising ? "bg-amber-500 text-white"
                    : "bg-slate-200 text-slate-500"
                }`}
              style={active || revising ? { animation: "ringPulse 1.4s ease-in-out infinite" } : undefined}
            >
              {done ? (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : idx + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-semibold ${active ? "text-blue-700" : done ? "text-emerald-700" : "text-slate-500"
                  }`}>{label}</span>
                <span className={`text-xs font-medium text-white px-1.5 py-0.5 rounded ${agentColour(agent)}`}>{agent}</span>
                {(active || revising) && <LiveDots />}
              </div>
              <p className="text-xs mt-0.5 text-slate-500">{note}</p>
            </div>
          </div>
        );
      })}

      {phase === "revising" && (
        <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5 bg-amber-50 border-amber-200">
          <div className="mt-0.5 flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold bg-amber-500 text-white"
            style={{ animation: "ringPulse 1.4s ease-in-out infinite" }}>
            R
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-amber-700">Revising</span>
              <span className="text-xs font-medium text-white px-1.5 py-0.5 rounded bg-sky-600">Writer</span>
              <LiveDots />
            </div>
            <p className="text-xs mt-0.5 text-amber-600">Incorporating reviewer notes into a new draft</p>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryCard({ task, isSelected, onClick }: { task: TaskSnapshot; isSelected: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${isSelected ? "bg-blue-50 border-blue-300" : "bg-white border-slate-200 hover:bg-slate-50"
        }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-mono text-slate-400">#{task.id}</span>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${phaseBadge(task.phase)}`}>
          {phaseLabel(task.phase)}
        </span>
      </div>
      <p className="text-xs font-medium text-slate-700 leading-snug line-clamp-2">{task.description}</p>
      {task.queued_at && <p className="text-xs text-slate-400 mt-1">{shortTime(task.queued_at)}</p>}
    </button>
  );
}

function ReportBlock({ title, content, muted }: { title: string; content: string; muted?: boolean }) {
  return (
    <div>
      <h4 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${muted ? "text-slate-400" : "text-slate-600"}`}>
        {title}
      </h4>
      <div className={`rounded-lg border p-4 max-h-72 overflow-y-auto ${muted ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200"}`}>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 font-sans">{content}</pre>
      </div>
    </div>
  );
}

function LogCard({ entry }: { entry: LogEntry }) {
  const d = entry.data ?? {};
  return (
    <div className="flex gap-3">
      <AgentBadge name={entry.agent} />
      <div className="flex-1 min-w-0 border border-slate-200 rounded-lg p-3 bg-white text-xs">
        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
          <span className="font-semibold text-slate-800">{entry.agent}</span>
          {d.is_revision && (
            <span className="bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">revision</span>
          )}
          <span className={`ml-auto px-1.5 py-0.5 rounded font-medium ${entry.success ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
            {entry.success ? "ok" : "failed"}
          </span>
          {entry.logged_at && <span className="text-slate-400">{shortTime(entry.logged_at)}</span>}
        </div>

        {/* Planner sub-tasks */}
        {Array.isArray(d.sub_tasks) && (d.sub_tasks as SubTask[]).length > 0 && (
          <ul className="space-y-1 pl-2">
            {(d.sub_tasks as SubTask[]).map((st, i) => (
              <li key={st.id ?? i} className="flex gap-1.5 text-slate-600">
                <span className="text-slate-400 flex-shrink-0">{st.id ?? i + 1}.</span>
                <span>{st.description}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Researcher findings */}
        {Array.isArray(d.findings) && (d.findings as Finding[]).length > 0 && (
          <ul className="space-y-1 pl-2">
            {(d.findings as Finding[]).map((f, i) => (
              <li key={f.sub_task_id ?? i} className="flex gap-1.5 text-slate-600">
                <span className="text-slate-400 flex-shrink-0">{f.sub_task_id ?? i + 1}.</span>
                <span className="italic">"{f.finding}"</span>
              </li>
            ))}
          </ul>
        )}

        {/* Single finding (old Researcher format) */}
        {typeof d.finding === "string" && d.finding && (
          <p className="pl-2 text-slate-600 italic">"{d.finding}"</p>
        )}

        {/* Writer report length */}
        {typeof d.report === "string" && d.report && (
          <p className="pl-2 text-slate-500">
            {d.is_revision ? "Revised draft" : "Initial draft"} — {(d.report as string).split(" ").length} words
          </p>
        )}

        {/* Reviewer verdict */}
        {typeof d.feedback === "string" && d.feedback && (
          <div className="pl-2 space-y-0.5">
            <p className="text-slate-700 font-medium">{d.approved ? "Approved" : "Revision requested"}</p>
            <p className="text-slate-600 italic">"{d.feedback}"</p>
          </div>
        )}

        {/* Errors from gather */}
        {Array.isArray(d.errors) && (d.errors as string[]).length > 0 && (
          <p className="pl-2 text-red-600">Errors: {(d.errors as string[]).join("; ")}</p>
        )}
      </div>
    </div>
  );
}

// Main App

export default function App() {
  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [liveTask, setLiveTask] = useState<TaskSnapshot | null>(null);
  const [history, setHistory] = useState<TaskSnapshot[]>([]);
  const [pinned, setPinned] = useState<TaskSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [wsError, setWsError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  const openSocket = useCallback((id: string) => {
    wsRef.current?.close();
    setWsError("");
    const ws = new WebSocket(`ws://${window.location.host}/ws/tasks/${id}`);
    ws.onmessage = (evt) => {
      try {
        const snap = normalizeTask(JSON.parse(evt.data));
        setLiveTask(snap);
        setPinned(null);
        setHistory((prev) => {
          const idx = prev.findIndex((t) => t.id === snap.id);
          if (idx >= 0) { const next = [...prev]; next[idx] = snap; return next; }
          return [snap, ...prev];
        });
        if (isFinal(snap.phase)) ws.close();
      } catch { /* malformed frame — ignore silently */ }
    };
    ws.onerror = () => setWsError("Live connection interrupted. Results may be stale.");
    wsRef.current = ws;
  }, []);

  const handleSubmit = async () => {
    if (!input.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    setLiveTask(null);
    setPinned(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: input.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(`Server returned ${res.status}: ${(body as Record<string, string>).detail ?? res.statusText}`);
        return;
      }
      const payload = await res.json() as Record<string, unknown>;
      const taskId = String(payload.task_id ?? payload.id ?? "");
      if (!taskId) { setSubmitError("Backend returned no task ID."); return; }
      setActiveId(taskId);
      openSocket(taskId);
    } catch (err) {
      setSubmitError(`Could not reach the backend: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setInput(""); setActiveId(null); setLiveTask(null);
    setPinned(null); setSubmitError(""); wsRef.current?.close();
  };

  const displayed = pinned ?? liveTask;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
        @keyframes dotBounce {
          0%,80%,100% { transform:scale(.6); opacity:.4; }
          40%         { transform:scale(1);  opacity:1;  }
        }
        @keyframes ringPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(59,130,246,.4); }
          50%     { box-shadow: 0 0 0 6px rgba(59,130,246,0); }
        }
        @keyframes fadeUp {
          from { opacity:0; transform:translateY(6px); }
          to   { opacity:1; transform:translateY(0);   }
        }
        .fade-up { animation: fadeUp .3s ease-out forwards; }
        pre { font-family: 'Inter', system-ui, sans-serif; }
      `}</style>

      <div className="min-h-screen bg-slate-50 flex flex-col">

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-5 py-3.5 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="text-base font-bold text-slate-900 tracking-tight">Multi-Agent Orchestration</h1>
            <p className="text-xs text-slate-500 mt-0.5">Planner · Researcher · Writer · Reviewer</p>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Live
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar */}
          <aside className="hidden lg:flex flex-col w-60 border-r border-slate-200 bg-white flex-shrink-0">
            <p className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">Session</p>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {history.length === 0
                ? <p className="text-center text-xs text-slate-400 py-8">No tasks yet</p>
                : history.map((t) => (
                  <HistoryCard key={t.id} task={t}
                    isSelected={pinned?.id === t.id || (!pinned && t.id === activeId)}
                    onClick={() => setPinned(pinned?.id === t.id ? null : t)} />
                ))
              }
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-5">
            <div className="max-w-5xl mx-auto grid grid-cols-1 xl:grid-cols-2 gap-5">

              {/* Submission panel */}
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-800">Submit a request</h2>
                  {activeId && (
                    <button onClick={resetForm}
                      className="text-xs px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors">
                      Clear
                    </button>
                  )}
                </div>

                {!activeId ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        What should the agents research?
                      </label>
                      <textarea rows={4}
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none leading-relaxed"
                        placeholder="Be specific — more context leads to more focused research."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleSubmit(); }}
                      />
                      <p className="text-xs text-slate-400 mt-1">Ctrl+Enter to submit</p>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-2">Starting points:</p>
                      <div className="space-y-1.5">
                        {SAMPLES.map((s) => (
                          <button key={s} onClick={() => setInput(s)}
                            className="w-full text-left text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-md px-3 py-2 leading-snug transition-colors">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onClick={handleSubmit} disabled={submitting || !input.trim()}
                      className="w-full py-2.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white transition-colors shadow-sm">
                      {submitting ? "Submitting..." : "Run Pipeline"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                      <p className="text-xs text-slate-500">Task ID</p>
                      <p className="text-sm font-mono font-semibold text-slate-800">#{activeId}</p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5 space-y-1">
                      <p className="text-xs text-slate-500">Request</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{input}</p>
                    </div>
                    <button onClick={resetForm}
                      className="w-full py-2.5 text-sm font-semibold rounded-lg bg-slate-700 hover:bg-slate-800 text-white transition-colors">
                      New request
                    </button>
                  </div>
                )}

                {submitError && (
                  <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{submitError}</p>
                )}
              </section>

              {/* Progress panel */}
              <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-800">Pipeline progress</h2>
                  {displayed && (
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${phaseBadge(displayed.phase)}`}>
                      {phaseLabel(displayed.phase)}
                    </span>
                  )}
                </div>

                {wsError && (
                  <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{wsError}</p>
                )}

                {displayed ? (
                  <div className="space-y-5 fade-up">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Agent chain</p>
                      <PipelineStepper phase={displayed.phase} />
                    </div>

                    {displayed.reviewer_feedback && (
                      <div className={`rounded-lg border p-3.5 fade-up ${displayed.revised_report ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200"}`}>
                        <p className={`text-xs font-semibold mb-1 ${displayed.revised_report ? "text-amber-700" : "text-emerald-700"}`}>
                          {displayed.revised_report ? "Reviewer requested a revision" : "Reviewer feedback"}
                        </p>
                        <p className="text-sm text-slate-700 leading-relaxed">{displayed.reviewer_feedback}</p>
                      </div>
                    )}

                    {displayed.revised_report ? (
                      <div className="space-y-3">
                        <ReportBlock title="Revised report (final)" content={displayed.revised_report} />
                        <ReportBlock title="Initial draft" content={displayed.initial_report} muted />
                      </div>
                    ) : displayed.initial_report ? (
                      <ReportBlock title="Report" content={displayed.initial_report} />
                    ) : null}

                    {displayed.phase === "errored" && displayed.error && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 fade-up">
                        <p className="text-xs font-semibold text-red-700 mb-1">Pipeline failed</p>
                        <p className="text-sm text-red-600">{displayed.error}</p>
                      </div>
                    )}

                    {displayed.activity_log.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">Activity log</p>
                        <div className="space-y-2">
                          {displayed.activity_log.map((entry, i) => <LogCard key={i} entry={entry} />)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-14 text-center">
                    <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21a48.309 48.309 0 01-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-slate-600">No active task</p>
                    <p className="text-xs text-slate-400 mt-1">Submit a request to start the pipeline</p>
                  </div>
                )}
              </section>

            </div>
          </main>
        </div>
      </div>
    </>
  );
}