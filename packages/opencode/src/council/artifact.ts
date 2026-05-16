import { mkdir } from "fs/promises"
import path from "path"
import type { SessionID, MessageID } from "../session/schema"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"

export namespace CouncilArtifact {
  function clean(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
  }

  export function dir(root: string, input: { sessionID: SessionID; messageID: MessageID }) {
    return path.join(root, ".opencode", "council", input.sessionID, input.messageID)
  }

  export function init(input: { sessionID: SessionID; messageID: MessageID }) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const root = dir(ctx.directory, input)
      yield* Effect.promise(() => mkdir(path.join(root, "perspectives"), { recursive: true }))
      yield* Effect.promise(() => mkdir(path.join(root, "debates"), { recursive: true }))
      return root
    })
  }

  export function perspective(id: string) {
    return clean(id) || "perspective"
  }

  export function debate(id: string) {
    return clean(id) || "debate"
  }

  export function json(file: string, data: unknown) {
    return Effect.promise(() => Bun.write(file, JSON.stringify(data, null, 2) + "\n"))
  }
}
