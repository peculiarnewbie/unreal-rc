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
