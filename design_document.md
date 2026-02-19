# Design Document

## Architectural Decisions
- **Agent Abstraction**: Base `Agent` class with async `execute` method for consistency and non-blocking operations.
- **Orchestrator**: Central coordinator managing state, flow, and WebSocket connections.
- **State Model**: Enum for task status, dict for task data with history tracking.
- **Real-time Communication**: WebSocket endpoint for instant UI updates.
- **Parallel Processing**: `asyncio.gather` for concurrent researcher execution.
- **Error Handling**: Try-catch blocks with failure status and error messages.

## Trade-offs
- **WebSocket vs Polling**: WebSocket provides instant updates and better UX, but requires more setup than simple polling.
- **Parallel vs Sequential**: Parallel research improves performance and realism, but adds complexity with `asyncio.gather`.
- **In-memory vs Database**: In-memory state is simple and fast, but not persistent (acceptable for demo).
- **Hardcoded vs Dynamic**: Hardcoded responses keep it focused on orchestration, not LLM integration.

## Assumptions
- WebSocket connections are reliable (basic error handling included).
- Parallel execution doesn't cause resource conflicts.
- Single revision in review loop (configurable).
- No concurrent tasks per user (state isolation).

## What I'd Do With More Time
- **Database Integration**: PostgreSQL with SQLAlchemy for task persistence.
- **User Authentication**: JWT-based auth with user-specific task isolation.
- **Advanced Error Recovery**: Retry mechanisms with exponential backoff.
- **Monitoring**: Prometheus metrics and logging.
- **Testing**: Comprehensive unit tests and integration tests.
- **Scalability**: Redis for state management, message queues for agent communication.
- **UI Enhancements**: Agent avatars, progress animations, dark mode.