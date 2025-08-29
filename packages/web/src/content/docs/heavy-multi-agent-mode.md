# Heavy Multi-Agent Mode

Heavy Multi-Agent Mode introduces a Planner → Executor → Synthesizer workflow for complex queries.

## Overview

- Planner: Decomposes the user's query into sub-tasks and emits a plan for approval.
- Executor: Runs sub-tasks in parallel with a configurable concurrency limit and tool controls.
- Synthesizer: Produces the final response using only the executor reports.

## How to use

Send a chat with `mode: "heavy"`:

```ts
await client.session.chat({
  params: {
    id: sessionID,
  },
  body: {
    providerID: "openai",
    modelID: "gpt-4o-mini",
    mode: "heavy",
    parts: [{ type: "text", text: "Compare Rust vs Go for web backends" }],
  },
})
```

The TUI will display the generated plan and ask for approval (Y/n). After approval, you will see a live dashboard of sub-task progress, followed by the synthesized final answer streamed in the same message.

## Configuration (`opencode.json`)

```jsonc
{
  "heavy": {
    "planner_model": "openai/gpt-4o-mini",
    "synthesizer_model": "anthropic/claude-3-5-sonnet",
    "max_concurrent_agents": 3,
    "strategy": "parallel",
    "agent_pool_models": [
      "openai/gpt-4o-mini",
      "anthropic/claude-3-haiku"
    ],
    "tools": {
      "read_only": true,
      "allowed_tools": ["webfetch", "read"],
      "denied_tools": ["bash", "edit", "write", "patch"]
    },
    "retry": {
      "max_attempts": 3,
      "backoff_ms": 1000,
      "rotate_models": true,
      "fail_on_empty": true
    }
  }
}
```

## Events

- `heavy.plan.generated`: Emitted after the planner produces a plan.
- `heavy.task.started`: Fired when a sub-task begins.
- `heavy.task.completed`: Fired when a sub-task finishes successfully.
- `heavy.task.failed`: Fired when a sub-task fails.
- `heavy.synthesis.started`: Fired when the synthesizer stage starts.

## Notes

- Costs and latency can be higher than single-agent mode; the plan approval helps avoid wasted runs.
- Tool whitelisting/blacklisting is enforced per sub-agent.

## Examples

### Example 1: TUI usage

1. Open the TUI and submit a prompt like: "Plan a migration from MongoDB to PostgreSQL for our service."
2. Review the generated plan and press `Y` to approve.
3. Watch the dashboard as sub-tasks execute, then read the synthesized final answer.

Suggested config:

```jsonc
{
  "heavy": {
    "planner_model": "openai/gpt-4o-mini",
    "synthesizer_model": "anthropic/claude-3-5-sonnet",
    "max_concurrent_agents": 3,
    "tools": { "read_only": true, "allowed_tools": ["read"] }
  }
}
```

### Example 2: JS SDK with plan approval

```ts
import { OpencodeClient } from "@opencode-ai/sdk"

const client = new OpencodeClient()
const session = await client.session.create()

// Subscribe to events to receive the plan and progress
const events = client.event.subscribe()
;(async () => {
  for await (const evt of events) {
    if (evt.type === "heavy.plan.generated") {
      // Approve immediately for demo purposes
      await client.session.heavy.respondPlan({
        params: { id: session.id },
        body: { approved: true },
      })
    }
  }
})()

// Send heavy-mode chat
await client.session.chat({
  params: { id: session.id },
  body: {
    providerID: "openai",
    modelID: "gpt-4o-mini",
    mode: "heavy",
    parts: [{ type: "text", text: "Create a release plan for v2.0 with risk assessment." }],
  },
})
```

### Example 3: Agent pool round-robin

```jsonc
{
  "heavy": {
    "agent_pool_models": [
      "openai/gpt-4o-mini",
      "anthropic/claude-3-haiku"
    ],
    "max_concurrent_agents": 2
  }
}
```



