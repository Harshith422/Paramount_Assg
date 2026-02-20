# Design Document: Multi-Agent Orchestration System

## What I built and why
The assignment asked for a system where multiple agents collaborate on a research task. The simplest implementation would be a flat chain of function calls with status updates sprinkled in. I took a different approach: the orchestration layer is a first-class object (`Pipeline`) that fully owns the task lifetime, with four agents that only know about their own inputs and outputs. This document explains the decisions that led there.
---
## Architecture

```
Browser
  │
  ├── POST /tasks          → registers task, kicks off pipeline in background
  └── WS  /ws/tasks/{id}  → receives full task snapshot on every phase transition
                               │
                          FastAPI  (main.py)
                               │
                          Pipeline
                          ┌────┴────────────────────────────────────┐
                     PlannerAgent                           (sequential)
                          │
                   ResearcherAgent    ← sub-tasks run concurrently via asyncio.gather
                          │
                      WriterAgent
                          │
                     ReviewerAgent ── rejected? ──► WriterAgent (revision)
                          │                               │
                          └── approved? ─────────── ReviewerAgent (re-review)
                          │
                       Phase.DONE → persisted to disk
```

---

## The Pipeline class

This is the core of the system.

`Pipeline` is a plain Python class- not a framework abstraction, not a decorator chain. I made this choice deliberately. Framework-based orchestration is often shorter to write but harder to read and nearly impossible to debug when something goes wrong. The explicit async call sequence in `Pipeline.run()` can be followed by anyone who reads it:

```python
async def run(self, task_id: str) -> None:
    task = self.registry[task_id]
    await self._phase_planning(task)
    await self._phase_research(task)
    initial_report = await self._phase_drafting(task)
    approved = await self._phase_review(task, initial_report, is_revision=False)
    if not approved:
        revised = await self._phase_revision(task, initial_report)
        await self._phase_review(task, revised, is_revision=True)
    task["phase"] = Phase.DONE
```

### State broadcasting

Every `_phase_*` method updates the task fields and pushes to the WebSocket *before* starting the agent. This means the client sees the new state the instant a phase begins, not after it finishes. Without this ordering the UI would feel sluggish-transitions would appear only after the slow work completed.

### Revision loop

The loop is bounded to one pass. If the Reviewer rejects the first draft, the Writer receives the feedback explicitly in its context and produces a revised draft acknowledging it. The Reviewer applies a lenient rubric to revisions since the structural issues raised will have been addressed. This avoids infinite loops and the common mistake of re-reviewing an unchanged draft.

The `is_revision` flag propagates through both the Writer (which adds "on reflection" commentary and revision notes to the report) and the Reviewer (which always approves a revision pass).

---

## Agents

| Agent | Phase | What it does |
|---|---|---|
| **PlannerAgent** | `planning` | Keyword-matches the user's request to a topic template. Produces 4 focused, independently-researchable sub-tasks. |
| **ResearcherAgent** | `researching` | Fans out with `asyncio.gather` — all sub-tasks run concurrently. Each selects a finding from a curated knowledge bank via semantic keyword matching. |
| **WriterAgent** | `drafting` / `revising` | Builds a structured report: header, overview, per-finding sections, conclusion. Revision pass explicitly acknowledges reviewer notes. |
| **ReviewerAgent** | `reviewing` | Binary approve/reject. Uses word count as a proxy for depth; always approves revisions. Returns natural-language feedback. |

### Why keyword matching instead of an LLM

The brief didn't require an LLM integration, and simulating one with a sophisticated curated lookup is more transparent than calling an external API and implying the agent "researches" the topic. The knowledge bank holds specific, realistic findings organised into six semantic buckets. The keyword matcher routes each sub-task to its most relevant bucket. The output reads like grounded analysis rather than filler.

---

## AgentResult: The Typed Return Contract

```python
class AgentResult(BaseModel):
    agent_name:    str
    phase:         str
    payload:       Dict[str, Any]
    success:       bool = True
    error_message: str  = ""
```

Every agent returns this. The Pipeline logs and stores from it without inspecting what's inside `payload`. This means: adding a new agent requires no changes to `Pipeline`, failures are distinguishable from successes without string-matching error messages, and the activity log the frontend renders is built from a consistent structure regardless of which agent produced it.

---

## WebSocket over polling

I considered polling (`GET /tasks/{id}` every second) and rejected it. With polling, the client is always at least one interval behind reality, and the request volume scales with the number of open browser tabs. With WebSocket, the server pushes exactly when state changes. Latency is bounded by the push call, not a timer.

One connection is maintained per task ID in `Pipeline.sockets`. When a task reaches a terminal phase, the server stops pushing and the client closes the connection.

---

## Persistence

Each task is written to `backend/data/{task_id}.json` on every state transition. This gives two things: the `GET /tasks` endpoint can reconstruct history after a server restart, and each JSON file is a readable audit trail of the full pipeline execution.

The cost is one disk write per transition - acceptable at this scale. For higher volume, the natural upgrade is a database with indexed IDs and connection pooling.

---

## Task IDs

Sequential integers (`1`, `2`, `3`, ...) are used for task IDs. The counter picks up where it left off after a server restart by scanning the existing data files on disk. This keeps IDs human-readable and consistent across sessions.

---

## What I'd tackle with more time

1. **Real LLM calls.** Planner and Researcher are the natural integration points. Swapping the knowledge bank for `openai.chat.completions.create()` would not change `AgentResult`, `Pipeline`, or any HTTP route - the contract absorbs the change.

2. **Smarter revision loop.** Track whether the Reviewer's feedback changes between rounds. If it doesn't, the loop is stuck and should surface an error rather than approving silently.

3. **Concurrent task execution.** Currently one active task per process. A task queue (ARQ) would let the server handle concurrent submissions properly.

4. **Streaming report output.** The Writer could push its report incrementally via the same WebSocket rather than all at once. The writing phase would feel alive rather than appearing in a single jump.

5. **Phase timeouts.** An `asyncio.wait_for` wrapper around each agent call would make stalls explicit and recoverable instead of leaving a task hanging indefinitely.

---

## Assumptions

- Single server process is sufficient- no horizontal scaling needed for the assignment.
- Clients open one WebSocket per task and handle reconnection on their side.
- Task history is append only- no update or delete endpoints needed.
- Research findings are illustrative rather than sourced from live data.