# Design Document

## Architectural Decisions
- **Agent Abstraction**: Base `Agent` class with `execute` method for consistency.
- **Orchestrator**: Central coordinator managing state and flow.
- **State Model**: Enum for task status, dict for task data.
- **API**: RESTful with POST for submit, GET for status, POST for process.

## Trade-offs
- **Polling vs Real-time**: Used manual polling for simplicity; WebSockets/SSE would be better for UX but add complexity.
- **Sync vs Async**: Async agents for simulation; in real, could be sync.
- **Hardcoded vs Dynamic**: Hardcoded for assignment; real would use LLM.

## Assumptions
- Single revision in review loop.
- No concurrent tasks.
- Agents don't fail.

## What I'd Do With More Time
- Add SSE for real-time progress.
- Error handling and retries.
- Unit tests.
- Database for persistence.
- Parallel execution for research.