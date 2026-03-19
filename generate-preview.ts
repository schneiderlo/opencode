import { writeFileSync } from "fs";
import path from "path";
import { RunHtml } from "./packages/opencode/src/report/html.ts";

const heavyHtml = RunHtml.heavy({
  dir: "/home/modkin/workspace/schneiderlo/opencode",
  query: "Refactor the authentication module to support OAuth 2.0",
  plan: {
    tasks: [
      { id: "1", title: "Analyze current Auth flow", mode: "read" },
      { id: "2", title: "Implement OAuth providers", mode: "write" }
    ]
  },
  tasks: [
    { task: { id: "1", title: "Analyze current Auth flow", mode: "read" }, result: { nested: false }, json: "{}", md: "" },
    { task: { id: "2", title: "Implement OAuth providers", mode: "write" }, result: { nested: true }, json: "{}", md: "" }
  ],
  synth: {
    summary: "The authentication module was successfully refactored. OAuth 2.0 providers (Google, GitHub) are now integrated.",
    answer: "I have implemented the OAuth 2.0 flow using the new providers. You will need to set the environment variables in your deployment.",
    key_points: ["Added Google Provider", "Added GitHub Provider", "Refactored session management"],
    next_steps: ["Add environment variables", "Update the database schema"]
  },
  report: `# Authentication Refactor
  
We have completed the refactoring. Here are the details:

## Key Changes
- Removed old basic auth code from \`src/auth/basic.ts\`
- Added new OAuth flow in \`src/auth/oauth.ts\`
- Updated session tokens to use JWT

### Example Configuration

You can now configure your \`Auth\` instance easily:

\`\`\`ts
import { Auth } from "@auth/core";
import { Google, GitHub } from "@auth/providers";

export const auth = new Auth({
  providers: [
    Google({ clientId: process.env.GOOGLE_ID, clientSecret: process.env.GOOGLE_SECRET }),
    GitHub({ clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET })
  ],
  session: { strategy: "jwt" }
});
\`\`\`

> Please ensure that the **environment variables** are set before running the server, otherwise the providers will fail to initialize.

1. First point
2. Second point

* Added some tests
* Cleaned up old dependencies

Thank you!
`,
  reportPath: "/tmp/heavy.md",
  reportHtmlPath: "/tmp/heavy.html"
});

const councilHtml = RunHtml.council({
  dir: "/home/modkin/workspace/schneiderlo/opencode",
  query: "Should we migrate to a monorepo?",
  plan: {
    topic: "Monorepo Migration",
    summary: "Evaluating the benefits and drawbacks of migrating the project to a monorepo structure using Turborepo.",
    perspectives: [
      { name: "DevOps", focus: ["CI/CD", "Build times"] },
      { name: "Frontend", focus: ["Shared UI components", "Developer experience"] },
      { name: "Backend", focus: ["Shared types", "Deployment complexity"] }
    ]
  },
  results: [
    { task: { id: "1" }, result: {}, json: "{}", md: "" },
    { task: { id: "2" }, result: {}, json: "{}", md: "" },
    { task: { id: "3" }, result: {}, json: "{}", md: "" }
  ],
  debates: [
    { id: "1", title: "Build times vs Complexity", json: "{}" },
    { id: "2", title: "Turborepo vs Nx", json: "{}" }
  ],
  synth: {
    executive_summary: "Migrating to a monorepo is strongly recommended due to the pressing need for shared UI components and synchronized full-stack deployments.",
    recommendation: "Proceed with Turborepo migration in Q3.",
    rationale: ["Easier code sharing", "Unified versioning", "Better DX for fullstack features"],
    open_questions: ["How do we handle containerized deployments?", "Which package manager to use (pnpm vs bun)?"]
  },
  report: `# Monorepo Investigation

The council has met to discuss the monorepo migration and analyzed various trade-offs.

## Perspectives
1. DevOps is concerned about CI setup.
2. Frontend is excited about shared components.
3. Backend wants shared types across boundaries.

### Analysis
The primary debate centered around build times. While monorepos can increase total codebase size, tools like **Turborepo** offer remote caching that offsets this cost.

> "If we adopt remote caching, our CI times might actually decrease for untouched packages."
> — DevOps Perspective

**Conclusion:** We will proceed with the migration.
`,
  reportPath: "/tmp/council.md",
  reportHtmlPath: "/tmp/council.html"
});

writeFileSync(path.join(process.cwd(), "preview-heavy.html"), heavyHtml);
writeFileSync(path.join(process.cwd(), "preview-council.html"), councilHtml);
console.log("Previews generated: preview-heavy.html and preview-council.html");
