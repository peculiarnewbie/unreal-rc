import type { HttpVerb } from "./types.js";

export type TransportRequestId = number | string;
export type TransportRequestErrorKind =
  | "timeout"
  | "connect"
  | "disconnect"
  | "http_status"
  | "remote_status"
  | "decode"
  | "unknown";

export interface TransportRequestOptions {
  timeoutMs?: number | undefined;
}

export interface TransportResponse {
  body: unknown;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface Transport {
  readonly transport?: string;
  request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<TransportResponse>;
  dispose(): void;
}

export interface ConnectableTransport extends Transport {
  connect(): Promise<void>;
  readonly connected: boolean;
}

export class TransportRequestError extends Error {
  readonly kind: TransportRequestErrorKind;
  readonly statusCode: number | undefined;
  readonly details?: unknown;
  readonly verb: HttpVerb | undefined;
  readonly url: string | undefined;
  readonly transport: string | undefined;
  readonly requestId: TransportRequestId | undefined;

  constructor(
    message: string,
    options?: {
      kind?: TransportRequestErrorKind | undefined;
      statusCode?: number | undefined;
      details?: unknown;
      verb?: HttpVerb | undefined;
      url?: string | undefined;
      transport?: string | undefined;
      requestId?: TransportRequestId | undefined;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "TransportRequestError";
    this.kind = options?.kind ?? "unknown";

    if (options && "statusCode" in options) {
      this.statusCode = options.statusCode;
    }

    if (options && "details" in options) {
      this.details = options.details;
    }

    if (options && "verb" in options) {
      this.verb = options.verb;
    }

    if (options && "url" in options) {
      this.url = options.url;
    }

    if (options && "transport" in options) {
      this.transport = options.transport;
    }

    if (options && "requestId" in options) {
      this.requestId = options.requestId;
    }
  }
}

export const toTransportRequestError = (
  error: unknown,
  fallback: {
    message?: string | undefined;
    kind?: TransportRequestErrorKind | undefined;
    statusCode?: number | undefined;
    details?: unknown;
    verb?: HttpVerb | undefined;
    url?: string | undefined;
    transport?: string | undefined;
    requestId?: TransportRequestId | undefined;
  } = {}
): TransportRequestError => {
  if (error instanceof TransportRequestError) {
    return new TransportRequestError(error.message, {
      cause: (error as Error & { cause?: unknown }).cause,
      kind: error.kind ?? fallback.kind,
      statusCode: error.statusCode ?? fallback.statusCode,
      details: error.details ?? fallback.details,
      verb: error.verb ?? fallback.verb,
      url: error.url ?? fallback.url,
      transport: error.transport ?? fallback.transport,
      requestId: error.requestId ?? fallback.requestId
    });
  }

  return new TransportRequestError(
    fallback.message ?? (error instanceof Error ? error.message : "Transport request failed"),
    {
      cause: error,
      kind: fallback.kind,
      statusCode: fallback.statusCode,
      details: fallback.details,
      verb: fallback.verb,
      url: fallback.url,
      transport: fallback.transport,
      requestId: fallback.requestId
    }
  );
};

export const isConnectableTransport = (transport: Transport): transport is ConnectableTransport => {
  return (
    typeof (transport as ConnectableTransport).connect === "function" &&
    typeof (transport as ConnectableTransport).connected === "boolean"
  );
};
