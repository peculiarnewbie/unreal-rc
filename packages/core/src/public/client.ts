import { Effect, Schema } from "effect";
import type { TransportError } from "../internal/errors.js";
import { DecodeError } from "../internal/errors.js";
import { Transport } from "../internal/transport.js";
import { makeRuntime, sendRequest, type FullLayer, type RuntimeConfig } from "../internal/runtime.js";
import { withRetry } from "../internal/retry.js";
import {
  BatchBuilder,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest,
  buildBatchRequest,
  correlateBatchResponses,
  type BatchResult
} from "../internal/batch.js";
import {
  ObjectCallResponseSchema,
  ObjectPropertyResponseSchema,
  ObjectDescribeResponseSchema,
  SearchAssetsRequestSchema,
  SearchAssetsResponseSchema,
  InfoResponseSchema,
  ObjectEventRequestSchema,
  ObjectEventResponseSchema,
  ObjectThumbnailRequestSchema,
  ObjectThumbnailResponseSchema,
  BatchResponseSchema
} from "../internal/schemas.js";
import { UnrealRCOptionsSchema } from "../internal/config-schemas.js";
import { toPublicError, TransportRequestError } from "./errors.js";
import { parseReturnValue } from "./helpers.js";
import type {
  AccessMode,
  HealthStatus,
  HttpVerb,
  ObjectCallResponse,
  ObjectDescribeResponse,
  ObjectEventRequest,
  ObjectEventResponse,
  ObjectPropertyResponse,
  ObjectThumbnailResponse,
  PendingRequestInfo,
  PingResult,
  SearchAssetsResponse,
  InfoResponse,
  TransportRequestId
} from "./types.js";
import type { TransportResponse } from "../internal/transport.js";
import type { ManagedRuntime } from "effect";
import type {
  PayloadRedactionContext,
  RequestHookContext,
  ResponseHookContext,
  ErrorHookContext
} from "../internal/hooks.js";

// ── Hook context types (re-exported from hooks) ────────────────────────

export type {
  PayloadRedactionContext,
  RequestHookContext,
  ResponseHookContext,
  ErrorHookContext
} from "../internal/hooks.js";

// ── Option types ───────────────────────────────────────────────────────

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  error: TransportRequestError;
  transport: string;
  verb: HttpVerb;
  url: string;
  body?: unknown;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface RetryPolicy {
  maxAttempts?: number | undefined;
  delayMs?: number | ((context: RetryContext) => number) | undefined;
  shouldRetry?: ((context: RetryContext) => boolean) | undefined;
}

export type RetryOptions = boolean | RetryPolicy;

export interface UnrealRCOptions extends RuntimeConfig {
  validateResponses?: boolean;
  retry?: RetryOptions;
  onRequest?: ((context: RequestHookContext) => void | Promise<void>) | undefined;
  onResponse?: ((context: ResponseHookContext) => void | Promise<void>) | undefined;
  onError?: ((context: ErrorHookContext) => void | Promise<void>) | undefined;
  redactPayload?: ((payload: unknown, context: PayloadRedactionContext) => unknown) | undefined;
}

interface RequestOptionsBase {
  timeoutMs?: number | undefined;
  retry?: RetryOptions | undefined;
}

export type { RequestOptionsBase };

export type WritableAccessMode = Exclude<AccessMode, "READ_ACCESS">;

export interface BatchOptions extends RequestOptionsBase {}

export interface EventOptions extends RequestOptionsBase {}

// ── Request argument types ────────────────────────────────────────────

export interface CallArgs {
  readonly objectPath: string;
  readonly functionName: string;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly transaction?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface GetPropertyArgs {
  readonly objectPath: string;
  readonly propertyName: string;
  readonly access?: AccessMode | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface GetPropertiesArgs {
  readonly objectPath: string;
  readonly access?: AccessMode | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface SetPropertyArgs {
  readonly objectPath: string;
  readonly propertyName: string;
  readonly propertyValue: unknown;
  readonly access?: WritableAccessMode | undefined;
  readonly transaction?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface DescribeArgs {
  readonly objectPath: string;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface SearchAssetsArgs {
  readonly query: string;
  readonly classNames?: readonly string[] | undefined;
  readonly packagePaths?: readonly string[] | undefined;
  readonly recursivePaths?: boolean | undefined;
  readonly recursiveClasses?: boolean | undefined;
  readonly includeOnlyOnDiskAssets?: boolean | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface ThumbnailArgs {
  readonly objectPath: string;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

// ── Generic request argument types ────────────────────────────────────

export interface RequestArgs<T = unknown> {
  readonly verb: HttpVerb;
  readonly url: string;
  readonly body?: unknown;
  readonly responseSchema?: Schema.Schema<T> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

export interface RequestRawArgs {
  readonly verb: HttpVerb;
  readonly url: string;
  readonly body?: unknown;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

// ── callReturn argument types ─────────────────────────────────────────

export interface CallReturnArgs<T> {
  readonly objectPath: string;
  readonly functionName: string;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly transaction?: boolean | undefined;
  readonly returnSchema: Schema.Schema<T>;
  readonly timeoutMs?: number | undefined;
  readonly retry?: RetryOptions | undefined;
}

// ── Health detection option types ─────────────────────────────────────

export interface PingOptions {
  timeoutMs?: number | undefined;
}

export interface WatchHealthOptions {
  intervalMs?: number | undefined;
  unhealthyAfter?: number | undefined;
  timeoutMs?: number | undefined;
  onChange?: ((status: HealthStatus) => void) | undefined;
}

export interface HealthWatcher {
  readonly status: () => HealthStatus;
  readonly dispose: () => void;
}

// ── Default retry ──────────────────────────────────────────────────────

const DEFAULT_RETRY_MAX_ATTEMPTS = 3;

// ── Client ─────────────────────────────────────────────────────────────

export class UnrealRC {
  private readonly runtime: ManagedRuntime.ManagedRuntime<FullLayer, never>;
  private readonly validateResponses: boolean;
  private readonly defaultRetry: RetryOptions | undefined;
  private readonly transportName: string;
  private readonly _onRequest: ((ctx: RequestHookContext) => void | Promise<void>) | undefined;
  private readonly _onResponse: ((ctx: ResponseHookContext) => void | Promise<void>) | undefined;
  private readonly _onError: ((ctx: ErrorHookContext) => void | Promise<void>) | undefined;
  private readonly _redactPayload: ((payload: unknown, ctx: PayloadRedactionContext) => unknown) | undefined;

  constructor(options: UnrealRCOptions = {}) {
    Schema.decodeUnknownSync(UnrealRCOptionsSchema)(options, { onExcessProperty: "ignore" });
    this.runtime = makeRuntime(options);
    this.validateResponses = options.validateResponses ?? true;
    this.defaultRetry = options.retry;
    this.transportName = options.transport ?? "ws";
    this._onRequest = options.onRequest;
    this._onResponse = options.onResponse;
    this._onError = options.onError;
    this._redactPayload = options.redactPayload;
  }

  // ── Effect API ─────────────────────────────────────────────────────

  get effect() {
    const self = this;

    return {
      call(args: CallArgs): Effect.Effect<ObjectCallResponse, TransportError, Transport> {
        const { objectPath, functionName, parameters, transaction, timeoutMs, retry } = args;
        const body = buildCallRequest({
          objectPath,
          functionName,
          ...(parameters !== undefined ? { parameters } : {}),
          ...(transaction !== undefined ? { transaction } : {})
        });
        return self.sendEffect("PUT", "/remote/object/call", body, ObjectCallResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => normalizeCallResponse(result.decoded))
        ) as Effect.Effect<ObjectCallResponse, TransportError, Transport>;
      },

      getProperty<T = unknown>(args: GetPropertyArgs): Effect.Effect<T | undefined, TransportError, Transport> {
        const { objectPath, propertyName, access, timeoutMs, retry } = args;
        const body = buildPropertyRequest(objectPath, {
          propertyName,
          access: access ?? "READ_ACCESS"
        });
        return self.sendEffect("PUT", "/remote/object/property", body, ObjectPropertyResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => {
            const parsed = parseReturnValue<T>(result.decoded, propertyName) ?? parseReturnValue<T>(result.decoded);
            return parsed;
          })
        ) as Effect.Effect<T | undefined, TransportError, Transport>;
      },

      getProperties<T = Record<string, unknown>>(args: GetPropertiesArgs): Effect.Effect<T, TransportError, Transport> {
        const { objectPath, access, timeoutMs, retry } = args;
        const body = buildPropertyRequest(objectPath, {
          access: access ?? "READ_ACCESS"
        });
        return self.sendEffect("PUT", "/remote/object/property", body, ObjectPropertyResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => {
            const parsed = parseReturnValue<T>(result.decoded) ?? (result.decoded as T);
            return parsed;
          })
        ) as Effect.Effect<T, TransportError, Transport>;
      },

      setProperty(args: SetPropertyArgs): Effect.Effect<ObjectPropertyResponse, TransportError, Transport> {
        const { objectPath, propertyName, propertyValue, access, transaction, timeoutMs, retry } = args;
        const body = buildPropertyRequest(objectPath, {
          propertyName,
          propertyValue,
          ...(access !== undefined ? { access } : {}),
          ...(transaction !== undefined ? { transaction } : {})
        });
        return self.sendEffect("PUT", "/remote/object/property", body, ObjectPropertyResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => result.decoded ?? ({} as ObjectPropertyResponse))
        ) as Effect.Effect<ObjectPropertyResponse, TransportError, Transport>;
      },

      describe(args: DescribeArgs): Effect.Effect<ObjectDescribeResponse, TransportError, Transport> {
        const { objectPath, timeoutMs, retry } = args;
        return self.sendEffect("PUT", "/remote/object/describe", buildDescribeRequest(objectPath), ObjectDescribeResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => result.decoded)
        ) as Effect.Effect<ObjectDescribeResponse, TransportError, Transport>;
      },

      searchAssets(args: SearchAssetsArgs): Effect.Effect<SearchAssetsResponse, TransportError, Transport> {
        const { query, timeoutMs, retry, ...searchOptions } = args;
        const body = Schema.encodeSync(SearchAssetsRequestSchema)({ query, ...searchOptions });
        return self.sendEffect("PUT", "/remote/search/assets", body, SearchAssetsResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => result.decoded)
        ) as Effect.Effect<SearchAssetsResponse, TransportError, Transport>;
      },

      info(options?: RequestOptionsBase): Effect.Effect<InfoResponse, TransportError, Transport> {
        return self.sendEffect("GET", "/remote/info", undefined, InfoResponseSchema, options).pipe(
          Effect.map((result) => result.decoded)
        ) as Effect.Effect<InfoResponse, TransportError, Transport>;
      },

      event(request: ObjectEventRequest, options?: EventOptions): Effect.Effect<ObjectEventResponse, TransportError, Transport> {
        const body = Schema.encodeSync(ObjectEventRequestSchema)(request);
        return self.sendEffect("PUT", "/remote/object/event", body, ObjectEventResponseSchema, options).pipe(
          Effect.map((result) => result.decoded)
        ) as Effect.Effect<ObjectEventResponse, TransportError, Transport>;
      },

      thumbnail(args: ThumbnailArgs): Effect.Effect<ObjectThumbnailResponse, TransportError, Transport> {
        const { objectPath, timeoutMs, retry } = args;
        const body = Schema.encodeSync(ObjectThumbnailRequestSchema)({ objectPath });
        return self.sendEffect("PUT", "/remote/object/thumbnail", body, ObjectThumbnailResponseSchema, {
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(retry !== undefined ? { retry } : {})
        }).pipe(
          Effect.map((result) => result.decoded)
        ) as Effect.Effect<ObjectThumbnailResponse, TransportError, Transport>;
      },

      batch(
        configure: (builder: BatchBuilder) => void,
        options?: BatchOptions
      ): Effect.Effect<BatchResult[], TransportError, Transport> {
        const builder = new BatchBuilder();
        configure(builder);
        const requests = builder.getRequests();
        return self.sendEffect("PUT", "/remote/batch", buildBatchRequest(requests), BatchResponseSchema, options).pipe(
          Effect.map((result) => correlateBatchResponses(requests, result.decoded))
        ) as Effect.Effect<BatchResult[], TransportError, Transport>;
      },

      request<T = unknown>(args: RequestArgs<T>): Effect.Effect<T, TransportError, Transport> {
        const { verb, url, body, responseSchema, timeoutMs, retry } = args;
        if (responseSchema !== undefined) {
          return self.sendEffect(verb, url, body, responseSchema, { timeoutMs, retry }).pipe(
            Effect.map((result) => result.decoded)
          ) as Effect.Effect<T, TransportError, Transport>;
        }
        return self.sendEffectRaw(verb, url, body, { timeoutMs, retry }).pipe(
          Effect.map((result) => result.body)
        ) as Effect.Effect<T, TransportError, Transport>;
      },

      requestRaw(args: RequestRawArgs): Effect.Effect<TransportResponse, TransportError, Transport> {
        const { verb, url, body, timeoutMs, retry } = args;
        return self.sendEffectRaw(verb, url, body, { timeoutMs, retry });
      },

      callReturn<T>(args: CallReturnArgs<T>): Effect.Effect<T, TransportError, Transport> {
        const { objectPath, functionName, parameters, transaction, returnSchema, timeoutMs, retry } = args;
        const body = buildCallRequest({
          objectPath,
          functionName,
          ...(parameters !== undefined ? { parameters } : {}),
          ...(transaction !== undefined ? { transaction } : {})
        });
        return self.sendEffect("PUT", "/remote/object/call", body, ObjectCallResponseSchema, { timeoutMs, retry }).pipe(
          Effect.map((result) => normalizeCallResponse(result.decoded)),
          Effect.flatMap((normalized) => {
            if (normalized.ReturnValue === undefined) {
              return Effect.fail(
                new DecodeError({
                  message: "callReturn: ReturnValue not present in response",
                  verb: "PUT",
                  url: "/remote/object/call"
                })
              ) as Effect.Effect<T, TransportError>;
            }
            return Schema.decodeUnknownEffect(returnSchema)(normalized.ReturnValue).pipe(
              Effect.mapError(
                (cause) =>
                  new DecodeError({
                    message: "callReturn: failed to decode ReturnValue",
                    verb: "PUT",
                    url: "/remote/object/call",
                    details: normalized.ReturnValue,
                    cause
                  })
              )
            ) as Effect.Effect<T, TransportError>;
          })
        ) as Effect.Effect<T, TransportError, Transport>;
      },

      ping(options?: PingOptions): Effect.Effect<PingResult, never, Transport> {
        const timeoutMs = options?.timeoutMs ?? 2000;
        return Effect.suspend(() => {
          const startTime = Date.now();
          return (sendRequest({ verb: "GET", url: "/remote/info", body: undefined, timeoutMs }) as Effect.Effect<
            { body: unknown; statusCode?: number | undefined; requestId?: number | string | undefined },
            TransportError,
            Transport
          >).pipe(
            Effect.map(() => ({ reachable: true, latencyMs: Date.now() - startTime } as PingResult)),
            Effect.catchCause(() => Effect.succeed({ reachable: false, latencyMs: undefined } as PingResult))
          ) as Effect.Effect<PingResult, never, Transport>;
        }) as Effect.Effect<PingResult, never, Transport>;
      },

      pendingRequests(): Effect.Effect<readonly PendingRequestInfo[], never, Transport> {
        return Transport.use((transport) => transport.pendingRequests);
      },

      dispose(): Effect.Effect<void, never, Transport> {
        return Transport.use((transport) => transport.dispose);
      }
    };
  }

  // ── Promise API ─────────────────────────────────────────────────────

  async call(args: CallArgs): Promise<ObjectCallResponse> {
    const { objectPath, functionName, parameters, transaction, timeoutMs, retry } = args;
    const body = buildCallRequest({
      objectPath,
      functionName,
      ...(parameters !== undefined ? { parameters } : {}),
      ...(transaction !== undefined ? { transaction } : {})
    });
    const response = await this.send("PUT", "/remote/object/call", body, ObjectCallResponseSchema, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(retry !== undefined ? { retry } : {})
    });
    return normalizeCallResponse(response);
  }

  async getProperty<T = unknown>(args: GetPropertyArgs): Promise<T | undefined> {
    const { objectPath, propertyName, access, timeoutMs, retry } = args;
    const body = buildPropertyRequest(objectPath, {
      propertyName,
      access: access ?? "READ_ACCESS"
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retry !== undefined ? { retry } : {}) }
    );
    return parseReturnValue<T>(response, propertyName) ?? parseReturnValue<T>(response);
  }

  async getProperties<T = Record<string, unknown>>(args: GetPropertiesArgs): Promise<T> {
    const { objectPath, access, timeoutMs, retry } = args;
    const body = buildPropertyRequest(objectPath, {
      access: access ?? "READ_ACCESS"
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retry !== undefined ? { retry } : {}) }
    );
    return parseReturnValue<T>(response) ?? (response as T);
  }

  async setProperty(args: SetPropertyArgs): Promise<ObjectPropertyResponse> {
    const { objectPath, propertyName, propertyValue, access, transaction, timeoutMs, retry } = args;
    const body = buildPropertyRequest(objectPath, {
      propertyName,
      propertyValue,
      ...(access !== undefined ? { access } : {}),
      ...(transaction !== undefined ? { transaction } : {})
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retry !== undefined ? { retry } : {}) }
    );
    return response ?? ({} as ObjectPropertyResponse);
  }

  async describe(args: DescribeArgs): Promise<ObjectDescribeResponse> {
    const { objectPath, timeoutMs, retry } = args;
    return this.send(
      "PUT",
      "/remote/object/describe",
      buildDescribeRequest(objectPath),
      ObjectDescribeResponseSchema,
      { ...(timeoutMs !== undefined ? { timeoutMs } : {}), ...(retry !== undefined ? { retry } : {}) }
    );
  }

  async searchAssets(args: SearchAssetsArgs): Promise<SearchAssetsResponse> {
    const { query, timeoutMs, retry, ...searchOptions } = args;
    const body = Schema.encodeSync(SearchAssetsRequestSchema)({ query, ...searchOptions });
    return this.send("PUT", "/remote/search/assets", body, SearchAssetsResponseSchema, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(retry !== undefined ? { retry } : {})
    });
  }

  async info(options?: RequestOptionsBase): Promise<InfoResponse> {
    return this.send("GET", "/remote/info", undefined, InfoResponseSchema, options);
  }

  async event(request: ObjectEventRequest, options?: EventOptions): Promise<ObjectEventResponse> {
    const body = Schema.encodeSync(ObjectEventRequestSchema)(request);
    return this.send("PUT", "/remote/object/event", body, ObjectEventResponseSchema, options);
  }

  async thumbnail(args: ThumbnailArgs): Promise<ObjectThumbnailResponse> {
    const { objectPath, timeoutMs, retry } = args;
    const body = Schema.encodeSync(ObjectThumbnailRequestSchema)({ objectPath });
    return this.send("PUT", "/remote/object/thumbnail", body, ObjectThumbnailResponseSchema, {
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(retry !== undefined ? { retry } : {})
    });
  }

  async batch(
    configure: (builder: BatchBuilder) => void | Promise<void>,
    options?: BatchOptions
  ): Promise<BatchResult[]> {
    const builder = new BatchBuilder();
    await configure(builder);
    const requests = builder.getRequests();
    const response = await this.send(
      "PUT",
      "/remote/batch",
      buildBatchRequest(requests),
      BatchResponseSchema,
      options
    );
    return correlateBatchResponses(requests, response);
  }

  // ── Health detection ─────────────────────────────────────────────────

  async ping(options?: PingOptions): Promise<PingResult> {
    const timeoutMs = options?.timeoutMs ?? 2000;
    try {
      const { latencyMs } = await this.sendRaw("GET", "/remote/info", undefined, timeoutMs);
      return { reachable: true, latencyMs };
    } catch {
      return { reachable: false, latencyMs: undefined };
    }
  }

  watchHealth(options?: WatchHealthOptions): HealthWatcher {
    const intervalMs = options?.intervalMs ?? 5000;
    const unhealthyAfter = Math.max(1, options?.unhealthyAfter ?? 2);
    const pingTimeoutMs = options?.timeoutMs ?? 2000;
    const onChange = options?.onChange;

    let currentStatus: HealthStatus = {
      healthy: false,
      latencyMs: undefined,
      consecutiveFailures: 0,
      lastSeen: undefined
    };
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async (): Promise<void> => {
      if (disposed) return;

      const result = await this.ping({ timeoutMs: pingTimeoutMs });
      if (disposed) return;

      const previousHealthy = currentStatus.healthy;

      if (result.reachable) {
        const nextStatus: HealthStatus = {
          healthy: true,
          latencyMs: result.latencyMs,
          consecutiveFailures: 0,
          lastSeen: new Date()
        };
        currentStatus = nextStatus;

        if (!previousHealthy) {
          onChange?.(currentStatus);
        }
      } else {
        const nextFailures = currentStatus.consecutiveFailures + 1;
        const nextHealthy = nextFailures < unhealthyAfter;
        const nextStatus: HealthStatus = {
          healthy: nextHealthy,
          latencyMs: undefined,
          consecutiveFailures: nextFailures,
          lastSeen: currentStatus.lastSeen
        };
        currentStatus = nextStatus;

        if (previousHealthy && !nextHealthy) {
          onChange?.(currentStatus);
        }
      }

      if (!disposed) {
        timer = setTimeout(() => { tick().catch(() => {}); }, intervalMs);
      }
    };

    // Start the first tick immediately
    timer = setTimeout(() => { tick().catch(() => {}); }, 0);

    return {
      status: () => currentStatus,
      dispose: () => {
        disposed = true;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      }
    };
  }

  async pendingRequests(): Promise<readonly PendingRequestInfo[]> {
    return this.runtime.runPromise(
      Transport.use((transport) => transport.pendingRequests)
    );
  }

  // ── Generic requests ───────────────────────────────────────────────

  async request<T = unknown>(args: RequestArgs<T>): Promise<T> {
    const { verb, url, body, responseSchema, timeoutMs, retry } = args;
    if (responseSchema !== undefined) {
      return this.send(verb as string, url, body, responseSchema, { timeoutMs, retry });
    }
    const raw = await this.sendRawResponse(verb as string, url, body, { timeoutMs, retry });
    return raw.body as T;
  }

  async requestRaw(args: RequestRawArgs): Promise<TransportResponse> {
    const { verb, url, body, timeoutMs, retry } = args;
    return this.sendRawResponse(verb as string, url, body, { timeoutMs, retry });
  }

  // ── callReturn ─────────────────────────────────────────────────────

  async callReturn<T>(args: CallReturnArgs<T>): Promise<T> {
    const { objectPath, functionName, parameters, transaction, returnSchema, timeoutMs, retry } = args;
    const body = buildCallRequest({
      objectPath,
      functionName,
      ...(parameters !== undefined ? { parameters } : {}),
      ...(transaction !== undefined ? { transaction } : {})
    });
    const response = await this.send("PUT", "/remote/object/call", body, ObjectCallResponseSchema, { timeoutMs, retry });
    const normalized = normalizeCallResponse(response);

    if (normalized.ReturnValue === undefined) {
      throw new TransportRequestError("callReturn: ReturnValue not present in response", {
        kind: "decode",
        verb: "PUT",
        url: "/remote/object/call"
      });
    }

    // Schema.decodeUnknownSync has strict Decoder<unknown, never> typing in
    // effect v4 beta; wrap decode and rethrow as TransportRequestError.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (Schema.decodeUnknownSync as any)(returnSchema)(normalized.ReturnValue) as T;
    } catch (cause) {
      throw new TransportRequestError("callReturn: failed to decode ReturnValue", {
        kind: "decode",
        verb: "PUT",
        url: "/remote/object/call",
        details: normalized.ReturnValue,
        cause
      });
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.runtime.runPromise(
      Transport.use((transport) => transport.dispose)
    ).catch(() => {});
    await this.runtime.dispose();
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private sendEffect<T>(
    verb: string,
    url: string,
    body: unknown,
    responseSchema: Schema.Schema<T>,
    options?: RequestOptionsBase
  ): Effect.Effect<SendResult<T>, TransportError, Transport> {
    const retryConfig = this.resolveRetryConfig(options?.retry, verb as HttpVerb, url);
    const validateResponses = this.validateResponses;

    const pipeline = sendRequest({
      verb,
      url,
      body,
      timeoutMs: options?.timeoutMs
    }).pipe(
      Effect.flatMap((response) => {
        if (!validateResponses) {
          return Effect.succeed({
            decoded: response.body as T,
            statusCode: response.statusCode,
            requestId: response.requestId,
            rawBody: response.body
          } as SendResult<T>);
        }
        const decodeInput = response.body ?? {};
        return Schema.decodeUnknownEffect(responseSchema)(
          decodeInput,
          { onExcessProperty: "preserve" }
        ).pipe(
          Effect.map((decoded) => ({
            decoded,
            statusCode: response.statusCode,
            requestId: response.requestId,
            rawBody: response.body
          } as SendResult<T>)),
          Effect.mapError(
            (parseError) =>
              new DecodeError({
                message: "Failed to decode response payload",
                verb,
                url,
                details: response.body,
                cause: parseError
              })
          )
        );
      })
    ) as Effect.Effect<SendResult<T>, TransportError, Transport>;

    if (retryConfig === false) {
      return pipeline;
    }
    return withRetry(pipeline, retryConfig);
  }

  private async sendRaw(
    verb: string,
    url: string,
    body: unknown,
    timeoutMs: number | undefined
  ): Promise<{ latencyMs: number }> {
    const startTime = Date.now();
    await this.runtime.runPromise(sendRequest({ verb, url, body, timeoutMs }));
    return { latencyMs: Date.now() - startTime };
  }

  private async send<T>(
    verb: string,
    url: string,
    body: unknown,
    responseSchema: Schema.Schema<T>,
    options?: RequestOptionsBase
  ): Promise<T> {
    const startTime = Date.now();
    this.fireRequestHook(verb as HttpVerb, url, body);

    const effect = this.sendEffect(verb, url, body, responseSchema, options).pipe(
      Effect.mapError(toPublicError)
    );

    try {
      const result = await this.runtime.runPromise(effect);
      this.fireResponseHook(verb as HttpVerb, url, body, result, startTime);
      return result.decoded;
    } catch (error) {
      this.fireErrorHook(verb as HttpVerb, url, body, error, startTime);
      throw error;
    }
  }

  private fireRequestHook(verb: HttpVerb, url: string, body: unknown): void {
    if (!this._onRequest) return;
    const redactedBody = this.redact(body, "request", verb, url);
    try {
      const result = this._onRequest({
        transport: this.transportName,
        verb,
        url,
        body: redactedBody,
        attempt: 1
      });
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {});
      }
    } catch { /* ignore hook errors */ }
  }

  private fireResponseHook(
    verb: HttpVerb,
    url: string,
    requestBody: unknown,
    result: { statusCode?: number | undefined; requestId?: number | string | undefined; rawBody: unknown },
    startTime: number
  ): void {
    if (!this._onResponse) return;
    const durationMs = Date.now() - startTime;
    try {
      const hookResult = this._onResponse({
        transport: this.transportName,
        verb,
        url,
        body: this.redact(result.rawBody, "response", verb, url, result.statusCode, result.requestId),
        requestBody: this.redact(requestBody, "request", verb, url),
        attempt: 1,
        durationMs,
        statusCode: result.statusCode,
        requestId: result.requestId
      });
      if (hookResult && typeof (hookResult as Promise<void>).catch === "function") {
        (hookResult as Promise<void>).catch(() => {});
      }
    } catch { /* ignore hook errors */ }
  }

  private fireErrorHook(
    verb: HttpVerb,
    url: string,
    requestBody: unknown,
    error: unknown,
    startTime: number
  ): void {
    if (!this._onError) return;
    const durationMs = Date.now() - startTime;
    const publicError =
      error instanceof TransportRequestError ? error : new TransportRequestError("Unknown error");
    try {
      const hookResult = this._onError({
        transport: this.transportName,
        verb,
        url,
        body: this.redact(requestBody, "request", verb, url),
        error: publicError,
        errorBody: this.redact(publicError.details, "error", verb, url, publicError.statusCode, publicError.requestId),
        attempt: 1,
        durationMs,
        statusCode: publicError.statusCode,
        requestId: publicError.requestId
      });
      if (hookResult && typeof (hookResult as Promise<void>).catch === "function") {
        (hookResult as Promise<void>).catch(() => {});
      }
    } catch { /* ignore hook errors */ }
  }

  private redact(
    payload: unknown,
    phase: "request" | "response" | "error",
    verb: HttpVerb,
    url: string,
    statusCode?: number,
    requestId?: number | string
  ): unknown {
    if (!this._redactPayload) return payload;
    try {
      return this._redactPayload(payload, {
        phase,
        transport: this.transportName,
        verb,
        url,
        attempt: 1,
        statusCode,
        requestId
      });
    } catch {
      return "[redaction_failed]";
    }
  }

  private resolveRetryConfig(
    retry: RetryOptions | undefined,
    verb: HttpVerb,
    url: string
  ): { maxAttempts: number; baseDelayMs: number; shouldRetry?: (error: TransportError) => boolean } | false {
    if (retry === false) return false;

    const source = retry ?? this.defaultRetry;
    if (source === undefined || source === false) return false;

    const policy = source === true ? {} : source;
    const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS));
    const rawDelay = policy.delayMs;
    const baseDelayMs = typeof rawDelay === "number"
      ? rawDelay
      : typeof rawDelay === "function"
        ? rawDelay({ attempt: 1, maxAttempts, error: new TransportRequestError("init"), transport: this.transportName, verb, url })
        : 100;

    const userShouldRetry = policy.shouldRetry;
    const transportName = this.transportName;
    const shouldRetry = userShouldRetry
      ? (error: TransportError) => {
          const publicError = toPublicError(error);
          return userShouldRetry({
            attempt: 1,
            maxAttempts,
            error: publicError,
            transport: transportName,
            verb,
            url,
            statusCode: publicError.statusCode,
            requestId: publicError.requestId
          });
        }
      : undefined;

    return { maxAttempts, baseDelayMs, ...(shouldRetry ? { shouldRetry } : {}) };
  }

  // ── Raw response transport (hooks + no decode) ──────────────────────

  private async sendRawResponse(
    verb: string,
    url: string,
    body: unknown,
    options?: RequestOptionsBase
  ): Promise<TransportResponse> {
    const startTime = Date.now();
    this.fireRequestHook(verb as HttpVerb, url, body);

    const effect = this.sendEffectRaw(verb, url, body, options).pipe(
      Effect.mapError(toPublicError)
    ) as Effect.Effect<TransportResponse, TransportRequestError, never>;

    try {
      const result = await this.runtime.runPromise(effect);
      this.fireResponseHook(verb as HttpVerb, url, body, {
        statusCode: result.statusCode,
        requestId: result.requestId,
        rawBody: result.body
      }, startTime);
      return result;
    } catch (error) {
      this.fireErrorHook(verb as HttpVerb, url, body, error, startTime);
      throw error;
    }
  }

  // ── Effect-level raw pipeline (no decode, with retry) ──────────────

  private sendEffectRaw(
    verb: string,
    url: string,
    body: unknown,
    options?: RequestOptionsBase
  ): Effect.Effect<TransportResponse, TransportError, Transport> {
    const retryConfig = this.resolveRetryConfig(options?.retry, verb as HttpVerb, url);
    const pipeline = sendRequest({ verb, url, body, timeoutMs: options?.timeoutMs });

    if (retryConfig === false) {
      return pipeline;
    }
    return withRetry(pipeline, retryConfig);
  }
}

// ── Types ──────────────────────────────────────────────────────────────

interface SendResult<T> {
  decoded: T;
  statusCode: number | undefined;
  requestId: number | string | undefined;
  rawBody: unknown;
}

// ── Helpers ────────────────────────────────────────────────────────────

const normalizeCallResponse = (response: ObjectCallResponse): ObjectCallResponse => {
  if (response.ReturnValue !== undefined) return response;

  const keys = Object.keys(response);
  if (keys.length !== 1) return response;

  const returnKey = keys[0];
  if (returnKey === undefined) return response;

  return { ...response, ReturnValue: (response as Record<string, unknown>)[returnKey] };
};
