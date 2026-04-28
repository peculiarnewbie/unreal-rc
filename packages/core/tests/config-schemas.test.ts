import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  HttpTransportOptionsSchema,
  WebSocketTransportOptionsSchema,
  RuntimeConfigSchema,
  RetryPolicySchema,
  UnrealRCOptionsSchema,
  WatchHealthOptionsSchema
} from "../src/index.js";

const decode = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.decodeUnknownSync(schema);

const ignoreExcess = <S extends Schema.Schema.Any>(schema: S) =>
  (input: unknown) => Schema.decodeUnknownSync(schema)(input, { onExcessProperty: "ignore" });

describe("HttpTransportOptionsSchema", () => {
  test("accepts valid options", () => {
    const result = decode(HttpTransportOptionsSchema)({
      host: "127.0.0.1",
      port: 30010
    });
    expect(result.host).toBe("127.0.0.1");
    expect(result.port).toBe(30010);
  });

  test("accepts empty options", () => {
    expect(() => decode(HttpTransportOptionsSchema)({})).not.toThrow();
  });

  test("rejects negative port", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ port: -1 })).toThrow();
  });

  test("rejects zero port", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ port: 0 })).toThrow();
  });

  test("rejects port above 65535", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ port: 65536 })).toThrow();
  });

  test("rejects non-integer port", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ port: 80.5 })).toThrow();
  });

  test("rejects negative requestTimeoutMs", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ requestTimeoutMs: -5000 })).toThrow();
  });

  test("rejects zero requestTimeoutMs", () => {
    expect(() => decode(HttpTransportOptionsSchema)({ requestTimeoutMs: 0 })).toThrow();
  });

  test("accepts all fields", () => {
    const result = decode(HttpTransportOptionsSchema)({
      baseUrl: "http://127.0.0.1:30010",
      host: "127.0.0.1",
      port: 30010,
      secure: false,
      passphrase: "test",
      headers: { "X-Custom": "value" },
      requestTimeoutMs: 5000
    });
    expect(result.baseUrl).toBe("http://127.0.0.1:30010");
    expect(result.secure).toBe(false);
  });
});

describe("WebSocketTransportOptionsSchema", () => {
  const decodeWs = ignoreExcess(WebSocketTransportOptionsSchema);

  test("accepts valid options", () => {
    expect(() => decodeWs({})).not.toThrow();
  });

  test("rejects negative maxQueueSize", () => {
    expect(() => decodeWs({ maxQueueSize: -1 })).toThrow();
  });

  test("rejects invalid disconnectedBehavior", () => {
    expect(() => decodeWs({ disconnectedBehavior: "invalid" })).toThrow();
  });

  test("accepts valid disconnectedBehavior", () => {
    const result = decodeWs({ disconnectedBehavior: "queue" });
    expect(result.disconnectedBehavior).toBe("queue");
  });

  test("rejects reconnectBackoffFactor <= 1", () => {
    expect(() => decodeWs({ reconnectBackoffFactor: 1 })).toThrow();
    expect(() => decodeWs({ reconnectBackoffFactor: 0.5 })).toThrow();
  });

  test("accepts reconnectBackoffFactor > 1", () => {
    const result = decodeWs({ reconnectBackoffFactor: 2 });
    expect(result.reconnectBackoffFactor).toBe(2);
  });

  test("rejects negative connectTimeoutMs", () => {
    expect(() => decodeWs({ connectTimeoutMs: -1000 })).toThrow();
  });

  test("ignores excess properties like callbacks", () => {
    expect(() => decodeWs({ onDisconnect: () => {}, onReconnect: () => {} })).not.toThrow();
  });
});

describe("RuntimeConfigSchema", () => {
  const decodeRuntime = ignoreExcess(RuntimeConfigSchema);

  test("accepts valid transport", () => {
    expect(() => decodeRuntime({ transport: "ws" })).not.toThrow();
    expect(() => decodeRuntime({ transport: "http" })).not.toThrow();
  });

  test("rejects invalid transport", () => {
    expect(() => decodeRuntime({ transport: "ftp" })).toThrow();
  });

  test("ignores excess properties like callbacks", () => {
    expect(() => decodeRuntime({ onDisconnect: () => {}, onReconnect: () => {} })).not.toThrow();
  });

  test("rejects invalid nested ws options", () => {
    expect(() => decodeRuntime({ ws: { maxQueueSize: -5 } })).toThrow();
  });

  test("rejects invalid nested http options", () => {
    expect(() => decodeRuntime({ http: { port: 0 } })).toThrow();
  });

  test("accepts valid nested ws and http options", () => {
    expect(() => decodeRuntime({
      transport: "ws",
      ws: { connectTimeoutMs: 5000, autoReconnect: true },
      http: { port: 30010 }
    })).not.toThrow();
  });
});

describe("RetryPolicySchema", () => {
  test("accepts valid policy", () => {
    expect(() => decode(RetryPolicySchema)({ maxAttempts: 3 })).not.toThrow();
  });

  test("accepts empty policy", () => {
    expect(() => decode(RetryPolicySchema)({})).not.toThrow();
  });

  test("rejects zero maxAttempts", () => {
    expect(() => decode(RetryPolicySchema)({ maxAttempts: 0 })).toThrow();
  });

  test("rejects negative maxAttempts", () => {
    expect(() => decode(RetryPolicySchema)({ maxAttempts: -1 })).toThrow();
  });

  test("rejects non-integer maxAttempts", () => {
    expect(() => decode(RetryPolicySchema)({ maxAttempts: 2.5 })).toThrow();
  });

  test("accepts excess fields like shouldRetry callback", () => {
    expect(() => decode(RetryPolicySchema)({
      maxAttempts: 3,
      shouldRetry: () => true
    }, { onExcessProperty: "ignore" })).not.toThrow();
  });

  test("accepts delayMs as number", () => {
    expect(() => decode(RetryPolicySchema)({
      maxAttempts: 3,
      delayMs: 1000
    }, { onExcessProperty: "ignore" })).not.toThrow();
  });
});

describe("UnrealRCOptionsSchema", () => {
  const decodeOpts = ignoreExcess(UnrealRCOptionsSchema);

  test("accepts minimal options", () => {
    expect(() => decodeOpts({})).not.toThrow();
  });

  test("accepts full options with callbacks", () => {
    expect(() => decodeOpts({
      transport: "ws",
      retry: { maxAttempts: 3 },
      validateResponses: false,
      onRequest: () => {},
      onResponse: () => {},
      onError: () => {},
      redactPayload: () => {}
    })).not.toThrow();
  });

  test("accepts retry as boolean", () => {
    expect(() => decodeOpts({ retry: true })).not.toThrow();
    expect(() => decodeOpts({ retry: false })).not.toThrow();
  });

  test("rejects invalid retry policy", () => {
    expect(() => decodeOpts({ retry: { maxAttempts: 0 } })).toThrow();
  });

  test("rejects invalid transport", () => {
    expect(() => decodeOpts({ transport: "ftp" })).toThrow();
  });
});

describe("WatchHealthOptionsSchema", () => {
  test("accepts valid options", () => {
    expect(() => decode(WatchHealthOptionsSchema)({
      intervalMs: 5000,
      unhealthyAfter: 3,
      timeoutMs: 2000
    })).not.toThrow();
  });

  test("accepts empty options", () => {
    expect(() => decode(WatchHealthOptionsSchema)({})).not.toThrow();
  });

  test("rejects negative intervalMs", () => {
    expect(() => decode(WatchHealthOptionsSchema)({ intervalMs: -1000 })).toThrow();
  });

  test("rejects zero intervalMs", () => {
    expect(() => decode(WatchHealthOptionsSchema)({ intervalMs: 0 })).toThrow();
  });

  test("rejects zero unhealthyAfter", () => {
    expect(() => decode(WatchHealthOptionsSchema)({ unhealthyAfter: 0 })).toThrow();
  });

  test("rejects negative unhealthyAfter", () => {
    expect(() => decode(WatchHealthOptionsSchema)({ unhealthyAfter: -1 })).toThrow();
  });

  test("rejects negative timeoutMs", () => {
    expect(() => decode(WatchHealthOptionsSchema)({ timeoutMs: -1000 })).toThrow();
  });
});
