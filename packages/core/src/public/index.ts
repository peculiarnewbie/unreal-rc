// ── Client ─────────────────────────────────────────────────────────────
export { UnrealRC } from "./client.js";
export type {
  BatchOptions,
  CallArgs,
  CallOptions,
  DescribeArgs,
  DescribeOptions,
  ErrorHookContext,
  EventOptions,
  GetPropertiesArgs,
  GetPropertyArgs,
  GetPropertyOptions,
  HealthWatcher,
  PayloadRedactionContext,
  PingOptions,
  RequestHookContext,
  ResponseHookContext,
  RetryContext,
  RetryOptions,
  RetryPolicy,
  SearchAssetsArgs,
  SearchAssetsOptions,
  SetPropertyArgs,
  SetPropertyOptions,
  ThumbnailArgs,
  ThumbnailOptions,
  UnrealRCOptions,
  WatchHealthOptions,
  WritableAccessMode
} from "./client.js";

// ── Batch ──────────────────────────────────────────────────────────────
export {
  BatchBuilder,
  buildBatchRequest,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest
} from "../internal/batch.js";
export type {
  BatchResult,
  BuildCallArgs,
  BuildCallRequestOptions,
  BuildGetPropertyArgs,
  BuildPropertyRequestOptions,
  BuildSearchAssetsArgs,
  BuildSetPropertyArgs
} from "../internal/batch.js";

// ── Helpers ────────────────────────────────────────────────────────────
export {
  blueprintLibraryPath,
  linearColor,
  objectPath,
  parseReturnValue,
  piePath,
  rotator,
  transform,
  vector
} from "./helpers.js";

// ── Errors ─────────────────────────────────────────────────────────────
export { TransportRequestError, toTransportRequestError } from "./errors.js";

// ── Types ──────────────────────────────────────────────────────────────
export type {
  AccessMode,
  AssetInfo,
  BatchRequest,
  BatchRequestItem,
  BatchResponse,
  BatchResponseItem,
  FunctionArgument,
  FunctionMetadata,
  HealthStatus,
  HttpVerb,
  InfoResponse,
  ObjectCallRequest,
  ObjectCallResponse,
  ObjectDescribeRequest,
  ObjectDescribeResponse,
  ObjectEventRequest,
  ObjectEventResponse,
  ObjectPropertyRequest,
  ObjectPropertyResponse,
  ObjectThumbnailRequest,
  ObjectThumbnailResponse,
  PendingRequestInfo,
  PingResult,
  PropertyMetadata,
  RouteInfo,
  SearchAssetsRequest,
  SearchAssetsResponse,
  TransportRequestErrorKind,
  TransportRequestId
} from "./types.js";

// ── Schemas ────────────────────────────────────────────────────────────
export {
  AccessModeSchema,
  AssetInfoSchema,
  BatchRequestItemSchema,
  BatchRequestSchema,
  BatchResponseItemSchema,
  BatchResponseSchema,
  FunctionArgumentSchema,
  FunctionMetadataSchema,
  HttpVerbSchema,
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
  PropertyMetadataSchema,
  RouteInfoSchema,
  SearchAssetsRequestSchema,
  SearchAssetsResponseSchema
} from "../internal/schemas.js";

// ── Transport layers (advanced usage) ──────────────────────────────────
export { HttpTransportLive } from "../internal/http.js";
export type { HttpTransportOptions } from "../internal/http.js";
export { WebSocketTransportLive } from "../internal/ws.js";
export type { DisconnectInfo, WebSocketTransportOptions } from "../internal/ws.js";
