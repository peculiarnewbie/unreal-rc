// Plain TypeScript types — zero Effect imports.
// These mirror the shapes in internal/schemas.ts.

export type HttpVerb = "GET" | "PUT" | "POST" | "PATCH" | "DELETE";

export type AccessMode = "READ_ACCESS" | "WRITE_ACCESS" | "WRITE_TRANSACTION_ACCESS";

export interface ObjectCallRequest {
  readonly objectPath: string;
  readonly functionName: string;
  readonly parameters?: Record<string, unknown> | undefined;
  readonly generateTransaction?: boolean | undefined;
}

export interface ObjectCallResponse {
  readonly ReturnValue?: unknown;
  readonly [key: string]: unknown;
}

export interface ObjectPropertyRequest {
  readonly objectPath: string;
  readonly propertyName?: string | undefined;
  readonly propertyValue?: unknown;
  readonly access?: AccessMode | undefined;
}

export interface ObjectPropertyResponse {
  readonly ReturnValue?: unknown;
  readonly [key: string]: unknown;
}

export interface ObjectDescribeRequest {
  readonly objectPath: string;
}

export interface PropertyMetadata {
  readonly Name: string;
  readonly Description?: string | undefined;
  readonly Type?: string | undefined;
  readonly Metadata?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

export interface FunctionArgument {
  readonly Name: string;
  readonly Type?: string | undefined;
  readonly Description?: string | undefined;
  readonly Metadata?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

export interface FunctionMetadata {
  readonly Name: string;
  readonly Description?: string | undefined;
  readonly ReturnType?: string | undefined;
  readonly Arguments?: readonly FunctionArgument[] | undefined;
  readonly Metadata?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}

export interface ObjectDescribeResponse {
  readonly Name?: string | undefined;
  readonly Class?: string | undefined;
  readonly DisplayName?: string | undefined;
  readonly Path?: string | undefined;
  readonly Properties?: readonly PropertyMetadata[] | undefined;
  readonly Functions?: readonly FunctionMetadata[] | undefined;
  readonly [key: string]: unknown;
}

export interface SearchAssetsRequest {
  readonly query?: string | undefined;
  readonly classNames?: readonly string[] | undefined;
  readonly packagePaths?: readonly string[] | undefined;
  readonly recursivePaths?: boolean | undefined;
  readonly recursiveClasses?: boolean | undefined;
  readonly includeOnlyOnDiskAssets?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface AssetInfo {
  readonly Name?: string | undefined;
  readonly ObjectPath?: string | undefined;
  readonly PackageName?: string | undefined;
  readonly PackagePath?: string | undefined;
  readonly AssetClass?: string | undefined;
  readonly Class?: string | undefined;
  readonly [key: string]: unknown;
}

export interface SearchAssetsResponse {
  readonly Assets?: readonly AssetInfo[] | undefined;
  readonly Results?: readonly AssetInfo[] | undefined;
  readonly [key: string]: unknown;
}

export interface BatchRequestItem {
  readonly RequestId: number;
  readonly URL: string;
  readonly Verb: HttpVerb;
  readonly Body?: unknown;
}

export interface BatchRequest {
  readonly Requests: readonly BatchRequestItem[];
}

export interface BatchResponseItem {
  readonly RequestId: number;
  readonly ResponseCode: number;
  readonly ResponseBody?: unknown;
  readonly [key: string]: unknown;
}

export interface BatchResponse {
  readonly Responses?: readonly BatchResponseItem[] | undefined;
  readonly [key: string]: unknown;
}

export interface RouteInfo {
  readonly Path?: string | undefined;
  readonly Verb?: string | undefined;
  readonly Description?: string | undefined;
  readonly [key: string]: unknown;
}

export interface InfoResponse {
  readonly HttpRoutes?: readonly RouteInfo[] | undefined;
  readonly Routes?: readonly RouteInfo[] | undefined;
  readonly [key: string]: unknown;
}

export interface ObjectEventRequest {
  readonly objectPath: string;
  readonly propertyName?: string | undefined;
  readonly timeoutSeconds?: number | undefined;
  readonly [key: string]: unknown;
}

export interface ObjectEventResponse {
  readonly objectPath?: string | undefined;
  readonly propertyName?: string | undefined;
  readonly propertyValue?: unknown;
  readonly [key: string]: unknown;
}

export interface ObjectThumbnailRequest {
  readonly objectPath: string;
  readonly [key: string]: unknown;
}

export type ObjectThumbnailResponse = unknown;

export type TransportRequestId = number | string;

export type TransportRequestErrorKind =
  | "timeout"
  | "connect"
  | "disconnect"
  | "http_status"
  | "remote_status"
  | "decode"
  | "unknown";
