# Design Document: Multi-Agent Orchestration System

## What I built and why

The assignment asked for a system where multiple agents collaborate on a research task. The simplest version would have been a flat chain of function calls with some status flags thrown in. I went a different route: the orchestration layer is a proper first-class object (`Pipeline`) that owns the entire task lifetime, while the four agents only ever know about their own inputs and outputs. This document walks through the decisions that got me there.

---

## Architecture

```
Browser
  │
  ├── POST /tasks          → registers task, starts pipeline in background
  └── WS  /ws/tasks/{id}  → receives full task snapshot on every phase change
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

The `Pipeline` class is the heart of the system. It's a plain Python class - not a framework abstraction, not a decorator chain. I made this choice deliberately. Framework-based orchestration can be compact to write, but it's often a nightmare to debug when something doesn't behave as expected. The explicit async call sequence in `Pipeline.run()` is straightforward enough that anyone can follow it:

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

Every `_phase_*` method updates the task and pushes the new state to the WebSocket *before* starting the actual agent work. This means the client sees the phase change the moment it begins, not after the slow part finishes. Without this ordering, the UI would feel sluggish - transitions would only appear once the heavy lifting was already done.

### Revision loop

The loop is bounded to one pass. If the Reviewer rejects an initial draft, the Writer gets the feedback in its context, produces a revised version that directly addresses it, and the Reviewer takes one more look using a lenient rubric (since the structural issues it raised should now be resolved). This keeps things from looping forever and avoids the common mistake of re-reviewing an unchanged draft.

The `is_revision` flag flows through both the Writer (which adds "on reflection" commentary and revision notes) and the Reviewer (which always approves a revision pass).

---

## Agents

| Agent | Phase | What it does |
|---|---|---|
| **PlannerAgent** | `planning` | Keyword-matches the user's request to a topic template and produces 4 focused, independently researchable sub-tasks. |
| **ResearcherAgent** | `researching` | Fans out with `asyncio.gather` - all sub-tasks run in parallel. Each picks a relevant finding from a curated knowledge bank via semantic keyword matching. |
| **WriterAgent** | `drafting` / `revising` | Builds a structured report: header, overview, per-finding sections, conclusion. On revision, it explicitly acknowledges the reviewer's notes. |
| **ReviewerAgent** | `reviewing` | Binary approve/reject. Uses word count as a proxy for depth and always approves revisions. Returns natural-language feedback when rejecting. |

### Why keyword matching instead of an LLM

The brief didn't require a live LLM integration, and simulating one with a well-structured curated lookup is actually more transparent than calling an external API. The knowledge bank holds specific, realistic findings organised into six semantic buckets. The keyword matcher routes each sub-task to the most relevant bucket, and the output reads like grounded analysis rather than generic filler.

---

## AgentResult: the typed return contract

```python
class AgentResult(BaseModel):
    agent_name:    str
    phase:         str
    payload:       Dict[str, Any]
    success:       bool = True
    error_message: str  = ""
```

Every agent returns this exact structure. The Pipeline logs and stores from it without ever peeking inside `payload`. This means adding a new agent requires no changes to the orchestrator, failures are clearly distinguishable from successes without string-matching error messages, and the activity log shown in the frontend is built from a consistent shape regardless of which agent produced it.

---

## WebSocket over polling

I looked at polling (`GET /tasks/{id}` every second) and decided against it pretty quickly. With polling, the client is always at least one interval behind reality, and request volume grows with every open tab. With WebSocket, the server pushes exactly when something changes. Latency is bounded by the push call, not a timer.

One connection is maintained per task ID in `Pipeline.sockets`. When a task reaches a terminal phase, the server stops pushing and the client closes the connection cleanly.

---

## Persistence

Each task is written to `backend/data/{task_id}.json` on every state transition. This gives two things: the `GET /tasks` endpoint can reconstruct full task history after a server restart, and every JSON file doubles as a readable audit trail of the complete pipeline run.

The cost is one disk write per transition - totally fine at this scale. For something handling higher volume, the natural next step would be a database with indexed IDs and connection pooling.

---

## Task IDs

Sequential integers (`1`, `2`, `3`, ...) are used for task IDs. The counter picks up from where it left off after a restart by scanning the existing data files. This keeps IDs human-readable and consistent between sessions, which makes manual debugging a lot easier.

---

## What I'd tackle with more time

1. **Real LLM calls.** The Planner and Researcher are the natural integration points. Swapping the knowledge bank for actual `openai.chat.completions.create()` calls wouldn't touch `AgentResult`, `Pipeline`, or any HTTP route — the contract absorbs the change cleanly.

2. **Smarter revision loop.** It would be worth tracking whether the Reviewer's feedback actually changes between rounds. If it doesn't, the loop is stuck and should surface an error rather than silently approving.

3. **Concurrent task execution.** Right now there's one active task per process. A proper task queue (something like ARQ) would let the server handle multiple concurrent submissions without any issue.

4. **Streaming report output.** The Writer could push its report incrementally over the same WebSocket connection rather than all at once. The drafting phase would feel much more alive instead of appearing in a single jump.

5. **Phase timeouts.** Wrapping each agent call with `asyncio.wait_for` would make stalls explicit and recoverable, instead of leaving a task hanging with no clear indication of what went wrong.

---

## Assumptions

- A single server process is sufficient - no horizontal scaling needed for this assignment.
- Clients open one WebSocket per task and handle reconnection themselves if needed.
- Task history is append-only - no update or delete endpoints were needed.
- Research findings are illustrative rather than sourced from live external data.