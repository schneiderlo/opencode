import { mkdir } from "fs/promises"
import path from "path"
import { Instance } from "../project/instance"
import type { SessionID, MessageID } from "../session/schema"

export namespace CouncilArtifact {
  function clean(input: string) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64)
  }

  export function dir(input: { sessionID: SessionID; messageID: MessageID }) {
    return path.join(Instance.directory, ".opencode", "council", input.sessionID, input.messageID)
  }

  export async function init(input: { sessionID: SessionID; messageID: MessageID }) {
    const root = dir(input)
    await mkdir(path.join(root, "perspectives"), { recursive: true })
    await mkdir(path.join(root, "debates"), { recursive: true })
    return root
  }

  export function perspective(id: string) {
    return clean(id) || "perspective"
  }

  export function debate(id: string) {
    return clean(id) || "debate"
  }

  export async function json(file: string, data: unknown) {
    await Bun.write(file, JSON.stringify(data, null, 2) + "\n")
  }
}
