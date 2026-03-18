import { describe, expect, test } from "bun:test"
import { HeavyReport } from "../../src/heavy/report"

describe("heavy.report", () => {
  test("renders a durable heavy report", () => {
    const text = HeavyReport.render({
      query: "How should heavy mode work?",
      plan: {
        summary: "Split the work into explicit parallel tasks.",
        tasks: [
          {
            id: "scan",
            title: "Scan codebase",
            agent: "explore",
            goal: "Find the relevant files.",
            prompt: "Inspect the codebase for heavy mode implementation points.",
            deliverable: "A file map and key findings.",
          },
        ],
        synthesis_focus: ["usefulness", "visibility"],
      },
      tasks: [
        {
          task: {
            id: "scan",
            title: "Scan codebase",
            agent: "explore",
            goal: "Find the relevant files.",
            prompt: "Inspect the codebase for heavy mode implementation points.",
            deliverable: "A file map and key findings.",
          },
          result: {
            task_id: "scan",
            title: "Scan codebase",
            summary: "The current heavy mode is prompt-led.",
            details: "It relies on map_reduce directly and does not persist a structured plan or synthesis.",
            findings: ["Heavy has no code-owned runtime."],
            next_steps: ["Add a heavy_run tool."],
          },
          json: ".opencode/heavy/a/b/tasks/scan.json",
          md: ".opencode/heavy/a/b/tasks/scan.md",
        },
      ],
      synth: {
        summary: "Heavy should become a code-owned decomposition runtime.",
        answer: "Use heavy_run for structured planning, execution, and synthesis.",
        key_points: ["The old heavy mode is too prompt-led."],
        next_steps: ["Implement heavy_run."],
        open_questions: ["How much structure should each task return?"],
      },
    })

    expect(text).toContain("# Heavy Report")
    expect(text).toContain("Use heavy_run for structured planning, execution, and synthesis.")
    expect(text).toContain("Scan codebase")
    expect(text).toContain("## Key Points")
  })
})
