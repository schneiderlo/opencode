import { describe, expect, test } from "bun:test"
import { CouncilReport } from "../../src/council/report"

describe("council.report", () => {
  test("renders a durable report from structured artifacts", () => {
    const text = CouncilReport.render({
      query: "Should we keep Council prompt-led or move it into code?",
      plan: {
        topic: "Council v2",
        summary: "Compare the current prompt-led flow with a code-owned Council runtime.",
        perspectives: [
          {
            id: "pragmatist",
            name: "Pragmatist",
            description: "Focus on delivery risk and implementation cost.",
            focus: ["scope", "risk"],
            questions: ["What is the smallest safe slice?"],
          },
          {
            id: "architect",
            name: "Architect",
            description: "Focus on long-term shape and runtime correctness.",
            focus: ["contracts", "artifacts"],
            questions: ["Where should workflow boundaries live?"],
          },
        ],
        shared_context: ["general remains the only worker"],
        debate_topics: ["whether debate should stay optional"],
        report_outline: ["summary", "recommendation"],
      },
      results: [
        {
          task: {
            topic: "Council v2",
            summary: "Compare the current prompt-led flow with a code-owned Council runtime.",
            user_query: "Should we keep Council prompt-led or move it into code?",
            shared_context: ["general remains the only worker"],
            persona: {
              id: "pragmatist",
              name: "Pragmatist",
              description: "Focus on delivery risk and implementation cost.",
              focus: ["scope", "risk"],
              questions: ["What is the smallest safe slice?"],
            },
            required_sections: ["executive_summary"],
          },
          result: {
            perspective: "Pragmatist",
            executive_summary: "Ship the smallest code-owned path first.",
            findings: ["The prompt/runtime mismatch is the immediate problem."],
            recommendations: ["Add a council_run tool before deeper redesign."],
            tradeoffs: ["The first slice will still be iterative."],
            unknowns: ["Need runtime validation under real model calls."],
            confidence: "high",
          },
          json: ".opencode/council/a/b/perspectives/pragmatist.json",
          md: ".opencode/council/a/b/perspectives/pragmatist.md",
        },
      ],
      debates: [
        {
          topic: "whether debate should stay optional",
          summary: "Debate should stay targeted to real conflicts.",
          participants: [
            { name: "Pragmatist", position: "Keep debate narrow." },
            { name: "Architect", position: "Normalize debate artifacts." },
          ],
          rounds: [
            {
              round: 1,
              responses: [{ perspective: "Pragmatist", argument: "Only debate material issues." }],
            },
          ],
          agreements: ["Always synthesize in code."],
          disagreements: ["How often debate should trigger."],
          transcript_path: ".opencode/council/a/b/debate.md",
          json: ".opencode/council/a/b/debates/debate.json",
          md: ".opencode/council/a/b/debates/debate.md",
        },
      ],
      synth: {
        recommendation: "Move Council orchestration into code behind council_run.",
        rationale: ["It removes prompt/runtime drift.", "It gives durable artifacts."],
        agreements: ["Structured outputs should drive synthesis."],
        disagreements: ["Debate should remain optional."],
        tradeoffs: ["More code to maintain."],
        next_steps: ["Register the tool.", "Use structured planning and synthesis."],
        open_questions: ["How much worker autonomy is still useful?"],
      },
    })

    expect(text).toContain("# Council Report: Council v2")
    expect(text).toContain("## Recommendation")
    expect(text).toContain("Move Council orchestration into code behind council_run.")
    expect(text).toContain("Pragmatist")
    expect(text).toContain("## Debate Summary")
    expect(text).toContain("Participants: Pragmatist, Architect")
    expect(text).toContain("Confidence: high")
  })
})
