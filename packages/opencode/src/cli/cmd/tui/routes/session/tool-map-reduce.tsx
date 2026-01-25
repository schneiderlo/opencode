import { createMemo, For, Match, Switch, Show } from "solid-js"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { Locale } from "@/util/locale"
import type { MapReduceTool } from "@/tool/map_reduce"
import { type ToolProps, BlockTool, InlineTool } from "./index"

export function MapReduce(props: ToolProps<typeof MapReduceTool>) {
  const { theme } = useTheme()
  const { navigate } = useRoute()
  const keybind = useKeybind()

  const tasks = createMemo(() => {
    const inputTasks = props.input.tasks ?? []
    const metaTasks = props.metadata.tasks ?? []

    return inputTasks.map((task, i) => {
      // Try to find matching metadata by index or fallback to pending
      const meta = metaTasks[i]
      return {
        description: task.description,
        subagent: task.subagent_type,
        status: meta?.status ?? "pending",
        sessionId: meta?.sessionId,
        error: meta?.error,
      }
    })
  })

  const completed = createMemo(() => tasks().filter((t) => t.status === "completed").length)

  const error = createMemo(() => {
    if (props.part.state.status === "error") return props.part.state.error
    return undefined
  })

  return (
    <Switch>
      <Match when={tasks().length > 0}>
        <BlockTool title={`# Map-Reduce: ${completed()}/${tasks().length} tasks completed`} part={props.part}>
          <box flexDirection="column" gap={0}>
            <For each={tasks()}>
              {(task) => {
                const statusColor = () => {
                  if (task.status === "running") return theme.warning
                  if (task.status === "completed") return theme.success
                  if (task.status === "error") return theme.error
                  return theme.textMuted
                }

                const statusIcon = () => {
                  if (task.status === "running") return "↻"
                  if (task.status === "completed") return "✓"
                  if (task.status === "error") return "✗"
                  return "•"
                }

                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    onMouseUp={() => {
                      if (task.sessionId) {
                        navigate({ type: "session", sessionID: task.sessionId })
                      }
                    }}
                  >
                    <text style={{ fg: statusColor() }}>[{statusIcon()}]</text>
                    <text style={{ fg: theme.text }}>{task.description}</text>
                    <text style={{ fg: theme.textMuted }}>({Locale.titlecase(task.subagent)})</text>
                    <Show when={task.error}>
                      <text style={{ fg: theme.error }}>- {task.error}</text>
                    </Show>
                  </box>
                )
              }}
            </For>

            <box marginTop={1} flexDirection="row" gap={1}>
              <text style={{ fg: theme.text }}>
                {keybind.print("session_child_cycle")}
                <span style={{ fg: theme.textMuted }}> view subagents</span>
              </text>
              <text style={{ fg: theme.textMuted }}>(or click to navigate)</text>
            </box>
          </box>
        </BlockTool>
      </Match>
      <Match when={error()}>
        <InlineTool icon="✗" pending="Failed" complete={true} part={props.part}>
          <text style={{ fg: theme.error }}>Map-Reduce Failed: {error()}</text>
        </InlineTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="☍" pending="Distributing tasks..." complete={false} part={props.part}>
          Map-Reduce Task
        </InlineTool>
      </Match>
    </Switch>
  )
}
