import { afterEach, describe, expect, test } from "bun:test";
import {
  BatchBuilder,
  UnrealRC,
  buildBatchRequest,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest
} from "../src/client.js";
import {
  TransportRequestError,
  type ConnectableTransport,
  type Transport,
  type TransportRequestOptions,
  type TransportResponse
} from "../src/transport.js";
import type { HttpVerb } from "../src/types.js";

type RecordedRequest = {
  verb: HttpVerb;
  url: string;
  body?: unknown;
  options?: TransportRequestOptions;
};

type MockResponse = TransportResponse | Error;
type WebSocketEvent = { data?: unknown };
type WebSocketListener = {
  listener: (event: WebSocketEvent) => void;
  once: boolean;
};

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;

class MockTransport implements Transport {
  readonly transport = "mock";
  readonly requests: RecordedRequest[] = [];
  disposed = false;
  private readonly responses: MockResponse[];

  constructor(responses: MockResponse[] = []) {
    this.responses = [...responses];
  }

  enqueueResponse(response: TransportResponse): void {
    this.responses.push(response);
  }

  enqueueError(error: Error): void {
    this.responses.push(error);
  }

  async request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<TransportResponse> {
    const request: RecordedRequest = {
      verb,
      url,
      ...(body !== undefined ? { body } : {}),
      ...(options !== undefined ? { options } : {})
    };
    this.requests.push(request);

    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }

    return next ?? { body: undefined, statusCode: 200 };
  }

  dispose(): void {
    this.disposed = true;
  }
}

class MockConnectableTransport extends MockTransport implements ConnectableTransport {
  connected = false;
  connectCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }
}

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, WebSocketListener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  addEventListener(
    type: string,
    listener: (event: WebSocketEvent) => void,
    options?: AddEventListenerOptions | boolean
  ): void {
    const once = typeof options === "object" && options?.once === true;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, once });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: WebSocketEvent) => void): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }

    this.listeners.set(
      type,
      listeners.filter((entry) => entry.listener !== listener)
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", {});
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatch("open", {});
  }

  message(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.dispatch("message", { data });
  }

  error(): void {
    this.dispatch("error", {});
  }

  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close", {});
  }

  private dispatch(type: string, event: WebSocketEvent): void {
    const listeners = [...(this.listeners.get(type) ?? [])];
    if (listeners.length === 0) {
      return;
    }

    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((entry) => !entry.once)
    );

    for (const entry of listeners) {
      entry.listener(event);
    }
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.WebSocket = originalWebSocket;
  FakeWebSocket.reset();
});

describe("UnrealRC client", () => {
  test("auto-connects connectable transports before requests", async () => {
    const transport = new MockConnectableTransport([{ body: {}, statusCode: 200 }]);
    const client = new UnrealRC({ transport });

    await client.info();

    expect(transport.connectCalls).toBe(1);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toEqual({
      verb: "GET",
      url: "/remote/info"
    });
  });

  test("builds call payloads with transaction option", async () => {
    const transport = new MockTransport([{ body: { ReturnValue: 123 }, statusCode: 200 }]);
    const client = new UnrealRC({ transport });

    const response = await client.call(
      "/Game/Maps/Main.Main:Actor",
      "IncrementCounter",
      { Delta: 5 },
      { transaction: true }
    );

    expect(response.ReturnValue).toBe(123);
    expect(transport.requests[0]).toEqual({
      verb: "PUT",
      url: "/remote/object/call",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: "IncrementCounter",
        parameters: { Delta: 5 },
        generateTransaction: true
      }
    });
  });

  test("parses property responses using property name then ReturnValue", async () => {
    const transport = new MockTransport([
      { body: { Counter: 9 }, statusCode: 200 },
      { body: { ReturnValue: 33 }, statusCode: 200 }
    ]);
    const client = new UnrealRC({ transport });

    const direct = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Counter");
    const fallback = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Missing");

    expect(direct).toBe(9);
    expect(fallback).toBe(33);
  });

  test("defaults setProperty access and supports transaction access", async () => {
    const transport = new MockTransport([
      { body: { ReturnValue: null }, statusCode: 200 },
      { body: { ReturnValue: null }, statusCode: 200 }
    ]);
    const client = new UnrealRC({ transport });

    await client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 1);
    await client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 2, { transaction: true });

    expect(transport.requests[0]).toEqual({
      verb: "PUT",
      url: "/remote/object/property",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        propertyName: "Counter",
        propertyValue: {
          Counter: 1
        },
        access: "WRITE_ACCESS"
      }
    });

    expect(transport.requests[1]).toEqual({
      verb: "PUT",
      url: "/remote/object/property",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        propertyName: "Counter",
        propertyValue: {
          Counter: 2
        },
        access: "WRITE_TRANSACTION_ACCESS"
      }
    });
  });

  test("fires logging hooks with redacted payloads", async () => {
    const requestLogs: unknown[] = [];
    const responseLogs: unknown[] = [];
    const errorLogs: unknown[] = [];
    const transport = new MockTransport([
      { body: { ReturnValue: { secret: "ok" } }, statusCode: 200 },
      new TransportRequestError("down", {
        kind: "http_status",
        statusCode: 503,
        details: { secret: "fail" }
      })
    ]);
    const client = new UnrealRC({
      transport,
      onRequest: (event) => {
        requestLogs.push(event);
      },
      onResponse: (event) => {
        responseLogs.push(event);
      },
      onError: (event) => {
        errorLogs.push(event);
      },
      redactPayload: (_payload, context) => {
        return `[redacted:${context.phase}]`;
      }
    });

    await client.call("/Game/Maps/Main.Main:Actor", "DoThing", { secret: "request" });
    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "DoThing", { secret: "request" })
    ).rejects.toBeInstanceOf(TransportRequestError);

    expect(requestLogs).toHaveLength(2);
    expect(responseLogs).toHaveLength(1);
    expect(errorLogs).toHaveLength(1);
    expect(requestLogs[0]).toMatchObject({
      transport: "mock",
      verb: "PUT",
      url: "/remote/object/call",
      body: "[redacted:request]"
    });
    expect(responseLogs[0]).toMatchObject({
      transport: "mock",
      body: "[redacted:response]",
      requestBody: "[redacted:request]",
      statusCode: 200
    });
    expect(errorLogs[0]).toMatchObject({
      transport: "mock",
      body: "[redacted:request]",
      errorBody: "[redacted:error]",
      statusCode: 503
    });
  });

  test("retries transient failures when enabled and allows per-call override", async () => {
    const transport = new MockTransport([
      new TransportRequestError("timed out", { kind: "timeout" }),
      { body: { ReturnValue: 42 }, statusCode: 200 },
      new TransportRequestError("timed out", { kind: "timeout" })
    ]);
    const client = new UnrealRC({
      transport,
      retry: { maxAttempts: 2, delayMs: 0 }
    });

    const success = await client.call("/Game/Maps/Main.Main:Actor", "GetValue");

    await expect(client.info({ retry: false })).rejects.toMatchObject({
      kind: "timeout"
    });
    expect(success.ReturnValue).toBe(42);
    expect(transport.requests).toHaveLength(3);
  });

  test("correlates batch responses under mixed success and failure", async () => {
    const transport = new MockTransport([
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
    const client = new UnrealRC({ transport });

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
    const transport = new MockTransport([{ body: 123, statusCode: 200 }]);
    const client = new UnrealRC({ transport, validateResponses: false });

    const raw = await client.info();

    expect(raw).toBe(123);
  });

  test("fails fast on invalid input before sending request", async () => {
    const transport = new MockTransport();
    const client = new UnrealRC({ transport });

    await expect(client.call("", "Fn")).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });

  test("normalizes HTTP transport errors with metadata", async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ message: "busy" }), {
        status: 503,
        headers: { "content-type": "application/json" }
      });
    };

    const client = new UnrealRC({
      transport: "http",
      http: { baseUrl: "http://127.0.0.1:30010" }
    });

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

  test("normalizes WebSocket remote status errors with metadata", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        baseUrl: "ws://127.0.0.1:30020",
        autoReconnect: false,
        pingIntervalMs: 0
      }
    });

    const request = client.info();
    const socket = await waitForSocket(1);
    socket.open();
    await flushTimers();
    socket.message({
      RequestId: 1,
      ResponseCode: 504,
      ResponseBody: { message: "busy" }
    });

    await expect(request).rejects.toMatchObject({
      kind: "remote_status",
      transport: "ws",
      verb: "GET",
      url: "/remote/info",
      requestId: 1,
      statusCode: 504,
      details: { message: "busy" }
    });

    client.dispose();
  });

  test("sends compatible WebSocket HTTP envelopes with both Id fields", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        baseUrl: "ws://127.0.0.1:30020",
        autoReconnect: false,
        pingIntervalMs: 0
      }
    });

    const request = client.info();
    const socket = await waitForSocket(1);
    socket.open();
    await flushTimers();

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] ?? "null")).toEqual({
      MessageName: "http",
      Id: "1",
      Parameters: {
        RequestId: 1,
        Url: "/remote/info",
        Verb: "GET"
      }
    });

    socket.message({
      RequestId: 1,
      ResponseCode: 200,
      ResponseBody: { HttpRoutes: [] }
    });

    await expect(request).resolves.toEqual({ HttpRoutes: [] });
    client.dispose();
  });

  test("accepts documented WebSocket responses that omit a matching RequestId", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        baseUrl: "ws://127.0.0.1:30020",
        autoReconnect: false,
        pingIntervalMs: 0
      }
    });

    const request = client.info();
    const socket = await waitForSocket(1);
    socket.open();
    await flushTimers();
    socket.message({
      RequestId: -1,
      ResponseCode: 200,
      ResponseBody: { HttpRoutes: [] }
    });

    await expect(request).resolves.toEqual({ HttpRoutes: [] });
    client.dispose();
  });

  test("rejects pending WebSocket requests on disconnect", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        baseUrl: "ws://127.0.0.1:30020",
        autoReconnect: true,
        pingIntervalMs: 0,
        reconnectInitialDelayMs: 1,
        reconnectMaxDelayMs: 1,
        reconnectBackoffFactor: 1
      }
    });

    const request = client.info();
    const socket = await waitForSocket(1);
    socket.open();
    await flushTimers();
    socket.serverClose();

    await expect(request).rejects.toMatchObject({
      kind: "disconnect",
      transport: "ws",
      verb: "GET",
      url: "/remote/info",
      requestId: 1
    });

    client.dispose();
  });

  test("queues WebSocket requests across reconnect and resumes after reconnect", async () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

    const client = new UnrealRC({
      transport: "ws",
      ws: {
        baseUrl: "ws://127.0.0.1:30020",
        autoReconnect: true,
        pingIntervalMs: 0,
        reconnectInitialDelayMs: 1,
        reconnectMaxDelayMs: 1,
        reconnectBackoffFactor: 1
      }
    });

    const firstRequest = client.info();
    const firstSocket = await waitForSocket(1);
    firstSocket.open();
    await flushTimers();
    firstSocket.message({
      RequestId: 1,
      ResponseCode: 200,
      ResponseBody: { HttpRoutes: [] }
    });
    await firstRequest;

    firstSocket.serverClose();

    const secondRequest = client.call("/Game/Maps/Main.Main:Actor", "Ping");
    const secondSocket = await waitForSocket(2);
    secondSocket.open();
    await flushTimers();
    secondSocket.message({
      RequestId: 2,
      ResponseCode: 200,
      ResponseBody: { ReturnValue: true }
    });

    await expect(secondRequest).resolves.toEqual({ ReturnValue: true });
    client.dispose();
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

const flushTimers = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

const waitForSocket = async (count: number): Promise<FakeWebSocket> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const socket = FakeWebSocket.instances[count - 1];
    if (socket) {
      return socket;
    }
    await flushTimers();
  }

  throw new Error(`Timed out waiting for socket ${count}`);
};
