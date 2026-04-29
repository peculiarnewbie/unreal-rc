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

export interface BuildCallArgs {
  readonly objectPath: string;
  readonly functionName: string;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly transaction?: boolean | undefined;
}

export interface BuildGetPropertyArgs {
  readonly objectPath: string;
  readonly propertyName: string;
  readonly access?: AccessMode | undefined;
}

export interface BuildSetPropertyArgs {
  readonly objectPath: string;
  readonly propertyName: string;
  readonly propertyValue: unknown;
  readonly access?: Exclude<AccessMode, "READ_ACCESS"> | undefined;
  readonly transaction?: boolean | undefined;
}

export interface BuildSearchAssetsArgs {
  readonly query: string;
  readonly classNames?: readonly string[] | undefined;
  readonly packagePaths?: readonly string[] | undefined;
  readonly recursivePaths?: boolean | undefined;
  readonly recursiveClasses?: boolean | undefined;
  readonly includeOnlyOnDiskAssets?: boolean | undefined;
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

export function buildCallRequest(args: BuildCallArgs): ObjectCallRequest {
  const { objectPath, functionName, parameters, transaction } = args;
  return Schema.encodeSync(ObjectCallRequestSchema)({
    objectPath,
    functionName,
    ...(parameters !== undefined ? { parameters } : {}),
    ...(transaction !== undefined ? { generateTransaction: true } : {})
  }) as ObjectCallRequest;
}

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

  call(args: BuildCallArgs): number {
    return this.add("PUT", "/remote/object/call", buildCallRequest(args));
  }

  getProperty(args: BuildGetPropertyArgs): number {
    const { objectPath, propertyName, access } = args;
    const acc = access ?? "READ_ACCESS";
    Schema.encodeSync(AccessModeSchema)(acc);
    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, { propertyName, access: acc })
    );
  }

  setProperty(args: BuildSetPropertyArgs): number {
    const { objectPath, propertyName, propertyValue, access, transaction } = args;
    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(objectPath, {
        propertyName,
        propertyValue,
        ...(access !== undefined ? { access } : {}),
        ...(transaction !== undefined ? { transaction } : {})
      })
    );
  }

  describe(objectPath: string): number {
    return this.add("PUT", "/remote/object/describe", buildDescribeRequest(objectPath));
  }

  searchAssets(args: BuildSearchAssetsArgs): number {
    const { query, ...rest } = args;
    const body = Schema.encodeSync(SearchAssetsRequestSchema)({
      query,
      ...rest
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
