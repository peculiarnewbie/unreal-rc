import { Deferred, Effect, Fiber, Layer, Queue, Ref, Schedule } from "effect";
import {
  ConnectError,
  DisconnectError,
  RemoteStatusError,
  TimeoutError,
  type TransportError
} from "./errors.js";
import { Transport, type TransportRequest, type TransportResponse } from "./transport.js";
import { heartbeat } from "./heartbeat.js";
import { PendingRequests, PendingRequestsLive } from "./correlation.js";

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

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 30020;
const DEFAULT_CONNECT_TIMEOUT_MS = 7_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PING_INTERVAL_MS = 25_000;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 250;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 5_000;
const DEFAULT_RECONNECT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_QUEUE_SIZE = 500;

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
}

export const WebSocketTransportLive = (
  options: WebSocketTransportOptions = {}
): Layer.Layer<Transport> => {
  const url =
    options.baseUrl ??
    `${options.secure ? "wss" : "ws"}://${options.host ?? DEFAULT_HOST}:${options.port ?? DEFAULT_PORT}`;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const defaultRequestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const autoReconnect = options.autoReconnect ?? true;
  const reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  const reconnectBackoffFactor = options.reconnectBackoffFactor ?? DEFAULT_RECONNECT_BACKOFF_FACTOR;
  const disconnectedBehavior = options.disconnectedBehavior ?? "queue";
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  return Layer.provide(
    Layer.effect(Transport)(
      Effect.gen(function* () {
        const pending = yield* PendingRequests;
        const outboundQueue = yield* Queue.bounded<QueuedRequest>(maxQueueSize);
        const socketRef = yield* Ref.make<WebSocket | undefined>(undefined);
        const connectedRef = yield* Ref.make(false);
        const disposedRef = yield* Ref.make(false);
        const connectionFiber = yield* Ref.make<Fiber.Fiber<void, TransportError> | undefined>(undefined);

        // ── Connect once ──────────────────────────────────────────────

        const connectOnce: Effect.Effect<WebSocket, TransportError> = Effect.callback<
          WebSocket,
          TransportError
        >((resume) => {
          const socket = new WebSocket(url);
          let settled = false;

          const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            socket.close();
            resume(
              Effect.fail(
                new TimeoutError({
                  message: `WebSocket connect timed out after ${connectTimeoutMs}ms`,
                  transport: "ws"
                })
              )
            );
          }, connectTimeoutMs);

          socket.addEventListener(
            "open",
            () => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resume(Effect.succeed(socket));
            },
            { once: true }
          );

          const onFailure = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.close();
            resume(
              Effect.fail(
                new ConnectError({
                  message: "WebSocket connection failed",
                  transport: "ws"
                })
              )
            );
          };

          socket.addEventListener("close", onFailure, { once: true });
          socket.addEventListener("error", onFailure, { once: true });
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
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return;
            }

            const requestIdValue = payload.RequestId;
            const requestId =
              typeof requestIdValue === "number" ? requestIdValue : Number(requestIdValue);

            if (!Number.isFinite(requestId) || requestId < 0) return;

            const responseCodeValue = payload.ResponseCode;
            const responseCode =
              typeof responseCodeValue === "number"
                ? responseCodeValue
                : Number(responseCodeValue);

            if (Number.isFinite(responseCode) && responseCode >= 200 && responseCode < 300) {
              yield* pending.resolve(requestId, {
                body: payload.ResponseBody ?? undefined,
                statusCode: responseCode,
                requestId
              });
            } else {
              const entry = yield* pending.get(requestId);
              const error = Number.isFinite(responseCode)
                ? new RemoteStatusError({
                    message: `Remote request failed with status ${responseCode}`,
                    statusCode: responseCode,
                    transport: "ws",
                    verb: entry?.verb,
                    url: entry?.url,
                    requestId,
                    details: payload.ResponseBody
                  })
                : new DisconnectError({
                    message: "Remote request failed",
                    transport: "ws"
                  });
              yield* pending.reject(requestId, error);
            }
          });

        // ── Message listener fiber ─────────────────────────────────────

        const messageLoop = (socket: WebSocket): Effect.Effect<void, TransportError> =>
          Effect.callback<void, TransportError>((resume) => {
            const onMessage = (event: MessageEvent) => {
              const raw = decodeMessage(event);
              if (raw) {
                Effect.runFork(handleMessage(raw));
              }
            };

            const onClose = () => {
              socket.removeEventListener("message", onMessage);
              resume(
                Effect.fail(
                  new DisconnectError({
                    message: "WebSocket closed",
                    transport: "ws"
                  })
                )
              );
            };

            socket.addEventListener("message", onMessage);
            socket.addEventListener("close", onClose, { once: true });
          });

        // ── Queue drainer ──────────────────────────────────────────────

        const drainQueue = (socket: WebSocket): Effect.Effect<void, TransportError> =>
          Effect.gen(function* () {
            while (true) {
              const item = yield* Queue.take(outboundQueue);

              if (socket.readyState !== WebSocket.OPEN) {
                yield* Deferred.fail(
                  item.deferred,
                  new DisconnectError({
                    message: "WebSocket is not connected",
                    transport: "ws"
                  })
                );
                continue;
              }

              try {
                socket.send(JSON.stringify(item.envelope));
              } catch (err) {
                yield* Deferred.fail(
                  item.deferred,
                  new DisconnectError({
                    message: "Failed to send WebSocket request",
                    transport: "ws",
                    cause: err
                  })
                );
                continue;
              }

              // Register as pending and set up per-request timeout
              const deferred = yield* pending.add(item.requestId, item.verb, item.url);

              // Wire timeout
              yield* Effect.forkChild(
                Effect.sleep(`${item.timeoutMs} millis`).pipe(
                  Effect.andThen(() =>
                    pending.reject(
                      item.requestId,
                      new TimeoutError({
                        message: `WebSocket request timed out after ${item.timeoutMs}ms`,
                        transport: "ws",
                        verb: item.verb,
                        url: item.url,
                        requestId: item.requestId
                      })
                    )
                  )
                )
              );

              // Forward resolution to the caller's deferred
              yield* Effect.forkChild(
                Deferred.await(deferred).pipe(
                  Effect.matchEffect({
                    onSuccess: (response: TransportResponse) => Deferred.succeed(item.deferred, response),
                    onFailure: (error: TransportError) => Deferred.fail(item.deferred, error)
                  })
                )
              );
            }
          });

        // ── Connection lifecycle ───────────────────────────────────────

        const runConnection: Effect.Effect<void, TransportError> = Effect.gen(function* () {
          const socket = yield* connectOnce;
          yield* Ref.set(socketRef, socket);
          yield* Ref.set(connectedRef, true);

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
              messageLoop(socket),
              drainQueue(socket)
            ],
            { concurrency: "unbounded" }
          ).pipe(
            Effect.catchIf(
              () => true,
              () =>
                // Clean up state after disconnect, then re-fail so Effect.retry can reconnect
                Effect.gen(function* () {
                  yield* Ref.set(connectedRef, false);
                  yield* Ref.set(socketRef, undefined);
                  yield* pending.rejectAll(
                    new DisconnectError({
                      message: "WebSocket disconnected",
                      transport: "ws"
                    })
                  );
                  return yield* Effect.fail(
                    new DisconnectError({
                      message: "WebSocket disconnected",
                      transport: "ws"
                    })
                  );
                })
            )
          );
        });

        const reconnectSchedule = Schedule.exponential(
          `${reconnectInitialDelayMs} millis`,
          reconnectBackoffFactor
        ).pipe(
          Schedule.either(Schedule.spaced(`${reconnectMaxDelayMs} millis`))
        );

        const connectionLoop = autoReconnect
          ? Effect.retry(runConnection, {
              schedule: reconnectSchedule,
              while: () => autoReconnect
            })
          : runConnection;

        // Start connection loop in the background (scoped to the layer lifetime)
        const fiber = yield* Effect.forkScoped(connectionLoop);
        yield* Ref.set(connectionFiber, fiber);

        // ── Transport service implementation ───────────────────────────

        return {
          name: "ws",

          request: (req: TransportRequest): Effect.Effect<TransportResponse, TransportError> =>
            Effect.gen(function* () {
              const disposed = yield* Ref.get(disposedRef);
              if (disposed) {
                return yield* Effect.fail(
                  new DisconnectError({
                    message: "Cannot send request on a disposed transport",
                    transport: "ws"
                  })
                );
              }

              const connected = yield* Ref.get(connectedRef);
              if (!connected && disconnectedBehavior === "reject") {
                return yield* Effect.fail(
                  new DisconnectError({
                    message: "WebSocket is disconnected",
                    transport: "ws"
                  })
                );
              }

              const requestId = yield* pending.nextId;
              const deferred = yield* Deferred.make<TransportResponse, TransportError>();

              const envelope: Envelope = {
                MessageName: "http",
                Parameters: {
                  RequestId: requestId,
                  Url: req.url,
                  Verb: req.verb,
                  ...(req.body !== undefined ? { Body: req.body } : {})
                }
              };

              const offered = yield* Queue.offer(outboundQueue, {
                requestId,
                envelope,
                deferred,
                verb: req.verb,
                url: req.url,
                timeoutMs: req.timeoutMs ?? defaultRequestTimeoutMs
              });

              if (!offered) {
                return yield* Effect.fail(
                  new DisconnectError({
                    message: `WebSocket queue limit reached (${maxQueueSize}); request rejected`,
                    transport: "ws"
                  })
                );
              }

              return yield* Deferred.await(deferred);
            }),

          dispose: Effect.gen(function* () {
            yield* Ref.set(disposedRef, true);
            yield* Ref.set(connectedRef, false);

            const fiber = yield* Ref.get(connectionFiber);
            if (fiber) {
              yield* Fiber.interrupt(fiber);
            }

            yield* pending.rejectAll(
              new DisconnectError({
                message: "Transport disposed",
                transport: "ws"
              })
            );

            const socket = yield* Ref.get(socketRef);
            if (
              socket &&
              (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
            ) {
              socket.close(1000, "Client disposed");
            }
            yield* Ref.set(socketRef, undefined);
          })
        };
      })
    ),
    PendingRequestsLive
  );
};
