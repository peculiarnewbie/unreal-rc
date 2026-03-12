// ── Client ─────────────────────────────────────────────────────────────
export { UnrealRC } from "./client.js";
export type {
  BatchOptions,
  CallOptions,
  DescribeOptions,
  ErrorHookContext,
  EventOptions,
  GetPropertyOptions,
  PayloadRedactionContext,
  RequestHookContext,
  ResponseHookContext,
  RetryContext,
  RetryOptions,
  RetryPolicy,
  SearchAssetsOptions,
  SetPropertyOptions,
  ThumbnailOptions,
  UnrealRCOptions
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
  BuildCallRequestOptions,
  BuildPropertyRequestOptions
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
export type { WebSocketTransportOptions } from "../internal/ws.js";
