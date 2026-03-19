import { createEffect, createMemo, For, Match, Show, Switch } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import type { HeavyRunTool } from "@/tool/heavy_run"
import { type ToolProps, BlockTool, InlineTool } from "./index"

export function HeavyRun(props: ToolProps<typeof HeavyRunTool>) {
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
    const value = Array.isArray(props.metadata.tasks) ? props.metadata.tasks : []
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const title = typeof item.title === "string" ? item.title : ""
      if (!title) return []
      return [
        {
          title,
          mode: item.mode === "heavy" ? "heavy" : "direct",
          agent: item.agent === "explore" ? "explore" : "general",
          status:
            item.status === "running" || item.status === "completed" || item.status === "error" ? item.status : "pending",
          sessionID: typeof item.sessionID === "string" ? item.sessionID : "",
          preview: typeof item.preview === "string" ? item.preview : "",
          reportPath: typeof item.reportPath === "string" ? item.reportPath : "",
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

  const done = createMemo(() => rows().filter((item) => item.status === "completed").length)
  const spin = createMemo(() => props.part.state.status === "pending" || props.part.state.status === "running")
  const hint = createMemo(() => {
    if (stage() === "planning") return "Planning heavy analysis..."
    if (stage() === "executing") return "Executing tasks..."
    if (stage() === "synthesizing") return "Synthesizing answer..."
    if (stage() === "completed") return "Heavy analysis complete"
    return "Heavy analysis"
  })

  return (
    <Switch>
      <Match when={rows().length > 0}>
        <BlockTool
          title={`# Heavy: ${done()}/${rows().length} tasks completed`}
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
                      <text style={{ fg: theme.text }}>{item.title}</text>
                      <text style={{ fg: theme.textMuted }}>
                        ({item.agent}, {item.mode})
                      </text>
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
                    <Show when={item.reportPath}>
                      <text paddingLeft={6} style={{ fg: theme.textMuted }}>
                        Nested report: {item.reportPath}
                      </text>
                    </Show>
                  </box>
                )
              }}
            </For>

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
          <text style={{ fg: theme.error }}>Heavy failed</text>
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
