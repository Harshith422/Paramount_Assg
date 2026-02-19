# Multi-Agent Task Orchestration System

## Overview
This project implements a lightweight platform where multiple AI agents collaborate to complete complex tasks, such as researching and generating reports.

## Architecture
- **Backend**: Python FastAPI service with agent abstractions and orchestrator.
- **Frontend**: React app for user interaction.

## Setup
1. Backend:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

2. Frontend:
   ```bash
   npm install
   npm run dev
   ```

## Usage
- Start backend on http://localhost:8000
- Start frontend on http://localhost:5173
- Submit a task, process it, check status.

## Design Decisions
- Used FastAPI for async support.
- Agents are async for simulation.
- Simple polling for status; could add WebSockets for real-time.

## Trade-offs
- Polling vs SSE: Polling is simple but less efficient; SSE better for real-time.
- Hardcoded responses: Keeps it simple, no real LLM.

## Future Improvements
- Add error handling.
- Parallel research.
- Persistent storage.
- Real-time updates with SSE.