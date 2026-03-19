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
    return `<section class="card"><div class="card-header">${text(title)}</div><div class="card-body">${body}</div></section>`
  }

  function shell(input: { title: string; kind: "heavy" | "council"; lead: string; rail: string; body: string }) {
    // Elegant Editorial / Modern Technical Document Theme
    const accent = input.kind === "heavy" ? "#FF3366" : "#4D4DFF" // Neon Rose vs Electric Indigo
    const accentBg = input.kind === "heavy" ? "rgba(255, 51, 102, 0.1)" : "rgba(77, 77, 255, 0.1)"

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${text(input.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #FAFAFA;
      --fg: #111110;
      --fg-muted: #666665;
      --border: #D1D1CD;
      --accent: ${accent};
      --accent-bg: ${accentBg};
      --font-serif: 'Instrument Serif', serif;
      --font-sans: 'Manrope', sans-serif;
      --font-mono: 'Space Mono', monospace;
    }

    [data-theme="dark"] {
      --bg: #0C0C0C;
      --fg: #F0F0F0;
      --fg-muted: #888888;
      --border: #2A2A2A;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; color-scheme: light dark; }

    body {
      font-family: var(--font-sans);
      background-color: var(--bg);
      color: var(--fg);
      margin: 0;
      padding: 0;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      transition: background-color 0.3s ease, color 0.3s ease;
    }

    .theme-toggle {
      position: absolute;
      top: 2rem;
      right: 2rem;
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      z-index: 100;
    }

    .theme-toggle:hover {
      background: var(--accent-bg);
      border-color: var(--accent);
      color: var(--accent);
    }

    .theme-toggle svg {
      width: 20px;
      height: 20px;
    }

    [data-theme="dark"] .sun-icon { display: block; }
    [data-theme="dark"] .moon-icon { display: none; }
    [data-theme="light"] .sun-icon { display: none; }
    [data-theme="light"] .moon-icon { display: block; }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem 2rem;
    }

    .masthead {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 2rem;
      position: relative;
    }

    .badge {
      display: inline-block;
      font-family: var(--font-mono);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      background: var(--fg);
      color: var(--bg);
      padding: 0.25rem 0.6rem;
      border-radius: 999px;
      margin-bottom: 1rem;
    }

    .title {
      font-family: var(--font-serif);
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 400;
      line-height: 1;
      margin: 0 0 1rem 0;
      letter-spacing: -0.02em;
      text-wrap: balance;
    }

    .lead {
      font-size: 1.25rem;
      color: var(--fg-muted);
      max-width: 800px;
      margin: 0;
      font-weight: 300;
      line-height: 1.4;
      text-wrap: pretty;
    }

    .grid-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 5rem;
      align-items: start;
    }

    /* Sidebar */
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 3rem;
      position: sticky;
      top: 4rem;
      max-height: calc(100vh - 8rem);
      overflow-y: auto;
      scrollbar-width: none;
    }
    
    .sidebar::-webkit-scrollbar { display: none; }

    .card {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .card-header {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--fg-muted);
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.5rem;
    }

    .statgrid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .stat {
      display: flex;
      flex-direction: column;
    }

    .stat .label {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      text-transform: uppercase;
      color: var(--fg-muted);
      margin-bottom: 0.25rem;
      letter-spacing: 0.05em;
    }

    .stat .value {
      font-family: var(--font-serif);
      font-size: 2.5rem;
      font-weight: 400;
      line-height: 1;
      color: var(--fg);
    }

    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .chip {
      font-size: 0.85rem;
      padding: 0.3rem 0.8rem;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: transparent;
      color: var(--fg);
    }

    .links {
      font-family: var(--font-mono);
      font-size: 0.85rem;
      margin-bottom: 8px;
    }

    .links a {
      color: var(--accent);
      text-decoration: none;
      transition: all 0.2s ease;
    }

    .links a:hover, .links a:focus-visible {
      text-decoration: underline;
      outline: none;
    }

    .path {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--fg-muted);
      word-break: break-all;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed var(--border);
    }

    .summary {
      font-size: 0.9rem;
      color: var(--fg);
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      line-height: 1.4;
    }
    
    .summary:last-child { border-bottom: none; padding-bottom: 0; }
    
    .summary-num {
      font-family: var(--font-mono);
      color: var(--fg-muted);
      margin-right: 0.5rem;
      font-size: 0.8rem;
    }

    .summary-tag {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      text-transform: uppercase;
      padding: 0.1rem 0.4rem;
      background: var(--border);
      border-radius: 4px;
      margin-left: 0.5rem;
    }

    /* Content Area */
    .content {
      font-size: 1.125rem;
      max-width: 800px;
      color: var(--fg);
    }

    .content h1, .content h2, .content h3, .content h4 {
      font-family: var(--font-serif);
      font-weight: 400;
      margin-top: 3.5rem;
      margin-bottom: 1.5rem;
      line-height: 1.1;
      text-wrap: balance;
      color: var(--fg);
    }

    .content h1 { font-size: 3.5rem; }
    .content h2 { font-size: 2.5rem; }
    .content h3 { font-size: 1.75rem; }

    .content p {
      margin-bottom: 1.5rem;
    }

    .content a {
      color: var(--accent);
      text-decoration: none;
      border-bottom: 1px solid var(--accent-bg);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .content a:hover, .content a:focus-visible {
      background-color: var(--accent-bg);
      border-bottom-color: var(--accent);
      outline: none;
    }

    .content ul, .content ol {
      margin-bottom: 2rem;
      padding-left: 1.5rem;
    }

    .content li {
      margin-bottom: 0.5rem;
    }

    .content li::marker {
      color: var(--fg-muted);
    }

    .content blockquote {
      margin: 2.5rem 0;
      padding: 1.5rem 2rem;
      border-left: 2px solid var(--accent);
      background: var(--accent-bg);
      font-style: italic;
      font-size: 1.25rem;
      color: var(--fg);
    }

    .content blockquote p { margin: 0; }

    .content hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 4rem 0;
    }

    /* Code Blocks */
    .content code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--border);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      color: var(--fg);
    }

    .code-block {
      margin: 2.5rem 0;
      background: #111110;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.1);
    }

    @media (prefers-color-scheme: dark) {
      .code-block { background: #1A1A1A; border-color: var(--border); }
    }

    .code-header {
      padding: 0.5rem 1rem;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      justify-content: flex-end;
    }

    .code-header .lang {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: #A0A0A0;
      text-transform: uppercase;
    }

    .content pre.code {
      margin: 0;
      padding: 1.5rem;
      overflow-x: auto;
    }

    .content pre.code code {
      background: transparent;
      padding: 0;
      color: #E2E2E2;
      font-size: 0.9rem;
      border: none;
    }

    /* Focus States */
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 4px;
      border-radius: 2px;
    }

    @media (max-width: 1024px) {
      .grid-layout { grid-template-columns: 1fr; gap: 3rem; }
      .sidebar { position: static; max-height: none; }
      .container { padding: 2rem 1.5rem; }
      .title { font-size: 3rem; }
      .masthead { margin-bottom: 2rem; padding-bottom: 2rem; }
    }
  </style>
</head>
<body>
  <button id="theme-toggle" class="theme-toggle" aria-label="Toggle theme">
    <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
    <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
  </button>
  <div class="container">
    <header class="masthead">
      <div class="badge">${text(input.kind)}</div>
      <h1 class="title">${text(input.title)}</h1>
      <p class="lead">${text(input.lead)}</p>
    </header>
    
    <main class="grid-layout">
      <aside class="sidebar">
        ${input.rail}
      </aside>
      
      <article class="content">
        ${input.body}
      </article>
    </main>
  </div>
  <script>
    const toggle = document.getElementById('theme-toggle');
    const html = document.documentElement;
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.setAttribute('data-theme', isDark ? 'dark' : 'light');
    toggle.addEventListener('click', () => {
      const currentTheme = html.getAttribute('data-theme');
      html.setAttribute('data-theme', currentTheme === 'dark' ? 'light' : 'dark');
    });
  </script>
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
        card("Answer", `<p style="margin:0;font-size:0.95rem">${text(input.synth.answer)}</p>`),
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
                `<div class="summary"><span class="summary-num">${text(String(idx + 1).padStart(2, "0"))}</span> ${text(item.title)} <span class="summary-tag">${text(item.mode)}</span></div>`,
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
        card("Recommendation", `<p style="margin:0;font-size:0.95rem">${text(input.synth.recommendation)}</p>`),
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
            .map((item) => `<div class="summary"><strong style="display:block;margin-bottom:4px">${text(item.name)}</strong><span style="color:var(--fg-muted);font-size:0.85rem">${text(item.focus.join(", "))}</span></div>`)
            .join(""),
        ),
      ].join(""),
      body: md(input.report),
    })
  }
}
