import path from "path"
import { pathToFileURL } from "url"
import type { CouncilSchema } from "../council/schema"
import type { HeavySchema } from "../heavy/schema"

export namespace RunHtml {
  function esc(input: string) {
    return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
  }

  function text(input: unknown) {
    return esc(String(input ?? ""))
  }

  function href(file: string) {
    return pathToFileURL(file).href
  }

  function link(file: string, label = path.basename(file)) {
    return `<a href="${text(href(file))}">${text(label)}</a>`
  }

  function inline(input: string) {
    return input
      .split(/(`[^`]+`)/g)
      .map((part) => {
        if (part.startsWith("\`") && part.endsWith("\`")) {
          return `<code>${text(part.slice(1, -1))}</code>`
        }
        return esc(part)
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${text(url)}">${text(label)}</a>`)
          .replace(/\*\*([^*]+)\*\*/g, (_, value) => `<strong>${text(value)}</strong>`)
          .replace(/\*([^*]+)\*/g, (_, value) => `<em>${text(value)}</em>`)
      })
      .join("")
  }

  function md(input: string) {
    const lines = input.replaceAll("\r\n", "\n").split("\n")
    const out: string[] = []
    let idx = 0

    while (idx < lines.length) {
      const line = lines[idx]?.trimEnd() ?? ""
      const trim = line.trim()

      if (!trim) {
        idx++
        continue
      }

      if (trim.startsWith("\`\`\`")) {
        const lang = trim.slice(3).trim()
        idx++
        const body: string[] = []
        while (idx < lines.length && !lines[idx].trim().startsWith("\`\`\`")) {
          body.push(lines[idx])
          idx++
        }
        if (idx < lines.length) idx++
        out.push(
          `<div class="code-block"><div class="code-header"><span class="lang">${text(lang || "text")}</span></div><pre class="code"><code>${text(body.join("\n"))}</code></pre></div>`,
        )
        continue
      }

      const head = /^(#{1,6})\s+(.*)$/.exec(trim)
      if (head) {
        const level = head[1].length
        out.push(`<h${level}>${inline(head[2])}</h${level}>`)
        idx++
        continue
      }

      if (/^---+$/.test(trim)) {
        out.push("<hr />")
        idx++
        continue
      }

      if (/^>\s?/.test(trim)) {
        const body: string[] = []
        while (idx < lines.length && /^>\s?/.test(lines[idx].trim())) {
          body.push(lines[idx].trim().replace(/^>\s?/, ""))
          idx++
        }
        out.push(`<blockquote>${body.map((item) => `<p>${inline(item)}</p>`).join("")}</blockquote>`)
        continue
      }

      if (/^[-*]\s+/.test(trim)) {
        const body: string[] = []
        while (idx < lines.length && /^[-*]\s+/.test(lines[idx].trim())) {
          body.push(lines[idx].trim().replace(/^[-*]\s+/, ""))
          idx++
        }
        out.push(`<ul>${body.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`)
        continue
      }

      if (/^\d+\.\s+/.test(trim)) {
        const body: string[] = []
        while (idx < lines.length && /^\d+\.\s+/.test(lines[idx].trim())) {
          body.push(lines[idx].trim().replace(/^\d+\.\s+/, ""))
          idx++
        }
        out.push(`<ol>${body.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`)
        continue
      }

      const body: string[] = []
      while (
        idx < lines.length &&
        lines[idx].trim() &&
        !/^(#{1,6})\s+/.test(lines[idx].trim()) &&
        !/^[-*]\s+/.test(lines[idx].trim()) &&
        !/^\d+\.\s+/.test(lines[idx].trim()) &&
        !/^>\s?/.test(lines[idx].trim()) &&
        !/^\`\`\`/.test(lines[idx].trim()) &&
        !/^---+$/.test(lines[idx].trim())
      ) {
        body.push(lines[idx].trim())
        idx++
      }
      out.push(`<p>${inline(body.join(" "))}</p>`)
    }

    return out.join("\n")
  }

  function stat(label: string, value: string | number) {
    return `<div class="stat"><span class="label">${text(label)}</span><span class="value">${text(value)}</span></div>`
  }

  function card(title: string, body: string) {
    return `<section class="card"><div class="card-header"><span class="eyebrow">${text(title)}</span></div><div class="card-body">${body}</div></section>`
  }

  function shell(input: { title: string; kind: "heavy" | "council"; lead: string; rail: string; body: string }) {
    // Cyber/Industrial Neo-Brutalist theme
    const ink = input.kind === "heavy" ? "#ff2a4d" : "#00f0ff" // Radical Red vs Cyan
    const tint = input.kind === "heavy" ? "rgba(255, 42, 77, 0.15)" : "rgba(0, 240, 255, 0.15)"

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${text(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;700;800&family=Space+Grotesk:wght@300..700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg: #09090b;
      --paper: #121214;
      --panel: #000000;
      --ink: #f4f4f5;
      --muted: #a1a1aa;
      --line: #27272a;
      --accent: ${ink};
      --accent-soft: ${tint};
      --shadow: 4px 4px 0px var(--accent);
      --font-display: 'Bebas Neue', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
      --font-body: 'Space Grotesk', sans-serif;
    }
    
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    
    body {
      margin: 0;
      color: var(--ink);
      font-family: var(--font-body);
      background-color: var(--bg);
      background-image: 
        linear-gradient(var(--line) 1px, transparent 1px),
        linear-gradient(90deg, var(--line) 1px, transparent 1px);
      background-size: 40px 40px;
      background-position: -1px -1px;
      line-height: 1.6;
      font-size: 16px;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(circle at 50% 0%, var(--accent-soft), transparent 60%);
      opacity: 0.5;
      z-index: -1;
    }

    /* Scanline effect */
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(
        to bottom,
        rgba(255, 255, 255, 0),
        rgba(255, 255, 255, 0.02) 50%,
        rgba(0, 0, 0, 0.05) 50%,
        rgba(0, 0, 0, 0)
      );
      background-size: 100% 4px;
      z-index: 9999;
      opacity: 0.3;
    }

    main {
      max-width: 1600px;
      margin: 0 auto;
      padding: 40px 24px;
    }

    .layout {
      display: grid;
      grid-template-columns: 380px minmax(0, 1fr);
      gap: 32px;
      align-items: start;
    }

    .rail {
      position: sticky;
      top: 40px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      scrollbar-width: none;
    }
    
    .rail::-webkit-scrollbar { display: none; }

    .paper {
      position: relative;
      background: var(--paper);
      border: 2px solid var(--line);
      padding: 48px clamp(24px, 5vw, 80px);
      box-shadow: 8px 8px 0px rgba(0,0,0,0.5);
      animation: slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .paper::before {
      content: "";
      position: absolute;
      top: 0; left: 0; width: 100%; height: 4px;
      background: var(--accent);
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      font-family: var(--font-mono);
      font-weight: 700;
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      background: var(--accent);
      color: #000;
      margin-bottom: 24px;
      box-shadow: 4px 4px 0px rgba(0,0,0,0.8);
      transform: rotate(-1deg);
    }

    .cover {
      background: var(--panel);
      border: 2px solid var(--line);
      padding: 32px 24px;
      position: relative;
    }
    
    .cover::after {
      content: "SYS.REP";
      position: absolute;
      bottom: -10px;
      right: 16px;
      background: var(--bg);
      padding: 0 8px;
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--muted);
      border-left: 2px solid var(--line);
      border-right: 2px solid var(--line);
    }

    .cover h1 {
      margin: 0 0 16px;
      font-family: var(--font-display);
      font-size: clamp(3rem, 5vw, 4.5rem);
      line-height: 0.85;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--ink);
      text-shadow: 2px 2px 0px var(--accent);
    }

    .cover p {
      margin: 0;
      color: var(--muted);
      font-size: 1.1rem;
      border-left: 2px solid var(--accent);
      padding-left: 16px;
    }

    .card {
      background: var(--panel);
      border: 2px solid var(--line);
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translate(-2px, -2px);
      box-shadow: 4px 4px 0px var(--accent);
      border-color: var(--muted);
    }

    .card-header {
      padding: 12px 16px;
      border-bottom: 2px solid var(--line);
      background: rgba(255,255,255,0.02);
    }

    .card-body {
      padding: 16px;
    }

    .eyebrow {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--ink);
    }

    .statgrid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(2, 1fr);
    }

    .stat {
      background: var(--panel);
      border: 2px solid var(--line);
      padding: 16px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
    }

    .stat::before {
      content: "";
      position: absolute;
      top: 0; left: 0; width: 4px; height: 100%;
      background: var(--accent);
    }

    .label {
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .value {
      font-family: var(--font-display);
      font-size: 2.5rem;
      line-height: 1;
      color: var(--ink);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      padding: 4px 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      background: var(--accent-soft);
      color: var(--accent);
      border: 1px solid var(--accent);
      text-transform: uppercase;
    }

    /* Article Typography */
    .article h1, .article h2, .article h3, .article h4 {
      font-family: var(--font-display);
      text-transform: uppercase;
      margin: 3rem 0 1.5rem;
      line-height: 0.9;
      color: var(--ink);
    }

    .article h1 { font-size: 3.5rem; color: var(--accent); }
    .article h2 { 
      font-size: 2.5rem; 
      padding-bottom: 12px;
      border-bottom: 2px solid var(--line);
    }
    .article h3 { font-size: 1.8rem; }
    
    .article p {
      margin: 0 0 1.5rem;
      font-size: 1.1rem;
      color: #d4d4d8;
    }

    .article strong { 
      color: #fff;
      font-weight: 700;
      background: var(--accent-soft);
      padding: 0 4px;
    }
    
    .article em {
      font-style: italic;
      color: var(--accent);
    }

    .article ul, .article ol {
      margin: 0 0 2rem;
      padding-left: 1.5rem;
      color: #d4d4d8;
    }

    .article li {
      margin-bottom: 0.5rem;
      padding-left: 0.5rem;
    }

    .article li::marker {
      color: var(--accent);
      font-family: var(--font-mono);
    }

    .article a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px dashed var(--accent);
      transition: all 0.2s;
    }

    .article a:hover {
      background: var(--accent);
      color: #000;
    }

    .article blockquote {
      margin: 2rem 0;
      padding: 1.5rem;
      background: var(--panel);
      border-left: 4px solid var(--accent);
      font-style: italic;
      font-size: 1.2rem;
      position: relative;
    }

    .article blockquote::before {
      content: '"';
      position: absolute;
      top: -10px;
      left: 10px;
      font-family: var(--font-display);
      font-size: 4rem;
      color: var(--line);
      line-height: 1;
    }

    .article hr {
      border: 0;
      height: 2px;
      background: repeating-linear-gradient(
        90deg,
        var(--line),
        var(--line) 10px,
        transparent 10px,
        transparent 20px
      );
      margin: 3rem 0;
    }

    /* Code Blocks */
    .article code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--panel);
      padding: 2px 6px;
      border: 1px solid var(--line);
      color: var(--accent);
    }

    .code-block {
      margin: 2rem 0;
      border: 2px solid var(--line);
      background: #000;
      border-radius: 0;
      overflow: hidden;
      box-shadow: 4px 4px 0px rgba(0,0,0,0.5);
    }

    .code-header {
      background: var(--panel);
      padding: 8px 16px;
      border-bottom: 2px solid var(--line);
      display: flex;
      justify-content: flex-end;
    }

    .code-header .lang {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .article pre.code {
      margin: 0;
      padding: 1.5rem;
      overflow-x: auto;
    }

    .article pre.code code {
      background: transparent;
      padding: 0;
      border: none;
      color: #e0e0e0;
      font-size: 0.9rem;
    }

    .links {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin-bottom: 8px;
    }

    .links a {
      color: var(--accent);
      text-decoration: none;
    }

    .links a:hover {
      text-decoration: underline;
    }

    .path {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
      word-break: break-all;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
    }

    .summary {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      color: var(--ink);
      padding: 8px 0;
      border-bottom: 1px dashed var(--line);
    }
    
    .summary:last-child {
      border-bottom: none;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 1024px) {
      .layout { grid-template-columns: 1fr; }
      .rail { position: static; max-height: none; }
      .paper { padding: 32px 24px; }
      .cover h1 { font-size: 3rem; }
    }
  </style>
</head>
<body>
  <main>
    <div class="layout">
      <aside class="rail">
        <div class="cover">
          <div class="badge">${text(input.kind)}</div>
          <h1>${text(input.title)}</h1>
          <p>${text(input.lead)}</p>
        </div>
        ${input.rail}
      </aside>
      <section class="paper">
        <article class="article">${input.body}</article>
      </section>
    </div>
  </main>
</body>
</html>`
  }

  export function heavy(input: {
    dir: string
    query: string
    plan: HeavySchema.Plan
    tasks: Array<{
      task: HeavySchema.Plan["tasks"][number]
      result: HeavySchema.Result
      json: string
      md: string
    }>
    synth: HeavySchema.Synthesis
    report: string
    reportPath: string
    reportHtmlPath: string
  }) {
    return shell({
      title: input.query,
      kind: "heavy",
      lead: input.synth.summary,
      rail: [
        `<div class="statgrid">${[
          stat("Tasks", input.tasks.length),
          stat("Nested", input.tasks.filter((item) => item.result.nested).length),
          stat("Key Points", input.synth.key_points.length),
          stat("Next Steps", input.synth.next_steps.length),
        ].join("")}</div>`,
        card("Answer", `<p>${text(input.synth.answer)}</p>`),
        card(
          "Key Points",
          `<div class="chips">${input.synth.key_points.map((item) => `<span class="chip">${text(item)}</span>`).join("") || '<span class="chip">None recorded</span>'}</div>`,
        ),
        card(
          "Artifacts",
          [
            `<div class="links"><strong>MD:</strong> ${link(input.reportPath)}</div>`,
            `<div class="links"><strong>HTML:</strong> ${link(input.reportHtmlPath)}</div>`,
            `<div class="path">${text(input.dir)}</div>`,
          ].join(""),
        ),
        card(
          "Task Index",
          input.plan.tasks
            .map(
              (item, idx) =>
                `<div class="summary">${text(String(idx + 1).padStart(2, "0"))} // ${text(item.title)} // [${text(item.mode)}]</div>`,
            )
            .join(""),
        ),
      ].join(""),
      body: md(input.report),
    })
  }

  export function council(input: {
    dir: string
    query: string
    plan: CouncilSchema.Plan
    results: Array<{
      task: CouncilSchema.Task
      result: CouncilSchema.Result
      json: string
      md: string
    }>
    debates: Array<CouncilSchema.Debate & { json: string; md?: string }>
    synth: CouncilSchema.Synthesis
    report: string
    reportPath: string
    reportHtmlPath: string
  }) {
    return shell({
      title: input.plan.topic,
      kind: "council",
      lead: input.synth.executive_summary || input.plan.summary,
      rail: [
        `<div class="statgrid">${[
          stat("Perspectives", input.results.length),
          stat("Debates", input.debates.length),
          stat("Rationale", input.synth.rationale.length),
          stat("Open Questions", input.synth.open_questions.length),
        ].join("")}</div>`,
        card("Recommendation", `<p>${text(input.synth.recommendation)}</p>`),
        card(
          "Rationale",
          `<div class="chips">${input.synth.rationale.map((item) => `<span class="chip">${text(item)}</span>`).join("")}</div>`,
        ),
        card(
          "Artifacts",
          [
            `<div class="links"><strong>MD:</strong> ${link(input.reportPath)}</div>`,
            `<div class="links"><strong>HTML:</strong> ${link(input.reportHtmlPath)}</div>`,
            `<div class="path">${text(input.dir)}</div>`,
          ].join(""),
        ),
        card(
          "Perspective Index",
          input.plan.perspectives
            .map((item) => `<div class="summary">[${text(item.name)}] // ${text(item.focus.join(", "))}</div>`)
            .join(""),
        ),
      ].join(""),
      body: md(input.report),
    })
  }
}
