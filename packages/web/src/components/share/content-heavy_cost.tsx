import type { MessageV2 } from "opencode/session/message-v2"
import styles from "./content-heavy_cost.module.css"
import { For } from "solid-js"

interface HeavyCostProps {
  part: MessageV2.HeavyCostPart
}

export function HeavyCost(props: HeavyCostProps) {
  const formatTokens = (tokens: MessageV2.HeavyCostPart["total"]["tokens"]) => {
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    return `${total.toLocaleString()} tokens`
  }

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`
  }

  const rows = [
    {
      label: "Planner",
      cost: props.part.planner.cost,
      tokens: props.part.planner.tokens,
    },
    {
      label: "Executors",
      cost: props.part.executors.cost,
      tokens: props.part.executors.tokens,
    },
    {
      label: "Synthesizer",
      cost: props.part.synthesizer.cost,
      tokens: props.part.synthesizer.tokens,
    },
  ]

  return (
    <div class={styles.root}>
      <div class={styles.title}>Heavy Mode Cost Breakdown</div>
      <div class={styles.table}>
        <div class={styles.header}>
          <div>Component</div>
          <div>Cost</div>
          <div>Tokens</div>
        </div>
        <For each={rows}>
          {(row) => (
            <div class={styles.row}>
              <div>{row.label}</div>
              <div>{formatCost(row.cost)}</div>
              <div>{formatTokens(row.tokens)}</div>
            </div>
          )}
        </For>
        <div class={styles.footer}>
          <div>Total</div>
          <div>{formatCost(props.part.total.cost)}</div>
          <div>{formatTokens(props.part.total.tokens)}</div>
        </div>
      </div>
    </div>
  )
}
