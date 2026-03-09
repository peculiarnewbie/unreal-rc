import type { HttpVerb } from "../types.js";
import {
  TransportRequestError,
  type TransportResponse,
  type Transport,
  type TransportRequestOptions
} from "../transport.js";

export interface HttpTransportOptions {
  baseUrl?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 30010;
const DEFAULT_TIMEOUT_MS = 15_000;
const TIMEOUT_ABORT_REASON = "timeout";
const DISPOSE_ABORT_REASON = "dispose";

export class HttpTransport implements Transport {
  readonly transport = "http";
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly controllers = new Set<AbortController>();

  constructor(options: HttpTransportOptions = {}) {
    this.baseUrl =
      options.baseUrl?.replace(/\/$/, "") ??
      `${options.secure ? "https" : "http"}://${options.host ?? DEFAULT_HOST}:${options.port ?? DEFAULT_PORT}`;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.headers = { ...(options.headers ?? {}) };
  }

  async request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<TransportResponse> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;

    this.controllers.add(controller);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort(TIMEOUT_ABORT_REASON);
      }, timeoutMs);
    }

    const targetUrl = new URL(url, this.baseUrl).toString();
    const headers: Record<string, string> = {
      ...this.headers
    };

    let requestBody: string | undefined;
    if (body !== undefined) {
      requestBody = JSON.stringify(body);
      if (!headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
    }

    try {
      const requestInit: RequestInit = {
        method: verb,
        headers,
        signal: controller.signal
      };

      if (requestBody !== undefined) {
        requestInit.body = requestBody;
      }

      const response = await fetch(targetUrl, requestInit);
      const payload = await parsePayload(response, {
        verb,
        url
      });

      if (!response.ok) {
        throw new TransportRequestError(`HTTP request failed with status ${response.status}`, {
          kind: "http_status",
          transport: this.transport,
          verb,
          url,
          statusCode: response.status,
          details: payload
        });
      }

      return {
        body: payload,
        statusCode: response.status
      };
    } catch (error) {
      if (error instanceof TransportRequestError) {
        throw error;
      }

      if (controller.signal.aborted) {
        const abortedByTimeout = controller.signal.reason === TIMEOUT_ABORT_REASON;

        throw new TransportRequestError(
          abortedByTimeout
            ? `HTTP request timed out after ${timeoutMs}ms`
            : "HTTP request was aborted",
          {
            cause: error,
            kind: abortedByTimeout ? "timeout" : "disconnect",
            transport: this.transport,
            verb,
            url
          }
        );
      }

      throw new TransportRequestError("HTTP request failed", {
        cause: error,
        kind: "connect",
        transport: this.transport,
        verb,
        url
      });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      this.controllers.delete(controller);
    }
  }

  dispose(): void {
    for (const controller of this.controllers) {
      controller.abort(DISPOSE_ABORT_REASON);
    }
    this.controllers.clear();
  }
}

const parsePayload = async (
  response: Response,
  request: { verb: HttpVerb; url: string }
): Promise<unknown> => {
  const raw = await response.arrayBuffer();
  if (raw.byteLength === 0) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const normalized = contentType.toLowerCase();

  if (normalized.includes("application/json")) {
    const text = new TextDecoder().decode(raw);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new TransportRequestError("Failed to decode HTTP response body", {
        cause: error,
        kind: "decode",
        transport: "http",
        verb: request.verb,
        url: request.url,
        statusCode: response.status
      });
    }
  }

  if (normalized.startsWith("text/") || normalized.includes("xml") || normalized.includes("javascript")) {
    return new TextDecoder().decode(raw);
  }

  return raw;
};
