import { ServiceMap, type Effect } from "effect";
import type { TransportError } from "./errors.js";

export interface TransportRequest {
  readonly verb: string;
  readonly url: string;
  readonly body?: unknown;
  readonly timeoutMs?: number | undefined;
}

export interface TransportResponse {
  readonly body: unknown;
  readonly statusCode?: number | undefined;
  readonly requestId?: number | string | undefined;
}

export interface PendingRequestInfo {
  readonly requestId: number | string | undefined;
  readonly verb: string;
  readonly url: string;
  readonly elapsedMs: number;
  readonly timeoutMs: number | undefined;
}

export class Transport extends ServiceMap.Service<
  Transport,
  {
    readonly name: string;
    readonly request: (req: TransportRequest) => Effect.Effect<TransportResponse, TransportError>;
    readonly dispose: Effect.Effect<void>;
    readonly pendingRequests: Effect.Effect<ReadonlyArray<PendingRequestInfo>>;
  }
>()("Transport") {}
