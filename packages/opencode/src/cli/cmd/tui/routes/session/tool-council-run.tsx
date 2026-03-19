import { createEffect, createMemo, For, Show, Switch, Match } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import type { CouncilRunTool } from "@/tool/council_run"
import { type ToolProps, BlockTool, InlineTool } from "./index"

export function CouncilRun(props: ToolProps<typeof CouncilRunTool>) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const keybind = useKeybind()
  const sync = useSync()

  const stage = createMemo(() => {
    const value = props.metadata.stage
    if (typeof value === "string" && value) return value
    if (props.part.state.status === "completed") return "completed"
    return "planning"
  })

  const rows = createMemo(() => {
    const value = Array.isArray(props.metadata.perspectives) ? props.metadata.perspectives : []
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const name = typeof item.name === "string" ? item.name : ""
      if (!name) return []
      return [
        {
          name,
          status:
            item.status === "running" || item.status === "completed" || item.status === "error" ? item.status : "pending",
          sessionID: typeof item.sessionID === "string" ? item.sessionID : "",
          preview: typeof item.preview === "string" ? item.preview : "",
        },
      ]
    })
  })

  createEffect(() => {
    for (const item of rows()) {
      if (!item.sessionID) continue
      if (sync.data.message[item.sessionID]?.length) continue
      sync.session.sync(item.sessionID).catch(() => {})
    }
  })

  function current(sessionID: string) {
    const messages = sync.data.message[sessionID] ?? []
    const tools = messages.flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is typeof props.part => part.type === "tool")
        .map((part) => ({
          tool: part.tool,
          title:
            typeof (part.state as Record<string, unknown> | undefined)?.title === "string"
              ? ((part.state as Record<string, unknown>).title as string)
              : "",
        })),
    )
    const last = tools.findLast((item) => item.title)
    return {
      title: sync.session.get(sessionID)?.title ?? "",
      status: sync.session.status(sessionID),
      current: last ? `${Locale.titlecase(last.tool)} ${last.title}` : "",
    }
  }

  const debates = createMemo(() => {
    const value = Array.isArray(props.metadata.debates) ? props.metadata.debates : []
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const topic = typeof item.topic === "string" ? item.topic : ""
      if (!topic) return []
      return [
        {
          topic,
          status:
            item.status === "running" || item.status === "completed" || item.status === "error" ? item.status : "pending",
          preview: typeof item.preview === "string" ? item.preview : "",
        },
      ]
    })
  })

  const done = createMemo(() => rows().filter((item) => item.status === "completed").length)
  const spin = createMemo(() => props.part.state.status === "pending" || props.part.state.status === "running")
  const hint = createMemo(() => {
    if (stage() === "planning") return "Planning council..."
    if (stage() === "consulting") return "Consulting perspectives..."
    if (stage() === "debating") return "Running debates..."
    if (stage() === "synthesizing") return "Synthesizing recommendation..."
    if (stage() === "completed") return "Council analysis complete"
    return "Council analysis"
  })

  return (
    <Switch>
      <Match when={rows().length > 0 || debates().length > 0}>
        <BlockTool
          title={
            rows().length > 0
              ? `# Council: ${done()}/${rows().length} perspectives completed`
              : `# Council: ${Locale.titlecase(stage())}`
          }
          part={props.part}
          spinner={spin()}
        >
          <box flexDirection="column" gap={0}>
            <text paddingLeft={3} fg={theme.textMuted}>
              Stage: {Locale.titlecase(stage())}
            </text>

            <For each={rows()}>
              {(item) => {
                const color = () => {
                  if (item.status === "running") return theme.warning
                  if (item.status === "completed") return theme.success
                  if (item.status === "error") return theme.error
                  return theme.textMuted
                }

                const icon = () => {
                  if (item.status === "running") return "↻"
                  if (item.status === "completed") return "✓"
                  if (item.status === "error") return "✗"
                  return "•"
                }

                return (
                  <box
                    flexDirection="column"
                    gap={0}
                    onMouseUp={() => {
                      if (item.sessionID) {
                        navigate({ type: "session", sessionID: item.sessionID })
                      }
                    }}
                  >
                    <box flexDirection="row" gap={1}>
                      <text style={{ fg: color() }}>[{icon()}]</text>
                      <text style={{ fg: theme.text }}>{item.name}</text>
                    </box>
                    <Show when={item.preview}>
                      <text paddingLeft={6} style={{ fg: theme.textMuted }}>
                        {item.preview}
                      </text>
                    </Show>
                    <Show when={item.sessionID && current(item.sessionID).title}>
                      <text paddingLeft={6} style={{ fg: theme.textMuted }}>
                        Session: {current(item.sessionID).title}
                      </text>
                    </Show>
                    <Show when={item.sessionID && current(item.sessionID).current}>
                      <text paddingLeft={6} style={{ fg: theme.textMuted }}>
                        Current: {current(item.sessionID).current}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>

            <Show when={debates().length > 0}>
              <text paddingLeft={3} fg={theme.textMuted}>
                Debates
              </text>
              <For each={debates()}>
                {(item) => {
                  const color = () => {
                    if (item.status === "running") return theme.warning
                    if (item.status === "completed") return theme.success
                    if (item.status === "error") return theme.error
                    return theme.textMuted
                  }

                  const icon = () => {
                    if (item.status === "running") return "↻"
                    if (item.status === "completed") return "✓"
                    if (item.status === "error") return "✗"
                    return "•"
                  }

                  return (
                    <box flexDirection="column" gap={0}>
                      <box flexDirection="row" gap={1}>
                        <text style={{ fg: color() }}>[{icon()}]</text>
                        <text style={{ fg: theme.text }}>{item.topic}</text>
                      </box>
                      <Show when={item.preview}>
                        <text paddingLeft={6} style={{ fg: theme.textMuted }}>
                          {item.preview}
                        </text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </Show>

            <Show when={rows().some((item) => !!item.sessionID)}>
              <box marginTop={1} flexDirection="row" gap={1}>
                <text style={{ fg: theme.text }}>
                  {keybind.print("session_child_first")}
                  <span style={{ fg: theme.textMuted }}> view subagents</span>
                </text>
                <text style={{ fg: theme.textMuted }}>(or click to navigate)</text>
              </box>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={props.part.state.status === "error"}>
        <InlineTool icon="✗" pending="Failed" complete={true} part={props.part}>
          <text style={{ fg: theme.error }}>Council failed</text>
        </InlineTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="☍" pending={hint()} complete={props.part.state.status === "completed"} spinner={spin()} part={props.part}>
          {hint()}
        </InlineTool>
      </Match>
    </Switch>
  )
}
