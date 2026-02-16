import { z } from "zod";
import { parseReturnValue } from "./helpers.js";
import {
  isConnectableTransport,
  type ConnectableTransport,
  type Transport
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
  type BatchRequestItem,
  type BatchResponseItem,
  type BatchResponse,
  type HttpVerb,
  type InfoResponse,
  type ObjectCallResponse,
  type ObjectDescribeResponse,
  type ObjectEventRequest,
  type ObjectEventResponse,
  type ObjectPropertyResponse,
  type ObjectThumbnailResponse,
  type SearchAssetsRequest,
  type SearchAssetsResponse
} from "./types.js";

type WritableAccessMode = Exclude<AccessMode, "READ_ACCESS">;

export interface UnrealRCOptions {
  transport?: "ws" | "http" | Transport;
  host?: string;
  port?: number;
  secure?: boolean;
  ws?: WebSocketTransportOptions;
  http?: HttpTransportOptions;
  validateResponses?: boolean;
}

export interface CallOptions {
  transaction?: boolean;
  timeoutMs?: number;
}

export interface GetPropertyOptions {
  access?: AccessMode;
  timeoutMs?: number;
}

export interface SetPropertyOptions {
  access?: WritableAccessMode;
  transaction?: boolean;
  timeoutMs?: number;
}

export interface DescribeOptions {
  timeoutMs?: number;
}

export type SearchAssetsOptions = Omit<SearchAssetsRequest, "query"> & {
  timeoutMs?: number;
};

export interface BatchOptions {
  timeoutMs?: number;
}

export interface EventOptions {
  timeoutMs?: number;
}

export interface ThumbnailOptions {
  timeoutMs?: number;
}

export interface BatchResult {
  requestId: number;
  statusCode: number;
  body: unknown;
  request: BatchRequestItem;
}

export class BatchBuilder {
  private readonly requests: BatchRequestItem[] = [];

  call(
    objectPath: string,
    functionName: string,
    parameters?: Record<string, unknown>,
    options?: { transaction?: boolean }
  ): number {
    const body = ObjectCallRequestSchema.parse({
      objectPath,
      functionName,
      ...(parameters ? { parameters } : {}),
      ...(options?.transaction ? { generateTransaction: true } : {})
    });

    return this.add("PUT", "/remote/object/call", body);
  }

  getProperty(objectPath: string, propertyName: string, access: AccessMode = "READ_ACCESS"): number {
    AccessModeSchema.parse(access);

    const body = ObjectPropertyRequestSchema.parse({
      objectPath,
      propertyName,
      access
    });

    return this.add("PUT", "/remote/object/property", body);
  }

  setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: { access?: WritableAccessMode; transaction?: boolean }
  ): number {
    const access = options?.access ?? (options?.transaction ? "WRITE_TRANSACTION_ACCESS" : "WRITE_ACCESS");

    const body = ObjectPropertyRequestSchema.parse({
      objectPath,
      propertyName,
      propertyValue,
      access
    });

    return this.add("PUT", "/remote/object/property", body);
  }

  describe(objectPath: string): number {
    const body = ObjectDescribeRequestSchema.parse({ objectPath });
    return this.add("PUT", "/remote/object/describe", body);
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

  toRequestBody(): z.infer<typeof BatchRequestSchema> {
    return BatchRequestSchema.parse({ Requests: this.requests });
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

const DEFAULT_WS_PORT = 30020;
const DEFAULT_HTTP_PORT = 30010;

export class UnrealRC {
  private readonly transport: Transport;
  private readonly validateResponses: boolean;

  constructor(options: UnrealRCOptions = {}) {
    this.transport = this.createTransport(options);
    this.validateResponses = options.validateResponses ?? true;
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
    const body = ObjectCallRequestSchema.parse({
      objectPath,
      functionName,
      ...(parameters ? { parameters } : {}),
      ...(options?.transaction ? { generateTransaction: true } : {})
    });

    return this.send("PUT", "/remote/object/call", body, ObjectCallResponseSchema, options?.timeoutMs);
  }

  async getProperty<T = unknown>(
    objectPath: string,
    propertyName: string,
    options?: GetPropertyOptions
  ): Promise<T | undefined> {
    const body = ObjectPropertyRequestSchema.parse({
      objectPath,
      propertyName,
      access: options?.access ?? "READ_ACCESS"
    });

    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options?.timeoutMs
    );

    return parseReturnValue<T>(response, propertyName) ?? parseReturnValue<T>(response);
  }

  async getProperties<T = Record<string, unknown>>(
    objectPath: string,
    options?: GetPropertyOptions
  ): Promise<T> {
    const body = ObjectPropertyRequestSchema.parse({
      objectPath,
      access: options?.access ?? "READ_ACCESS"
    });

    const response = await this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options?.timeoutMs
    );

    return (parseReturnValue<T>(response) ?? (response as T));
  }

  async setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: SetPropertyOptions
  ): Promise<ObjectPropertyResponse> {
    const access = options?.access ?? (options?.transaction ? "WRITE_TRANSACTION_ACCESS" : "WRITE_ACCESS");

    const body = ObjectPropertyRequestSchema.parse({
      objectPath,
      propertyName,
      propertyValue,
      access
    });

    return this.send(
      "PUT",
      "/remote/object/property",
      body,
      ObjectPropertyResponseSchema,
      options?.timeoutMs
    );
  }

  async describe(objectPath: string, options?: DescribeOptions): Promise<ObjectDescribeResponse> {
    const body = ObjectDescribeRequestSchema.parse({ objectPath });
    return this.send(
      "PUT",
      "/remote/object/describe",
      body,
      ObjectDescribeResponseSchema,
      options?.timeoutMs
    );
  }

  async searchAssets(query: string, options?: SearchAssetsOptions): Promise<SearchAssetsResponse> {
    const { timeoutMs, ...searchOptions } = options ?? {};

    const body = SearchAssetsRequestSchema.parse({
      query,
      ...searchOptions
    });
    return this.send(
      "PUT",
      "/remote/search/assets",
      body,
      SearchAssetsResponseSchema,
      timeoutMs
    );
  }

  async info(options?: { timeoutMs?: number }): Promise<InfoResponse> {
    return this.send("GET", "/remote/info", undefined, InfoResponseSchema, options?.timeoutMs);
  }

  async event(request: ObjectEventRequest, options?: EventOptions): Promise<ObjectEventResponse> {
    const body = ObjectEventRequestSchema.parse(request);
    return this.send(
      "PUT",
      "/remote/object/event",
      body,
      ObjectEventResponseSchema,
      options?.timeoutMs
    );
  }

  async thumbnail(objectPath: string, options?: ThumbnailOptions): Promise<ObjectThumbnailResponse> {
    const body = ObjectThumbnailRequestSchema.parse({ objectPath });
    return this.send(
      "PUT",
      "/remote/object/thumbnail",
      body,
      ObjectThumbnailResponseSchema,
      options?.timeoutMs
    );
  }

  async batch(
    configure: (builder: BatchBuilder) => void | Promise<void>,
    options?: BatchOptions
  ): Promise<BatchResult[]> {
    const builder = new BatchBuilder();
    await configure(builder);

    const requestBody = builder.toRequestBody();
    const requests = builder.getRequests();

    const response = await this.send(
      "PUT",
      "/remote/batch",
      requestBody,
      BatchResponseSchema,
      options?.timeoutMs
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
      await (this.transport as ConnectableTransport).connect();
    }
  }

  private async send<T>(
    verb: HttpVerb,
    url: string,
    body: unknown,
    responseSchema: z.ZodType<T>,
    timeoutMs?: number
  ): Promise<T> {
    await this.ensureConnected();
    const requestOptions = timeoutMs === undefined ? undefined : { timeoutMs };
    const raw = await this.transport.request(verb, url, body, requestOptions);

    if (!this.validateResponses) {
      return raw as T;
    }

    return responseSchema.parse(raw);
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
