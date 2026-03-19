#!/usr/bin/env bun

import path from "path"
import z from "zod"
import { CouncilSchema } from "../src/council/schema"
import { HeavySchema } from "../src/heavy/schema"

const TaskFile = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    mode: z.enum(["direct", "heavy"]),
    agent: z.enum(["explore", "general"]),
    goal: z.string(),
    prompt: z.string(),
    deliverable: z.string(),
  }),
  result: HeavySchema.Result,
})

const PerspectiveFile = z.object({
  task: CouncilSchema.Task,
  result: CouncilSchema.Result,
})

const DebateFile = CouncilSchema.Debate

type Perspective = z.infer<typeof PerspectiveFile> & {
  json: string
  md: string
}

type Debate = CouncilSchema.Debate & {
  json: string
  md: string
}

type Task = z.infer<typeof TaskFile> & {
  json: string
  md: string
}

type CouncilRun = {
  type: "council"
  dir: string
  req: {
    query?: string
    context?: string[]
  }
  plan: CouncilSchema.Plan
  synth: CouncilSchema.Synthesis
  perspectives: Perspective[]
  debates: Debate[]
  report: string
}

type HeavyRun = {
  type: "heavy"
  dir: string
  req: HeavySchema.Input
  plan: HeavySchema.Plan
  synth: HeavySchema.Synthesis
  tasks: Task[]
  nested: Run[]
  report: string
}

type Run = CouncilRun | HeavyRun

const args = Bun.argv.slice(2)
const dir = args[0] ? path.resolve(process.cwd(), args[0]) : ""
const out = args[1] ? path.resolve(process.cwd(), args[1]) : ""

function esc(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function text(input: unknown) {
  return esc(String(input ?? ""))
}

function list(items: string[]) {
  return items.length ? `<ul>${items.map((item) => `<li>${text(item)}</li>`).join("")}</ul>` : `<p class="muted">None</p>`
}

function code(body: string) {
  return `<pre>${esc(body)}</pre>`
}

function card(title: string, body: string, tone = "") {
  return `<section class="card ${tone}"><h3>${text(title)}</h3>${body}</section>`
}

function detail(title: string, body: string) {
  return body ? `<details><summary>${text(title)}</summary>${body}</details>` : ""
}

async function json(file: string) {
  return Bun.file(file).json()
}

async function raw(file: string) {
  return Bun.file(file).text().catch(() => "")
}

async function has(file: string) {
  return Bun.file(file).exists()
}

async function council(dir: string): Promise<CouncilRun> {
  const paths = CouncilSchema.Paths.parse(await json(path.join(dir, "paths.json")))
  const req = (await json(paths.request)) as { query?: string; context?: string[] }
  const plan = CouncilSchema.Plan.parse(await json(paths.plan))
  const synth = CouncilSchema.Synthesis.parse(await json(paths.synthesis))
  const report = await raw(paths.report)
  const perspectives = await Promise.all(
    paths.perspectives.map(async (file) => {
      const item = PerspectiveFile.parse(await json(file))
      return {
        ...item,
        json: file,
        md: await raw(file.replace(/\.json$/, ".md")),
      }
    }),
  )
  const debates = await Promise.all(
    paths.debates.map(async (file) => {
      const item = DebateFile.parse(await json(file))
      return {
        ...item,
        json: file,
        md: await raw(file.replace(/\.json$/, ".md")),
      }
    }),
  )
  return {
    type: "council" as const,
    dir,
    req,
    plan,
    synth,
    perspectives,
    debates,
    report,
  }
}

async function heavy(dir: string, seen: Set<string>): Promise<HeavyRun> {
  const paths = HeavySchema.Paths.parse(await json(path.join(dir, "paths.json")))
  const req = HeavySchema.Input.parse(await json(paths.request))
  const plan = HeavySchema.Plan.parse(await json(paths.plan))
  const synth = HeavySchema.Synthesis.parse(await json(paths.synthesis))
  const report = await raw(path.join(dir, "HEAVY_REPORT.md"))
  const tasks = await Promise.all(
    paths.tasks.map(async (file) => {
      const item = TaskFile.parse(await json(file))
      return {
        ...item,
        json: file,
        md: await raw(file.replace(/\.json$/, ".md")),
      }
    }),
  )
  const nested = (
    await Promise.all(
      paths.nested
        .filter(Boolean)
        .filter((item) => item !== dir)
        .filter((item, idx, all) => all.indexOf(item) === idx)
        .map(async (item) => {
          const full = path.resolve(item)
          if (seen.has(full)) return
          return load(full, seen)
        }),
    )
  ).flatMap((item) => (item ? [item] : []))
  return {
    type: "heavy" as const,
    dir,
    req,
    plan,
    synth,
    tasks,
    nested,
    report,
  }
}

async function load(dir: string, seen = new Set<string>()): Promise<Run> {
  const full = path.resolve(dir)
  seen.add(full)
  if (await has(path.join(full, "HEAVY_REPORT.md"))) return heavy(full, seen)
  if (await has(path.join(full, "COUNCIL_REPORT.md"))) return council(full)
  throw new Error(`No heavy or council report found in ${full}`)
}

function stats(items: Array<[string, string | number]>) {
  return `<div class="stats">${items
    .map(
      ([key, value]) =>
        `<div class="stat"><span class="label">${text(key)}</span><span class="value">${text(value)}</span></div>`,
    )
    .join("")}</div>`
}

function frame(title: string, body: string) {
  return `<section class="frame"><h2>${text(title)}</h2>${body}</section>`
}

function renderCouncil(run: CouncilRun): string {
  const summary = [
    card("Recommendation", `<p>${text(run.synth.recommendation)}</p>`),
    card("Executive Summary", `<p>${text(run.synth.executive_summary || run.plan.summary)}</p>`),
    card("Rationale", list(run.synth.rationale)),
  ].join("")

  const perspectives = run.perspectives
    .map((item) =>
      card(
        item.task.persona.name,
        [
          `<p>${text(item.result.executive_summary)}</p>`,
          `<p class="meta">${text(item.task.persona.description)}</p>`,
          `<p><strong>Focus:</strong> ${text(item.task.persona.focus.join(", "))}</p>`,
          `<p><strong>Questions:</strong> ${text(item.task.persona.questions.join(" | "))}</p>`,
          frame("Findings", list(item.result.findings)),
          frame("Recommendations", list(item.result.recommendations)),
          frame("Tradeoffs", list(item.result.tradeoffs)),
          frame("Unknowns", list(item.result.unknowns)),
          item.result.analysis ? detail("Analysis", code(item.result.analysis)) : "",
          detail("Markdown", code(item.md)),
          detail("JSON", code(JSON.stringify(item, null, 2))),
          `<p class="path">${text(item.json)}</p>`,
        ].join(""),
      ),
    )
    .join("")

  const debates = run.debates.length
    ? frame(
        "Debates",
        run.debates
          .map((item) =>
            card(
              item.topic,
              [
                `<p>${text(item.summary)}</p>`,
                `<p><strong>Participants:</strong> ${text(item.participants.map((entry) => entry.name).join(", "))}</p>`,
                `<p><strong>Rounds:</strong> ${text(item.rounds.length)}</p>`,
                frame("Agreements", list(item.agreements)),
                frame("Disagreements", list(item.disagreements)),
                detail("Markdown", code(item.md)),
                detail("JSON", code(JSON.stringify(item, null, 2))),
              ].join(""),
            ),
          )
          .join(""),
      )
    : ""

  return [
    `<section class="run council">`,
    `<header class="hero"><div><p class="badge">Council</p><h1>${text(run.plan.topic)}</h1><p>${text(run.req.query || "")}</p></div>${stats([
      ["Perspectives", run.perspectives.length],
      ["Debates", run.debates.length],
      ["Dir", run.dir],
    ])}</header>`,
    frame("Summary", summary),
    frame(
      "Areas",
      [
        card("Agreements", list(run.synth.agreements)),
        card("Disagreements", list(run.synth.disagreements)),
        card("Tradeoffs", list(run.synth.tradeoffs)),
        card("Next Steps", list(run.synth.next_steps)),
        card("Open Questions", list(run.synth.open_questions)),
      ].join(""),
    ),
    frame("Perspectives", perspectives),
    debates,
    detail("Raw Report", code(run.report)),
    `</section>`,
  ].join("")
}

function renderHeavy(run: HeavyRun): string {
  const plan = frame(
    "Plan",
    run.plan.tasks
      .map((item) =>
        card(
          item.title,
          [
            `<p>${text(item.goal)}</p>`,
            `<p class="meta"><span>${text(item.agent)}</span><span>${text(item.mode)}</span></p>`,
            `<p><strong>Deliverable:</strong> ${text(item.deliverable)}</p>`,
            detail("Prompt", code(item.prompt)),
          ].join(""),
        ),
      )
      .join(""),
  )

  const results = frame(
    "Results",
    run.tasks
      .map((item) =>
        card(
          item.result.title,
          [
            `<p>${text(item.result.summary)}</p>`,
            `<p class="meta"><span>${text(item.task.agent)}</span><span>${text(item.task.mode)}</span></p>`,
            item.result.details ? detail("Details", code(item.result.details)) : "",
            frame("Findings", list(item.result.findings)),
            frame("Next Steps", list(item.result.next_steps)),
            item.result.nested
              ? `<p class="path"><strong>Nested:</strong> ${text(item.result.nested.report)}</p>`
              : "",
            detail("Markdown", code(item.md)),
            detail("JSON", code(JSON.stringify(item, null, 2))),
            `<p class="path">${text(item.json)}</p>`,
          ].join(""),
          item.task.mode === "heavy" ? "accent" : "",
        ),
      )
      .join(""),
  )

  const nested: string = run.nested.length
    ? frame("Nested Runs", run.nested.map((item) => render(item)).join(""))
    : ""

  return [
    `<section class="run heavy">`,
    `<header class="hero"><div><p class="badge">Heavy</p><h1>${text(run.req.query)}</h1><p>${text(run.synth.summary)}</p></div>${stats([
      ["Tasks", run.tasks.length],
      ["Nested", run.nested.length],
      ["Depth", run.req.depth],
    ])}</header>`,
    frame(
      "Synthesis",
      [
        card("Answer", `<p>${text(run.synth.answer)}</p>`),
        card("Key Points", list(run.synth.key_points)),
        card("Next Steps", list(run.synth.next_steps)),
        card("Open Questions", list(run.synth.open_questions)),
      ].join(""),
    ),
    plan,
    results,
    nested,
    detail("Raw Report", code(run.report)),
    `</section>`,
  ].join("")
}

function render(run: Run): string {
  return run.type === "heavy" ? renderHeavy(run) : renderCouncil(run)
}

function html(body: string, file: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${text(path.basename(file))}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f1e8;
      --card: #fffdf9;
      --ink: #1b1a17;
      --muted: #6c655c;
      --line: #ddd3c3;
      --accent: #0f766e;
      --heavy: #8b5cf6;
      --council: #c2410c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.08), transparent 24rem),
        radial-gradient(circle at top right, rgba(194, 65, 12, 0.08), transparent 28rem),
        var(--bg);
      color: var(--ink);
      line-height: 1.5;
    }
    main { max-width: 1100px; margin: 0 auto; padding: 32px 20px 80px; }
    .run { margin-bottom: 28px; }
    .hero, .frame, .card, details {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 14px 34px rgba(27, 26, 23, 0.06);
    }
    .hero {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(0, 1fr) 280px;
      padding: 24px;
      margin-bottom: 18px;
    }
    .hero h1 { margin: 8px 0 12px; font-size: clamp(28px, 5vw, 44px); line-height: 1.05; }
    .badge {
      display: inline-flex;
      margin: 0;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: white;
      background: var(--accent);
    }
    .council .badge { background: var(--council); }
    .heavy .badge { background: var(--heavy); }
    .stats { display: grid; gap: 10px; }
    .stat { padding: 14px; border-radius: 14px; background: rgba(27, 26, 23, 0.04); }
    .label { display: block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .value { display: block; margin-top: 6px; font-size: 14px; word-break: break-word; }
    .frame { padding: 18px; margin: 18px 0; }
    .frame > h2 { margin: 0 0 16px; font-size: 20px; }
    .frame, .hero, .frame > div { display: block; }
    .frame > .card, .frame > .run { margin-bottom: 14px; }
    .frame > .card:last-child, .frame > .run:last-child { margin-bottom: 0; }
    .card { padding: 16px; margin-bottom: 14px; }
    .card:last-child { margin-bottom: 0; }
    .card h3 { margin: 0 0 10px; font-size: 18px; }
    .card.accent { border-color: rgba(139, 92, 246, 0.5); }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      font-size: 14px;
    }
    .meta span {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(27, 26, 23, 0.06);
    }
    .muted { color: var(--muted); }
    .path {
      font-family: "SFMono-Regular", "Menlo", "Monaco", monospace;
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
    }
    ul { margin: 8px 0 0; padding-left: 18px; }
    p { margin: 0 0 12px; }
    pre {
      margin: 10px 0 0;
      padding: 14px;
      overflow: auto;
      border-radius: 12px;
      background: #1f2430;
      color: #f7f7f2;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
    }
    details { padding: 12px 14px; margin-top: 12px; }
    summary { cursor: pointer; font-weight: 600; }
    @media (max-width: 860px) {
      .hero { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`
}

async function main() {
  if (!dir) {
    console.error("Usage: bun run script/visualize-run.ts <artifact-dir> [output.html]")
    process.exit(1)
  }
  const run = await load(dir)
  const file = out || path.join(dir, run.type === "heavy" ? "HEAVY_REPORT.html" : "COUNCIL_REPORT.html")
  await Bun.write(file, html(render(run), file))
  console.log(file)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
