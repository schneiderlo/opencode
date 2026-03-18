import z from "zod"

const Task = z.object({
  id: z.string(),
  title: z.string(),
  agent: z.enum(["explore", "general"]),
  goal: z.string(),
  prompt: z.string(),
  deliverable: z.string(),
})

export namespace HeavySchema {
  export const Plan = z
    .object({
      summary: z.string(),
      tasks: z.array(Task).min(2).max(6),
      synthesis_focus: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavyPlan",
    })
  export type Plan = z.infer<typeof Plan>

  export const Result = z
    .object({
      task_id: z.string(),
      title: z.string(),
      summary: z.string(),
      details: z.string().default(""),
      findings: z.array(z.string()).default([]),
      next_steps: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavyTaskResult",
    })
  export type Result = z.infer<typeof Result>

  export const Synthesis = z
    .object({
      summary: z.string(),
      answer: z.string(),
      key_points: z.array(z.string()).default([]),
      next_steps: z.array(z.string()).default([]),
      open_questions: z.array(z.string()).default([]),
    })
    .meta({
      ref: "HeavySynthesis",
    })
  export type Synthesis = z.infer<typeof Synthesis>

  export const Paths = z
    .object({
      root: z.string(),
      request: z.string(),
      plan: z.string(),
      tasks: z.array(z.string()),
      synthesis: z.string(),
    })
    .meta({
      ref: "HeavyPaths",
    })
  export type Paths = z.infer<typeof Paths>
}
