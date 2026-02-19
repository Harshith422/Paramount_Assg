# Multi-Agent Task Orchestration System

## Overview
This project implements a lightweight platform where multiple AI agents collaborate to complete complex tasks, such as researching and generating reports. Features real-time WebSocket updates, parallel agent execution, and comprehensive error handling.

## Architecture
- **Backend**: FastAPI service with agent abstractions, orchestrator, WebSocket real-time updates, and parallel processing
- **Frontend**: React app with real-time progress visualization and interactive UI

## Key Features
- ✅ **Real-time Updates**: WebSocket connections for live progress tracking
- ✅ **Parallel Processing**: Multiple researchers work simultaneously
- ✅ **Error Handling**: Robust failure recovery and status tracking
- ✅ **Interactive UI**: Modern React interface with progress indicators
- ✅ **Agent Pipeline**: Planner → Researchers (parallel) → Writer → Reviewer

## Setup
1. **Backend**:
   ```bash
   cd backend
   pip install -r requirements.txt
   uvicorn main:app --reload
   ```

2. **Frontend**:
   ```bash
   npm install
   npm run dev
   ```

## Usage
- **Backend**: `http://localhost:8000`
- **Frontend**: `http://localhost:5173`
- **API Docs**: `http://localhost:8000/docs`

Submit a task, watch agents collaborate in real-time, and view the final report.

## API Endpoints
- `POST /tasks` - Submit task
- `GET /tasks/{id}` - Get status
- `POST /tasks/{id}/process` - Process task
- `WebSocket /ws/tasks/{id}` - Real-time updates

## Architecture Decisions
- **WebSocket over Polling**: Provides instant updates without constant requests
- **Parallel Research**: Researchers execute concurrently for efficiency
- **Async Agents**: All agents are async for non-blocking execution
- **State Broadcasting**: Real-time state sync between backend and frontend

## Trade-offs
- **WebSocket vs SSE**: WebSocket chosen for bidirectional communication
- **Parallel vs Sequential**: Parallel research improves performance but increases complexity
- **In-memory State**: Simple but not persistent (could add database for production)

## Future Improvements
- Database persistence for task history
- User authentication and multi-user support
- Configurable agent pipelines
- Advanced error recovery strategies
- Performance monitoring and metrics