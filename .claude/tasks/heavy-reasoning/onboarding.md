# Task Onboarding: Heavy Reasoning Agent

## Overview

Implement a "Heavy Reasoning Agent" that uses a Map-Reduce pattern to solve complex queries. The agent decomposes queries into sub-tasks, executes them in parallel using sub-agents, and synthesizes the results.

## Constraints

- **Fork Friendly**: Minimize changes to existing files to reduce merge conflicts when syncing with upstream.
- **Architecture**: Implemented as a Core feature (not a plugin) to support custom UI requirements.

## Architecture

### Backend

1.  **New Tool**: `map_reduce`
    - **File**: `packages/opencode/src/tool/map_reduce.ts` (New file)
    - **Prompt**: `packages/opencode/src/tool/map_reduce.txt` (New file)
    - **Logic**:
      - Spawns multiple sessions via `Session.create` in parallel.
      - Subscribes to `Bus` events to track progress of all sessions.
      - Updates tool metadata with `tasks: Array<{ id, description, status, sessionId }>` for real-time UI updates.
      - Waits for all sessions to complete (or error).
      - Aggregates outputs into a final text response.

2.  **New Agent**: `heavy`
    - **Prompt**: `packages/opencode/src/agent/prompt/heavy.txt` (New file).
    - **Registration**: Minimal edit to `packages/opencode/src/agent/agent.ts` to register the agent and permissions.

### Frontend (TUI)

1.  **New Component**: `MapReduceTool`
    - **File**: `packages/opencode/src/cli/cmd/tui/routes/session/tool-map-reduce.tsx` (New file).
    - **Responsibility**: Render the dashboard view (list of tasks with status icons) and handle navigation events.
2.  **Integration**:
    - **File**: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
    - **Change**: Add import and a single `<Match>` case to the `ToolPart` component.

## Implementation Steps

### 1. Backend Logic

- [x] Create `packages/opencode/src/tool/map_reduce.txt` (Prompt description).
- [x] Create `packages/opencode/src/tool/map_reduce.ts` (Tool implementation).
- [x] Register tool in `packages/opencode/src/tool/registry.ts`.

### 2. Agent Logic

- [x] Create `packages/opencode/src/agent/prompt/heavy.txt`.
- [x] Register agent in `packages/opencode/src/agent/agent.ts`.

### 3. Frontend UI

- [x] Create `packages/opencode/src/cli/cmd/tui/routes/session/tool-map-reduce.tsx`.
- [x] Update `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` to use the new component.

## Data Structures

### Tool Metadata

The `map_reduce` tool will output metadata in this format for the UI:

```typescript
type MapReduceMetadata = {
  tasks: Array<{
    id: string
    description: string
    subagent: string
    sessionId: string
    status: "pending" | "running" | "completed" | "error"
    error?: string
  }>
  summary?: string // Final synthesized answer
}
```
