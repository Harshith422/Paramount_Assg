# Multi-Agent Orchestration System

A research pipeline built around four specialised agents - Planner, Researcher, Writer, and Reviewer - all coordinated by a central `Pipeline` class. The pipeline manages the full task lifecycle, handles a revision loop when the Reviewer isn't satisfied, and streams live updates to the browser over WebSocket so you can watch the whole thing unfold in real time.

---

## Live Demo Walkthrough

Watch a short screen recording of the system in action:

**Demo Video:** [Click here to watch](https://drive.google.com/file/d/1vF-pR8YVSrjF5wygnB_oOMJ-XDkaWAKl/view?usp=sharing)

---

## Getting it running

**Prerequisites:** Python 3.11+, Node.js 18+

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python main.py
```
This starts the API at `http://localhost:8001`. You can browse the auto-generated Swagger docs at `/docs`. Task data is saved to `backend/data/` as JSON files and persists across restarts.

**Frontend:**
```bash
npm install
npm run dev
```
Opens at `http://localhost:5173`. Vite automatically proxies `/api/*` to the backend REST API and `/ws/*` to the WebSocket endpoint — no manual config needed.

---

## How the pipeline works

1. **POST /tasks** - you send a description, and the server gives back a `task_id` and kicks off the pipeline in the background
2. **WebSocket /ws/tasks/{id}** - your browser connects and receives a full task snapshot every time a phase changes
3. **Planner** breaks the request into 4 focused sub-tasks using topic-specific templates
4. **Researcher** runs all sub-tasks concurrently with `asyncio.gather`, pulling relevant findings from a curated knowledge bank
5. **Writer** puts everything together into a structured report - title, overview, per-finding sections, and a conclusion
6. **Reviewer** approves or rejects. If rejected, the Writer revises with the feedback, and the Reviewer takes one more look (capped at a single retry to avoid infinite loops)

---

## Project structure

```
backend/
  main.py            # FastAPI app, all four agents, Pipeline orchestrator
  data/              # Per-task JSON files (created at runtime)
  requirements.txt   # Python dependencies
src/
  App.tsx            # React UI — stepper, activity log, report display
  index.css          # Tailwind directives and global font
  main.tsx           # React entry point
vite.config.ts       # Dev proxy: /api → :8001, /ws → :8001
design_document.md   # Architecture decisions and trade-offs
```

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/tasks` | Submit a task (returns `task_id`, 202 Accepted) |
| `GET` | `/tasks/{id}` | Get a single task by ID |
| `GET` | `/tasks` | List all saved tasks (reads from disk) |
| `WS` | `/ws/tasks/{id}` | Real-time task snapshot stream |

**POST body:** `{ "description": "your research question" }`

---

## Key design decisions

- **Pipeline as a plain class** - an explicit `async def run()` rather than a framework chain. Much easier to follow and debug when something goes wrong.
- **Push state before work** - the WebSocket push happens at the *start* of each phase, so the UI updates instantly rather than waiting for the slow work to finish.
- **Typed agent contract** - every agent returns an `AgentResult(BaseModel)`. Adding a new agent means zero changes to the orchestrator.
- **Sequential task IDs** - simple integers that pick up from where they left off after a restart — human-readable and consistent.
- **Concurrent research** - `asyncio.gather` runs all sub-tasks in parallel, so total time equals the slowest lookup, not the sum of all of them.

---

## A few development notes

- The Vite proxy rewrites `/api/tasks` → `/tasks` on the backend. The `/api` prefix is only there during development.
- Task data is written to `backend/data/{task_id}.json` on every state transition. If you want a clean slate, just delete that folder.
- No authentication - this is a single-user assignment demo, so there's no need for it here.