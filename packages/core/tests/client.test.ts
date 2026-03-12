import { afterEach, describe, expect, test } from "bun:test";
import {
  BatchBuilder,
  UnrealRC,
  TransportRequestError,
  buildBatchRequest,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest
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

afterEach(() => {
  globalThis.fetch = originalFetch;
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
