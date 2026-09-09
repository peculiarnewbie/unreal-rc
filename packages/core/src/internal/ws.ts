import { Deferred, Effect, Fiber, Layer, Queue, Ref, Schedule, Schema } from "effect";
import {
  ConnectError,
  DecodeError,
  DisconnectError,
  RemoteStatusError,
  TimeoutError,
  type TransportError,
} from "./errors.js";
import {
  Transport,
  type PendingRequestInfo,
  type TransportRequest,
  type TransportResponse,
} from "./transport.js";
import { heartbeat } from "./heartbeat.js";
import { PendingRequests, PendingRequestsLive } from "./correlation.js";
import { WebSocketTransportOptionsSchema } from "./config-schemas.js";

export interface DisconnectInfo {
  readonly code: number | undefined;
  readonly reason: string | undefined;
  readonly wasClean: boolean | undefined;
}

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
  onDisconnect?: ((info: DisconnectInfo) => void) | undefined;
  onReconnect?: (() => void) | undefined;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 30020;
const DEFAULT_CONNECT_TIMEOUT_MS = 7_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PING_INTERVAL_MS = 25_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const decodeEnvelope = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));

interface Envelope {
  MessageName: "http";
  Parameters: {
    RequestId: number;
    Url: string;
    Verb: string;
    Body?: unknown;
  };
}

interface QueuedRequest {
  readonly requestId: number;
  readonly envelope: Envelope;
  readonly deferred: Deferred.Deferred<TransportResponse, TransportError>;
  readonly verb: string;
  readonly url: string;
  readonly timeoutMs: number;
  readonly expiresAt?: number | undefined;
}

export const WebSocketTransportLive = (
  options: WebSocketTransportOptions = {},
): Layer.Layer<Transport> => {
  Schema.decodeUnknownSync(WebSocketTransportOptionsSchema)(options, {
    onExcessProperty: "ignore",
  });
  const url =
    options.baseUrl ??
    `${options.secure ? "wss" : "ws"}://${options.host ?? DEFAULT_HOST}:${options.port ?? DEFAULT_PORT}`;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const defaultRequestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const autoReconnect = options.autoReconnect ?? true;
  const reconnectInitialDelayMs =
    options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  const reconnectBackoffFactor = options.reconnectBackoffFactor ?? DEFAULT_RECONNECT_BACKOFF_FACTOR;
  const disconnectedBehavior = options.disconnectedBehavior ?? "queue";
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const onDisconnect = options.onDisconnect;
  const onReconnect = options.onReconnect;
  const createTimeoutError = (
    item: Pick<QueuedRequest, "timeoutMs" | "verb" | "url" | "requestId">,
  ) =>
    new TimeoutError({
      message: `WebSocket request timed out after ${item.timeoutMs}ms`,
      transport: "ws",
      verb: item.verb,
      url: item.url,
      requestId: item.requestId,
    });

  return Layer.provide(
    Layer.effect(Transport)(
      Effect.gen(function* () {
        const pending = yield* PendingRequests;
        const outboundQueue = yield* Queue.dropping<QueuedRequest>(maxQueueSize);
        const offerRequest = (item: QueuedRequest) =>
          Effect.sync(() => {
            if (Queue.isFullUnsafe(outboundQueue)) {
              // Reclaim expired/cancelled slots atomically without disturbing FIFO order.
              const retained: QueuedRequest[] = [];
              let entry = Queue.takeUnsafe(outboundQueue);
              while (entry !== undefined) {
                if (entry._tag === "Success" && !Deferred.isDoneUnsafe(entry.value.deferred)) {
                  retained.push(entry.value);
                }
                entry = Queue.takeUnsafe(outboundQueue);
              }
              Queue.offerAllUnsafe(outboundQueue, retained);
            }
            return Queue.offerUnsafe(outboundQueue, item);
          });
        const socketRef = yield* Ref.make<WebSocket | undefined>(undefined);
        const connectedRef = yield* Ref.make(false);
        const disposedRef = yield* Ref.make(false);
        const connectionFiber = yield* Ref.make<Fiber.Fiber<void, TransportError> | undefined>(
          undefined,
        );
        const hasConnectedBefore = yield* Ref.make(false);

        // ── Connect once ──────────────────────────────────────────────

        const connectOnce: Effect.Effect<WebSocket, TransportError> = Effect.callback<
          WebSocket,
          TransportError
        >((resume) => {
          let socket: WebSocket;
          try {
            socket = new WebSocket(url);
            socket.binaryType = "arraybuffer";
          } catch (cause) {
            resume(
              Effect.fail(
                new ConnectError({
                  message: "Failed to create WebSocket connection",
                  transport: "ws",
                  cause,
                }),
              ),
            );
            return;
          }
          let settled = false;

          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            socket.close();
            resume(
              Effect.fail(
                new TimeoutError({
                  message: `WebSocket connect timed out after ${connectTimeoutMs}ms`,
                  transport: "ws",
                }),
              ),
            );
          }, connectTimeoutMs);

          const onOpen = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resume(Effect.succeed(socket));
          };

          const onFailure = (cause: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            socket.close();
            resume(
              Effect.fail(
                new ConnectError({
                  message: "WebSocket connection failed",
                  transport: "ws",
                  cause,
                }),
              ),
            );
          };

          const cleanup = () => {
            clearTimeout(timeout);
            socket.removeEventListener("open", onOpen);
            socket.removeEventListener("close", onFailure);
            socket.removeEventListener("error", onFailure);
          };

          socket.addEventListener("open", onOpen, { once: true });
          socket.addEventListener("close", onFailure, { once: true });
          socket.addEventListener("error", onFailure, { once: true });

          return Effect.sync(() => {
            settled = true;
            cleanup();
            socket.close();
          });
        });

        // ── Decode incoming message ────────────────────────────────────

        const decodeMessage = (event: MessageEvent): string | undefined => {
          if (typeof event.data === "string") return event.data;
          if (typeof Buffer !== "undefined" && Buffer.isBuffer(event.data)) {
            return (event.data as Buffer).toString("utf8");
          }
          if (event.data instanceof ArrayBuffer) {
            return new TextDecoder().decode(event.data);
          }
          return undefined;
        };

        // ── Message handler ────────────────────────────────────────────

        const handleMessage = (raw: string): Effect.Effect<void> =>
          Effect.gen(function* () {
            const payload = yield* Effect.sync(() => {
              try {
                const value: unknown = JSON.parse(raw);
                return decodeEnvelope(value);
              } catch {
                return undefined;
              }
            });
            if (payload === undefined || payload._tag === "None") return;

            const requestIdValue = payload.value.RequestId;
            if (typeof requestIdValue !== "number" && typeof requestIdValue !== "string") return;
            const requestId =
              typeof requestIdValue === "number" ? requestIdValue : Number(requestIdValue);

            if (!Number.isSafeInteger(requestId) || requestId < 0) return;

            const responseCodeValue = payload.value.ResponseCode;
            const responseCode =
              typeof responseCodeValue === "number"
                ? responseCodeValue
                : typeof responseCodeValue === "string"
                  ? Number(responseCodeValue)
                  : NaN;

            if (Number.isInteger(responseCode) && responseCode >= 200 && responseCode < 300) {
              yield* pending.resolve(requestId, {
                body: payload.value.ResponseBody,
                statusCode: responseCode,
                requestId,
              });
            } else {
              const entry = yield* pending.get(requestId);
              const error = Number.isInteger(responseCode)
                ? new RemoteStatusError({
                    message: `Remote request failed with status ${responseCode}`,
                    statusCode: responseCode,
                    transport: "ws",
                    verb: entry?.verb,
                    url: entry?.url,
                    requestId,
                    details: payload.value.ResponseBody,
                  })
                : new DecodeError({
                    message: "Invalid WebSocket response status",
                    transport: "ws",
                    verb: entry?.verb,
                    url: entry?.url,
                    requestId,
                    details: payload.value,
                  });
              yield* pending.reject(requestId, error);
            }
          });

        // ── Message listener fiber ─────────────────────────────────────

        const messageLoop = (
          socket: WebSocket,
          closeInfo: {
            code: number | undefined;
            reason: string | undefined;
            wasClean: boolean | undefined;
          },
        ): Effect.Effect<void, TransportError> =>
          Effect.gen(function* () {
            const services = yield* Effect.context();
            yield* Effect.callback<void, TransportError>((resume) => {
              const onMessage = (event: MessageEvent) => {
                const raw = decodeMessage(event);
                if (raw) {
                  Effect.runForkWith(services)(handleMessage(raw));
                }
              };

              const onClose = (event: unknown) => {
                socket.removeEventListener("message", onMessage);
                if (event && typeof event === "object") {
                  const ce = event as { code?: unknown; reason?: unknown; wasClean?: unknown };
                  closeInfo.code = typeof ce.code === "number" ? ce.code : undefined;
                  closeInfo.reason = typeof ce.reason === "string" ? ce.reason : undefined;
                  closeInfo.wasClean = typeof ce.wasClean === "boolean" ? ce.wasClean : undefined;
                }
                resume(
                  Effect.fail(
                    new DisconnectError({
                      message: "WebSocket closed",
                      transport: "ws",
                    }),
                  ),
                );
              };

              socket.addEventListener("message", onMessage);
              socket.addEventListener("close", onClose as EventListener, { once: true });
              return Effect.sync(() => {
                socket.removeEventListener("message", onMessage);
                socket.removeEventListener("close", onClose as EventListener);
              });
            });
          });

        // ── Queue drainer ──────────────────────────────────────────────

        const drainQueue = (socket: WebSocket): Effect.Effect<void, TransportError> =>
          Effect.gen(function* () {
            while (true) {
              const item = yield* Queue.take(outboundQueue);
              const alreadyDone = yield* Deferred.isDone(item.deferred);
              if (alreadyDone) {
                continue;
              }

              const remainingTimeoutMs =
                item.expiresAt === undefined ? undefined : Math.max(0, item.expiresAt - Date.now());

              if (remainingTimeoutMs !== undefined && remainingTimeoutMs <= 0) {
                yield* Deferred.fail(item.deferred, createTimeoutError(item));
                continue;
              }

              if (socket.readyState !== WebSocket.OPEN) {
                yield* Deferred.fail(
                  item.deferred,
                  new DisconnectError({
                    message: "WebSocket is not connected",
                    transport: "ws",
                  }),
                );
                continue;
              }

              // Correlate before sending so even an immediate response can resolve the caller.
              yield* pending.add({
                requestId: item.requestId,
                deferred: item.deferred,
                verb: item.verb,
                url: item.url,
                startedAt: Date.now(),
                timeoutMs: item.timeoutMs,
              });

              const sendError = yield* Effect.sync(() => {
                try {
                  socket.send(JSON.stringify(item.envelope));
                  return undefined;
                } catch (err) {
                  return err;
                }
              });
              if (sendError !== undefined) {
                yield* pending.reject(
                  item.requestId,
                  new DisconnectError({
                    message: "Failed to send WebSocket request",
                    transport: "ws",
                    cause: sendError,
                  }),
                );
                continue;
              }
            }
          });

        // ── Connection lifecycle ───────────────────────────────────────

        const runConnection: Effect.Effect<void, TransportError> = Effect.gen(function* () {
          const socket = yield* connectOnce;
          yield* Ref.set(socketRef, socket);
          yield* Ref.set(connectedRef, true);

          // Fire onReconnect if this is not the first connection
          const wasConnectedBefore = yield* Ref.get(hasConnectedBefore);
          if (wasConnectedBefore && onReconnect) {
            yield* Effect.sync(() => {
              try {
                onReconnect();
              } catch {
                /* ignore hook errors */
              }
            });
          }
          yield* Ref.set(hasConnectedBefore, true);

          const closeInfo: {
            code: number | undefined;
            reason: string | undefined;
            wasClean: boolean | undefined;
          } = {
            code: undefined,
            reason: undefined,
            wasClean: undefined,
          };

          const sendPing = (data: string) =>
            Effect.sync(() => {
              if (socket.readyState === WebSocket.OPEN) {
                try {
                  socket.send(JSON.stringify({ type: data }));
                } catch {
                  // Ignore ping failures
                }
              }
            });

          // Run heartbeat, message loop, and queue drainer concurrently
          // When any exits (e.g. socket closes), all are interrupted
          yield* Effect.all(
            [
              pingIntervalMs > 0 ? heartbeat(sendPing, pingIntervalMs) : Effect.never,
              messageLoop(socket, closeInfo),
              drainQueue(socket),
            ],
            { concurrency: "unbounded" },
          ).pipe(
            Effect.ensuring(Effect.sync(() => socket.close())),
            Effect.catchIf(
              () => true,
              () =>
                // Clean up state after disconnect, then re-fail so Effect.retry can reconnect
                Effect.gen(function* () {
                  yield* Ref.set(connectedRef, false);
                  yield* Ref.set(socketRef, undefined);

                  // Fire onDisconnect hook
                  if (onDisconnect) {
                    yield* Effect.sync(() => {
                      try {
                        onDisconnect({
                          code: closeInfo.code,
                          reason: closeInfo.reason ?? "WebSocket disconnected",
                          wasClean: closeInfo.wasClean,
                        });
                      } catch {
                        /* ignore hook errors */
                      }
                    });
                  }

                  yield* pending.rejectAll(
                    new DisconnectError({
                      message: "WebSocket disconnected",
                      transport: "ws",
                    }),
                  );
                  return yield* new DisconnectError({
                    message: "WebSocket disconnected",
                    transport: "ws",
                  });
                }),
            ),
          );
        });

        const reconnectSchedule = Schedule.min([
          Schedule.exponential(`${reconnectInitialDelayMs} millis`, reconnectBackoffFactor),
          Schedule.spaced(`${reconnectMaxDelayMs} millis`),
        ]);

        const connectionLoop = autoReconnect
          ? Effect.retry(runConnection, {
              schedule: reconnectSchedule,
              while: () => autoReconnect,
            })
          : runConnection;

        // Start connection loop in the background (scoped to the layer lifetime)
        const fiber = yield* Effect.forkScoped(connectionLoop);
        yield* Ref.set(connectionFiber, fiber);

        // ── Transport service implementation ───────────────────────────

        const transport = {
          name: "ws",

          request: (req: TransportRequest): Effect.Effect<TransportResponse, TransportError> =>
            Effect.gen(function* () {
              const disposed = yield* Ref.get(disposedRef);
              if (disposed) {
                return yield* new DisconnectError({
                  message: "Cannot send request on a disposed transport",
                  transport: "ws",
                });
              }

              const connected = yield* Ref.get(connectedRef);
              if (!connected && disconnectedBehavior === "reject") {
                return yield* new DisconnectError({
                  message: "WebSocket is disconnected",
                  transport: "ws",
                });
              }

              const requestId = yield* pending.nextId;
              const deferred = yield* Deferred.make<TransportResponse, TransportError>();
              const timeoutMs = req.timeoutMs ?? defaultRequestTimeoutMs;
              const expiresAt = timeoutMs > 0 ? Date.now() + timeoutMs : undefined;

              const envelope: Envelope = {
                MessageName: "http",
                Parameters: {
                  RequestId: requestId,
                  Url: req.url,
                  Verb: req.verb,
                  ...(req.body !== undefined ? { Body: req.body } : {}),
                },
              };

              const offered = yield* offerRequest({
                requestId,
                envelope,
                deferred,
                verb: req.verb,
                url: req.url,
                timeoutMs,
                expiresAt,
              });

              if (!offered) {
                return yield* new DisconnectError({
                  message: `WebSocket queue limit reached (${maxQueueSize}); request rejected`,
                  transport: "ws",
                });
              }

              const response = Deferred.await(deferred);
              const awaitResponse =
                expiresAt === undefined
                  ? response
                  : response.pipe(
                      Effect.timeoutOrElse({
                        duration: Math.max(0, expiresAt - Date.now()),
                        orElse: () =>
                          Effect.fail(
                            createTimeoutError({
                              requestId,
                              timeoutMs,
                              verb: req.verb,
                              url: req.url,
                            }),
                          ),
                      }),
                    );
              return yield* awaitResponse.pipe(
                Effect.ensuring(
                  Effect.gen(function* () {
                    if (yield* Deferred.isDone(deferred)) return;
                    const error = new DisconnectError({
                      message: "WebSocket request cancelled",
                      transport: "ws",
                    });
                    yield* Deferred.fail(deferred, error);
                    yield* pending.reject(requestId, error);
                  }),
                ),
              );
            }),

          pendingRequests: Effect.gen(function* () {
            const now = Date.now();
            const entries = yield* pending.snapshot;
            return entries.map(
              (e): PendingRequestInfo => ({
                requestId: e.requestId,
                verb: e.verb,
                url: e.url,
                elapsedMs: now - e.startedAt,
                timeoutMs: e.timeoutMs,
              }),
            );
          }),

          dispose: Effect.gen(function* () {
            if (yield* Ref.get(disposedRef)) return;
            yield* Ref.set(disposedRef, true);
            yield* Ref.set(connectedRef, false);

            const fiber = yield* Ref.get(connectionFiber);
            if (fiber) {
              yield* Fiber.interrupt(fiber);
            }

            yield* pending.rejectAll(
              new DisconnectError({
                message: "Transport disposed",
                transport: "ws",
              }),
            );

            for (const item of yield* Queue.clear(outboundQueue)) {
              yield* Deferred.fail(
                item.deferred,
                new DisconnectError({
                  message: "Transport disposed",
                  transport: "ws",
                }),
              );
            }

            const socket = yield* Ref.get(socketRef);
            if (
              socket &&
              (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
            ) {
              socket.close(1000, "Client disposed");
            }
            yield* Ref.set(socketRef, undefined);
          }),
        };
        yield* Effect.addFinalizer(() => transport.dispose);
        return transport;
      }),
    ),
    PendingRequestsLive,
  );
};
