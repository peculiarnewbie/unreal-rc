import { afterEach, describe, expect, test } from "bun:test";
import {
  BatchBuilder,
  UnrealRC,
  buildCallRequest,
  type BatchRequestItem,
  type ObjectCallRequest,
  type ObjectPropertyRequest
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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const makeHttpClient = (responses: MockResponseEntry[]) => {
  const mock = createFetchMock(responses);
  const client = new UnrealRC({
    transport: "http",
    http: { baseUrl: "http://127.0.0.1:30010" },
    validateResponses: false
  } as ConstructorParameters<typeof UnrealRC>[0]);
  return { client, requests: mock.requests };
};

// ── Client method argument types ──────────────────────────────────────

describe("client method argument types", () => {
  test("call sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: {}, statusCode: 200 }]);

    await client.call({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "DoThing",
      parameters: { Delta: 5 },
      transaction: true
    });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/call");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(body?.functionName).toBe("DoThing");
    expect(body?.generateTransaction).toBe(true);
  });

  test("getProperty sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: { Counter: 10 }, statusCode: 200 }]);

    await client.getProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter" });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/property");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(body?.propertyName).toBe("Counter");
  });

  test("getProperties sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: { Counter: 10 }, statusCode: 200 }]);

    await client.getProperties({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/property");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
  });

  test("setProperty sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: {}, statusCode: 200 }]);

    await client.setProperty({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: 42
    });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/property");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(body?.propertyName).toBe("Counter");
  });

  test("describe sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: { Name: "Test" }, statusCode: 200 }]);

    await client.describe({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/describe");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
  });

  test("searchAssets sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: { Assets: [] }, statusCode: 200 }]);

    await client.searchAssets({ query: "Chair", recursivePaths: true });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/search/assets");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.query).toBe("Chair");
  });

  test("thumbnail sends correct body and url", async () => {
    const { client, requests } = makeHttpClient([{ body: "data:image/png;base64,abc", statusCode: 200 }]);

    await client.thumbnail({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.url).toBe("http://127.0.0.1:30010/remote/object/thumbnail");
    const body = requests[0]?.body as Record<string, unknown> | undefined;
    expect(body?.objectPath).toBe("/Game/Maps/Main.Main:Actor");
  });
});

// ── buildCallRequest ──────────────────────────────────────────────────

describe("buildCallRequest", () => {
  test("produces correct structure", () => {
    const result = buildCallRequest({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "DoThing",
      parameters: { Delta: 5 },
      transaction: true
    });

    expect(result.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(result.functionName).toBe("DoThing");
    expect(result.generateTransaction).toBe(true);
  });
});

// ── BatchBuilder method argument types ────────────────────────────────

describe("BatchBuilder argument types", () => {
  test("call adds correct request", () => {
    const b = new BatchBuilder();
    b.call({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "DoThing",
      parameters: { Delta: 5 }
    });

    const requests = (b as { getRequests(): BatchRequestItem[] }).getRequests();
    expect(requests).toHaveLength(1);
  });

  test("getProperty adds correct request", () => {
    const b = new BatchBuilder();
    b.getProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter" });

    const requests = (b as { getRequests(): BatchRequestItem[] }).getRequests();
    expect(requests).toHaveLength(1);
  });

  test("setProperty adds correct request", () => {
    const b = new BatchBuilder();
    b.setProperty({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: 42
    });

    const requests = (b as { getRequests(): BatchRequestItem[] }).getRequests();
    expect(requests).toHaveLength(1);
  });

  test("searchAssets adds correct request", () => {
    const b = new BatchBuilder();
    b.searchAssets({ query: "Chair", recursivePaths: true });

    const requests = (b as { getRequests(): BatchRequestItem[] }).getRequests();
    expect(requests).toHaveLength(1);
  });
});
