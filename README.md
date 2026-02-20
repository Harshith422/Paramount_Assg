# Multi-Agent Orchestration System

A research pipeline built around four specialised agents - Planner, Researcher, Writer, and Reviewer - coordinated by a central `Pipeline` class that manages state, handles the revision loop, and streams live updates to the browser over WebSocket.

---
## Live Demo Walkthrough

Watch a **3–5 minute screen recording** of the system in action:

**Demo Video:** [Click here to watch](https://drive.google.com/file/d/1vF-pR8YVSrjF5wygnB_oOMJ-XDkaWAKl/view?usp=sharing)

## Running it

**Prerequisites:** Python 3.11+, Node.js 18+

**Backend:**
```bash
cd backend
pip install -r requirements.txt
python main.py
```
Starts at `http://localhost:8001`. Swagger docs at `/docs`. Task data is written to `backend/data/` and survives restarts.

**Frontend:**
```bash
npm install
npm run dev
```
Starts at `http://localhost:5173`. Vite proxies `/api/*` to the backend REST API and `/ws/*` to the WebSocket endpoint.

---

## How the pipeline works

1. **POST /tasks** - client sends a description, gets back a `task_id` (short UUID)
2. **WebSocket /ws/tasks/{id}** - client connects and receives the full task snapshot on every phase transition
3. **Planner** decomposes the request into 4 focused sub-tasks using topic-specific templates
4. **Researcher** fans out with `asyncio.gather` - all sub-tasks are researched concurrently from a curated knowledge bank
5. **Writer** synthesises findings into a structured report (title, overview, per-finding sections, conclusion)
6. **Reviewer** approves or rejects. If rejected, the Writer revises with the feedback, then the Reviewer re-reviews (bounded to one retry)

---

## Project structure

```
backend/
  main.py            # FastAPI app, all four agents, Pipeline orchestrator
  data/              # JSON files persisted per task (created at runtime)
  requirements.txt   # Python dependencies
src/
  App.tsx            # React UI - stepper, activity log, report display
  index.css          # Tailwind directives and global font
  main.tsx           # React entry point
vite.config.ts       # Dev proxy: /api→:8001, /ws→:8001
design_document.md   # Architecture decisions and trade-offs
```

---

## API reference

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/tasks` | Submit a task (returns `task_id`, 202 Accepted) |
| `GET` | `/tasks/{id}` | Retrieve a single task by ID |
| `GET` | `/tasks` | List all saved tasks (reads from disk) |
| `WS` | `/ws/tasks/{id}` | Real-time task snapshot stream |

**POST body:** `{ "description": "your research question" }`

---

## Key design decisions

- **Pipeline as a plain class** - explicit `async def run()` rather than a framework chain. Easy to read, easy to debug.
- **Push state before work** - WebSocket push happens at the *start* of each phase so the UI feels instant.
- **Typed contract** - every agent returns `AgentResult(BaseModel)`. Adding a 5th agent requires zero changes to the orchestrator.
- **Short UUIDs** - `uuid4()[:8]` avoids sequential ID enumeration while staying copy-paste friendly.
- **Concurrent research** - `asyncio.gather` runs all sub-tasks in parallel. Total time equals the slowest lookup, not the sum.

---

## Development notes

- The Vite proxy rewrites `/api/tasks` → `/tasks` on the backend. The `/api` prefix only exists in development.
- Task data is persisted to `backend/data/{task_id}.json` on every state transition. Delete this folder to start fresh.
- No authentication - this is a single-user assignment demo.