import { Effect, Schema } from "effect"
import type { JSONSchema7 } from "@ai-sdk/provider"
import type { MessageV2 } from "../session/message-v2"
import type { Permission } from "../permission"
import type { SessionID, MessageID } from "../session/schema"
import * as Truncate from "./truncate"
import { Agent } from "@/agent/agent"
import z from "zod"

interface Metadata {
  [key: string]: any
}

type Params = Schema.Decoder<unknown> | z.ZodType
type Input<T> = T extends z.ZodType ? z.infer<T> : T extends Schema.Decoder<unknown> ? Schema.Schema.Type<T> : never

// TODO: remove this hack
export type DynamicDescription = (agent: Agent.Info) => Effect.Effect<string>

export type Context<M extends Metadata = Metadata> = {
  sessionID: SessionID
  messageID: MessageID
  agent: string
  abort: AbortSignal
  callID?: string
  extra?: { [key: string]: unknown }
  messages: MessageV2.WithParts[]
  metadata(input: { title?: string; metadata?: M }): Effect.Effect<void>
  ask(input: Omit<Permission.Request, "id" | "sessionID" | "tool">): Effect.Effect<void>
}

export interface ExecuteResult<M extends Metadata = Metadata> {
  title: string
  metadata: M
  output: string
  attachments?: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[]
}

export interface Def<
  Parameters extends Params = Params,
  M extends Metadata = Metadata,
> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  execute(args: Input<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
export type DefWithoutID<
  Parameters extends Params = Params,
  M extends Metadata = Metadata,
> = Omit<Def<Parameters, M>, "id">

export interface Info<
  Parameters extends Params = Params,
  M extends Metadata = Metadata,
> {
  id: string
  init: () => Effect.Effect<DefWithoutID<Parameters, M>>
}

type Init<Parameters extends Params, M extends Metadata> =
  | DefWithoutID<Parameters, M>
  | (() => Effect.Effect<DefWithoutID<Parameters, M>>)

export type InferParameters<T> =
  T extends Info<infer P, any>
    ? Input<P>
    : T extends Effect.Effect<Info<infer P, any>, any, any>
      ? Input<P>
      : never
export type InferMetadata<T> =
  T extends Info<any, infer M> ? M : T extends Effect.Effect<Info<any, infer M>, any, any> ? M : never

export type InferDef<T> =
  T extends Info<infer P, infer M>
    ? Def<P, M>
    : T extends Effect.Effect<Info<infer P, infer M>, any, any>
      ? Def<P, M>
      : never

function isZod(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value
}

function decode<Parameters extends Params>(
  id: string,
  parameters: Parameters,
  format: ((error: unknown) => string) | undefined,
) {
  if (isZod(parameters)) {
    return (args: unknown) =>
      Effect.try({
        try: () => parameters.parse(args) as Input<Parameters>,
        catch: (error) =>
          new Error(
            format
              ? format(error)
              : `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
            { cause: error },
          ),
      })
  }

  const parse = Schema.decodeUnknownEffect(parameters)
  return (args: unknown) =>
    parse(args).pipe(
      Effect.map((value) => value as Input<Parameters>),
      Effect.mapError((error) =>
        format
          ? new Error(format(error), { cause: error })
          : new Error(
              `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
              { cause: error },
            ),
      ),
    )
}

function wrap<Parameters extends Params, Result extends Metadata>(
  id: string,
  init: Init<Parameters, Result>,
  truncate: Truncate.Interface,
  agents: Agent.Interface,
) {
  return () =>
    Effect.gen(function* () {
      const toolInfo = typeof init === "function" ? { ...(yield* init()) } : { ...init }
      // Compile the parser closure once per tool init; `decodeUnknownEffect`
      // allocates a new closure per call, so hoisting avoids re-closing it for
      // every LLM tool invocation.
      const parser = decode(id, toolInfo.parameters, toolInfo.formatValidationError)
      const execute = toolInfo.execute
      toolInfo.execute = (args, ctx) => {
        const attrs = {
          "tool.name": id,
          "session.id": ctx.sessionID,
          "message.id": ctx.messageID,
          ...(ctx.callID ? { "tool.call_id": ctx.callID } : {}),
        }
        return Effect.gen(function* () {
          const decoded = yield* parser(args)
          const result = yield* execute(decoded, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const agent = yield* agents.get(ctx.agent)
          const truncated = yield* truncate.output(result.output, {}, agent)
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs })) as unknown as Effect.Effect<
          ExecuteResult<Result>
        >
      }
      return toolInfo
    })
}

export function define<
  Parameters extends Params,
  Result extends Metadata,
  R,
  ID extends string = string,
>(
  id: ID,
  init: Effect.Effect<Init<Parameters, Result>, never, R>,
): Effect.Effect<Info<Parameters, Result>, never, R | Truncate.Service | Agent.Service> & { id: ID } {
  return Object.assign(
    Effect.gen(function* () {
      const resolved = yield* init
      const truncate = yield* Truncate.Service
      const agents = yield* Agent.Service
      return { id, init: wrap(id, resolved, truncate, agents) }
    }),
    { id },
  )
}

export function init<P extends Params, M extends Metadata>(
  info: Info<P, M>,
): Effect.Effect<Def<P, M>> {
  return Effect.gen(function* () {
    const init = yield* info.init()
    return {
      ...init,
      id: info.id,
    }
  })
}

export * as Tool from "./tool"
