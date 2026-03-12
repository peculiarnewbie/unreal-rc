import { Schema } from "effect";
import {
  AccessModeSchema,
  BatchRequestItemSchema,
  BatchRequestSchema,
  ObjectCallRequestSchema,
  ObjectDescribeRequestSchema,
  ObjectPropertyRequestSchema,
  SearchAssetsRequestSchema
} from "./schemas.js";
import type {
  AccessMode,
  BatchRequest,
  BatchRequestItem,
  BatchResponse,
  BatchResponseItem,
  HttpVerb,
  ObjectCallRequest,
  ObjectDescribeRequest,
  ObjectPropertyRequest,
  SearchAssetsRequest
} from "../public/types.js";

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
  return Schema.encodeSync(ObjectCallRequestSchema)({
    objectPath,
    functionName,
    ...(parameters ? { parameters } : {}),
    ...(options?.transaction ? { generateTransaction: true } : {})
  }) as ObjectCallRequest;
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

  return Schema.encodeSync(ObjectPropertyRequestSchema)({
    objectPath,
    ...(options.propertyName !== undefined ? { propertyName: options.propertyName } : {}),
    ...(hasPropertyValue
      ? { propertyValue: normalizePropertyValue(options.propertyName, options.propertyValue) }
      : {}),
    access
  }) as ObjectPropertyRequest;
};

export const buildDescribeRequest = (objectPath: string): ObjectDescribeRequest => {
  return Schema.encodeSync(ObjectDescribeRequestSchema)({ objectPath }) as ObjectDescribeRequest;
};

export const buildBatchRequest = (
  requests: readonly BatchRequestItem[] | BatchBuilder
): BatchRequest => {
  const items = requests instanceof BatchBuilder ? requests.getRequests() : [...requests];
  return Schema.encodeSync(BatchRequestSchema)({ Requests: items }) as BatchRequest;
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
    Schema.encodeSync(AccessModeSchema)(access);
    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, { propertyName, access })
    );
  }

  setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: { access?: Exclude<AccessMode, "READ_ACCESS">; transaction?: boolean }
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
    const body = Schema.encodeSync(SearchAssetsRequestSchema)({
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
    const entry = Schema.encodeSync(BatchRequestItemSchema)({
      RequestId: requestId,
      URL: url,
      Verb: verb,
      ...(body !== undefined ? { Body: body } : {})
    }) as BatchRequestItem;
    this.requests.push(entry);
    return requestId;
  }
}

export const correlateBatchResponses = (
  requests: BatchRequestItem[],
  response: BatchResponse
): BatchResult[] => {
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

const normalizePropertyValue = (propertyName: string | undefined, propertyValue: unknown): unknown => {
  if (propertyName === undefined) {
    return propertyValue;
  }

  if (isSinglePropertyValueMap(propertyValue, propertyName)) {
    return propertyValue;
  }

  return { [propertyName]: propertyValue };
};

const isSinglePropertyValueMap = (value: unknown, propertyName: string): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === propertyName;
};
