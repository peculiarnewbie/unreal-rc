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

export function buildCallRequest(
  objectPath: string,
  functionName: string,
  parameters?: Record<string, unknown>,
  options?: BuildCallRequestOptions
): ObjectCallRequest;
export function buildCallRequest(args: BuildCallArgs): ObjectCallRequest;
export function buildCallRequest(
  objectPathOrArgs: string | BuildCallArgs,
  functionName?: string,
  parameters?: Record<string, unknown>,
  options?: BuildCallRequestOptions
): ObjectCallRequest {
  let op: string;
  let fn: string;
  let params: Record<string, unknown> | undefined;
  let opts: BuildCallRequestOptions | undefined;

  if (typeof objectPathOrArgs === "string") {
    op = objectPathOrArgs;
    fn = functionName!;
    params = parameters;
    opts = options;
  } else {
    op = objectPathOrArgs.objectPath;
    fn = objectPathOrArgs.functionName;
    params = objectPathOrArgs.parameters;
    opts = objectPathOrArgs.transaction !== undefined ? { transaction: objectPathOrArgs.transaction } : undefined;
  }

  return Schema.encodeSync(ObjectCallRequestSchema)({
    objectPath: op,
    functionName: fn,
    ...(params ? { parameters: params } : {}),
    ...(opts?.transaction ? { generateTransaction: true } : {})
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

  call(objectPath: string, functionName: string, parameters?: Record<string, unknown>, options?: BuildCallRequestOptions): number;
  call(args: BuildCallArgs): number;
  call(
    objectPathOrArgs: string | BuildCallArgs,
    functionName?: string,
    parameters?: Record<string, unknown>,
    options?: BuildCallRequestOptions
  ): number {
    let op: string;
    let fn: string;
    let params: Record<string, unknown> | undefined;
    let opts: BuildCallRequestOptions | undefined;

    if (typeof objectPathOrArgs === "string") {
      op = objectPathOrArgs;
      fn = functionName!;
      params = parameters;
      opts = options;
    } else {
      op = objectPathOrArgs.objectPath;
      fn = objectPathOrArgs.functionName;
      params = objectPathOrArgs.parameters;
      opts = objectPathOrArgs.transaction !== undefined ? { transaction: objectPathOrArgs.transaction } : undefined;
    }

    return this.add("PUT", "/remote/object/call", buildCallRequest(op, fn, params, opts));
  }

  getProperty(objectPath: string, propertyName: string, access?: AccessMode): number;
  getProperty(args: BuildGetPropertyArgs): number;
  getProperty(
    objectPathOrArgs: string | BuildGetPropertyArgs,
    propertyName?: string,
    access: AccessMode = "READ_ACCESS"
  ): number {
    let op: string;
    let pn: string;
    let acc: AccessMode;

    if (typeof objectPathOrArgs === "string") {
      op = objectPathOrArgs;
      pn = propertyName!;
      acc = access;
      Schema.encodeSync(AccessModeSchema)(acc);
    } else {
      op = objectPathOrArgs.objectPath;
      pn = objectPathOrArgs.propertyName;
      acc = objectPathOrArgs.access ?? "READ_ACCESS";
    }

    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(op, { propertyName: pn, access: acc })
    );
  }

  setProperty(
    objectPath: string,
    propertyName: string,
    propertyValue: unknown,
    options?: { access?: Exclude<AccessMode, "READ_ACCESS">; transaction?: boolean }
  ): number;
  setProperty(args: BuildSetPropertyArgs): number;
  setProperty(
    objectPathOrArgs: string | BuildSetPropertyArgs,
    propertyName?: string,
    propertyValue?: unknown,
    options?: { access?: Exclude<AccessMode, "READ_ACCESS">; transaction?: boolean }
  ): number {
    let op: string;
    let pn: string;
    let pv: unknown;
    let opts: { access?: Exclude<AccessMode, "READ_ACCESS">; transaction?: boolean } | undefined;

    if (typeof objectPathOrArgs === "string") {
      op = objectPathOrArgs;
      pn = propertyName!;
      pv = propertyValue;
      opts = options;
    } else {
      op = objectPathOrArgs.objectPath;
      pn = objectPathOrArgs.propertyName;
      pv = objectPathOrArgs.propertyValue;
      opts = {
        ...(objectPathOrArgs.access !== undefined ? { access: objectPathOrArgs.access } : {}),
        ...(objectPathOrArgs.transaction !== undefined ? { transaction: objectPathOrArgs.transaction } : {})
      };
    }

    return this.add(
      "PUT",
      "/remote/object/property",
      buildPropertyRequest(op, {
        propertyName: pn,
        propertyValue: pv,
        ...(opts?.access !== undefined ? { access: opts.access } : {}),
        ...(opts?.transaction !== undefined ? { transaction: opts.transaction } : {})
      })
    );
  }

  describe(objectPath: string): number {
    return this.add("PUT", "/remote/object/describe", buildDescribeRequest(objectPath));
  }

  searchAssets(query: string, options?: Omit<SearchAssetsRequest, "query">): number;
  searchAssets(args: BuildSearchAssetsArgs): number;
  searchAssets(
    queryOrArgs: string | BuildSearchAssetsArgs,
    options?: Omit<SearchAssetsRequest, "query">
  ): number {
    let q: string;
    let opts: Omit<SearchAssetsRequest, "query"> | undefined;

    if (typeof queryOrArgs === "string") {
      q = queryOrArgs;
      opts = options;
    } else {
      q = queryOrArgs.query;
      const { query: _q, ...rest } = queryOrArgs;
      opts = rest;
    }

    const body = Schema.encodeSync(SearchAssetsRequestSchema)({
      query: q,
      ...(opts ?? {})
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
