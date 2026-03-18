import { mkdir } from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import type { MessageID, SessionID } from "../session/schema"

export namespace HeavyArtifact {
  function clean(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
  }

  export function dir(input: { sessionID: SessionID; messageID: MessageID }) {
    return path.join(Instance.directory, ".opencode", "heavy", input.sessionID, input.messageID)
  }

  export async function init(input: { sessionID: SessionID; messageID: MessageID }) {
    const root = dir(input)
    await mkdir(path.join(root, "tasks"), { recursive: true })
    return root
  }

  export function task(id: string) {
    return clean(id) || "task"
  }

  export async function json(file: string, data: unknown) {
    await Bun.write(file, JSON.stringify(data, null, 2) + "\n")
  }
}
