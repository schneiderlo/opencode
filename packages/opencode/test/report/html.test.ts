import { describe, expect, test } from "bun:test"
import { CouncilReport } from "../../src/council/report"
import { CouncilSchema } from "../../src/council/schema"
import { HeavyReport } from "../../src/heavy/report"
import { HeavySchema } from "../../src/heavy/schema"
import { RunHtml } from "../../src/report/html"

describe("report.html", () => {
  test("renders heavy markdown into structured html", () => {
    const plan = HeavySchema.Plan.parse({
      summary: "Split the work into explicit tasks.",
      tasks: [
        {
          id: "scan",
          title: "Scan codebase",
          mode: "direct",
          agent: "explore",
          goal: "Find the relevant files.",
          prompt: "Inspect the heavy mode implementation.",
          deliverable: "A file map and findings.",
        },
        {
          id: "shape",
          title: "Shape report",
          mode: "direct",
          agent: "general",
          goal: "Design the final output.",
          prompt: "Define the report structure and presentation.",
          deliverable: "A visual report direction.",
        },
      ],
      synthesis_focus: ["visibility"],
    })
    const task = HeavySchema.Result.parse({
      task_id: "scan",
      title: "Scan codebase",
      summary: "The runtime is prompt-led.",
      details: "It needs a durable report.\n\n```ts\nconst x = 1\n```\n\n- Keep artifacts\n- Render markdown",
      findings: ["Heavy lacks a visual artifact."],
      next_steps: ["Add a generated HTML report."],
    })
    const synth = HeavySchema.Synthesis.parse({
      summary: "Heavy should emit a visual report with readable structure.",
      answer: "Use a distinctive HTML report.",
      key_points: ["The report should render headings, lists, code, and links."],
      next_steps: ["Ship the renderer."],
      open_questions: ["How much live state should the TUI mirror?"],
    })
    const report = HeavyReport.render({
      query: "How should heavy mode work?",
      plan,
      tasks: [{ task: plan.tasks[0], result: task, json: "/tmp/scan.json", md: "/tmp/scan.md" }],
      synth,
    })
    const html = RunHtml.heavy({
      dir: "/tmp/heavy",
      query: "How should heavy mode work?",
      plan,
      tasks: [{ task: plan.tasks[0], result: task, json: "/tmp/scan.json", md: "/tmp/scan.md" }],
      synth,
      report,
      reportPath: "/tmp/HEAVY_REPORT.md",
      reportHtmlPath: "/tmp/HEAVY_REPORT.html",
    })

    expect(html).toContain('<article class="article">')
    expect(html).toContain("<h1>Heavy Report</h1>")
    expect(html).toContain("<h2>Key Points</h2>")
    expect(html).toContain("<ul><li>The report should render headings, lists, code, and links.</li></ul>")
    expect(html).toContain('<div class="code-block"><div class="code-header"><span class="lang">ts</span></div><pre class="code"><code>const x = 1</code></pre></div>')
    expect(html).toContain('<a href="file:///tmp/HEAVY_REPORT.md">HEAVY_REPORT.md</a>')
  })

  test("renders council markdown into structured html", () => {
    const plan = CouncilSchema.Plan.parse({
      topic: "Council v2",
      summary: "Compare prompt-led and code-owned orchestration.",
      perspectives: [
        {
          id: "arch",
          name: "Architect",
          description: "Focus on durable runtime shape.",
          focus: ["contracts", "artifacts"],
          questions: ["What should the runtime own?"],
        },
        {
          id: "ops",
          name: "Operator",
          description: "Focus on inspectability and workflow clarity.",
          focus: ["visibility", "operations"],
          questions: ["How does a user inspect the run?"],
        },
      ],
      shared_context: ["general remains the only worker"],
      debate_topics: ["whether debate should stay optional"],
      report_outline: ["summary", "recommendation"],
    })
    const task = CouncilSchema.Result.parse({
      perspective: "Architect",
      executive_summary: "Move orchestration into code.",
      analysis: "Structured artifacts improve traceability.\n\n> Debate should stay targeted.\n\n1. Own the flow\n2. Render the report",
      findings: ["The runtime should emit durable artifacts."],
      recommendations: ["Add an auto-generated HTML report."],
      tradeoffs: ["More code to maintain."],
      unknowns: ["How much worker autonomy is still useful?"],
      confidence: "high",
    })
    const synth = CouncilSchema.Synthesis.parse({
      executive_summary: "Council should keep structured artifacts and better presentation.",
      recommendation: "Generate a visual report automatically.",
      decision_log: "The runtime should own synthesis while preserving readable artifacts.",
      rationale: ["A rendered report makes the run inspectable."],
      agreements: ["Artifacts should be durable."],
      disagreements: ["Whether debate should stay optional."],
      tradeoffs: ["A richer renderer needs tests."],
      next_steps: ["Wire the renderer into the service."],
      open_questions: ["Should the report include live child-session state?"],
    })
    const report = CouncilReport.render({
      query: "Should council runs auto-generate a report?",
      plan,
      results: [
        {
          task: {
            topic: plan.topic,
            summary: plan.summary,
            user_query: "Should council runs auto-generate a report?",
            shared_context: plan.shared_context,
            persona: plan.perspectives[0],
            required_sections: ["executive_summary"],
          },
          result: task,
          json: "/tmp/arch.json",
          md: "/tmp/arch.md",
        },
      ],
      debates: [],
      synth,
    })
    const html = RunHtml.council({
      dir: "/tmp/council",
      query: "Should council runs auto-generate a report?",
      plan,
      results: [
        {
          task: {
            topic: plan.topic,
            summary: plan.summary,
            user_query: "Should council runs auto-generate a report?",
            shared_context: plan.shared_context,
            persona: plan.perspectives[0],
            required_sections: ["executive_summary"],
          },
          result: task,
          json: "/tmp/arch.json",
          md: "/tmp/arch.md",
        },
      ],
      debates: [],
      synth,
      report,
      reportPath: "/tmp/COUNCIL_REPORT.md",
      reportHtmlPath: "/tmp/COUNCIL_REPORT.html",
    })

    expect(html).toContain("<h1>Council Report: Council v2</h1>")
    expect(html).toContain("<h2>Recommendation</h2>")
    expect(html).toContain("<blockquote><p>Debate should stay targeted.</p></blockquote>")
    expect(html).toContain("<ol><li>Own the flow</li><li>Render the report</li></ol>")
    expect(html).toContain('<a href="file:///tmp/COUNCIL_REPORT.html">COUNCIL_REPORT.html</a>')
  })
})
