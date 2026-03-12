import { z } from "zod";
import { parseReturnValue } from "./helpers.js";
import {
  isConnectableTransport,
  toTransportRequestError,
  TransportRequestError,
  type ConnectableTransport,
  type Transport,
  type TransportRequestErrorKind,
  type TransportRequestId,
  type TransportResponse
} from "./transport.js";
import { HttpTransport, type HttpTransportOptions } from "./transports/http.js";
import { WebSocketTransport, type WebSocketTransportOptions } from "./transports/ws.js";
import {
  AccessModeSchema,
  BatchRequestItemSchema,
  BatchRequestSchema,
  BatchResponseSchema,
  InfoResponseSchema,
  ObjectCallRequestSchema,
  ObjectCallResponseSchema,
  ObjectDescribeRequestSchema,
  ObjectDescribeResponseSchema,
  ObjectEventRequestSchema,
  ObjectEventResponseSchema,
  ObjectPropertyRequestSchema,
  ObjectPropertyResponseSchema,
  ObjectThumbnailRequestSchema,
  ObjectThumbnailResponseSchema,
  SearchAssetsRequestSchema,
  SearchAssetsResponseSchema,
  type AccessMode,
  type BatchRequest,
  type BatchRequestItem,
  type BatchResponse,
  type BatchResponseItem,
  type HttpVerb,
  type InfoResponse,
  type ObjectCallRequest,
  type ObjectCallResponse,
  type ObjectDescribeRequest,
  type ObjectDescribeResponse,
  type ObjectEventRequest,
  type ObjectEventResponse,
  type ObjectPropertyRequest,
  type ObjectPropertyResponse,
  type ObjectThumbnailResponse,
  type SearchAssetsRequest,
  type SearchAssetsResponse
} from "./types.js";

type WritableAccessMode = Exclude<AccessMode, "READ_ACCESS">;
type HookPhase = "request" | "response" | "error";
type RedactPayload = (payload: unknown, context: PayloadRedactionContext) => unknown;
type ResolvedRetryPolicy = {
  maxAttempts: number;
  delayMs: (context: RetryContext) => number;
  shouldRetry: (context: RetryContext) => boolean;
};

const DEFAULT_WS_PORT = 30020;
const DEFAULT_HTTP_PORT = 30010;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUS_CODES = new Set([502, 503, 504]);

export interface PayloadRedactionContext {
  phase: HookPhase;
  transport: string;
  verb: HttpVerb;
  url: string;
  attempt: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface RequestHookContext {
  transport: string;
  verb: HttpVerb;
  url: string;
  body?: unknown;
  attempt: number;
}

export interface ResponseHookContext extends RequestHookContext {
  requestBody?: unknown;
  durationMs: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

export interface ErrorHookContext extends RequestHookContext {
  error: TransportRequestError;
  errorBody?: unknown;
  durationMs: number;
  statusCode?: number | undefined;
  requestId?: TransportRequestId | undefined;
}

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

export interface UnrealRCOptions {
  transport?: "ws" | "http" | Transport;
  host?: string;
  port?: number;
  secure?: boolean;
  ws?: WebSocketTransportOptions;
  http?: HttpTransportOptions;
  validateResponses?: boolean;
  retry?: RetryOptions;
  onRequest?: (context: RequestHookContext) => void | Promise<void>;
  onResponse?: (context: ResponseHookContext) => void | Promise<void>;
  onError?: (context: ErrorHookContext) => void | Promise<void>;
  redactPayload?: RedactPayload;
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

export interface SetPropertyOptions extends RequestOptionsBase {
  access?: WritableAccessMode;
  transaction?: boolean;
}

export interface DescribeOptions extends RequestOptionsBase {}

export type SearchAssetsOptions = Omit<SearchAssetsRequest, "query"> & RequestOptionsBase;

export interface BatchOptions extends RequestOptionsBase {}

export interface EventOptions extends RequestOptionsBase {}

export interface ThumbnailOptions extends RequestOptionsBase {}

export interface BuildCallRequestOptions {
  transaction?: boolean | undefined;
}

export interface BuildPropertyRequestOptions {
  propertyName?: string;
  propertyValue?: unknown;
  access?: AccessMode | undefined;
  transaction?: boolean | undefined;
}

export interface BatchResult {
  requestId: number;
  statusCode: number;
  body: unknown;
  request: BatchRequestItem;
}

export const buildCallRequest = (
  objectPath: string,
  functionName: string,
  parameters?: Record<string, unknown>,
  options?: BuildCallRequestOptions
): ObjectCallRequest => {
  return ObjectCallRequestSchema.parse({
    objectPath,
    functionName,
    ...(parameters ? { parameters } : {}),
    ...(options?.transaction ? { generateTransaction: true } : {})
  });
};

export const buildPropertyRequest = (
  objectPath: string,
  options: BuildPropertyRequestOptions = {}
): ObjectPropertyRequest => {
  const hasPropertyValue = "propertyValue" in options && options.propertyValue !== undefined;
  const access =
    options.access ??
    (hasPropertyValue || options.transaction
      ? options.transaction
        ? "WRITE_TRANSACTION_ACCESS"
        : "WRITE_ACCESS"
      : "READ_ACCESS");

  return ObjectPropertyRequestSchema.parse({
    objectPath,
    ...(options.propertyName !== undefined ? { propertyName: options.propertyName } : {}),
    ...(hasPropertyValue
      ? {
          propertyValue: normalizePropertyValue(options.propertyName, options.propertyValue)
        }
      : {}),
    access
  });
};

export const buildDescribeRequest = (objectPath: string): ObjectDescribeRequest => {
  return ObjectDescribeRequestSchema.parse({ objectPath });
};

export const buildBatchRequest = (
  requests: readonly BatchRequestItem[] | BatchBuilder
): BatchRequest => {
  const items = requests instanceof BatchBuilder ? requests.getRequests() : [...requests];
  return BatchRequestSchema.parse({ Requests: items });
};

export class BatchBuilder {
  private readonly requests: BatchRequestItem[] = [];

  call(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>,
    options?: BuildCallRequestOptions
  ): number {
    return this.add("PUT", "/remote/object/call", buildCallRequest(objectPath, functionName, parameters, options));
  }

  getProperty(objectPath: string, propertyName: string, access: AccessMode = "READ_ACCESS"): number {
    AccessModeSchema.parse(access);
    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        propertyName,
        access
      })
    );
  }

  setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: { access?: WritableAccessMode; transaction?: boolean }
  ): number {
    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        propertyName,
        propertyValue,
        ...(options?.access !== undefined ? { access: options.access } : {}),
        ...(options?.transaction !== undefined ? { transaction: options.transaction } : {})
      })
    );
  }

  describe(objectPath: string): number {
    return this.add("PUT", "/remote/object/describe", buildDescribeRequest(objectPath));
  }

  searchAssets(query: string, options?: Omit<SearchAssetsRequest, "query">): number {
    const body = SearchAssetsRequestSchema.parse({
      query,
      ...(options ?? {})
    });
    return this.add("PUT", "/remote/search/assets", body);
  }

  request(verb: HttpVerb, url: string, body?: unknown): number {
    return this.add(verb, url, body);
  }

  toRequestBody(): BatchRequest {
    return buildBatchRequest(this.requests);
  }

  getRequests(): BatchRequestItem[] {
    return [...this.requests];
  }

  private add(verb: HttpVerb, url: string, body?: unknown): number {
    const requestId = this.requests.length;
    const entry = BatchRequestItemSchema.parse({
      RequestId: requestId,
      URL: url,
      Verb: verb,
      ...(body !== undefined ? { Body: body } : {})
    });
    this.requests.push(entry);
    return requestId;
  }
}

export class UnrealRC {
  private readonly transport: Transport;
  private readonly validateResponses: boolean;
  private readonly defaultRetry: RetryOptions | undefined;
  private readonly onRequestHook: UnrealRCOptions["onRequest"] | undefined;
  private readonly onResponseHook: UnrealRCOptions["onResponse"] | undefined;
  private readonly onErrorHook: UnrealRCOptions["onError"] | undefined;
  private readonly redactPayloadHook: RedactPayload | undefined;

  constructor(options: UnrealRCOptions = {}) {
    this.transport = this.createTransport(options);
    this.validateResponses = options.validateResponses ?? true;
    this.defaultRetry = options.retry;
    this.onRequestHook = options.onRequest;
    this.onResponseHook = options.onResponse;
    this.onErrorHook = options.onError;
    this.redactPayloadHook = options.redactPayload;
  }

  get connected(): boolean {
    if (isConnectableTransport(this.transport)) {
      return this.transport.connected;
    }
    return true;
  }

  async connect(): Promise<void> {
    if (isConnectableTransport(this.transport)) {
      await this.transport.connect();
    }
  }

  async call(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>,
    options?: CallOptions
  ): Promise<ObjectCallResponse> {
    return this.send(
      "PUT",
      "/remote/object/call",
      buildCallRequest(objectPath, functionName, parameters, options),
      ObjectCallResponseSchema,
      options
    );
  }

  async getProperty<T = unknown>(
    objectPath: string,
    propertyName: string,
    options?: GetPropertyOptions
  ): Promise<T | undefined> {
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        propertyName,
        access: options?.access ?? "READ_ACCESS"
      }),
      ObjectPropertyResponseSchema,
      options
    );

    return parseReturnValue<T>(response, propertyName) ?? parseReturnValue<T>(response);
  }

  async getProperties<T = Record<string, unknown>>(
    objectPath: string,
    options?: GetPropertyOptions
  ): Promise<T> {
    const response = await this.send(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        access: options?.access ?? "READ_ACCESS"
      }),
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
    return this.send(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        propertyName,
        propertyValue,
        ...(options?.access !== undefined ? { access: options.access } : {}),
        ...(options?.transaction !== undefined ? { transaction: options.transaction } : {})
      }),
      ObjectPropertyResponseSchema,
      options
    );
  }

  async describe(objectPath: string, options?: DescribeOptions): Promise<ObjectDescribeResponse> {
    return this.send(
      "PUT",
      "/remote/object/describe",
      buildDescribeRequest(objectPath),
      ObjectDescribeResponseSchema,
      options
    );
  }

  async searchAssets(query: string, options?: SearchAssetsOptions): Promise<SearchAssetsResponse> {
    const { timeoutMs, retry, ...searchOptions } = options ?? {};
    const body = SearchAssetsRequestSchema.parse({
      query,
      ...searchOptions
    });

    return this.send(
      "PUT",
      "/remote/search/assets",
      body,
      SearchAssetsResponseSchema,
      {
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(retry !== undefined ? { retry } : {})
      }
    );
  }

  async info(options?: RequestOptionsBase): Promise<InfoResponse> {
    return this.send("GET", "/remote/info", undefined, InfoResponseSchema, options);
  }

  async event(request: ObjectEventRequest, options?: EventOptions): Promise<ObjectEventResponse> {
    return this.send(
      "PUT",
      "/remote/object/event",
      ObjectEventRequestSchema.parse(request),
      ObjectEventResponseSchema,
      options
    );
  }

  async thumbnail(objectPath: string, options?: ThumbnailOptions): Promise<ObjectThumbnailResponse> {
    return this.send(
      "PUT",
      "/remote/object/thumbnail",
      ObjectThumbnailRequestSchema.parse({ objectPath }),
      ObjectThumbnailResponseSchema,
      options
    );
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

  dispose(): void {
    this.transport.dispose();
  }

  private createTransport(options: UnrealRCOptions): Transport {
    if (typeof options.transport === "object" && options.transport) {
      return options.transport;
    }

    const transportType = options.transport ?? "ws";

    if (transportType === "http") {
      const httpOptions: HttpTransportOptions = {
        ...options.http,
        ...(options.host !== undefined ? { host: options.host } : {}),
        ...(options.port !== undefined
          ? { port: options.port }
          : { port: options.http?.port ?? DEFAULT_HTTP_PORT }),
        ...(options.secure !== undefined ? { secure: options.secure } : {})
      };

      return new HttpTransport(httpOptions);
    }

    const wsOptions: WebSocketTransportOptions = {
      ...options.ws,
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.port !== undefined
        ? { port: options.port }
        : { port: options.ws?.port ?? DEFAULT_WS_PORT }),
      ...(options.secure !== undefined ? { secure: options.secure } : {})
    };

    return new WebSocketTransport(wsOptions);
  }

  private async ensureConnected(): Promise<void> {
    if (isConnectableTransport(this.transport) && !this.transport.connected) {
      await this.transport.connect();
    }
  }

  private async send<T>(
    verb: HttpVerb,
    url: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    options?: RequestOptionsBase
  ): Promise<T> {
    const transport = resolveTransportName(this.transport);
    const retryPolicy = this.resolveRetryPolicy(options?.retry);
    let attempt = 1;

    while (true) {
      const startedAt = performance.now();
      const requestBody = this.redactPayload(body, {
        phase: "request",
        transport,
        verb,
        url,
        attempt
      });

      await this.invokeHook(this.onRequestHook, {
        transport,
        verb,
        url,
        body: requestBody,
        attempt
      });

      try {
        await this.ensureConnected();

        const response = await this.transport.request(
          verb,
          url,
          body,
          options?.timeoutMs === undefined ? undefined : { timeoutMs: options.timeoutMs }
        );

        const parsed = this.parseResponse(responseSchema, response, {
          transport,
          verb,
          url
        });
        const durationMs = elapsedMs(startedAt);

        await this.invokeHook(this.onResponseHook, {
          transport,
          verb,
          url,
          body: this.redactPayload(response.body, {
            phase: "response",
            transport,
            verb,
            url,
            attempt,
            statusCode: response.statusCode,
            requestId: response.requestId
          }),
          requestBody,
          durationMs,
          statusCode: response.statusCode,
          requestId: response.requestId,
          attempt
        });

        return parsed;
      } catch (error) {
        const durationMs = elapsedMs(startedAt);
        const normalized = toTransportRequestError(error, {
          kind: "unknown",
          transport,
          verb,
          url
        });

        await this.invokeHook(this.onErrorHook, {
          transport,
          verb,
          url,
          body: requestBody,
          errorBody: this.redactPayload(normalized.details, {
            phase: "error",
            transport,
            verb,
            url,
            attempt,
            statusCode: normalized.statusCode,
            requestId: normalized.requestId
          }),
          durationMs,
          statusCode: normalized.statusCode,
          requestId: normalized.requestId,
          error: normalized,
          attempt
        });

        if (!retryPolicy) {
          throw normalized;
        }

        const retryContext: RetryContext = {
          attempt,
          maxAttempts: retryPolicy.maxAttempts,
          error: normalized,
          transport,
          verb,
          url,
          body: requestBody,
          statusCode: normalized.statusCode,
          requestId: normalized.requestId
        };

        if (attempt >= retryPolicy.maxAttempts || !retryPolicy.shouldRetry(retryContext)) {
          throw normalized;
        }

        const delayMs = Math.max(0, retryPolicy.delayMs(retryContext));
        if (delayMs > 0) {
          await sleep(delayMs);
        }

        attempt += 1;
      }
    }
  }

  private parseResponse<T>(
    responseSchema: z.ZodType<T>,
    response: TransportResponse,
    request: { transport: string; verb: HttpVerb; url: string }
  ): T {
    if (!this.validateResponses) {
      return response.body as T;
    }

    try {
      return responseSchema.parse(response.body);
    } catch (error) {
      throw new TransportRequestError("Failed to decode response payload", {
        cause: error,
        kind: "decode",
        transport: request.transport,
        verb: request.verb,
        url: request.url,
        statusCode: response.statusCode,
        requestId: response.requestId,
        details: response.body
      });
    }
  }

  private resolveRetryPolicy(retry: RetryOptions | undefined): ResolvedRetryPolicy | undefined {
    if (retry === false) {
      return undefined;
    }

    const source = retry ?? this.defaultRetry;
    if (source === undefined || source === false) {
      return undefined;
    }

    const policy = source === true ? {} : source;
    const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS));
    const delayMs =
      typeof policy.delayMs === "function"
        ? policy.delayMs
        : (context: RetryContext): number =>
            typeof policy.delayMs === "number"
              ? policy.delayMs
              : defaultRetryDelayMs(context.attempt);

    return {
      maxAttempts,
      delayMs,
      shouldRetry: policy.shouldRetry ?? defaultShouldRetry
    };
  }

  private redactPayload(payload: unknown, context: PayloadRedactionContext): unknown {
    if (payload === undefined || !this.redactPayloadHook) {
      return payload;
    }

    try {
      return this.redactPayloadHook(payload, context);
    } catch {
      return "[redaction_failed]";
    }
  }

  private async invokeHook<T>(hook: ((context: T) => void | Promise<void>) | undefined, context: T): Promise<void> {
    if (!hook) {
      return;
    }

    try {
      await hook(context);
    } catch {
      // Logging hooks are best-effort and must not affect request flow.
    }
  }
}

const correlateBatchResponses = (requests: BatchRequestItem[], response: BatchResponse): BatchResult[] => {
  const byRequestId = new Map<number, BatchResponseItem>();

  for (const item of response.Responses ?? []) {
    byRequestId.set(item.RequestId, item);
  }

  return requests.map((request) => {
    const matched = byRequestId.get(request.RequestId);
    return {
      requestId: request.RequestId,
      statusCode: matched?.ResponseCode ?? 0,
      body: matched?.ResponseBody,
      request
    };
  });
};

const resolveTransportName = (transport: Transport): string => {
  return transport.transport ?? "custom";
};

const normalizePropertyValue = (propertyName: string | undefined, propertyValue: unknown): unknown => {
  if (propertyName === undefined) {
    return propertyValue;
  }

  if (isSinglePropertyValueMap(propertyValue, propertyName)) {
    return propertyValue;
  }

  return {
    [propertyName]: propertyValue
  };
};

const isSinglePropertyValueMap = (value: unknown, propertyName: string): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === propertyName;
};

const defaultRetryDelayMs = (attempt: number): number => {
  return Math.min(100 * 2 ** Math.max(0, attempt - 1), 1_000);
};

const defaultShouldRetry = (context: RetryContext): boolean => {
  if (context.error.kind === "timeout") {
    return true;
  }

  if (context.error.kind === "connect" || context.error.kind === "disconnect") {
    return true;
  }

  return (
    context.error.kind === "http_status" &&
    context.statusCode !== undefined &&
    RETRYABLE_HTTP_STATUS_CODES.has(context.statusCode)
  );
};

const elapsedMs = (startedAt: number): number => {
  return Math.max(0, Math.round(performance.now() - startedAt));
};

const sleep = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};
