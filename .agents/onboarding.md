# Heavy Multi-Agent Mode Onboarding

## Overview

The Heavy Multi-Agent Mode is a sophisticated workflow system that introduces a three-phase approach to handling complex queries:

1. **Planner Phase**: Decomposes user queries into independent, parallelizable sub-tasks
2. **Executor Phase**: Runs sub-tasks concurrently using configurable agent pools
3. **Synthesizer Phase**: Combines all results into a coherent final answer

## Architecture Components

### Core Files

#### `/packages/opencode/src/session/heavy.ts` (621 lines)
**Primary implementation file** containing:
- `PlannerOutput` schema and validation
- Three main workflow functions: `_runPlannerAgent()`, `_runExecutorAgents()`, `_runSynthesizerAgent()`
- State management for heavy plans, approvals, and results
- Event publishing for real-time progress tracking
- Configuration-driven concurrency limits and model pools

#### `/packages/opencode/src/session/prompt/heavy_planner.txt`
**Planner agent prompt** that instructs the AI to:
- Break user queries into 3-8 independent sub-tasks
- Ensure parallelizable, non-overlapping tasks
- Output strictly minified JSON format
- Include clear deliverables for each task

#### `/packages/opencode/src/session/prompt/heavy_synthesizer.txt`
**Synthesizer agent prompt** that:
- Takes original query + all executor reports
- Produces well-structured, coherent final answer
- Handles missing information and contradictions
- Uses source fidelity (only uses provided reports)

#### `/packages/opencode/src/session/index.ts`
**Integration point** where heavy mode is triggered:
- Chat input schema includes `mode: "heavy"` option
- Heavy workflow function is called instead of regular chat
- State management for plans, approvals, and results
- Event broadcasting for UI updates

### Supporting Files

#### `/packages/web/src/content/docs/heavy-multi-agent-mode.md`
**User documentation** covering:
- How to use heavy mode (API examples)
- Configuration options
- Event system
- JS SDK integration examples

#### `/packages/sdk/go/sessionheavy.go`
**Go SDK integration** for:
- Plan approval/rejection via `RespondPlan()` method
- Event handling for heavy mode workflow

#### `/packages/tui/internal/tui/tui.go`
**Terminal UI integration** with:
- Real-time dashboard showing sub-task progress
- Plan approval prompts (Y/n)
- Event handlers for all heavy mode phases

## Three-Phase Workflow

### Phase 1: Planning
```typescript
// From heavy.ts lines 120-252
async function _runPlannerAgent(input: Session.ChatInput): Promise<PlannerOutput>
```

1. **Model Selection**: Uses `cfg.heavy?.planner_model` or falls back to current model
2. **Query Extraction**: Extracts text content from input parts
3. **System Prompt**: Combines header + heavy_planner.txt
4. **Structured Generation**: Attempts `generateObject()` first, falls back to text generation
5. **JSON Parsing**: Robust parsing with error handling and validation
6. **Event Publishing**: Emits `Heavy.PlanGenerated` event

### Phase 2: Execution
```typescript
// From heavy.ts lines 364-470
async function _runExecutorAgents(plan: PlannerOutput, ...): Promise<ExecutorTaskResult[]>
```

1. **Concurrency Control**: `Math.max(1, cfg.heavy?.max_concurrent_agents ?? 3)`
2. **Model Pool Selection**: Cycles through `agent_pool_models` or uses current model
3. **Child Session Creation**: Each task gets its own isolated session
4. **Tool Configuration**: Applies heavy-specific tool restrictions
5. **Parallel Execution**: Uses `runWithConcurrency()` for efficient batching
6. **Output Processing**: Formats results as "report" or "full_text" based on config
7. **Event Publishing**: `Heavy.TaskStarted`, `Heavy.TaskCompleted`, `Heavy.TaskFailed`

### Phase 3: Synthesis
```typescript
// From heavy.ts lines 472-531
async function _runSynthesizerAgent(args: {...}): Promise<void>
```

1. **Model Selection**: Uses `cfg.heavy?.synthesizer_model` or current model
2. **Report Aggregation**: Collects successful task reports, filters empty ones
3. **System Prompt**: Uses heavy_synthesizer.txt
4. **Streaming Response**: Uses `streamText()` for real-time output
5. **Event Publishing**: `Heavy.SynthesisStarted`, `Heavy.SynthesisCompleted`

## Configuration System

### opencode.json Configuration
```json
{
  "heavy": {
    "planner_model": "openai/gpt-4o-mini",
    "synthesizer_model": "anthropic/claude-3-5-sonnet",
    "max_concurrent_agents": 3,
    "strategy": "parallel",
    "agent_pool_models": ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"],
    "sub_agent_output": "report",
    "save_agent_work": false,
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

### Key Configuration Features

- **Model Specialization**: Different models for planning, execution, and synthesis
- **Concurrency Limits**: Controls parallel execution load
- **Tool Sandboxing**: Fine-grained control over what tools sub-agents can use
- **Output Modes**: "report" vs "full_text" for different verbosity levels
- **Model Pools**: Load balancing across multiple models
- **Retry Logic**: Automatic retries with model rotation

## Event System

### Heavy-Specific Events
```typescript
export const Heavy = {
  PlanGenerated: Bus.event("heavy.plan.generated", ...),
  TaskStarted: Bus.event("heavy.task.started", ...),
  TaskCompleted: Bus.event("heavy.task.completed", ...),
  TaskFailed: Bus.event("heavy.task.failed", ...),
  SynthesisStarted: Bus.event("heavy.synthesis.started", ...),
  SynthesisCompleted: Bus.event("heavy.synthesis.completed", ...),
}
```

### Integration Points
- **TUI**: Real-time progress dashboard
- **Web SDK**: Event streaming for UI updates
- **Go SDK**: Plan approval workflow
- **State Management**: Tracks heavy workflow state across sessions

## Message Types and State Management

### HeavyPlanPart
```typescript
export const HeavyPlanPart = PartBase.extend({
  type: z.literal("heavy_plan"),
  plan: z.any(), // PlannerOutput
})
```

### State Management
```typescript
export type HeavyState = {
  heavyPlan: Map<string, PlannerOutput>
  heavyApproval: Map<string, (approved: boolean) => void>
  heavyResults: Map<string, ExecutorTaskResult[]>
}
```

## Tool Control System

### Per-Agent Tool Restrictions
```typescript
// From heavy.ts lines 402-418
const heavyTools = cfg.heavy?.tools
const toolOverrides: Record<string, boolean> = {}

if (heavyTools?.read_only) {
  for (const id of ["edit", "write", "patch", "bash", "todowrite"]) {
    toolOverrides[id] = false
  }
}
```

### Configuration Options
- **read_only**: Disables all file modification tools
- **allowed_tools**: Whitelist approach
- **denied_tools**: Blacklist approach
- **Agent-level control**: Tools can be restricted per agent type

## Error Handling and Resilience

### Planner Failures
- Falls back from `generateObject()` to `generateText()` with JSON instruction
- Extracts JSON from raw text using regex patterns
- Validates against `PlannerOutputSchema`
- Returns raw text if parsing fails completely

### Executor Failures
- Each task failure is isolated - doesn't stop other tasks
- Failed tasks are marked with error details
- Synthesizer handles missing reports explicitly

### Synthesis Failures
- Streaming approach allows partial results
- Error handling through the processor system
- Graceful degradation with error reporting

## SDK Integrations

### JavaScript SDK
```typescript
await client.session.chat({
  params: { id: sessionID },
  body: {
    providerID: "openai",
    modelID: "gpt-4o-mini",
    mode: "heavy",
    parts: [{ type: "text", text: "Compare Rust vs Go for web backends" }]
  }
})
```

### Go SDK
```go
res, err := client.SessionHeavy.RespondPlan(ctx, sessionID, SessionHeavyRespondPlanParams{
    Approved: param.Field[bool]{Value: true, Set: true},
})
```

## TUI Experience

### Plan Approval Flow
1. User submits query with heavy mode
2. Planner generates plan
3. TUI displays plan and asks "Approve plan? (Y/n)"
4. User approves or rejects
5. If approved, live dashboard shows sub-task progress
6. Final synthesized answer streams in

### Real-time Dashboard
- Shows each sub-task status (pending/running/completed/failed)
- Updates in real-time via event system
- Displays model information and timing
- Handles errors gracefully

## Performance Considerations

### Cost Management
- Separate models for different phases allow cost optimization
- Planner can use cheaper/faster models
- Synthesizer can use more capable models
- Concurrent execution maximizes throughput

### Latency Optimization
- Parallel execution of sub-tasks
- Configurable concurrency limits
- Streaming synthesis for immediate results
- Tool result caching

### Resource Management
- Session isolation for each sub-task
- Memory management through Map-based state
- Event-driven architecture reduces polling
- Abort signals for cancellation

## Testing and Debugging

### Debug Features
- Raw planner output fallback for debugging
- Event logging throughout the workflow
- Tool execution metadata
- Session isolation for reproducible testing

### Monitoring
- Event-based progress tracking
- Token usage reporting per phase
- Error aggregation and reporting
- Performance metrics collection

## Future Extensions

### Potential Enhancements
- **Hierarchical Planning**: Multi-level task decomposition
- **Dynamic Concurrency**: Adjust parallelism based on load
- **Model Selection**: AI-driven model selection per task
- **Result Caching**: Cache similar sub-task results
- **Interactive Planning**: Allow user refinement of generated plans

## Key Design Principles

1. **Separation of Concerns**: Each phase has a specific, focused responsibility
2. **Fault Isolation**: Failures in one task don't affect others
3. **Configurable Flexibility**: Extensive configuration options for different use cases
4. **Real-time Feedback**: Event-driven architecture enables live dashboards
5. **Tool Safety**: Comprehensive sandboxing for sub-agent tool access
6. **Cost Optimization**: Specialized models for different phases
7. **Streaming Results**: Immediate feedback through streaming synthesis

## Files Modified in Recent Changes

Based on the analysis of the codebase, the heavy feature appears to be a recent addition with comprehensive integration across:

- **Core Logic**: `heavy.ts` (main implementation)
- **Prompts**: `heavy_planner.txt`, `heavy_synthesizer.txt`
- **Integration**: `index.ts` (session management)
- **UI**: TUI integration for plan approval and dashboards
- **SDK**: Go and JS SDK support
- **Documentation**: Comprehensive user guides
- **Configuration**: Schema support in `config.json`

The feature represents a significant architectural enhancement that enables complex multi-step workflows while maintaining the existing single-agent mode as the default.
