import { Schema } from "effect";

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0));
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Port = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(65535));

// ── Transport options ───────────────────────────────────────────────────

export const HttpTransportOptionsSchema = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Port),
  secure: Schema.optional(Schema.Boolean),
  passphrase: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  requestTimeoutMs: Schema.optional(PositiveNumber),
});

export type HttpTransportOptions = Schema.Schema.Type<typeof HttpTransportOptionsSchema>;

export const WebSocketTransportOptionsSchema = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Port),
  secure: Schema.optional(Schema.Boolean),
  connectTimeoutMs: Schema.optional(PositiveNumber),
  requestTimeoutMs: Schema.optional(PositiveNumber),
  pingIntervalMs: Schema.optional(NonNegativeNumber),
  autoReconnect: Schema.optional(Schema.Boolean),
  reconnectInitialDelayMs: Schema.optional(PositiveNumber),
  reconnectMaxDelayMs: Schema.optional(PositiveNumber),
  reconnectBackoffFactor: Schema.optional(Schema.Number.check(Schema.isGreaterThan(1))),
  disconnectedBehavior: Schema.optional(Schema.Literals(["queue", "reject"])),
  maxQueueSize: Schema.optional(PositiveInt),
});

export const RuntimeConfigSchema = Schema.Struct({
  transport: Schema.optional(Schema.Literals(["ws", "http"])),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Port),
  secure: Schema.optional(Schema.Boolean),
  passphrase: Schema.optional(Schema.String),
  ws: Schema.optional(WebSocketTransportOptionsSchema),
  http: Schema.optional(HttpTransportOptionsSchema),
});

export const RetryPolicySchema = Schema.Struct({
  maxAttempts: Schema.optional(PositiveInt),
});

export const UnrealRCOptionsSchema = Schema.Struct({
  transport: Schema.optional(Schema.Literals(["ws", "http"])),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Port),
  secure: Schema.optional(Schema.Boolean),
  passphrase: Schema.optional(Schema.String),
  ws: Schema.optional(WebSocketTransportOptionsSchema),
  http: Schema.optional(HttpTransportOptionsSchema),
  validateResponses: Schema.optional(Schema.Boolean),
  retry: Schema.optional(Schema.Union([
    Schema.Boolean,
    RetryPolicySchema
  ])),
});

export const WatchHealthOptionsSchema = Schema.Struct({
  intervalMs: Schema.optional(PositiveNumber),
  unhealthyAfter: Schema.optional(PositiveInt),
  timeoutMs: Schema.optional(PositiveNumber),
});
