import { afterEach, describe, expect, test } from "bun:test";
import {
  BatchBuilder,
  UnrealRC,
  buildBatchRequest,
  buildCallRequest,
  buildDescribeRequest,
  buildPropertyRequest
} from "../src/index.js";
import type { BatchRequestItem, BatchResponse } from "../src/index.js";
import { correlateBatchResponses } from "../src/internal/batch.js";

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

// ── BatchBuilder unit tests ──────────────────────────────────────────

describe("BatchBuilder", () => {
  test("assigns sequential request IDs starting from 0", () => {
    const builder = new BatchBuilder();
    expect(builder.call("/A", "Fn")).toBe(0);
    expect(builder.describe("/B")).toBe(1);
    expect(builder.getProperty("/C", "Prop")).toBe(2);
    expect(builder.setProperty("/D", "Prop", 1)).toBe(3);
    expect(builder.searchAssets("query")).toBe(4);
    expect(builder.request("GET", "/remote/info")).toBe(5);
  });

  test("getRequests returns a copy of internal requests", () => {
    const builder = new BatchBuilder();
    builder.describe("/Game/Maps/Main.Main:Actor");

    const first = builder.getRequests();
    const second = builder.getRequests();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  test("call builds correct request shape", () => {
    const builder = new BatchBuilder();
    builder.call("/Game/Maps/Main.Main:Actor", "Add", { Delta: 5 }, { transaction: true });

    const requests = builder.getRequests();
    expect(requests[0]).toEqual({
      RequestId: 0,
      URL: "/remote/object/call",
      Verb: "PUT",
      Body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: "Add",
        parameters: { Delta: 5 },
        generateTransaction: true
      }
    });
  });

  test("call without parameters omits parameters field", () => {
    const builder = new BatchBuilder();
    builder.call("/Game/Maps/Main.Main:Actor", "Reset");

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.parameters).toBeUndefined();
  });

  test("getProperty defaults to READ_ACCESS", () => {
    const builder = new BatchBuilder();
    builder.getProperty("/Game/Maps/Main.Main:Actor", "Counter");

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.access).toBe("READ_ACCESS");
  });

  test("getProperty with explicit access mode", () => {
    const builder = new BatchBuilder();
    builder.getProperty("/Game/Maps/Main.Main:Actor", "Counter", "WRITE_ACCESS");

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.access).toBe("WRITE_ACCESS");
  });

  test("setProperty defaults to WRITE_ACCESS", () => {
    const builder = new BatchBuilder();
    builder.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 10);

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.access).toBe("WRITE_ACCESS");
    expect(body.propertyValue).toEqual({ Counter: 10 });
  });

  test("setProperty with transaction uses WRITE_TRANSACTION_ACCESS", () => {
    const builder = new BatchBuilder();
    builder.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 10, { transaction: true });

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.access).toBe("WRITE_TRANSACTION_ACCESS");
  });

  test("setProperty with explicit access overrides default", () => {
    const builder = new BatchBuilder();
    builder.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 10, {
      access: "WRITE_TRANSACTION_ACCESS"
    });

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.access).toBe("WRITE_TRANSACTION_ACCESS");
  });

  test("describe builds correct request shape", () => {
    const builder = new BatchBuilder();
    builder.describe("/Game/Maps/Main.Main:Actor");

    expect(builder.getRequests()[0]).toEqual({
      RequestId: 0,
      URL: "/remote/object/describe",
      Verb: "PUT",
      Body: { objectPath: "/Game/Maps/Main.Main:Actor" }
    });
  });

  test("searchAssets builds correct request shape", () => {
    const builder = new BatchBuilder();
    builder.searchAssets("Chair", {
      classNames: ["StaticMesh"],
      recursivePaths: true
    });

    const body = builder.getRequests()[0]?.Body as Record<string, unknown>;
    expect(body.query).toBe("Chair");
    expect(body.classNames).toEqual(["StaticMesh"]);
    expect(body.recursivePaths).toBe(true);
  });

  test("custom request verb and url", () => {
    const builder = new BatchBuilder();
    builder.request("POST", "/custom/endpoint", { key: "value" });

    expect(builder.getRequests()[0]).toEqual({
      RequestId: 0,
      URL: "/custom/endpoint",
      Verb: "POST",
      Body: { key: "value" }
    });
  });

  test("custom request without body omits Body field", () => {
    const builder = new BatchBuilder();
    builder.request("GET", "/remote/info");

    const req = builder.getRequests()[0]!;
    expect(req.Verb).toBe("GET");
    expect(req.Body).toBeUndefined();
  });

  test("toRequestBody wraps requests in BatchRequest shape", () => {
    const builder = new BatchBuilder();
    builder.describe("/A");
    builder.describe("/B");

    const body = builder.toRequestBody();
    expect(body.Requests).toHaveLength(2);
    expect(body.Requests[0]?.RequestId).toBe(0);
    expect(body.Requests[1]?.RequestId).toBe(1);
  });
});

// ── Pure protocol builders ───────────────────────────────────────────

describe("pure protocol builders", () => {
  test("buildCallRequest without transaction omits generateTransaction", () => {
    const req = buildCallRequest("/Game/Maps/Main.Main:Actor", "Ping");
    expect(req.generateTransaction).toBeUndefined();
    expect(req.parameters).toBeUndefined();
  });

  test("buildPropertyRequest normalizes scalar value into property map", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Health",
      propertyValue: 100
    });
    expect(req.propertyValue).toEqual({ Health: 100 });
  });

  test("buildPropertyRequest preserves pre-wrapped value", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Health",
      propertyValue: { Health: 100 }
    });
    expect(req.propertyValue).toEqual({ Health: 100 });
  });

  test("buildPropertyRequest without propertyName passes value through", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyValue: { Counter: 5 }
    });
    expect(req.propertyValue).toEqual({ Counter: 5 });
  });

  test("buildPropertyRequest defaults access to READ_ACCESS for reads", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Counter"
    });
    expect(req.access).toBe("READ_ACCESS");
  });

  test("buildPropertyRequest defaults access to WRITE_ACCESS for writes", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Counter",
      propertyValue: 5
    });
    expect(req.access).toBe("WRITE_ACCESS");
  });

  test("buildPropertyRequest defaults access to WRITE_TRANSACTION_ACCESS with transaction", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Counter",
      propertyValue: 5,
      transaction: true
    });
    expect(req.access).toBe("WRITE_TRANSACTION_ACCESS");
  });

  test("buildPropertyRequest explicit access overrides defaults", () => {
    const req = buildPropertyRequest("/Game/Maps/Main.Main:Actor", {
      propertyName: "Counter",
      propertyValue: 5,
      access: "WRITE_TRANSACTION_ACCESS"
    });
    expect(req.access).toBe("WRITE_TRANSACTION_ACCESS");
  });

  test("buildDescribeRequest produces minimal shape", () => {
    const req = buildDescribeRequest("/Game/Maps/Main.Main:Actor");
    expect(req).toEqual({ objectPath: "/Game/Maps/Main.Main:Actor" });
  });

  test("buildCallRequest rejects empty objectPath", () => {
    expect(() => buildCallRequest("", "Fn")).toThrow();
  });

  test("buildCallRequest rejects empty functionName", () => {
    expect(() => buildCallRequest("/Game/Maps/Main.Main:Actor", "")).toThrow();
  });

  test("buildDescribeRequest rejects empty objectPath", () => {
    expect(() => buildDescribeRequest("")).toThrow();
  });

  test("buildBatchRequest accepts BatchBuilder instance", () => {
    const builder = new BatchBuilder();
    builder.describe("/A");
    const batch = buildBatchRequest(builder);
    expect(batch.Requests).toHaveLength(1);
  });

  test("buildBatchRequest accepts array of BatchRequestItems", () => {
    const items: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/info", Verb: "GET" },
      { RequestId: 1, URL: "/remote/object/describe", Verb: "PUT", Body: { objectPath: "/A" } }
    ];
    const batch = buildBatchRequest(items);
    expect(batch.Requests).toHaveLength(2);
  });
});

// ── Batch response correlation ───────────────────────────────────────

describe("correlateBatchResponses", () => {
  test("matches responses to requests by RequestId", () => {
    const requests: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/object/call", Verb: "PUT" },
      { RequestId: 1, URL: "/remote/info", Verb: "GET" }
    ];
    const response: BatchResponse = {
      Responses: [
        { RequestId: 1, ResponseCode: 200, ResponseBody: { HttpRoutes: [] } },
        { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: 42 } }
      ]
    };

    const results = correlateBatchResponses(requests, response);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      requestId: 0,
      statusCode: 200,
      body: { ReturnValue: 42 },
      request: requests[0]
    });
    expect(results[1]).toEqual({
      requestId: 1,
      statusCode: 200,
      body: { HttpRoutes: [] },
      request: requests[1]
    });
  });

  test("assigns statusCode 0 for missing responses", () => {
    const requests: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/object/call", Verb: "PUT" },
      { RequestId: 1, URL: "/remote/object/describe", Verb: "PUT" }
    ];
    const response: BatchResponse = {
      Responses: [
        { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: true } }
      ]
    };

    const results = correlateBatchResponses(requests, response);

    expect(results[1]).toEqual({
      requestId: 1,
      statusCode: 0,
      body: undefined,
      request: requests[1]
    });
  });

  test("handles empty Responses array", () => {
    const requests: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/info", Verb: "GET" }
    ];
    const response: BatchResponse = { Responses: [] };

    const results = correlateBatchResponses(requests, response);

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(0);
    expect(results[0]?.body).toBeUndefined();
  });

  test("handles undefined Responses", () => {
    const requests: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/info", Verb: "GET" }
    ];
    const response: BatchResponse = {};

    const results = correlateBatchResponses(requests, response);

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(0);
  });

  test("handles empty requests array", () => {
    const response: BatchResponse = {
      Responses: [{ RequestId: 0, ResponseCode: 200 }]
    };

    const results = correlateBatchResponses([], response);
    expect(results).toHaveLength(0);
  });

  test("preserves error response bodies", () => {
    const requests: BatchRequestItem[] = [
      { RequestId: 0, URL: "/remote/object/call", Verb: "PUT" }
    ];
    const response: BatchResponse = {
      Responses: [
        { RequestId: 0, ResponseCode: 404, ResponseBody: { errorMessage: "not found" } }
      ]
    };

    const results = correlateBatchResponses(requests, response);

    expect(results[0]?.statusCode).toBe(404);
    expect(results[0]?.body).toEqual({ errorMessage: "not found" });
  });

  test("handles many requests with out-of-order responses", () => {
    const requests: BatchRequestItem[] = Array.from({ length: 5 }, (_, i) => ({
      RequestId: i,
      URL: `/remote/op/${i}`,
      Verb: "PUT" as const
    }));

    const response: BatchResponse = {
      Responses: [
        { RequestId: 4, ResponseCode: 200, ResponseBody: { id: 4 } },
        { RequestId: 1, ResponseCode: 200, ResponseBody: { id: 1 } },
        { RequestId: 3, ResponseCode: 500, ResponseBody: { error: "fail" } },
        { RequestId: 0, ResponseCode: 200, ResponseBody: { id: 0 } }
        // RequestId 2 is missing
      ]
    };

    const results = correlateBatchResponses(requests, response);

    expect(results).toHaveLength(5);
    expect(results[0]?.body).toEqual({ id: 0 });
    expect(results[1]?.body).toEqual({ id: 1 });
    expect(results[2]?.statusCode).toBe(0);
    expect(results[2]?.body).toBeUndefined();
    expect(results[3]?.statusCode).toBe(500);
    expect(results[4]?.body).toEqual({ id: 4 });
  });
});

// ── Client batch integration ─────────────────────────────────────────

describe("client.batch", () => {
  test("sends empty batch when builder has no requests", async () => {
    const { client, requests } = makeHttpClient([
      { body: { Responses: [] }, statusCode: 200 }
    ]);

    const results = await client.batch(() => {});

    expect(results).toHaveLength(0);
    expect(requests[0]?.body).toEqual({ Requests: [] });
  });

  test("sends single-item batch", async () => {
    const { client, requests } = makeHttpClient([
      {
        body: {
          Responses: [
            { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: 42 } }
          ]
        },
        statusCode: 200
      }
    ]);

    const results = await client.batch((b) => {
      b.call("/Game/Maps/Main.Main:Actor", "GetValue");
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.statusCode).toBe(200);
    expect(results[0]?.body).toEqual({ ReturnValue: 42 });
  });

  test("handles all-failure batch responses", async () => {
    const { client } = makeHttpClient([
      {
        body: {
          Responses: [
            { RequestId: 0, ResponseCode: 500, ResponseBody: { error: "a" } },
            { RequestId: 1, ResponseCode: 404, ResponseBody: { error: "b" } }
          ]
        },
        statusCode: 200
      }
    ]);

    const results = await client.batch((b) => {
      b.call("/Game/Maps/Main.Main:Actor", "Fail1");
      b.call("/Game/Maps/Main.Main:Actor", "Fail2");
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.statusCode).toBe(500);
    expect(results[1]?.statusCode).toBe(404);
  });

  test("handles batch with mixed operation types", async () => {
    const { client, requests } = makeHttpClient([
      {
        body: {
          Responses: [
            { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: true } },
            { RequestId: 1, ResponseCode: 200, ResponseBody: { Name: "Actor" } },
            { RequestId: 2, ResponseCode: 200, ResponseBody: { Counter: 42 } },
            { RequestId: 3, ResponseCode: 200, ResponseBody: {} }
          ]
        },
        statusCode: 200
      }
    ]);

    const results = await client.batch((b) => {
      b.call("/Game/Maps/Main.Main:Actor", "Reset");
      b.describe("/Game/Maps/Main.Main:Actor");
      b.getProperty("/Game/Maps/Main.Main:Actor", "Counter");
      b.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 0);
    });

    expect(results).toHaveLength(4);

    const batchBody = requests[0]?.body as { Requests: BatchRequestItem[] };
    expect(batchBody.Requests).toHaveLength(4);
    expect(batchBody.Requests[0]?.URL).toBe("/remote/object/call");
    expect(batchBody.Requests[1]?.URL).toBe("/remote/object/describe");
    expect(batchBody.Requests[2]?.URL).toBe("/remote/object/property");
    expect(batchBody.Requests[3]?.URL).toBe("/remote/object/property");
  });

  test("propagates HTTP-level batch failure as error", async () => {
    const { client } = makeHttpClient([
      { body: { error: "server error" }, statusCode: 500 }
    ]);

    await expect(
      client.batch((b) => {
        b.call("/Game/Maps/Main.Main:Actor", "Ping");
      })
    ).rejects.toMatchObject({
      kind: "http_status",
      statusCode: 500
    });
  });

  test("supports async builder callback", async () => {
    const { client } = makeHttpClient([
      {
        body: {
          Responses: [
            { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: 1 } }
          ]
        },
        statusCode: 200
      }
    ]);

    const results = await client.batch(async (b) => {
      await Promise.resolve();
      b.call("/Game/Maps/Main.Main:Actor", "Ping");
    });

    expect(results).toHaveLength(1);
  });
});
