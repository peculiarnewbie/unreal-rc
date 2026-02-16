import type { HttpVerb } from "../types.js";
import {
  TransportRequestError,
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

export class HttpTransport implements Transport {
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
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;

    this.controllers.add(controller);

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        controller.abort();
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
      const payload = await parsePayload(response);

      if (!response.ok) {
        throw new TransportRequestError(`HTTP request failed with status ${response.status}`, {
          statusCode: response.status,
          details: payload
        });
      }

      return payload;
    } catch (error) {
      if (error instanceof TransportRequestError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new TransportRequestError(`HTTP request timed out after ${timeoutMs}ms`, {
          cause: error
        });
      }
      throw new TransportRequestError("HTTP request failed", { cause: error });
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      this.controllers.delete(controller);
    }
  }

  dispose(): void {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}

const parsePayload = async (response: Response): Promise<unknown> => {
  const raw = await response.arrayBuffer();
  if (raw.byteLength === 0) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const normalized = contentType.toLowerCase();

  if (normalized.includes("application/json")) {
    const text = new TextDecoder().decode(raw);
    return JSON.parse(text);
  }

  if (normalized.startsWith("text/") || normalized.includes("xml") || normalized.includes("javascript")) {
    return new TextDecoder().decode(raw);
  }

  return raw;
};
