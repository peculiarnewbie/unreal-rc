import type { TransportRequestId } from "../public/types.js";
import type { TransportRequestError } from "../public/errors.js";
import type { HttpVerb } from "../public/types.js";
import type { TransportError } from "./errors.js";

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

// ── Effect-native hook contexts (failures propagate) ──────────────────

export interface EffectRequestHookContext {
  readonly transport: string;
  readonly verb: HttpVerb;
  readonly url: string;
  readonly body?: unknown;
}

export interface EffectResponseHookContext extends EffectRequestHookContext {
  readonly statusCode?: number | undefined;
  readonly requestId?: number | string | undefined;
  readonly durationMs: number;
}

export interface EffectErrorHookContext extends EffectRequestHookContext {
  readonly error: TransportError;
  readonly durationMs: number;
  readonly statusCode?: number | undefined;
  readonly requestId?: number | string | undefined;
}
