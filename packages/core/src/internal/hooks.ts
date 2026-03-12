import { ServiceMap, Effect, Layer } from "effect";
import type { TransportRequestId } from "../public/types.js";
import type { TransportRequestError } from "../public/errors.js";
import type { HttpVerb } from "../public/types.js";

type HookPhase = "request" | "response" | "error";

export interface PayloadRedactionContext {
  phase: HookPhase;
  transport: string;
  verb: HttpVerb;
  url: string;
  attempt: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface RequestHookContext {
  transport: string;
  verb: HttpVerb;
  url: string;
  body?: unknown;
  attempt: number;
}

export interface ResponseHookContext extends RequestHookContext {
  requestBody?: unknown;
  durationMs: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface ErrorHookContext extends RequestHookContext {
  error: TransportRequestError;
  errorBody?: unknown;
  durationMs: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface HooksService {
  readonly onRequest: (context: RequestHookContext) => Effect.Effect<void>;
  readonly onResponse: (context: ResponseHookContext) => Effect.Effect<void>;
  readonly onError: (context: ErrorHookContext) => Effect.Effect<void>;
  readonly redactPayload: (payload: unknown, context: PayloadRedactionContext) => unknown;
}

export class Hooks extends ServiceMap.Service<Hooks, HooksService>()("Hooks") {}

export const HooksLive = (options: {
  onRequest?: ((context: RequestHookContext) => void | Promise<void>) | undefined;
  onResponse?: ((context: ResponseHookContext) => void | Promise<void>) | undefined;
  onError?: ((context: ErrorHookContext) => void | Promise<void>) | undefined;
  redactPayload?: ((payload: unknown, context: PayloadRedactionContext) => unknown) | undefined;
}): Layer.Layer<Hooks> =>
  Layer.succeed(Hooks)({
    onRequest: (context) =>
      options.onRequest
        ? Effect.promise(() => Promise.resolve(options.onRequest!(context))).pipe(Effect.ignore)
        : Effect.void,
    onResponse: (context) =>
      options.onResponse
        ? Effect.promise(() => Promise.resolve(options.onResponse!(context))).pipe(Effect.ignore)
        : Effect.void,
    onError: (context) =>
      options.onError
        ? Effect.promise(() => Promise.resolve(options.onError!(context))).pipe(Effect.ignore)
        : Effect.void,
    redactPayload: options.redactPayload
      ? (payload, context) => {
          try {
            return options.redactPayload!(payload, context);
          } catch {
            return "[redaction_failed]";
          }
        }
      : (payload) => payload
  });

export const HooksNoop: Layer.Layer<Hooks> = Layer.succeed(Hooks)({
  onRequest: () => Effect.void,
  onResponse: () => Effect.void,
  onError: () => Effect.void,
  redactPayload: (payload) => payload
});
