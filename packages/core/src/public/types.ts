import type { Schema } from "effect";
import type {
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

type WithIndex<T> = T & { readonly [key: string]: unknown };

export type HttpVerb = Schema.Schema.Type<typeof HttpVerbSchema>;

export type AccessMode = Schema.Schema.Type<typeof AccessModeSchema>;

export type ObjectCallRequest = Schema.Schema.Type<typeof ObjectCallRequestSchema>;

export type ObjectCallResponse = WithIndex<Schema.Schema.Type<typeof ObjectCallResponseSchema>>;

export type ObjectPropertyRequest = Schema.Schema.Type<typeof ObjectPropertyRequestSchema>;

export type ObjectPropertyResponse = Schema.Schema.Type<typeof ObjectPropertyResponseSchema>;

export type ObjectDescribeRequest = Schema.Schema.Type<typeof ObjectDescribeRequestSchema>;

export type PropertyMetadata = WithIndex<Schema.Schema.Type<typeof PropertyMetadataSchema>>;

export type FunctionArgument = WithIndex<Schema.Schema.Type<typeof FunctionArgumentSchema>>;

export type FunctionMetadata = WithIndex<Schema.Schema.Type<typeof FunctionMetadataSchema>>;

export type ObjectDescribeResponse = WithIndex<Schema.Schema.Type<typeof ObjectDescribeResponseSchema>>;

export type SearchAssetsRequest = WithIndex<Schema.Schema.Type<typeof SearchAssetsRequestSchema>>;

export type AssetInfo = WithIndex<Schema.Schema.Type<typeof AssetInfoSchema>>;

export type SearchAssetsResponse = WithIndex<Schema.Schema.Type<typeof SearchAssetsResponseSchema>>;

export type BatchRequestItem = Schema.Schema.Type<typeof BatchRequestItemSchema>;

export type BatchRequest = Schema.Schema.Type<typeof BatchRequestSchema>;

export type BatchResponseItem = WithIndex<Schema.Schema.Type<typeof BatchResponseItemSchema>>;

export type BatchResponse = WithIndex<Schema.Schema.Type<typeof BatchResponseSchema>>;

export type RouteInfo = WithIndex<Schema.Schema.Type<typeof RouteInfoSchema>>;

export type InfoResponse = WithIndex<Schema.Schema.Type<typeof InfoResponseSchema>>;

export type ObjectEventRequest = WithIndex<Schema.Schema.Type<typeof ObjectEventRequestSchema>>;

export type ObjectEventResponse = WithIndex<Schema.Schema.Type<typeof ObjectEventResponseSchema>>;

export type ObjectThumbnailRequest = WithIndex<Schema.Schema.Type<typeof ObjectThumbnailRequestSchema>>;

export type ObjectThumbnailResponse = Schema.Schema.Type<typeof ObjectThumbnailResponseSchema>;

// ── No schema counterpart ───────────────────────────────────────────────

export type TransportRequestId = number | string;

export type TransportRequestErrorKind =
  | "timeout"
  | "connect"
  | "disconnect"
  | "http_status"
  | "remote_status"
  | "decode"
  | "unknown";

// ── Health detection ──────────────────────────────────────────────────

export interface PingResult {
  readonly reachable: boolean;
  readonly latencyMs: number | undefined;
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly latencyMs: number | undefined;
  readonly consecutiveFailures: number;
  readonly lastSeen: Date | undefined;
}

export type DiscriminatedPingResult =
  | { readonly type: "reachable"; readonly latencyMs: number; }
  | { readonly type: "unreachable"; };

export type DiscriminatedHealthStatus =
  | { readonly type: "healthy"; readonly latencyMs: number; readonly lastSeen: Date; }
  | { readonly type: "unhealthy"; readonly consecutiveFailures: number; readonly lastSeen: Date | undefined; };

export interface PendingRequestInfo {
  readonly requestId: number | string | undefined;
  readonly verb: string;
  readonly url: string;
  readonly elapsedMs: number;
  readonly timeoutMs: number | undefined;
}
