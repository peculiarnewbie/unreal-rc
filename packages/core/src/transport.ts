import type { HttpVerb } from "./types.js";

export interface TransportRequestOptions {
  timeoutMs?: number;
}

export interface Transport {
  request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<unknown>;
  dispose(): void;
}

export interface ConnectableTransport extends Transport {
  connect(): Promise<void>;
  readonly connected: boolean;
}

export class TransportRequestError extends Error {
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      details?: unknown;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "TransportRequestError";

    if (options && "statusCode" in options) {
      this.statusCode = options.statusCode;
    }

    if (options && "details" in options) {
      this.details = options.details;
    }
  }
}

export const isConnectableTransport = (transport: Transport): transport is ConnectableTransport => {
  return (
    typeof (transport as ConnectableTransport).connect === "function" &&
    typeof (transport as ConnectableTransport).connected === "boolean"
  );
};
