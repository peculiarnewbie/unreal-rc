import { Effect, Layer } from "effect";
import {
  ConnectError,
  DecodeError,
  HttpStatusError,
  TimeoutError,
  type TransportError
} from "./errors.js";
import { Transport, type PendingRequestInfo, type TransportRequest, type TransportResponse } from "./transport.js";

export interface HttpTransportOptions {
  baseUrl?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  passphrase?: string;
  headers?: Record<string, string>;
  requestTimeoutMs?: number;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 30010;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_HTTP_PASSPHRASE = "smh ue, this is stupid";
const TIMEOUT_ABORT_REASON = "timeout";

export const HttpTransportLive = (options: HttpTransportOptions = {}): Layer.Layer<Transport> => {
  const baseUrl =
    options.baseUrl?.replace(/\/$/, "") ??
    `${options.secure ? "https" : "http"}://${options.host ?? DEFAULT_HOST}:${options.port ?? DEFAULT_PORT}`;
  const defaultTimeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { ...(options.headers ?? {}) };
  const passphrase = options.passphrase ?? DEFAULT_HTTP_PASSPHRASE;
  if (!hasHeaderIgnoreCase(headers, "Passphrase")) {
    headers.Passphrase = passphrase;
  }
  interface ActiveHttpRequest {
    readonly controller: AbortController;
    readonly verb: string;
    readonly url: string;
    readonly startedAt: number;
    readonly timeoutMs: number;
  }

  let nextRequestId = 1;
  const activeRequests = new Map<number, ActiveHttpRequest>();

  return Layer.succeed(Transport)({
    name: "http",

    request: (req: TransportRequest): Effect.Effect<TransportResponse, TransportError> =>
      Effect.callback<TransportResponse, TransportError>((resume) => {
        const controller = new AbortController();
        const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const requestId = nextRequestId++;

        activeRequests.set(requestId, {
          controller,
          verb: req.verb,
          url: req.url,
          startedAt: Date.now(),
          timeoutMs
        });

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            controller.abort(TIMEOUT_ABORT_REASON);
          }, timeoutMs);
        }

        const targetUrl = new URL(req.url, baseUrl).toString();
        const reqHeaders: Record<string, string> = { ...headers };

        let requestBody: string | undefined;
        if (req.body !== undefined) {
          requestBody = JSON.stringify(req.body);
          if (!reqHeaders["content-type"]) {
            reqHeaders["content-type"] = "application/json";
          }
        }

        const requestInit: RequestInit = {
          method: req.verb,
          headers: reqHeaders,
          signal: controller.signal
        };

        if (requestBody !== undefined) {
          requestInit.body = requestBody;
        }

        const run = async (): Promise<TransportResponse> => {
          try {
            const response = await fetch(targetUrl, requestInit);
            const payload = await parsePayload(response, req);

            if (!response.ok) {
              throw new HttpStatusError({
                message: `HTTP request failed with status ${response.status}`,
                statusCode: response.status,
                transport: "http",
                verb: req.verb,
                url: req.url,
                details: payload
              });
            }

            return { body: payload, statusCode: response.status };
          } catch (error) {
            if (error instanceof HttpStatusError || error instanceof DecodeError) {
              throw error;
            }

            if (controller.signal.aborted) {
              const abortedByTimeout = controller.signal.reason === TIMEOUT_ABORT_REASON;
              if (abortedByTimeout) {
                throw new TimeoutError({
                  message: `HTTP request timed out after ${timeoutMs}ms`,
                  transport: "http",
                  verb: req.verb,
                  url: req.url
                });
              }
            }

            throw new ConnectError({
              message: "HTTP request failed",
              transport: "http",
              cause: error
            });
          } finally {
            if (timer) clearTimeout(timer);
            activeRequests.delete(requestId);
          }
        };

        run().then(
          (response) => resume(Effect.succeed(response)),
          (error) => resume(Effect.fail(error as TransportError))
        );
      }),

    pendingRequests: Effect.sync((): ReadonlyArray<PendingRequestInfo> => {
      const now = Date.now();
      return [...activeRequests.values()].map((e): PendingRequestInfo => ({
        requestId: undefined,
        verb: e.verb,
        url: e.url,
        elapsedMs: now - e.startedAt,
        timeoutMs: e.timeoutMs
      }));
    }),

    dispose: Effect.sync(() => {
      for (const { controller } of activeRequests.values()) {
        controller.abort("dispose");
      }
      activeRequests.clear();
    })
  });
};

const hasHeaderIgnoreCase = (headers: Record<string, string>, name: string): boolean => {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
};

const parsePayload = async (
  response: Response,
  req: TransportRequest
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
      throw new DecodeError({
        message: "Failed to decode HTTP response body",
        transport: "http",
        verb: req.verb,
        url: req.url,
        details: text,
        cause: error
      });
    }
  }

  if (normalized.startsWith("text/") || normalized.includes("xml") || normalized.includes("javascript")) {
    return new TextDecoder().decode(raw);
  }

  return raw;
};
