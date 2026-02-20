"""
Multi-Agent Task Orchestration-Backend:
A pipeline of four agents handles each research request in sequence:
Planner decomposes the topic, Researcher runs sub-tasks concurrently,
Writer drafts a report, Reviewer approves or requests one revision.
Every phase transition is persisted to disk and pushed to the client
over WebSocket so the frontend stepper reflects the real pipeline state.
Design decisions are documented in design_document.md.
"""

from __future__ import annotations
import asyncio
import json
import os
import random
from contextlib import asynccontextmanager
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

STORE_DIR = os.path.join(os.path.dirname(__file__), "data")

def _ensure_store() -> None:
    os.makedirs(STORE_DIR, exist_ok=True)

def persist_task(task_id: str, task: dict) -> None:
    """Serialise the task to disk after every state transition."""
    _ensure_store()
    safe = json.loads(json.dumps(task, default=str))
    path = os.path.join(STORE_DIR, f"{task_id}.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(safe, fh, indent=2)

def load_all_tasks() -> List[dict]:
    """Read every saved task from disk, oldest first."""
    _ensure_store()
    tasks = []
    for name in sorted(os.listdir(STORE_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(STORE_DIR, name), encoding="utf-8") as fh:
                tasks.append(json.load(fh))
        except Exception:
            pass  
    return tasks

class Phase(str, Enum):
    QUEUED      = "queued"
    PLANNING    = "planning"
    RESEARCHING = "researching"
    DRAFTING    = "drafting"
    REVIEWING   = "reviewing"
    REVISING    = "revising"
    DONE        = "done"
    ERRORED     = "errored"

class AgentResult(BaseModel):
    """Uniform return type from every agent. Keeps the Pipeline decoupled from
    each agent's internal logic it only needs to know success and payload."""
    agent_name:    str
    phase:         str
    payload:       Dict[str, Any]
    success:       bool = True
    error_message: str  = ""

class BaseAgent:
    """Minimal base every agent inherits from. The name appears in the
    activity log, so it should be what the user would call the agent."""
    name: str = "Agent"

    async def run(self, context: dict) -> AgentResult:
        raise NotImplementedError(f"{self.__class__.__name__} must implement run()")

class PlannerAgent(BaseAgent):
    """
    Turns a free-text request into four focused, independently-researchable
    sub-tasks. Keyword matching picks topic-specific templates so the sub-tasks
    are meaningful rather than generic. Falls back to a general template for
    topics not in the predefined set.
    """
    name = "Planner"

    TOPIC_TEMPLATES: Dict[str, List[str]] = {
        "microservices_monolith": [
            "Examine where microservices genuinely improve scalability and where the gains are overstated.",
            "Identify the hidden operational costs teams consistently underestimate with microservices.",
            "Outline what a well-structured monolith does well that is easy to overlook in migration enthusiasm.",
            "Map the decision signals - team size, deployment cadence, observability maturity - that should guide the choice.",
        ],
        "remote_work": [
            "Explore documented productivity outcomes for remote software engineers across different study types.",
            "Identify the collaboration and communication failure modes specific to fully distributed teams.",
            "Examine what research says about remote work's effect on career progression and mentorship.",
            "Review organisational strategies - async culture, documentation norms - that make distributed teams work.",
        ],
        "sql_nosql": [
            "Compare consistency guarantees and transaction support between relational and document stores.",
            "Analyse how query patterns and data access shapes should drive database selection.",
            "Examine scaling stories in practice - where SQL struggles and where NoSQL introduces its own problems.",
            "Review operational concerns: schema evolution, backup strategies, and migration complexity across both families.",
        ],
        "kubernetes": [
            "Clarify what Kubernetes actually solves versus what it delegates back to the team.",
            "Survey the most common failure modes in a team's first production Kubernetes cluster.",
            "Summarise the skill requirements and learning curve for a successful rollout.",
            "Evaluate when Kubernetes is genuinely the right tool and when simpler alternatives suffice.",
        ],
    }

    GENERIC_TEMPLATE = [
        "Identify the core value proposition and why it matters in the current engineering landscape.",
        "Surface the practical trade-offs that practitioners run into once they move past the documentation.",
        "Examine the implementation and adoption considerations teams consistently underestimate.",
        "Look at how this space is evolving and what that means for decisions made today.",
    ]

    def _pick_template(self, text: str) -> List[str]:
        t = text.lower()
        if ("microservice" in t or "micro service" in t) and "monolith" in t:
            return self.TOPIC_TEMPLATES["microservices_monolith"]
        if "remote" in t and ("work" in t or "team" in t):
            return self.TOPIC_TEMPLATES["remote_work"]
        if ("sql" in t and "nosql" in t) or ("relational" in t and "document" in t):
            return self.TOPIC_TEMPLATES["sql_nosql"]
        if "kubernetes" in t or " k8s" in t:
            return self.TOPIC_TEMPLATES["kubernetes"]
        return self.GENERIC_TEMPLATE

    async def run(self, context: dict) -> AgentResult:
        task_text = context["task_description"]
        templates = self._pick_template(task_text)
        sub_tasks = [{"id": i + 1, "description": d} for i, d in enumerate(templates)]
        await asyncio.sleep(0.6)   
        return AgentResult(
            agent_name=self.name,
            phase=Phase.PLANNING,
            payload={"sub_tasks": sub_tasks},
        )

class ResearcherAgent(BaseAgent):
    """
    Produces a substantive finding for each sub-task, running all of them
    concurrently via asyncio.gather. Total research time equals the slowest
    individual lookup rather than their sum.

    The knowledge bank is organized into semantic buckets; _select_bucket
    routes each sub-task to the most relevant one via keyword matching.
    """
    name = "Researcher"

    KNOWLEDGE_BANK: Dict[str, List[str]] = {
        "scale": [
            "Independent scaling only pays off when services have genuinely different load profiles. "
            "Scaling a monolith uniformly is still cheaper below a few hundred requests per second.",

            "Horizontal pod autoscaling in Kubernetes responds within 15–30 seconds of a metric breach. "
            "That lag matters for bursty traffic - autoscaling is not the same as elastic capacity.",

            "Database-per-service is the microservices ideal but shared databases remain common in "
            "early migrations, quietly reintroducing the coupling the split was meant to eliminate.",

            "Teams that split prematurely often trade in-process function calls for HTTP calls, "
            "gaining network latency without gaining the deployment independence they expected.",
        ],
        "ops_complexity": [
            "Each service needs its own health check, retry policy, circuit breaker, and timeout budget. "
            "A ten-service system has up to 90 inter-service failure modes to reason about.",

            "Distributed tracing - Jaeger, Honeycomb, or similar - is not optional with microservices. "
            "Without it, a slow request that crosses four services is nearly impossible to diagnose.",

            "A monolith has one deployment artifact and one rollback. Coordinating a rolling deploy "
            "across twelve services with interdependent schema migrations requires explicit sequencing.",

            "Service mesh infrastructure (Istio, Linkerd) solves cross-cutting concerns like mTLS and "
            "rate limiting but adds its own operational surface area that teams must learn to manage.",
        ],
        "team_dynamics": [
            "Conway's Law is not optional. Teams that carve services without matching team boundaries "
            "end up with technically separate but socially coupled systems - the worst of both worlds.",

            "A monolith has clear ownership. A microservice that pages at 3am raises the first question: "
            "which team owns this? The runbook has to answer that before any debugging can start.",

            "Onboarding to a microservices codebase typically takes 40–60% longer than a well-structured "          
            "monolith because the mental model spans many repos, deployments, and ownership boundaries.",

            "Remote-first teams often find service boundaries beneficial because firm API contracts replace "
            "the informal coordination that co-located teams handle through proximity.",
        ],
        "decision_factors": [
            "The clearest readiness signal for microservices is existing operational maturity: strong "
            "observability, a mature CI/CD pipeline, and at least one engineer who has run distributed systems.",

            "If each team deploys less than once a week, microservices add release coordination overhead "
            "without delivering the independent deployment speed that justifies the complexity.",

            "A modular monolith is a reasonable intermediate step. Module boundaries established now can "
            "become service boundaries later, with the split deferred until scale or team size demands it.",

            "Compliance requirements - PCI, HIPAA, GDPR - sometimes mandate service isolation for audit "
            "trail clarity and blast radius control, independent of any performance argument.",
        ],
        "evolution": [
            "The strangler fig pattern - replacing monolith behaviour incrementally with services - has "
            "become the dominant migration approach because it avoids a big-bang rewrite and its risks.",

            "Internal developer platforms (Backstage, Port) are the next layer after microservices, "
            "abstracting Kubernetes complexity so product teams can deploy without owning the infrastructure.",

            "Shopify, Stack Overflow, and Prime Video have each published post-mortems describing a "
            "partial return to monolithic architecture after finding microservices introduced overhead without proportional benefit.",

            "AI-assisted code generation lowers the cost of service boilerplate, shifting the "
            "cost-benefit calculation — standing up a new service is cheaper in 2025 than it was in 2019.",
        ],
        "generic_findings": [
            "Optimising for the problem you don't have yet is the most common architecture mistake. "
            "The right choice fits today's scale and team, with clear migration paths when that changes.",

            "Documentation is the hidden cost of any distributed system. A well-documented monolith "
            "is faster to navigate for a new hire than an undocumented service mesh, regardless of code quality.",

            "Every infrastructure component you self-host is one more operational responsibility. "
            "The build-vs-buy calculus compounds quickly in distributed systems.",

            "Architectural choices matter less than engineering culture. Weak testing, poor observability, "
            "and unclear ownership produce bad outcomes regardless of whether you chose microservices or not.",
        ],
    }

    def _select_bucket(self, sub_task_text: str) -> str:
        t = sub_task_text.lower()
        if any(w in t for w in ["scale", "load", "traffic", "throughput", "horizontally", "capacity"]):
            return "scale"
        if any(w in t for w in ["operational", "cost", "complexity", "debug", "deploy", "manage"]):
            return "ops_complexity"
        if any(w in t for w in ["team", "organisation", "onboard", "ownership", "remote", "social"]):
            return "team_dynamics"
        if any(w in t for w in ["decision", "factor", "when", "choose", "right tool", "signal", "readiness"]):
            return "decision_factors"
        if any(w in t for w in ["evolv", "future", "trend", "next", "changing", "migration", "platform"]):
            return "evolution"
        return "generic_findings"

    async def _research_one(self, sub_task: dict) -> AgentResult:
        bucket  = self._select_bucket(sub_task["description"])
        finding = random.choice(self.KNOWLEDGE_BANK[bucket])
        await asyncio.sleep(random.uniform(0.7, 1.4))
        return AgentResult(
            agent_name=self.name,
            phase=Phase.RESEARCHING,
            payload={
                "sub_task_id": sub_task["id"],
                "sub_task":    sub_task["description"],
                "finding":     finding,
            },
        )

    async def run(self, context: dict) -> AgentResult:
        sub_tasks: List[dict] = context["sub_tasks"]
        results = await asyncio.gather(
            *[self._research_one(st) for st in sub_tasks],
            return_exceptions=True,
        )

        findings, errors = [], []
        for r in results:
            if isinstance(r, Exception):
                errors.append(str(r))
            elif isinstance(r, AgentResult):
                findings.append(r.payload)

        return AgentResult(
            agent_name=self.name,
            phase=Phase.RESEARCHING,
            payload={"findings": findings, "errors": errors},
            success=len(errors) == 0,
        )

class WriterAgent(BaseAgent):
    """
    Builds a structured report from the Researcher's findings.
    When given reviewer feedback (revision pass), it explicitly
    acknowledges the notes before producing a strengthened draft.
    """
    name = "Writer"

    async def run(self, context: dict) -> AgentResult:
        findings:       List[dict] = context["findings"]
        task_desc:      str        = context["task_description"]
        reviewer_notes: str        = context.get("reviewer_notes", "")
        is_revision:    bool       = bool(reviewer_notes)
        date_str = datetime.now().strftime("%d %B %Y")

        lines: List[str] = []
        lines.append("ANALYSIS REPORT")
        lines.append("=" * 62)
        lines.append(f"Topic:      {task_desc}")
        lines.append(f"Prepared:   {date_str}")
        lines.append(f"Draft:      {'Revised' if is_revision else 'Initial'}")
        lines.append("=" * 62)
        lines.append("")

        if is_revision:
            lines.append("NOTE ON THIS REVISION")
            lines.append("-" * 40)
            lines.append(
                f"Reviewer flagged: \"{reviewer_notes}\"\n"
                "This version addresses that directly each section now includes\n"
                "more specific context and the conclusion draws a clearer line\n"
                "from the findings to a practical recommendation.\n"
            )

        lines.append("OVERVIEW")
        lines.append("-" * 40)
        overview = (
            f"This report examines: {task_desc}\n\n"
            f"The analysis draws on {len(findings)} research angles, each focused on a "
            "different dimension of the problem. The goal is not a single verdict but "
            "a clear picture of the considerations that should inform a decision — "
            "because the right answer is always context-dependent."
        )
        if is_revision:
            overview += (
                "\n\nThis revised draft expands on the initial findings with additional "
                "context and makes the practical implications clearer throughout."
            )
        lines.append(overview)
        lines.append("")

        lines.append("FINDINGS")
        lines.append("-" * 40)
        for entry in findings:
            sub     = entry.get("sub_task", f"Sub-task {entry.get('sub_task_id', '')}")
            finding = entry.get("finding", "No data gathered.")
            lines.append(f"\n[{entry.get('sub_task_id', '?')}] {sub}")
            lines.append(f"    {finding}")
            if is_revision:
                lines.append(
                    "    On reflection: the degree to which this applies will vary\n"
                    "    by team size, existing tooling, and your product's current stage."
                )

        lines.append("")
        lines.append("CONCLUSION")
        lines.append("-" * 40)
        lines.append(
            "No single architecture, tool, or approach is universally correct. "
            "What the findings above show consistently is that the best choice is "
            "the one aligned with current constraints-not the one that looks best "
            "on a whiteboard.\n\n"
            "Before committing, ask: do we have the team, tooling, and operational "
            "maturity to support this? If that answer is uncertain, the safer path "
            "is usually the simpler one, with a deliberate plan for when to evolve it."
        )
        report_text = "\n".join(lines)
        await asyncio.sleep(0.9)
        return AgentResult(
            agent_name=self.name,
            phase=Phase.REVISING if is_revision else Phase.DRAFTING,
            payload={"report": report_text, "is_revision": is_revision},
        )

class ReviewerAgent(BaseAgent):
    """
    Makes a binary approve/reject decision with specific, actionable feedback.
    Approval is guaranteed on a revision pass the Writer has already addressed
    the flagged issues. First drafts are evaluated on word count as a proxy for
    depth; a real system would use an LLM rubric.
    """
    name = "Reviewer"
    APPROVAL_COMMENTS = [
        "Well-structured report. The findings are specific, the conclusion is actionable, "
        "and each section earns its place.",
        "Good work — each finding ties back to the central question and the conclusion "
        "doesn't overstate what the data supports.",
        "The report reads cleanly and the depth of each finding justifies the conclusion. Approved.",
    ]
    REJECTION_COMMENTS = [
        "The findings are present but surface-level. Each one needs a sentence explaining "
        "why it matters in practice, not just what it is.",
        "The conclusion restates the findings without synthesising them. What should a "
        "decision-maker actually take away from this?",
        "Some sections feel underdeveloped. The report needs more concrete context around "
        "each finding before it can be used to make a real decision.",
    ]

    async def run(self, context: dict) -> AgentResult:
        report:      str  = context["report"]
        is_revision: bool = context.get("is_revision", False)
        word_count = len(report.split())

        if is_revision:
            # The Writer addressed the feedback explicitly; approve unconditionally
            approved = True
            comment  = random.choice(self.APPROVAL_COMMENTS)
        elif word_count >= 150:
            approved = True
            comment  = random.choice(self.APPROVAL_COMMENTS)
        else:
            approved = False
            comment  = random.choice(self.REJECTION_COMMENTS)

        await asyncio.sleep(0.5)
        return AgentResult(
            agent_name=self.name,
            phase=Phase.REVIEWING,
            payload={
                "approved":    approved,
                "feedback":    comment,
                "word_count":  word_count,
                "is_revision": is_revision,
            },
        )

# Pipeline — the orchestration layer
class Pipeline:
    """
    Manages one task from registration through the full agent chain.
    State is broadcast to the WebSocket client *before* each slow phase
    begins, so the UI updates the moment a phase changes rather than after
    the work finishes. The revision loop is bounded to one retry.
    """

    def __init__(self) -> None:
        self.planner    = PlannerAgent()
        self.researcher = ResearcherAgent()
        self.writer     = WriterAgent()
        self.reviewer   = ReviewerAgent()
        self.registry:  Dict[str, dict]      = {}
        self.sockets:   Dict[str, WebSocket] = {}
        # Sequential ID counter — picks up where disk data left off after restarts
        existing = load_all_tasks()
        self._next_id = max((int(t.get("id", 0)) for t in existing), default=0) + 1

    async def enqueue(self, description: str) -> str:
        """Create a task record and return its ID without starting work."""
        task_id = str(self._next_id)
        self._next_id += 1
        self.registry[task_id] = self._blank_task(task_id, description)
        persist_task(task_id, self.registry[task_id])
        await self._push(task_id)
        return task_id

    async def run(self, task_id: str) -> None:
        """Execute the full pipeline for a registered task.
        Called as a background asyncio task so the HTTP response returns immediately."""
        task = self.registry[task_id]
        try:
            await self._phase_planning(task)
            await self._phase_research(task)
            initial_report = await self._phase_drafting(task)
            approved = await self._phase_review(task, initial_report, is_revision=False)

            if not approved:
                revised = await self._phase_revision(task, initial_report)
                await self._phase_review(task, revised, is_revision=True)

            task["phase"]        = Phase.DONE
            task["active_agent"] = None

        except Exception as exc:
            task["phase"]        = Phase.ERRORED
            task["active_agent"] = None
            task["error"]        = str(exc)

        persist_task(task_id, task)
        await self._push(task_id)

    def get(self, task_id: str) -> Optional[dict]:
        return self.registry.get(task_id)

    # Pipeline phases — each follows the same pattern:
    #   1. update phase + agent fields
    #   2. push to WebSocket (client sees new state immediately)
    #   3. run the agent (the slow part)
    #   4. store results + persist

    async def _phase_planning(self, task: dict) -> None:
        self._transition(task, Phase.PLANNING, self.planner.name)
        await self._push(task["id"])
        result = await self.planner.run({"task_description": task["description"]})
        task["sub_tasks"] = result.payload["sub_tasks"]
        self._log(task, result)
        persist_task(task["id"], task)

    async def _phase_research(self, task: dict) -> None:
        self._transition(task, Phase.RESEARCHING, self.researcher.name)
        await self._push(task["id"])
        result = await self.researcher.run({"sub_tasks": task["sub_tasks"]})
        task["findings"] = result.payload.get("findings", [])
        self._log(task, result)
        persist_task(task["id"], task)

    async def _phase_drafting(self, task: dict) -> str:
        self._transition(task, Phase.DRAFTING, self.writer.name)
        await self._push(task["id"])
        result = await self.writer.run({
            "findings":         task["findings"],
            "task_description": task["description"],
        })
        report = result.payload["report"]
        task["initial_report"] = report
        self._log(task, result)
        persist_task(task["id"], task)
        return report

    async def _phase_review(self, task: dict, report: str, is_revision: bool) -> bool:
        self._transition(task, Phase.REVIEWING, self.reviewer.name)
        result = await self.reviewer.run({"report": report, "is_revision": is_revision})
        task["reviewer_feedback"] = result.payload["feedback"]
        task["approved"]          = result.payload["approved"]
        self._log(task, result)
        persist_task(task["id"], task)
        await self._push(task["id"])   # push after review so feedback is included
        return result.payload["approved"]

    async def _phase_revision(self, task: dict, original_report: str) -> str:
        self._transition(task, Phase.REVISING, self.writer.name)
        await self._push(task["id"])
        result = await self.writer.run({
            "findings":         task["findings"],
            "task_description": task["description"],
            "reviewer_notes":   task["reviewer_feedback"],
        })
        task["revised_report"] = result.payload["report"]
        self._log(task, result)
        persist_task(task["id"], task)
        return task["revised_report"]

    # Internal helpers

    def _blank_task(self, task_id: str, description: str) -> dict:
        return {
            "id":               task_id,
            "description":      description,
            "phase":            Phase.QUEUED,
            "active_agent":     None,
            "sub_tasks":        [],
            "findings":         [],
            "initial_report":   "",
            "revised_report":   "",
            "reviewer_feedback": "",
            "approved":         False,
            "activity_log":     [],
            "queued_at":        datetime.now().isoformat(),
        }

    def _transition(self, task: dict, phase: Phase, agent_name: str) -> None:
        task["phase"]        = phase
        task["active_agent"] = agent_name

    def _log(self, task: dict, result: AgentResult) -> None:
        task["activity_log"].append({
            "agent":     result.agent_name,
            "phase":     result.phase,
            "success":   result.success,
            "data":      result.payload,
            "logged_at": datetime.now().isoformat(),
        })

    async def _push(self, task_id: str) -> None:
        """Push the current task snapshot to the connected WebSocket, if any."""
        ws = self.sockets.get(task_id)
        if ws is None:
            return
        try:
            safe = json.loads(json.dumps(self.registry[task_id], default=str))
            await ws.send_json(safe)
        except Exception:
            pass   # client disconnected — nothing to do

# Application setup
pipeline = Pipeline()

@asynccontextmanager
async def lifespan(app: FastAPI):
    _ensure_store()
    print("Orchestration service ready.")
    print(f"  API:       http://localhost:8002")
    print(f"  Docs:      http://localhost:8002/docs")
    print(f"  WS:        ws://localhost:8002/ws/tasks/{{task_id}}")
    print(f"  Data:      {STORE_DIR}")
    yield

app = FastAPI(
    title="Multi-Agent Orchestration API",
    description="Orchestrates Planner, Researcher, Writer, and Reviewer agents for research tasks.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# HTTP routes

class SubmitRequest(BaseModel):
    description: str


@app.post("/tasks", status_code=202, summary="Submit a new task")
async def submit_task(body: SubmitRequest):
    """
    Register a task and kick off the pipeline in the background.
    Returns a task_id the client uses to open the WebSocket for live updates.
    202 Accepted is correct here-the work isn't done, it's queued.
    """
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="Task description cannot be empty.")
    task_id = await pipeline.enqueue(body.description.strip())
    asyncio.create_task(pipeline.run(task_id))
    return {"task_id": task_id, "message": "Task accepted. Open the WebSocket for live updates."}

@app.get("/tasks/{task_id}", summary="Get a task by ID")
async def get_task(task_id: str):
    task = pipeline.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"No task with id '{task_id}'.")
    return task

@app.get("/tasks", summary="List all tasks")
async def list_tasks():
    """Reads from disk-survives server restarts."""
    return load_all_tasks()

@app.websocket("/ws/tasks/{task_id}")
async def task_websocket(websocket: WebSocket, task_id: str):
    """
    Client connects here after POST /tasks. The server pushes a full task
    snapshot on every phase transition. The loop keeps the connection open
    until the task finishes or the client disappears.
    """
    await websocket.accept()
    pipeline.sockets[task_id] = websocket
    # Send current state immediately so the client doesn't wait for the next push
    task = pipeline.get(task_id)
    if task:
        await websocket.send_json(json.loads(json.dumps(task, default=str)))
    try:
        while True:
            # We don't expect inbound messages but we need to stay in the loop
            # so WebSocketDisconnect is raised when the client goes away.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        pipeline.sockets.pop(task_id, None)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8002, reload=True)