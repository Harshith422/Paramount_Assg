from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import List, Dict
from enum import Enum
import asyncio
from fastapi.middleware.cors import CORSMiddleware
import json

class TaskStatus(Enum):
    PENDING = "pending"
    PLANNING = "planning"
    RESEARCHING = "researching"
    WRITING = "writing"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    FAILED = "failed"

class Agent:
    def __init__(self, name: str):
        self.name = name

    async def execute(self, input_data: dict) -> dict:
        raise NotImplementedError

class PlannerAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        task = input_data['task']
        # Simulate planning
        subtasks = [
            {"id": 1, "description": "Research pros of microservices"},
            {"id": 2, "description": "Research cons of microservices"},
            {"id": 3, "description": "Research pros of monoliths"},
            {"id": 4, "description": "Research cons of monoliths"}
        ]
        await asyncio.sleep(0.5)  # Simulate delay
        return {"subtasks": subtasks, "status": "completed"}

class ResearcherAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        subtask = input_data['subtask']
        # Simulate research with possible failure
        if "failure" in subtask.lower():  # Simulate failure for testing
            await asyncio.sleep(0.2)
            return {"research": "", "status": "failed", "error": "Research failed"}
        
        if "pros" in subtask and "microservices" in subtask:
            info = "Microservices offer scalability, independent deployment, and technology diversity."
        elif "cons" in subtask and "microservices" in subtask:
            info = "Microservices increase complexity, require more infrastructure, and can have latency issues."
        elif "pros" in subtask and "monoliths" in subtask:
            info = "Monoliths are simpler to develop, deploy, and debug."
        elif "cons" in subtask and "monoliths" in subtask:
            info = "Monoliths are harder to scale, maintain, and update."
        else:
            info = "General information on the topic."
        await asyncio.sleep(1)  # Simulate delay
        return {"research": info, "status": "completed"}

class WriterAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        researches = input_data['researches']
        # Simulate writing
        report = "Summary Report:\n"
        for res in researches:
            report += res + "\n"
        await asyncio.sleep(0.5)  # Simulate delay
        return {"report": report, "status": "completed"}

class ReviewerAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        report = input_data['report']
        # Simulate review
        if len(report) < 100:
            return {"feedback": "Report is too short. Please expand.", "approved": False, "status": "needs_revision"}
        else:
            return {"feedback": "Report looks good.", "approved": True, "status": "completed"}
        await asyncio.sleep(0.3)  # Simulate delay

class Orchestrator:
    def __init__(self):
        self.planner = PlannerAgent("Planner")
        self.researcher = ResearcherAgent("Researcher")
        self.writer = WriterAgent("Writer")
        self.reviewer = ReviewerAgent("Reviewer")
        self.tasks = {}
        self.connections: Dict[str, WebSocket] = {}

    async def submit_task(self, task_description: str) -> str:
        task_id = str(len(self.tasks) + 1)
        self.tasks[task_id] = {
            "id": task_id,
            "description": task_description,
            "status": TaskStatus.PENDING.value,
            "subtasks": [],
            "researches": [],
            "report": "",
            "feedback": "",
            "history": [],
            "current_agent": None
        }
        await self.broadcast_update(task_id)
        return task_id

    async def process_task(self, task_id: str) -> Dict:
        task = self.tasks[task_id]
        try:
            if task["status"] == TaskStatus.PENDING.value:
                task["status"] = TaskStatus.PLANNING.value
                task["current_agent"] = "Planner"
                await self.broadcast_update(task_id)
                plan_result = await self.planner.execute({"task": task["description"]})
                task["subtasks"] = plan_result["subtasks"]
                task["history"].append({"agent": "Planner", "output": plan_result})
                task["status"] = TaskStatus.RESEARCHING.value

            if task["status"] == TaskStatus.RESEARCHING.value:
                task["current_agent"] = "Researcher"
                await self.broadcast_update(task_id)
                # Run researchers in parallel
                research_tasks = [
                    self.researcher.execute({"subtask": subtask["description"]})
                    for subtask in task["subtasks"]
                ]
                research_results = await asyncio.gather(*research_tasks, return_exceptions=True)
                
                for i, result in enumerate(research_results):
                    if isinstance(result, Exception):
                        task["researches"].append(f"Error in research {i+1}: {str(result)}")
                        task["history"].append({"agent": "Researcher", "output": {"status": "failed", "error": str(result)}})
                    else:
                        task["researches"].append(result.get("research", ""))
                        task["history"].append({"agent": "Researcher", "output": result})
                
                task["status"] = TaskStatus.WRITING.value

            if task["status"] == TaskStatus.WRITING.value:
                task["current_agent"] = "Writer"
                await self.broadcast_update(task_id)
                write_result = await self.writer.execute({"researches": task["researches"]})
                task["report"] = write_result["report"]
                task["history"].append({"agent": "Writer", "output": write_result})
                task["status"] = TaskStatus.REVIEWING.value

            if task["status"] == TaskStatus.REVIEWING.value:
                task["current_agent"] = "Reviewer"
                await self.broadcast_update(task_id)
                review_result = await self.reviewer.execute({"report": task["report"]})
                task["feedback"] = review_result["feedback"]
                task["history"].append({"agent": "Reviewer", "output": review_result})
                if review_result["approved"]:
                    task["status"] = TaskStatus.COMPLETED.value
                else:
                    # For simplicity, assume one revision
                    task["report"] += "\nRevised: " + task["feedback"]
                    task["status"] = TaskStatus.COMPLETED.value
            
            task["current_agent"] = None
            await self.broadcast_update(task_id)
            
        except Exception as e:
            task["status"] = TaskStatus.FAILED.value
            task["error"] = str(e)
            await self.broadcast_update(task_id)
        
        return task

    def get_task_status(self, task_id: str) -> Dict:
        return self.tasks.get(task_id, {})

    async def broadcast_update(self, task_id: str):
        """Send real-time updates to connected WebSocket clients"""
        if task_id in self.connections:
            try:
                await self.connections[task_id].send_json(self.tasks[task_id])
            except:
                pass  # Client disconnected

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

orchestrator = Orchestrator()

class TaskRequest(BaseModel):
    description: str

@app.post("/tasks")
async def create_task(request: TaskRequest):
    task_id = await orchestrator.submit_task(request.description)
    return {"task_id": task_id}

@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = orchestrator.get_task_status(task_id)
    if not task:
        return {"error": "Task not found"}
    return task

@app.post("/tasks/{task_id}/process")
async def process_task(task_id: str):
    if task_id not in orchestrator.tasks:
        return {"error": "Task not found"}
    result = await orchestrator.process_task(task_id)
    return result

@app.websocket("/ws/tasks/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    orchestrator.connections[task_id] = websocket
    try:
        # Send initial state
        if task_id in orchestrator.tasks:
            await websocket.send_json(orchestrator.tasks[task_id])
        
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
            # Could handle client messages here if needed
    except WebSocketDisconnect:
        if task_id in orchestrator.connections:
            del orchestrator.connections[task_id]
    PENDING = "pending"
    PLANNING = "planning"
    RESEARCHING = "researching"
    WRITING = "writing"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    FAILED = "failed"

class Agent:
    def __init__(self, name: str):
        self.name = name

    async def execute(self, input_data: dict) -> dict:
        raise NotImplementedError

class PlannerAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        task = input_data['task']
        # Simulate planning
        subtasks = [
            {"id": 1, "description": "Research pros of microservices"},
            {"id": 2, "description": "Research cons of microservices"},
            {"id": 3, "description": "Research pros of monoliths"},
            {"id": 4, "description": "Research cons of monoliths"}
        ]
        await asyncio.sleep(0.1)  # Simulate delay
        return {"subtasks": subtasks, "status": "completed"}

class ResearcherAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        subtask = input_data['subtask']
        # Simulate research
        if "pros" in subtask and "microservices" in subtask:
            info = "Microservices offer scalability, independent deployment, and technology diversity."
        elif "cons" in subtask and "microservices" in subtask:
            info = "Microservices increase complexity, require more infrastructure, and can have latency issues."
        elif "pros" in subtask and "monoliths" in subtask:
            info = "Monoliths are simpler to develop, deploy, and debug."
        elif "cons" in subtask and "monoliths" in subtask:
            info = "Monoliths are harder to scale, maintain, and update."
        else:
            info = "General information on the topic."
        await asyncio.sleep(0.1)  # Simulate delay
        return {"research": info, "status": "completed"}

class WriterAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        researches = input_data['researches']
        # Simulate writing
        report = "Summary Report:\n"
        for res in researches:
            report += res + "\n"
        await asyncio.sleep(0.1)  # Simulate delay
        return {"report": report, "status": "completed"}

class ReviewerAgent(Agent):
    async def execute(self, input_data: dict) -> dict:
        report = input_data['report']
        # Simulate review
        if len(report) < 100:
            return {"feedback": "Report is too short. Please expand.", "approved": False, "status": "needs_revision"}
        else:
            return {"feedback": "Report looks good.", "approved": True, "status": "completed"}
        await asyncio.sleep(0.1)  # Simulate delay

class Orchestrator:
    def __init__(self):
        self.planner = PlannerAgent("Planner")
        self.researcher = ResearcherAgent("Researcher")
        self.writer = WriterAgent("Writer")
        self.reviewer = ReviewerAgent("Reviewer")
        self.tasks = {}

    async def submit_task(self, task_description: str) -> str:
        task_id = str(len(self.tasks) + 1)
        self.tasks[task_id] = {
            "id": task_id,
            "description": task_description,
            "status": TaskStatus.PENDING.value,
            "subtasks": [],
            "researches": [],
            "report": "",
            "feedback": "",
            "history": []
        }
        return task_id

    async def process_task(self, task_id: str) -> Dict:
        task = self.tasks[task_id]
        if task["status"] == TaskStatus.PENDING.value:
            task["status"] = TaskStatus.PLANNING.value
            plan_result = await self.planner.execute({"task": task["description"]})
            task["subtasks"] = plan_result["subtasks"]
            task["history"].append({"agent": "Planner", "output": plan_result})
            task["status"] = TaskStatus.RESEARCHING.value

        if task["status"] == TaskStatus.RESEARCHING.value:
            for subtask in task["subtasks"]:
                res_result = await self.researcher.execute({"subtask": subtask["description"]})
                task["researches"].append(res_result["research"])
                task["history"].append({"agent": "Researcher", "output": res_result})
            task["status"] = TaskStatus.WRITING.value

        if task["status"] == TaskStatus.WRITING.value:
            write_result = await self.writer.execute({"researches": task["researches"]})
            task["report"] = write_result["report"]
            task["history"].append({"agent": "Writer", "output": write_result})
            task["status"] = TaskStatus.REVIEWING.value

        if task["status"] == TaskStatus.REVIEWING.value:
            review_result = await self.reviewer.execute({"report": task["report"]})
            task["feedback"] = review_result["feedback"]
            task["history"].append({"agent": "Reviewer", "output": review_result})
            if review_result["approved"]:
                task["status"] = TaskStatus.COMPLETED.value
            else:
                # For simplicity, assume one revision
                task["report"] += "\nRevised: " + task["feedback"]
                task["status"] = TaskStatus.COMPLETED.value

        return task

    def get_task_status(self, task_id: str) -> Dict:
        return self.tasks.get(task_id, {})

app = FastAPI()

orchestrator = Orchestrator()

class TaskRequest(BaseModel):
    description: str

@app.post("/tasks")
async def create_task(request: TaskRequest):
    task_id = await orchestrator.submit_task(request.description)
    return {"task_id": task_id}

@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = orchestrator.get_task_status(task_id)
    if not task:
        return {"error": "Task not found"}
    return task

@app.post("/tasks/{task_id}/process")
async def process_task(task_id: str):
    if task_id not in orchestrator.tasks:
        return {"error": "Task not found"}
    result = await orchestrator.process_task(task_id)
    return result