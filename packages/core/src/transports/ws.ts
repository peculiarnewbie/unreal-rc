import type {
  ConnectableTransport,
  TransportResponse,
  TransportRequestErrorKind,
  TransportRequestOptions
} from "../transport.js";
import { TransportRequestError } from "../transport.js";
import type { HttpVerb } from "../types.js";

export interface WebSocketTransportOptions {
  baseUrl?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  pingIntervalMs?: number;
  autoReconnect?: boolean;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  reconnectBackoffFactor?: number;
  disconnectedBehavior?: "queue" | "reject";
  maxQueueSize?: number;
}

type OutboundRequest = {
  requestId: number;
  correlationId: string;
  verb: HttpVerb;
  url: string;
  body: unknown;
  timeoutMs: number;
  resolve: (value: TransportResponse) => void;
  reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 30020;
const DEFAULT_CONNECT_TIMEOUT_MS = 7_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PING_INTERVAL_MS = 25_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_QUEUE_SIZE = 500;

export class WebSocketTransport implements ConnectableTransport {
  readonly transport = "ws";
  private readonly url: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly pingIntervalMs: number;
  private readonly autoReconnect: boolean;
  private readonly reconnectInitialDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly reconnectBackoffFactor: number;
  private readonly disconnectedBehavior: "queue" | "reject";
  private readonly maxQueueSize: number;

  private socket: WebSocket | undefined;
  private connectPromise: Promise<void> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectAttempt = 0;
  private nextRequestId = 1;
  private disposed = false;
  private connectedState = false;

  private readonly pendingRequests = new Map<number, OutboundRequest>();
  private readonly queuedRequests: OutboundRequest[] = [];

  constructor(options: WebSocketTransportOptions = {}) {
    this.url =
      options.baseUrl ??
      `${options.secure ? "wss" : "ws"}://${options.host ?? DEFAULT_HOST}:${options.port ?? DEFAULT_PORT}`;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.autoReconnect = options.autoReconnect ?? true;
    this.reconnectInitialDelayMs =
      options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
    this.reconnectBackoffFactor =
      options.reconnectBackoffFactor ?? DEFAULT_RECONNECT_BACKOFF_FACTOR;
    this.disconnectedBehavior = options.disconnectedBehavior ?? "queue";
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  }

  get connected(): boolean {
    return this.connectedState;
  }

  async connect(): Promise<void> {
    if (this.disposed) {
      throw new TransportRequestError("Cannot connect a disposed transport", {
        kind: "disconnect",
        transport: this.transport
      });
    }
    if (this.connectedState) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      let settled = false;

      const finalize = (fn: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("close", onCloseBeforeOpen);
        socket.removeEventListener("error", onErrorBeforeOpen);
        fn();
      };

      const timeout = setTimeout(() => {
        finalize(() => {
          socket.close();
          this.scheduleReconnect();
          reject(
            new TransportRequestError(`WebSocket connect timed out after ${this.connectTimeoutMs}ms`, {
              kind: "timeout",
              transport: this.transport
            })
          );
        });
      }, this.connectTimeoutMs);

      const onOpen = (): void => {
        finalize(() => {
          this.attachSocket(socket);
          this.connectedState = true;
          this.reconnectAttempt = 0;
          this.startPing();
          this.flushQueuedRequests();
          resolve();
        });
      };

      const onCloseBeforeOpen = (): void => {
        finalize(() => {
          this.scheduleReconnect();
          reject(
            new TransportRequestError("WebSocket closed during connect", {
              kind: "connect",
              transport: this.transport
            })
          );
        });
      };

      const onErrorBeforeOpen = (): void => {
        finalize(() => {
          socket.close();
          this.scheduleReconnect();
          reject(
            new TransportRequestError("WebSocket error during connect", {
              kind: "connect",
              transport: this.transport
            })
          );
        });
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("close", onCloseBeforeOpen, { once: true });
      socket.addEventListener("error", onErrorBeforeOpen, { once: true });
    }).finally(() => {
      this.connectPromise = undefined;
    });

    return this.connectPromise;
  }

  request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<TransportResponse> {
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const requestId = this.nextRequestId++;
    const correlationId = String(requestId);

    return new Promise<TransportResponse>((resolve, reject) => {
      const outbound: OutboundRequest = {
        requestId,
        correlationId,
        verb,
        url,
        body,
        timeoutMs,
        resolve,
        reject
      };

      if (this.connectedState && this.socket?.readyState === WebSocket.OPEN) {
        this.sendRequest(outbound);
        return;
      }

      if (this.disconnectedBehavior === "reject") {
        reject(this.createRequestError("WebSocket is disconnected", outbound, "disconnect"));
        return;
      }

      if (this.queuedRequests.length >= this.maxQueueSize) {
        reject(this.createRequestError(
          `WebSocket queue limit reached (${this.maxQueueSize}); request rejected`,
          outbound,
          "disconnect"
        ));
        return;
      }

      this.queuedRequests.push(outbound);

      void this.connect().catch(() => {
        if (!this.autoReconnect) {
          this.rejectQueuedRequests("WebSocket is disconnected and auto-reconnect is disabled");
        }
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.connectedState = false;
    this.stopPing();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.rejectPendingRequests("Transport disposed");
    this.rejectQueuedRequests("Transport disposed");

    if (this.socket) {
      this.detachSocket(this.socket);
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, "Client disposed");
      }
      this.socket = undefined;
    }
  }

  private attachSocket(socket: WebSocket): void {
    if (this.socket && this.socket !== socket) {
      this.detachSocket(this.socket);
    }
    this.socket = socket;
    socket.addEventListener("message", this.onMessage);
    socket.addEventListener("close", this.onClose);
    socket.addEventListener("error", this.onError);
  }

  private detachSocket(socket: WebSocket): void {
    socket.removeEventListener("message", this.onMessage);
    socket.removeEventListener("close", this.onClose);
    socket.removeEventListener("error", this.onError);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    const raw =
      typeof event.data === "string"
        ? event.data
        : typeof Buffer !== "undefined" && Buffer.isBuffer(event.data)
          ? (event.data as Buffer).toString("utf8")
          : event.data instanceof ArrayBuffer
            ? new TextDecoder().decode(event.data)
            : undefined;

    if (!raw) {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const requestIdValue = payload.RequestId;
    const requestId = typeof requestIdValue === "number" ? requestIdValue : Number(requestIdValue);
    const idValue = payload.Id;
    const correlationId =
      typeof idValue === "string" || typeof idValue === "number" ? String(idValue) : undefined;

    const pending = this.resolvePendingRequest(requestId, correlationId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(pending.requestId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    const responseCodeValue = payload.ResponseCode;
    const responseCode =
      typeof responseCodeValue === "number" ? responseCodeValue : Number(responseCodeValue);

    if (Number.isFinite(responseCode) && responseCode >= 200 && responseCode < 300) {
      pending.resolve({
        body: payload.ResponseBody ?? undefined,
        statusCode: responseCode,
        requestId: pending.requestId
      });
      return;
    }

    const errorOptions = Number.isFinite(responseCode)
      ? {
          kind: "remote_status" as const,
          statusCode: responseCode,
          details: payload.ResponseBody
        }
      : {
          kind: "unknown" as const,
          details: payload.ResponseBody
        };

    pending.reject(
      new TransportRequestError(
        Number.isFinite(responseCode)
          ? `Remote request failed with status ${responseCode}`
          : "Remote request failed",
        {
          ...errorOptions,
          transport: this.transport,
          verb: pending.verb,
          url: pending.url,
          requestId: pending.requestId
        }
      )
    );
  };

  private resolvePendingRequest(
    requestId: number,
    correlationId: string | undefined
  ): OutboundRequest | undefined {
    if (correlationId) {
      for (const pending of this.pendingRequests.values()) {
        if (pending.correlationId === correlationId) {
          return pending;
        }
      }
    }

    if (Number.isFinite(requestId) && requestId >= 0) {
      return this.pendingRequests.get(requestId);
    }

    if (this.pendingRequests.size === 1) {
      return this.pendingRequests.values().next().value;
    }

    return undefined;
  }

  private readonly onClose = (): void => {
    this.connectedState = false;
    this.stopPing();

    if (this.socket) {
      this.detachSocket(this.socket);
      this.socket = undefined;
    }

    this.rejectPendingRequests("WebSocket disconnected before responses were received");

    if (!this.disposed) {
      this.scheduleReconnect();
    }
  };

  private readonly onError = (): void => {
    // Intentionally empty: close handling covers reconnect + failures.
  };

  private sendRequest(request: OutboundRequest): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      request.reject(this.createRequestError("WebSocket is not connected", request, "disconnect"));
      return;
    }

    const envelope: {
      MessageName: "http";
      Parameters: {
        RequestId: number;
        Url: string;
        Verb: HttpVerb;
        Body?: unknown;
      };
    } = {
      MessageName: "http",
      Parameters: {
        RequestId: request.requestId,
        Url: request.url,
        Verb: request.verb
      }
    };

    if (request.body !== undefined) {
      envelope.Parameters.Body = request.body;
    }

    try {
      this.socket.send(JSON.stringify(envelope));
    } catch (error) {
      request.reject(
        new TransportRequestError("Failed to send WebSocket request", {
          cause: error,
          kind: "unknown",
          transport: this.transport,
          verb: request.verb,
          url: request.url,
          requestId: request.requestId
        })
      );
      return;
    }

    request.timer = setTimeout(() => {
      this.pendingRequests.delete(request.requestId);
      request.reject(this.createRequestError(
        `WebSocket request timed out after ${request.timeoutMs}ms`,
        request,
        "timeout"
      ));
    }, request.timeoutMs);

    this.pendingRequests.set(request.requestId, request);
  }

  private flushQueuedRequests(): void {
    while (this.queuedRequests.length > 0) {
      const next = this.queuedRequests.shift();
      if (!next) {
        break;
      }
      if (!this.connectedState || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
        this.queuedRequests.unshift(next);
        break;
      }
      this.sendRequest(next);
    }
  }

  private startPing(): void {
    this.stopPing();
    if (this.pingIntervalMs <= 0) {
      return;
    }

    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        this.socket.send(JSON.stringify({ type: "ping" }));
      } catch {
        // Ignore ping failures; close/error handlers will recover.
      }
    }, this.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (!this.autoReconnect || this.disposed || this.reconnectTimer) {
      return;
    }

    const delay = Math.min(
      this.reconnectInitialDelayMs * this.reconnectBackoffFactor ** this.reconnectAttempt,
      this.reconnectMaxDelayMs
    );
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private rejectPendingRequests(message: string): void {
    for (const request of this.pendingRequests.values()) {
      if (request.timer) {
        clearTimeout(request.timer);
      }
      request.reject(this.createRequestError(message, request, "disconnect"));
    }
    this.pendingRequests.clear();
  }

  private rejectQueuedRequests(message: string): void {
    while (this.queuedRequests.length > 0) {
      const request = this.queuedRequests.shift();
      if (request) {
        request.reject(this.createRequestError(message, request, "disconnect"));
      }
    }
  }

  private createRequestError(
    message: string,
    request: Pick<OutboundRequest, "requestId" | "verb" | "url">,
    kind: TransportRequestErrorKind,
    details?: unknown
  ): TransportRequestError {
    return new TransportRequestError(message, {
      kind,
      details,
      transport: this.transport,
      verb: request.verb,
      url: request.url,
      requestId: request.requestId
    });
  }
}
