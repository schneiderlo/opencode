import { describe, expect, test } from "bun:test"
import { CouncilDebate } from "../../src/council/debate"

describe("council.debate", () => {
  test("selects only debate topics with at least two matching perspectives", () => {
    const result = CouncilDebate.select({
      plan: {
        topic: "Council v2",
        summary: "Debate the remaining design tensions.",
        perspectives: [
          {
            id: "a",
            name: "Architect",
            description: "Cares about contracts.",
            focus: ["contracts"],
            questions: ["How should debates be stored?"],
          },
          {
            id: "b",
            name: "Pragmatist",
            description: "Cares about delivery.",
            focus: ["scope"],
            questions: ["What is the smallest slice?"],
          },
        ],
        shared_context: [],
        debate_topics: ["debate", "confidence"],
        report_outline: [],
      },
      results: [
        {
          perspective: "Architect",
          executive_summary: "Debate should be a first-class artifact.",
          analysis: "Debate should produce a durable artifact so the final synthesis can reason over concrete disagreements.",
          findings: ["Debate transcripts should be persisted as structured artifacts."],
          recommendations: ["Add debate normalization before synthesis."],
          tradeoffs: [],
          unknowns: [],
        },
        {
          perspective: "Pragmatist",
          executive_summary: "Debate should stay targeted.",
          analysis: "Debate is useful when it resolves a meaningful tension, not when it simply repeats similar advice.",
          findings: ["Debate is only useful when the disagreement is material."],
          recommendations: ["Keep debate optional and focused on material tensions."],
          tradeoffs: [],
          unknowns: [],
        },
        {
          perspective: "Operator",
          executive_summary: "Confidence is useful later.",
          analysis: "The system can add more structured metadata later, but the first priority is reliable artifacts and visibility.",
          findings: ["Confidence labels are useful, but they are not the current priority."],
          recommendations: ["Add confidence after the artifacts are stable."],
          tradeoffs: [],
          unknowns: [],
        },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0].topic).toBe("debate")
    expect(result[0].participants.map((item) => item.name)).toEqual(["Architect", "Pragmatist"])
  })
})
