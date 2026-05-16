import { mkdir } from "fs/promises"
import path from "path"
import type { MessageID, SessionID } from "../session/schema"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"

export namespace HeavyArtifact {
  function clean(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
  }

  export function dir(root: string, input: { sessionID: SessionID; messageID: MessageID }) {
    return path.join(root, ".opencode", "heavy", input.sessionID, input.messageID)
  }

  export function init(input: { sessionID: SessionID; messageID: MessageID }) {
    return Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      const root = dir(ctx.directory, input)
      yield* Effect.promise(() => mkdir(path.join(root, "tasks"), { recursive: true }))
      yield* Effect.promise(() => mkdir(path.join(root, "nested"), { recursive: true }))
      return root
    })
  }

  export function task(id: string) {
    return clean(id) || "task"
  }

  export function child(root: string, id: string) {
    const dir = path.join(root, "nested", task(id))
    return Effect.gen(function* () {
      yield* Effect.promise(() => mkdir(path.join(dir, "tasks"), { recursive: true }))
      yield* Effect.promise(() => mkdir(path.join(dir, "nested"), { recursive: true }))
      return dir
    })
  }

  export function json(file: string, data: unknown) {
    return Effect.promise(() => Bun.write(file, JSON.stringify(data, null, 2) + "\n"))
  }
}
