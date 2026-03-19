import z from "zod"

const Perspective = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  focus: z.array(z.string()).min(1),
  questions: z.array(z.string()).min(1),
})

const DebateParticipant = z.object({
  name: z.string(),
  position: z.string(),
})

const DebateResponse = z.object({
  perspective: z.string(),
  argument: z.string(),
})

const DebateRound = z.object({
  round: z.number().int().positive(),
  responses: z.array(DebateResponse),
})

export namespace CouncilSchema {
  export const Plan = z
    .object({
      topic: z.string(),
      summary: z.string(),
      perspectives: z.array(Perspective).min(2).max(4),
      shared_context: z.array(z.string()).default([]),
      debate_topics: z.array(z.string()).default([]),
      report_outline: z.array(z.string()).default([]),
    })
    .meta({
      ref: "CouncilPlan",
    })
  export type Plan = z.infer<typeof Plan>

  export const Task = z
    .object({
      topic: z.string(),
      summary: z.string(),
      user_query: z.string(),
      shared_context: z.array(z.string()).default([]),
      persona: Perspective,
      required_sections: z.array(z.string()).default([]),
    })
    .meta({
      ref: "CouncilTask",
    })
  export type Task = z.infer<typeof Task>

  export const Result = z
    .object({
      perspective: z.string(),
      executive_summary: z.string(),
      analysis: z.string().default(""),
      findings: z.array(z.string()).min(1),
      recommendations: z.array(z.string()).min(1),
      tradeoffs: z.array(z.string()).default([]),
      unknowns: z.array(z.string()).default([]),
      confidence: z.enum(["low", "medium", "high"]).optional(),
    })
    .meta({
      ref: "CouncilPerspectiveResult",
    })
  export type Result = z.infer<typeof Result>

  export const Debate = z
    .object({
      topic: z.string(),
      summary: z.string(),
      participants: z.array(DebateParticipant).min(2),
      rounds: z.array(DebateRound).default([]),
      agreements: z.array(z.string()).default([]),
      disagreements: z.array(z.string()).default([]),
      transcript_path: z.string().optional(),
    })
    .meta({
      ref: "CouncilDebateSummary",
    })
  export type Debate = z.infer<typeof Debate>

  export const Synthesis = z
    .object({
      executive_summary: z.string().default(""),
      recommendation: z.string(),
      decision_log: z.string().default(""),
      rationale: z.array(z.string()).min(1),
      agreements: z.array(z.string()).default([]),
      disagreements: z.array(z.string()).default([]),
      tradeoffs: z.array(z.string()).default([]),
      next_steps: z.array(z.string()).default([]),
      open_questions: z.array(z.string()).default([]),
    })
    .meta({
      ref: "CouncilSynthesis",
    })
  export type Synthesis = z.infer<typeof Synthesis>

  export const Paths = z
    .object({
      root: z.string(),
      request: z.string(),
      plan: z.string(),
      perspectives: z.array(z.string()),
      debates: z.array(z.string()),
      synthesis: z.string(),
      report: z.string(),
      report_html: z.string().optional(),
    })
    .meta({
      ref: "CouncilPaths",
    })
  export type Paths = z.infer<typeof Paths>
}
