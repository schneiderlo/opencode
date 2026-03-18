# Council v2 Implementation Plan

Standalone implementation plan for upgrading the Council agent into a code-owned workflow.

This document is intended to be sufficient context for future agents. Do not assume access to prior conversation history.

## Goal

Refactor the Council agent so that:

- workflow control lives in code, not mostly in prompt prose
- perspective analysis uses structured artifacts
- debate is a real runtime capability, not only a prompt instruction
- report generation is reliable and reproducible
- the `general` subagent remains the only worker subagent used by Council in this effort

## Scope Decisions

These are explicit decisions for this effort:

- Keep `general` as the only Council worker subagent.
- Do not introduce separate `security`, `pragmatist`, `architecture`, or other specialized subagents in this phase.
- Reuse the existing JSON-schema structured-output path in `src/session/prompt.ts`.
- Prefer adding new Council-specific code under `src/council/` rather than overloading `map_reduce.ts` with Council-only behavior.
- Keep `map_reduce` generic. Council may reuse the same child-session execution pattern internally, but Council orchestration should not be prompt-only.
- Generate `COUNCIL_REPORT.md` from code plus persisted artifacts, not from prompt instructions alone.

## Non-goals

- Do not redesign the generic agent system.
- Do not redesign `task` or `map_reduce` semantics beyond what is needed for shared execution helpers or compatibility.
- Do not remove the existing Council agent UX in one step. Migrate it incrementally.
- Do not rely on freeform markdown parsing for core Council artifacts if structured output is available.

## Current Baseline

### Agent definitions

- `src/agent/agent.ts`
  - `general` is a `subagent` with no custom prompt of its own.
  - `council` is a `primary` agent with permissions for `map_reduce`, `debate`, and `task`.

Important implication:

- Since `general` has no dedicated persona prompt, Council perspective specialization currently comes from the task prompt text, not from separate worker agents.

### Council prompt

- `src/agent/prompt/council.txt`

Current prompt-driven workflow:

1. choose 2-4 perspectives
2. use `map_reduce`
3. send the same query to all perspectives with different persona text
4. optionally use `debate`
5. synthesize
6. write `COUNCIL_REPORT.md`

Important details from the prompt:

- It explicitly tells Council to use `general` for all perspectives.
- It expects each perspective to return long, detailed prose.
- It expects optional debate rounds.
- It expects the final report to be written to `COUNCIL_REPORT.md`.

### Current `map_reduce`

- `src/tool/map_reduce.ts`

Current behavior:

- Creates a fresh child session per task.
- Sets `parentID` to the caller session.
- Uses `task.prompt` as the worker input.
- Chooses the worker model from the worker agent override or from the parent assistant message model.
- Disables todo tools for the child session.
- Allows limited recursion for `map_reduce` and `task`.
- Returns concatenated text output, not typed structured artifacts.

Important implication:

- Worker sessions do not automatically receive full parent conversation history.
- The quality of worker context depends almost entirely on the generated prompt text.

### Current `task`

- `src/tool/task.ts`

Current behavior:

- Creates or resumes a child session.
- Sends a freeform prompt to a subagent.
- Returns text output wrapped in a `task_id` block.

This is similar to `map_reduce`, but single-worker rather than parallel.

### Current `debate`

- `src/tool/debate.ts`

Current behavior:

- Runs debate rounds using `general`.
- Builds a prompt containing:
  - topic
  - previous position
  - arguments from other perspectives
- Writes markdown transcript files under `.opencode/council/<sessionID>/`.
- Returns a textual synthesis summary.

Important implication:

- Debate does exist as a tool implementation.
- Debate outputs are still largely prose-first.

### Tool registration

- `src/tool/registry.ts`

Current problem:

- `DebateTool` is implemented in `src/tool/debate.ts` but is not registered in the tool registry.
- This means the Council prompt can instruct the agent to use `debate`, while the runtime does not actually expose that tool.

### Structured output path

- `src/session/prompt.ts`
- `src/session/message-v2.ts`

Current capabilities:

- `SessionPrompt.prompt()` supports `format: { type: "json_schema", schema, retryCount }`.
- When JSON-schema mode is enabled, a `StructuredOutput` tool is injected.
- Successful structured output is stored on the assistant message as `message.structured`.

Important implication:

- The project already has a usable structured-output path.
- Council v2 should build on this instead of inventing a separate parser.

## Current Problems

1. Prompt/runtime mismatch

- Council prompt assumes `debate` is available.
- Runtime does not register `DebateTool`.
- Council prompt assumes report-writing behavior that is not guaranteed by code.

2. Workflow mostly lives in prompt prose

- Perspective selection
- perspective prompt shape
- decision to debate
- report generation

All of those are currently described in prompt text rather than represented as explicit runtime artifacts.

3. Worker input is weakly structured

- Workers receive a freeform `task.prompt`.
- They do not receive a typed payload like `persona`, `focus_areas`, `questions`, `shared_context`, or `required_sections`.

4. Worker output is weakly structured

- `map_reduce` returns concatenated text.
- Synthesis must infer agreement/disagreement by reading raw essays.

5. Debate output is not normalized enough

- Debate returns text plus markdown transcripts.
- It does not produce a stable typed artifact for synthesis.

6. Final report is not code-owned

- The prompt tells the model to write `COUNCIL_REPORT.md`.
- This is fragile and not guaranteed.

## Target v2 Architecture

Council v2 should be a code-owned orchestration flow with four phases:

1. `Plan`
2. `Consult`
3. `Debate`
4. `Synthesize`

The LLM should still perform reasoning and writing, but code should own:

- phase boundaries
- schemas
- artifact persistence
- report generation
- debate triggering rules

## Proposed High-Level Design

Introduce a Council-specific service plus a small Council-specific tool.

Recommended additions:

- `src/council/schema.ts`
- `src/council/service.ts`
- `src/council/report.ts`
- `src/council/artifact.ts`
- `src/tool/council_run.ts`

The Council prompt should be simplified so that the `council` agent mostly does:

1. understand the query
2. call `council_run`
3. present the resulting recommendation to the user

This keeps the user-facing Council agent but moves orchestration into code.

## Proposed Data Contracts

Add these schemas in `src/council/schema.ts`.

Use Zod and keep the shapes simple.

```ts
import z from "zod"

export const CouncilPlan = z.object({
  topic: z.string(),
  summary: z.string(),
  perspectives: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        focus: z.array(z.string()),
        questions: z.array(z.string()),
      }),
    )
    .min(2)
    .max(4),
  shared_context: z.array(z.string()).default([]),
  debate_topics: z.array(z.string()).default([]),
  report_outline: z.array(z.string()).default([]),
})

export const PerspectiveResult = z.object({
  perspective_id: z.string(),
  perspective_name: z.string(),
  executive_summary: z.string(),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
  tradeoffs: z.array(z.string()),
  unknowns: z.array(z.string()),
  confidence: z.enum(["low", "medium", "high"]).optional(),
})

export const DebateSummary = z.object({
  topic: z.string(),
  participants: z.array(z.string()),
  agreements: z.array(z.string()),
  disagreements: z.array(z.string()),
  evolved_positions: z.array(
    z.object({
      perspective_name: z.string(),
      final_position: z.string(),
    }),
  ),
})

export const CouncilSynthesis = z.object({
  topic: z.string(),
  executive_summary: z.string(),
  perspectives_consulted: z.array(z.string()),
  areas_of_agreement: z.array(z.string()),
  areas_of_disagreement: z.array(z.string()),
  blind_spots: z.array(z.string()),
  recommendation: z.string(),
  tradeoffs: z.array(z.string()),
  next_steps: z.array(z.string()),
})
```

## Proposed `council_run` Tool

Create `src/tool/council_run.ts`.

Purpose:

- provide a single runtime entrypoint for Council orchestration
- keep Council prompt simple
- keep orchestration logic out of prompt prose

Suggested input schema:

```ts
const parameters = z.object({
  query: z.string().describe("The user query to analyze"),
  context: z.array(z.string()).optional(),
  allow_debate: z.boolean().default(true),
  max_perspectives: z.number().int().min(2).max(4).default(4),
})
```

Suggested output metadata:

- `planPath`
- `perspectivePaths`
- `debatePaths`
- `synthesisPath`
- `reportPath`

Suggested output text:

- short high-signal summary
- paths to generated artifacts

## Proposed `CouncilService`

Create `src/council/service.ts`.

Primary responsibilities:

- build a `CouncilPlan`
- execute perspective analyses in parallel
- decide whether to run debate
- produce a `CouncilSynthesis`
- ask `report.ts` to render `COUNCIL_REPORT.md`
- persist all intermediate artifacts

Recommended public API:

```ts
export namespace CouncilService {
  export async function run(input: {
    sessionID: SessionID
    messageID: MessageID
    model: { providerID: ProviderID; modelID: ModelID }
    query: string
    context?: string[]
    allowDebate: boolean
    maxPerspectives: number
    agent: Agent.Info
  }): Promise<{
    plan: CouncilPlan
    perspectives: PerspectiveResult[]
    debates: DebateSummary[]
    synthesis: CouncilSynthesis
    paths: {
      root: string
      plan: string
      perspectives: string[]
      debates: string[]
      synthesis: string
      report: string
    }
  }>
}
```

## How Each Phase Should Work

### Phase 1: Plan

Use structured output to generate a `CouncilPlan`.

Recommended implementation:

- create a fresh child session under the current Council session
- use the `council` agent or a lightweight hidden Council planning mode
- disable operational tools during the planning call
- call `SessionPrompt.prompt()` with `format: { type: "json_schema", schema: CouncilPlan }`

Why:

- planning becomes inspectable and testable
- perspective selection becomes a persisted artifact, not only a transient prompt choice

Persist:

- `.opencode/council/<sessionID>/plan.json`
- optional `plan.md` human-readable rendering

### Phase 2: Consult

Do not use freeform persona essays as the only contract.

For each perspective from `CouncilPlan`:

- create a fresh child session
- use `general`
- pass a normalized prompt built from:
  - topic
  - original query
  - shared context
  - perspective name
  - perspective description
  - focus areas
  - perspective-specific questions
  - required output contract
- request `PerspectiveResult` via JSON-schema mode

Important:

- The worker remains `general`.
- Persona stays in prompt text, but now the payload is built from explicit typed data.
- Result becomes structured and stable.

Persist per perspective:

- `perspectives/<perspective_id>.json`
- `perspectives/<perspective_id>.md`

### Phase 3: Debate

Debate should run only when needed.

Rule:

- If `CouncilPlan.debate_topics` is empty, skip debate.
- If the plan identified one or more real conflicts, run `debate` once per topic.

Upgrade `src/tool/debate.ts` so it can return a typed `DebateSummary` in addition to transcript markdown.

Recommended approach:

- keep current markdown transcript generation
- add structured summary generation at the end
- persist:
  - `debates/<slug>.json`
  - `debates/<slug>.md`

Also:

- register `DebateTool` in `src/tool/registry.ts`

### Phase 4: Synthesize

Generate `CouncilSynthesis` from:

- `CouncilPlan`
- all `PerspectiveResult`s
- all `DebateSummary`s

Use structured output again.

The synthesis call should not have to re-infer everything from raw prose.
It should receive the normalized artifacts directly.

Persist:

- `synthesis.json`
- optional `synthesis.md`

### Phase 5: Report

Generate `COUNCIL_REPORT.md` from code.

Create `src/council/report.ts`.

Responsibility:

- render markdown from `CouncilPlan`, `PerspectiveResult[]`, `DebateSummary[]`, and `CouncilSynthesis`

Do not depend on the Council prompt to write the report with `write`.

Recommended output path:

- `.opencode/council/<sessionID>/COUNCIL_REPORT.md`

Optional:

- continue mirroring to `COUNCIL_REPORT.md` in the working directory for backwards compatibility

If mirroring is retained, do it from code, not from prompt instructions.

## Artifact Layout

Council v2 should persist a full run under:

```text
.opencode/council/<sessionID>/
  plan.json
  plan.md
  perspectives/
    security.json
    security.md
    pragmatist.json
    pragmatist.md
  debates/
    data-store-choice.json
    data-store-choice.md
  synthesis.json
  synthesis.md
  COUNCIL_REPORT.md
```

## File-by-File Implementation Plan

### 1. `src/tool/registry.ts`

Changes:

- register `DebateTool`
- register new `CouncilRunTool`

Acceptance criteria:

- `ToolRegistry.ids()` contains `debate`
- `ToolRegistry.ids()` contains `council_run`

### 2. `src/agent/agent.ts`

Changes:

- keep `general` unchanged as worker
- keep `council` as primary
- add `council_run` permission for `council`
- decide whether `council` still needs direct `map_reduce` and `task`

Recommendation:

- during transition, keep `map_reduce`, `task`, and `debate`
- once `council_run` is fully adopted, consider removing direct `map_reduce` from Council prompt usage but do not force that in the same PR

### 3. `src/agent/prompt/council.txt`

Rewrite to a minimal orchestration prompt.

It should say roughly:

- understand the question
- call `council_run` with the user query and any important context
- use the returned synthesis/report to answer the user

It should stop containing the full workflow contract for:

- perspective prompt format
- debate loop rules
- report-writing instructions

Those should move into code.

### 4. `src/council/schema.ts`

Add:

- `CouncilPlan`
- `PerspectiveResult`
- `DebateSummary`
- `CouncilSynthesis`

Keep names stable and explicit because future agents and tests will refer to them.

### 5. `src/council/artifact.ts`

Add helpers for:

- council output root resolution
- JSON writing
- markdown writing
- slug creation

Keep file IO centralized rather than scattering `Bun.write()` across service code.

### 6. `src/council/service.ts`

Add:

- orchestration entrypoint
- per-phase helpers:
  - `plan()`
  - `consult()`
  - `runDebates()`
  - `synthesize()`

Recommended internal helper:

- a small reusable helper to run a child session with:
  - chosen agent
  - chosen model
  - prompt text
  - structured-output schema

This helper should likely reuse `SessionPrompt.prompt()` directly.

### 7. `src/council/report.ts`

Add a deterministic markdown renderer.

Sections should match the current conceptual report:

- Executive Summary
- Perspectives Consulted
- Detailed Findings
- Areas of Agreement
- Areas of Disagreement
- Debate Summary
- Synthesis & Recommendation
- Trade-offs to Consider
- Next Steps

### 8. `src/tool/council_run.ts`

Add the tool that:

- validates input
- calls `CouncilService.run()`
- returns a concise summary plus artifact paths

This tool should be the Council runtime entrypoint.

### 9. `src/tool/debate.ts`

Upgrade:

- keep transcripts
- add typed `DebateSummary`
- return stable metadata for synthesis

### 10. `src/tool/map_reduce.ts`

Do not turn this into a Council-specific tool.

Possible refactor:

- extract the child-session execution logic shared by `map_reduce`, `task`, and `council/service.ts` into a helper module

If extraction is too invasive for the first iteration, duplicate only the minimum necessary logic in `CouncilService` and refactor later.

## Recommended PR Sequence

### PR 1: Runtime alignment

Scope:

- register `DebateTool`
- add `CouncilRunTool`
- update Council permissions
- simplify Council prompt toward `council_run`

Why first:

- fixes the current prompt/runtime mismatch
- gives the feature a real runtime entrypoint

### PR 2: Council schemas and artifact helpers

Scope:

- `src/council/schema.ts`
- `src/council/artifact.ts`
- tests for schema validity and artifact writing

Why second:

- establishes stable interfaces before orchestration logic lands

### PR 3: Planning and consultation

Scope:

- implement `CouncilService.plan()`
- implement `CouncilService.consult()`
- persist `plan.json`
- persist perspective artifacts
- use structured outputs

Why third:

- delivers the highest-value shift away from raw prompt orchestration

### PR 4: Debate and synthesis

Scope:

- upgrade `debate.ts`
- implement `runDebates()`
- implement `synthesize()`
- persist debate and synthesis artifacts

### PR 5: Report generation and polish

Scope:

- implement `report.ts`
- generate `COUNCIL_REPORT.md`
- update user-facing Council response format
- finalize tests

## Testing Plan

Tests must run from `packages/opencode`, not repo root.

Add or extend:

- `test/tool/registry.test.ts`
  - assert `debate` is registered
  - assert `council_run` is registered

- `test/agent/agent.test.ts`
  - assert Council has `council_run`
  - assert Council still has intended tool permissions

- `test/tool/council-run.test.ts`
  - validate input parsing
  - validate artifact paths are returned
  - validate orchestration errors are surfaced

- `test/council/service.test.ts`
  - plan generation path
  - perspective execution path
  - debate skip vs run behavior
  - synthesis path

- `test/tool/debate.test.ts`
  - debate returns structured summary
  - debate still writes transcript markdown

- `test/session/prompt.test.ts`
  - structured-output path still works for Council schemas

Recommended verification commands from `packages/opencode`:

```bash
bun test test/tool/registry.test.ts
bun test test/agent/agent.test.ts
bun test test/tool/council-run.test.ts
bun test test/tool/debate.test.ts
bun test test/council/service.test.ts
bun test test/session/prompt.test.ts
```

If broader verification is needed:

```bash
bun test
```

## Acceptance Criteria

Council v2 is complete when:

- Council uses `council_run` as its primary execution path
- `debate` is actually available at runtime
- perspective selection is persisted as `plan.json`
- each perspective returns a typed `PerspectiveResult`
- debate returns a typed `DebateSummary`
- synthesis returns a typed `CouncilSynthesis`
- `COUNCIL_REPORT.md` is generated from code-owned artifacts
- another agent can inspect `.opencode/council/<sessionID>/` and understand exactly what happened

## Risks and Mitigations

### Risk: structured output instability across providers

Mitigation:

- reuse the existing JSON-schema mode and retry behavior
- keep schemas small and explicit
- avoid deeply nested optional unions where possible

### Risk: orchestration complexity gets duplicated

Mitigation:

- isolate Council orchestration in `src/council/service.ts`
- consider extracting shared child-session execution helpers only after the first end-to-end path works

### Risk: report generation drifts from synthesis

Mitigation:

- generate report from structured synthesis data in code
- avoid asking the model to write the report file directly

### Risk: Council still behaves differently depending on prompt style

Mitigation:

- minimize what the Council prompt has to decide
- move selection, debate triggering, and report persistence into explicit runtime phases

## Future Work After v2

These are intentionally out of scope for this phase:

- perspective-specific worker agents
- model routing per perspective beyond existing agent/model configuration
- UI-specific Council artifact browsing
- richer conflict detection heuristics based on semantic comparison of structured outputs

## Suggested Starting Point

If implementing from scratch from this document, start here:

1. register `DebateTool` and add `CouncilRunTool`
2. create `src/council/schema.ts`
3. create `src/council/service.ts` with only `plan()` and `consult()`
4. persist `plan.json` and perspective JSON files
5. add report generation last

That sequence gives the fastest path to a real Council v2 while minimizing risk.
