import { afterEach, describe, expect, test } from "bun:test";
import {
  BatchBuilder,
  UnrealRC,
  TransportRequestError,
  buildBatchRequest,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest,
  type HealthStatus,
  type PingResult
} from "../src/index.js";

// ── Fetch mock helpers ────────────────────────────────────────────────

type MockResponseEntry = { body?: unknown; statusCode?: number } | Error;

type RecordedFetchRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
};

const createFetchMock = (responses: MockResponseEntry[]) => {
  const requests: RecordedFetchRequest[] = [];
  let index = 0;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = { ...((init?.headers as Record<string, string>) ?? {}) };
    const rawBody = init?.body as string | undefined;
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    requests.push({ url, method, headers, body });

    const entry = responses[index++];
    if (!entry) throw new Error("No more mock responses");

    if (entry instanceof Error) throw entry;

    const status = entry.statusCode ?? 200;
    const responseBody = entry.body !== undefined ? JSON.stringify(entry.body) : "";

    return new Response(responseBody, {
      status,
      headers: responseBody ? { "content-type": "application/json" } : {}
    });
  };

  return { requests };
};

// ── Cleanup ───────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
});

// ── Helpers ───────────────────────────────────────────────────────────

const makeHttpClient = (
  responses: MockResponseEntry[],
  options: Record<string, unknown> = {}
) => {
  const mock = createFetchMock(responses);
  const client = new UnrealRC({
    transport: "http",
    http: { baseUrl: "http://127.0.0.1:30010" },
    ...options
  } as ConstructorParameters<typeof UnrealRC>[0]);
  return { client, requests: mock.requests };
};

const installMockWebSocket = (options: { openDelayMs?: number | undefined } = {}) => {
  const sentPayloads: string[] = [];
  const sockets: MockWebSocket[] = [];

  class MockWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readyState = MockWebSocket.CONNECTING;
    private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

    constructor(url: string) {
      this.url = url;
      sockets.push(this);

      if (options.openDelayMs !== undefined) {
        setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) return;
          this.readyState = MockWebSocket.OPEN;
          this.emit("open");
        }, options.openDelayMs);
      }
    }

    addEventListener(type: string, listener: (event?: unknown) => void) {
      const listeners = this.listeners.get(type) ?? new Set<(event?: unknown) => void>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event?: unknown) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    send(payload: string) {
      sentPayloads.push(payload);
    }

    close() {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close");
    }

    private emit(type: string, event?: unknown) {
      const listeners = this.listeners.get(type);
      if (!listeners) return;
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

  return { sentPayloads, sockets };
};

const getHttpPayloads = (sentPayloads: string[]) =>
  sentPayloads
    .map((payload) => {
      try {
        return JSON.parse(payload) as { MessageName?: string };
      } catch {
        return undefined;
      }
    })
    .filter((payload): payload is { MessageName?: string } => payload !== undefined && payload.MessageName === "http");

// ── Client tests ──────────────────────────────────────────────────────

describe("UnrealRC client", () => {
  test("builds call payloads with transaction option", async () => {
    const { client, requests } = makeHttpClient([
      { body: { ReturnValue: 123 }, statusCode: 200 }
    ]);

    const response = await client.call(
      "/Game/Maps/Main.Main:Actor",
      "IncrementCounter",
      { Delta: 5 },
      { transaction: true }
    );

    expect(response.ReturnValue).toBe(123);
    expect(requests[0]?.body).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "IncrementCounter",
      parameters: { Delta: 5 },
      generateTransaction: true
    });
  });

  test("normalizes single-output call responses onto ReturnValue", async () => {
    const { client } = makeHttpClient([
      { body: { OutCounter: 123 }, statusCode: 200 }
    ]);

    const response = await client.call("/Game/Maps/Main.Main:Actor", "IncrementCounter", {
      Delta: 5
    });

    expect(response).toEqual({
      OutCounter: 123,
      ReturnValue: 123
    });
  });

  test("parses property responses using property name then ReturnValue", async () => {
    const { client } = makeHttpClient([
      { body: { Counter: 9 }, statusCode: 200 },
      { body: { ReturnValue: 33 }, statusCode: 200 }
    ]);

    const direct = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Counter");
    const fallback = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Missing");

    expect(direct).toBe(9);
    expect(fallback).toBe(33);
  });

  test("defaults setProperty access and supports transaction access", async () => {
    const { client, requests } = makeHttpClient([
      { body: undefined, statusCode: 200 },
      { body: { ReturnValue: null }, statusCode: 200 }
    ]);

    await expect(client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 1)).resolves.toEqual({});
    await expect(
      client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 2, { transaction: true })
    ).resolves.toEqual({ ReturnValue: null });

    expect(requests[0]?.body).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: { Counter: 1 },
      access: "WRITE_ACCESS"
    });

    expect(requests[1]?.body).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: { Counter: 2 },
      access: "WRITE_TRANSACTION_ACCESS"
    });
  });

  test("fires logging hooks with redacted payloads", async () => {
    const requestLogs: unknown[] = [];
    const responseLogs: unknown[] = [];
    const errorLogs: unknown[] = [];

    const { client } = makeHttpClient(
      [
        { body: { ReturnValue: { secret: "ok" } }, statusCode: 200 },
        { body: { secret: "fail" }, statusCode: 503 }
      ],
      {
        onRequest: (event: unknown) => {
          requestLogs.push(event);
        },
        onResponse: (event: unknown) => {
          responseLogs.push(event);
        },
        onError: (event: unknown) => {
          errorLogs.push(event);
        },
        redactPayload: (_payload: unknown, context: { phase: string }) => {
          return `[redacted:${context.phase}]`;
        }
      }
    );

    await client.call("/Game/Maps/Main.Main:Actor", "DoThing", { secret: "request" });
    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "DoThing", { secret: "request" })
    ).rejects.toBeInstanceOf(TransportRequestError);

    expect(requestLogs).toHaveLength(2);
    expect(responseLogs).toHaveLength(1);
    expect(errorLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({
      transport: "http",
      verb: "PUT",
      url: "/remote/object/call",
      body: "[redacted:request]"
    });
    expect(responseLogs[0]).toMatchObject({
      transport: "http",
      body: "[redacted:response]",
      requestBody: "[redacted:request]",
      statusCode: 200
    });
    expect(errorLogs[0]).toMatchObject({
      transport: "http",
      body: "[redacted:request]",
      errorBody: "[redacted:error]",
      statusCode: 503
    });
  });

  test("retries transient failures when enabled and allows per-call override", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 42 }, statusCode: 200 },
        { body: { error: "busy" }, statusCode: 503 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const success = await client.call("/Game/Maps/Main.Main:Actor", "GetValue");

    await expect(client.info({ retry: false })).rejects.toMatchObject({
      kind: "http_status",
      statusCode: 503
    });
    expect(success.ReturnValue).toBe(42);
    expect(requests).toHaveLength(3);
  });

  test("correlates batch responses under mixed success and failure", async () => {
    const { client } = makeHttpClient([
      {
        body: {
          Responses: [
            { RequestId: 2, ResponseCode: 404, ResponseBody: { error: "missing" } },
            { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: true } }
          ]
        },
        statusCode: 200
      }
    ]);

    const results = await client.batch((builder) => {
      builder.call("/Game/Maps/Main.Main:Actor", "ResetFixtures");
      builder.describe("/Game/Maps/Main.Main:Actor");
      builder.getProperty("/Game/Maps/Main.Main:Actor", "Missing");
    });

    expect(results).toEqual([
      {
        requestId: 0,
        statusCode: 200,
        body: { ReturnValue: true },
        request: {
          RequestId: 0,
          URL: "/remote/object/call",
          Verb: "PUT",
          Body: {
            objectPath: "/Game/Maps/Main.Main:Actor",
            functionName: "ResetFixtures"
          }
        }
      },
      {
        requestId: 1,
        statusCode: 0,
        body: undefined,
        request: {
          RequestId: 1,
          URL: "/remote/object/describe",
          Verb: "PUT",
          Body: {
            objectPath: "/Game/Maps/Main.Main:Actor"
          }
        }
      },
      {
        requestId: 2,
        statusCode: 404,
        body: { error: "missing" },
        request: {
          RequestId: 2,
          URL: "/remote/object/property",
          Verb: "PUT",
          Body: {
            objectPath: "/Game/Maps/Main.Main:Actor",
            propertyName: "Missing",
            access: "READ_ACCESS"
          }
        }
      }
    ]);
  });

  test("skips response schema parsing when validateResponses is false", async () => {
    const { client } = makeHttpClient(
      [{ body: 123, statusCode: 200 }],
      { validateResponses: false }
    );

    const raw = await client.info();

    expect(raw).toBe(123);
  });

  test("fails fast on invalid input before sending request", async () => {
    const { client, requests } = makeHttpClient([]);

    await expect(client.call("", "Fn")).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  test("normalizes HTTP transport errors with metadata", async () => {
    const { client } = makeHttpClient([
      { body: { message: "busy" }, statusCode: 503 }
    ]);

    await expect(client.info()).rejects.toMatchObject({
      kind: "http_status",
      transport: "http",
      verb: "GET",
      url: "/remote/info",
      statusCode: 503,
      details: { message: "busy" }
    });
  });

  test("passes custom HTTP headers through to the transport boundary", async () => {
    let targetUrl = "";
    let requestHeaders: Record<string, string> = {};

    globalThis.fetch = async (input, init) => {
      targetUrl = String(input);
      requestHeaders = { ...((init?.headers as Record<string, string>) ?? {}) };

      return new Response(JSON.stringify({ ReturnValue: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new UnrealRC({
      transport: "http",
      http: {
        baseUrl: "http://127.0.0.1:30010",
        headers: {
          authorization: "Bearer secret",
          "x-trace-id": "abc123"
        }
      }
    });

    await client.call("/Game/Maps/Main.Main:Actor", "Ping");

    expect(targetUrl).toBe("http://127.0.0.1:30010/remote/object/call");
    expect(requestHeaders).toMatchObject({
      authorization: "Bearer secret",
      "x-trace-id": "abc123",
      "content-type": "application/json"
    });
  });

  test("maps passphrase onto the HTTP Passphrase header", async () => {
    let requestHeaders: Record<string, string> = {};

    globalThis.fetch = async (_input, init) => {
      requestHeaders = { ...((init?.headers as Record<string, string>) ?? {}) };

      return new Response(JSON.stringify({ ReturnValue: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new UnrealRC({
      transport: "http",
      passphrase: "smh ue, this is stupid",
      http: {
        baseUrl: "http://127.0.0.1:30010"
      }
    } as ConstructorParameters<typeof UnrealRC>[0]);

    await client.batch((builder) => {
      builder.request("GET", "/remote/info");
    });

    expect(requestHeaders).toMatchObject({
      Passphrase: "smh ue, this is stupid",
      "content-type": "application/json"
    });
  });

  test("defaults the HTTP Passphrase header when no passphrase is configured", async () => {
    let requestHeaders: Record<string, string> = {};

    globalThis.fetch = async (_input, init) => {
      requestHeaders = { ...((init?.headers as Record<string, string>) ?? {}) };

      return new Response(JSON.stringify({ ReturnValue: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new UnrealRC({
      transport: "http",
      http: {
        baseUrl: "http://127.0.0.1:30010"
      }
    });

    await client.info();

    expect(requestHeaders).toMatchObject({
      Passphrase: "smh ue, this is stupid"
    });
  });

  test("applies websocket request timeout while disconnected and queued", async () => {
    const { sentPayloads } = installMockWebSocket();
    const client = new UnrealRC({
      transport: "ws",
      ws: { connectTimeoutMs: 10_000 }
    });

    const start = Date.now();

    await expect(
      client.info({ timeoutMs: 50, retry: false })
    ).rejects.toMatchObject({
      kind: "timeout",
      transport: "ws",
      verb: "GET",
      url: "/remote/info"
    });

    expect(Date.now() - start).toBeLessThan(500);
    expect(getHttpPayloads(sentPayloads)).toHaveLength(0);

    await client.dispose();
  });

  test("does not send expired queued websocket requests after reconnect", async () => {
    const { sentPayloads } = installMockWebSocket({ openDelayMs: 100 });
    const client = new UnrealRC({
      transport: "ws",
      ws: { connectTimeoutMs: 10_000, autoReconnect: false }
    });

    await expect(
      client.info({ timeoutMs: 25, retry: false })
    ).rejects.toMatchObject({
      kind: "timeout",
      transport: "ws",
      verb: "GET",
      url: "/remote/info"
    });

    await Bun.sleep(150);
    expect(getHttpPayloads(sentPayloads)).toHaveLength(0);

    await client.dispose();
  });
});

describe("BatchBuilder and protocol builders", () => {
  test("creates sequential request ids", () => {
    const builder = new BatchBuilder();

    const first = builder.describe("/Game/Maps/Main.Main:Actor");
    const second = builder.request("GET", "/remote/info");

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(builder.toRequestBody()).toEqual({
      Requests: [
        {
          RequestId: 0,
          URL: "/remote/object/describe",
          Verb: "PUT",
          Body: { objectPath: "/Game/Maps/Main.Main:Actor" }
        },
        {
          RequestId: 1,
          URL: "/remote/info",
          Verb: "GET"
        }
      ]
    });
  });

  test("exposes pure protocol request builders", () => {
    const builder = new BatchBuilder();
    builder.call("/Game/Maps/Main.Main:Actor", "Increment", { Delta: 1 }, { transaction: true });

    expect(buildCallRequest("/Game/Maps/Main.Main:Actor", "Increment", { Delta: 1 }, { transaction: true })).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "Increment",
      parameters: { Delta: 1 },
      generateTransaction: true
    });
    expect(buildPropertyRequest("/Game/Maps/Main.Main:Actor", { propertyName: "Counter" })).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      access: "READ_ACCESS"
    });
    expect(
      buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
        propertyName: "Counter",
        propertyValue: 3
      })
    ).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: {
        Counter: 3
      },
      access: "WRITE_ACCESS"
    });
    expect(buildDescribeRequest("/Game/Maps/Main.Main:Actor")).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor"
    });
    expect(buildBatchRequest(builder)).toEqual({
      Requests: [
        {
          RequestId: 0,
          URL: "/remote/object/call",
          Verb: "PUT",
          Body: {
            objectPath: "/Game/Maps/Main.Main:Actor",
            functionName: "Increment",
            parameters: { Delta: 1 },
            generateTransaction: true
          }
        }
      ]
    });
  });
});

// ── Health detection tests ────────────────────────────────────────────

describe("ping", () => {
  test("returns reachable true with latency on success", async () => {
    const { client } = makeHttpClient([
      { body: {}, statusCode: 200 }
    ]);

    const result = await client.ping();

    expect(result.reachable).toBe(true);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test("returns reachable false on transport failure", async () => {
    const { client } = makeHttpClient([new Error("connection refused")]);

    const result = await client.ping();

    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeUndefined();
  });

  test("returns reachable false on HTTP error status", async () => {
    const { client } = makeHttpClient([
      { body: { message: "busy" }, statusCode: 503 }
    ]);

    const result = await client.ping();

    expect(result.reachable).toBe(false);
    expect(result.latencyMs).toBeUndefined();
  });

  test("does not fire hooks", async () => {
    const hookCalls: string[] = [];

    const { client } = makeHttpClient(
      [{ body: {}, statusCode: 200 }],
      {
        onRequest: () => { hookCalls.push("request"); },
        onResponse: () => { hookCalls.push("response"); },
        onError: () => { hookCalls.push("error"); }
      }
    );

    await client.ping();

    expect(hookCalls).toHaveLength(0);
  });

  test("respects custom timeout", async () => {
    const { client, requests } = makeHttpClient([
      { body: {}, statusCode: 200 }
    ]);

    const result = await client.ping({ timeoutMs: 500 });

    expect(result.reachable).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/remote/info");
    expect(requests[0]?.method).toBe("GET");
  });

  test("never throws regardless of error type", async () => {
    const { client: client1 } = makeHttpClient([new TypeError("fetch failed")]);
    const { client: client2 } = makeHttpClient([new Error("ECONNREFUSED")]);
    const { client: client3 } = makeHttpClient([{ body: {}, statusCode: 500 }]);

    const [r1, r2, r3] = await Promise.all([
      client1.ping(),
      client2.ping(),
      client3.ping()
    ]);

    expect(r1.reachable).toBe(false);
    expect(r2.reachable).toBe(false);
    expect(r3.reachable).toBe(false);
  });
});

describe("watchHealth", () => {
  test("transitions from unhealthy to healthy on first success", async () => {
    const statuses: HealthStatus[] = [];
    const { client } = makeHttpClient(
      Array.from({ length: 10 }, () => ({ body: {}, statusCode: 200 }))
    );

    const watcher = client.watchHealth({
      intervalMs: 10,
      onChange: (status) => { statuses.push({ ...status }); }
    });

    await Bun.sleep(100);
    watcher.dispose();

    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0]?.healthy).toBe(true);
    expect(statuses[0]?.consecutiveFailures).toBe(0);
    expect(statuses[0]?.lastSeen).toBeInstanceOf(Date);
  });

  test("transitions from healthy to unhealthy after consecutive failures", async () => {
    const statuses: HealthStatus[] = [];

    // First response succeeds, then all fail
    const { client } = makeHttpClient([
      { body: {}, statusCode: 200 },
      new Error("down"),
      new Error("down"),
      new Error("down"),
      new Error("down")
    ]);

    const watcher = client.watchHealth({
      intervalMs: 10,
      unhealthyAfter: 2,
      onChange: (status) => { statuses.push({ ...status }); }
    });

    await Bun.sleep(200);
    watcher.dispose();

    // Should have: unhealthy->healthy transition, then healthy->unhealthy transition
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    expect(statuses[0]?.healthy).toBe(true);
    expect(statuses[1]?.healthy).toBe(false);
    expect(statuses[1]!.consecutiveFailures).toBeGreaterThanOrEqual(2);
  });

  test("does not fire onChange on every tick when status is stable", async () => {
    const statuses: HealthStatus[] = [];
    const { client } = makeHttpClient(
      Array.from({ length: 20 }, () => ({ body: {}, statusCode: 200 }))
    );

    const watcher = client.watchHealth({
      intervalMs: 10,
      onChange: (status) => { statuses.push({ ...status }); }
    });

    await Bun.sleep(200);
    watcher.dispose();

    // Should only fire once for the unhealthy->healthy transition
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.healthy).toBe(true);
  });

  test("status() returns current snapshot", async () => {
    const { client } = makeHttpClient(
      Array.from({ length: 10 }, () => ({ body: {}, statusCode: 200 }))
    );

    const watcher = client.watchHealth({ intervalMs: 10 });

    // Initially unhealthy
    const initial = watcher.status();
    expect(initial.healthy).toBe(false);
    expect(initial.consecutiveFailures).toBe(0);

    await Bun.sleep(100);

    // After pings succeed
    const updated = watcher.status();
    expect(updated.healthy).toBe(true);
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastSeen).toBeInstanceOf(Date);

    watcher.dispose();
  });

  test("dispose stops polling", async () => {
    let pingCount = 0;
    const originalFetchInner = globalThis.fetch;

    const { client } = makeHttpClient(
      Array.from({ length: 50 }, () => ({ body: {}, statusCode: 200 }))
    );

    // Wrap fetch to count calls
    const wrappedFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      pingCount++;
      return wrappedFetch(...args);
    };

    const watcher = client.watchHealth({ intervalMs: 10 });

    await Bun.sleep(80);
    watcher.dispose();

    const countAtDispose = pingCount;
    await Bun.sleep(100);

    // No more pings after dispose
    expect(pingCount).toBe(countAtDispose);
  });
});

describe("pendingRequests", () => {
  test("returns empty array when no requests are pending", async () => {
    const { client } = makeHttpClient([]);

    const pending = await client.pendingRequests();

    expect(pending).toEqual([]);
  });

  test("returns pending HTTP requests with timing info", async () => {
    // Create a fetch that delays
    let resolveDelay: (() => void) | undefined;
    const delayPromise = new Promise<void>((resolve) => { resolveDelay = resolve; });

    globalThis.fetch = async () => {
      await delayPromise;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new UnrealRC({
      transport: "http",
      http: { baseUrl: "http://127.0.0.1:30010" }
    });

    // Start a request but don't await it
    const infoPromise = client.info({ retry: false });

    await Bun.sleep(50);

    const pending = await client.pendingRequests();

    expect(pending.length).toBe(1);
    expect(pending[0]?.verb).toBe("GET");
    expect(pending[0]?.url).toContain("/remote/info");
    expect(pending[0]?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(typeof pending[0]?.timeoutMs).toBe("number");

    // Clean up
    resolveDelay!();
    await infoPromise;
    await client.dispose();
  });
});

describe("onDisconnect and onReconnect", () => {
  test("fires onDisconnect when WebSocket closes", async () => {
    const disconnects: unknown[] = [];
    const { sockets } = installMockWebSocket({ openDelayMs: 5 });

    const client = new UnrealRC({
      transport: "ws",
      ws: { connectTimeoutMs: 5000, autoReconnect: false },
      onDisconnect: (info) => { disconnects.push(info); }
    });

    // Trigger runtime initialization by starting a request (won't complete — mock doesn't respond)
    const pendingRequest = client.info({ timeoutMs: 5000, retry: false }).catch(() => {});

    // Wait for socket to open
    await Bun.sleep(50);
    expect(sockets.length).toBeGreaterThanOrEqual(1);

    // Close the socket (rejects pending request + fires onDisconnect)
    sockets[0]!.close();

    await Bun.sleep(50);

    expect(disconnects.length).toBe(1);

    await pendingRequest;
    await client.dispose().catch(() => {});
  });

  test("fires onReconnect on second connection but not first", async () => {
    const reconnects: number[] = [];
    const disconnects: unknown[] = [];
    const { sockets } = installMockWebSocket({ openDelayMs: 5 });

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        connectTimeoutMs: 5000,
        autoReconnect: true,
        reconnectInitialDelayMs: 10,
        reconnectMaxDelayMs: 20
      },
      onDisconnect: (info) => { disconnects.push(info); },
      onReconnect: () => { reconnects.push(Date.now()); }
    });

    // Trigger runtime initialization (short timeout so it doesn't block on reconnect)
    const pendingRequest = client.info({ timeoutMs: 200, retry: false }).catch(() => {});

    // Wait for first connection
    await Bun.sleep(50);
    expect(reconnects).toHaveLength(0);

    // Close first socket to trigger reconnect
    sockets[0]!.close();
    await Bun.sleep(150);

    // After reconnection, onReconnect should have fired
    expect(reconnects.length).toBeGreaterThanOrEqual(1);
    expect(disconnects.length).toBeGreaterThanOrEqual(1);

    await pendingRequest;
    await client.dispose().catch(() => {});
  });

  test("does not error for HTTP transport with lifecycle hooks", async () => {
    const disconnects: unknown[] = [];
    const reconnects: number[] = [];

    const { client } = makeHttpClient(
      [{ body: {}, statusCode: 200 }],
      {
        onDisconnect: (info: unknown) => { disconnects.push(info); },
        onReconnect: () => { reconnects.push(Date.now()); }
      }
    );

    await client.info();

    // Hooks should never fire for HTTP
    expect(disconnects).toHaveLength(0);
    expect(reconnects).toHaveLength(0);
  });
});
