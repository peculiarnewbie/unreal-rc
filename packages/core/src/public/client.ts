import { Effect, Schema } from "effect";
import type { TransportError } from "../internal/errors.js";
import { DecodeError } from "../internal/errors.js";
import { makeRuntime, sendRequest, type FullLayer, type RuntimeConfig } from "../internal/runtime.js";
import { withRetry } from "../internal/retry.js";
import {
  BatchBuilder,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest,
  buildBatchRequest,
  correlateBatchResponses,
  type BatchResult,
  type BuildCallRequestOptions,
  type BuildPropertyRequestOptions
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
import { toPublicError, TransportRequestError } from "./errors.js";
import { parseReturnValue } from "./helpers.js";
import type {
  AccessMode,
  HttpVerb,
  ObjectCallResponse,
  ObjectDescribeResponse,
  ObjectEventRequest,
  ObjectEventResponse,
  ObjectPropertyResponse,
  ObjectThumbnailResponse,
  SearchAssetsRequest,
  SearchAssetsResponse,
  InfoResponse,
  TransportRequestId
} from "./types.js";
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

export interface UnrealRCOptions extends Omit<RuntimeConfig, "onRequest" | "onResponse" | "onError" | "redactPayload"> {
  validateResponses?: boolean;
  retry?: RetryOptions;
  onRequest?: RuntimeConfig["onRequest"];
  onResponse?: RuntimeConfig["onResponse"];
  onError?: RuntimeConfig["onError"];
  redactPayload?: RuntimeConfig["redactPayload"];
}

interface RequestOptionsBase {
  timeoutMs?: number | undefined;
  retry?: RetryOptions | undefined;
}

export interface CallOptions extends RequestOptionsBase {
  transaction?: boolean;
}

export interface GetPropertyOptions extends RequestOptionsBase {
  access?: AccessMode;
}

type WritableAccessMode = Exclude<AccessMode, "READ_ACCESS">;

export interface SetPropertyOptions extends RequestOptionsBase {
  access?: WritableAccessMode;
  transaction?: boolean;
}

export interface DescribeOptions extends RequestOptionsBase {}

export type SearchAssetsOptions = Omit<SearchAssetsRequest, "query"> & RequestOptionsBase;

export interface BatchOptions extends RequestOptionsBase {}

export interface EventOptions extends RequestOptionsBase {}

export interface ThumbnailOptions extends RequestOptionsBase {}

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
    this.runtime = makeRuntime(options);
    this.validateResponses = options.validateResponses ?? true;
    this.defaultRetry = options.retry;
    this.transportName = options.transport ?? "ws";
    this._onRequest = options.onRequest;
    this._onResponse = options.onResponse;
    this._onError = options.onError;
    this._redactPayload = options.redactPayload;
  }

  async call(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>,
    options?: CallOptions
  ): Promise<ObjectCallResponse> {
    const body = buildCallRequest(objectPath, functionName, parameters, options);
    const response = await this.send("PUT", "/remote/object/call", body, ObjectCallResponseSchema, options);
    return normalizeCallResponse(response);
  }

  async getProperty<T = unknown>(
    objectPath: string,
    propertyName: string,
    options?: GetPropertyOptions
  ): Promise<T | undefined> {
    const body = buildPropertyRequest(objectPath, {
      propertyName,
      access: options?.access ?? "READ_ACCESS"
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options
    );
    return parseReturnValue<T>(response, propertyName) ?? parseReturnValue<T>(response);
  }

  async getProperties<T = Record<string, unknown>>(
    objectPath: string,
    options?: GetPropertyOptions
  ): Promise<T> {
    const body = buildPropertyRequest(objectPath, {
      access: options?.access ?? "READ_ACCESS"
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options
    );
    return parseReturnValue<T>(response) ?? (response as T);
  }

  async setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: SetPropertyOptions
  ): Promise<ObjectPropertyResponse> {
    const body = buildPropertyRequest(objectPath, {
      propertyName,
      propertyValue,
      ...(options?.access !== undefined ? { access: options.access } : {}),
      ...(options?.transaction !== undefined ? { transaction: options.transaction } : {})
    });
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options
    );
    return response ?? ({} as ObjectPropertyResponse);
  }

  async describe(objectPath: string, options?: DescribeOptions): Promise<ObjectDescribeResponse> {
    return this.send("PUT", "/remote/object/describe", buildDescribeRequest(objectPath), ObjectDescribeResponseSchema, options);
  }

  async searchAssets(query: string, options?: SearchAssetsOptions): Promise<SearchAssetsResponse> {
    const { timeoutMs, retry, ...searchOptions } = options ?? {};
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

  async thumbnail(objectPath: string, options?: ThumbnailOptions): Promise<ObjectThumbnailResponse> {
    const body = Schema.encodeSync(ObjectThumbnailRequestSchema)({ objectPath });
    return this.send("PUT", "/remote/object/thumbnail", body, ObjectThumbnailResponseSchema, options);
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

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async send<T>(
    verb: string,
    url: string,
    body: unknown,
    responseSchema: Schema.Schema<T>,
    options?: RequestOptionsBase
  ): Promise<T> {
    const retryConfig = this.resolveRetryConfig(options?.retry);
    const validateResponses = this.validateResponses;
    const startTime = Date.now();

    // Fire request hook
    this.fireRequestHook(verb as HttpVerb, url, body);

    type SendResult = { decoded: T; statusCode?: number; requestId?: number | string; rawBody: unknown };

    const effect = sendRequest({
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
          } as SendResult);
        }
        const decodeInput = response.body ?? {};
        return Schema.decodeUnknownEffect(responseSchema)(
          decodeInput,
          { onExcessProperty: "preserve" }
        ).pipe(
          Effect.map(
            (decoded) =>
              ({
                decoded,
                statusCode: response.statusCode,
                requestId: response.requestId,
                rawBody: response.body
              }) as SendResult
          ),
          Effect.mapError(
            (parseError) =>
              new DecodeError({
                message: "Failed to decode response payload",
                verb,
                url,
                details: response.body,
                cause: parseError
              }) as TransportError
          )
        );
      }),
      (e) => (retryConfig === false ? e : withRetry(e, retryConfig)),
      Effect.mapError(toPublicError)
    );

    try {
      const result = await this.runtime.runPromise(
        effect as Effect.Effect<SendResult, TransportRequestError>
      );
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
      this._onRequest({
        transport: this.transportName,
        verb,
        url,
        body: redactedBody,
        attempt: 1
      });
    } catch { /* ignore hook errors */ }
  }

  private fireResponseHook(
    verb: HttpVerb,
    url: string,
    requestBody: unknown,
    result: { statusCode?: number; requestId?: number | string; rawBody: unknown },
    startTime: number
  ): void {
    if (!this._onResponse) return;
    const durationMs = Date.now() - startTime;
    try {
      this._onResponse({
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
      this._onError({
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
    retry: RetryOptions | undefined
  ): { maxAttempts: number; baseDelayMs: number; shouldRetry?: (error: TransportError) => boolean } | false {
    if (retry === false) return false;

    const source = retry ?? this.defaultRetry;
    if (source === undefined || source === false) return false;

    const policy = source === true ? {} : source;
    const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS));
    const baseDelayMs = typeof policy.delayMs === "number" ? policy.delayMs : 100;

    return { maxAttempts, baseDelayMs };
  }
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
