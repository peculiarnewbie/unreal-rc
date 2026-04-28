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

// ── Client method overloads ───────────────────────────────────────────

describe("client method overloads", () => {
  test("call with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: {}, statusCode: 200 }, { body: {}, statusCode: 200 }]);

    await client.call("/Game/Maps/Main.Main:Actor", "DoThing", { Delta: 5 }, { transaction: true });
    await client.call({ objectPath: "/Game/Maps/Main.Main:Actor", functionName: "DoThing", parameters: { Delta: 5 }, transaction: true });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("getProperty with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: { Counter: 10 }, statusCode: 200 }, { body: { Counter: 10 }, statusCode: 200 }]);

    await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Counter");
    await client.getProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter" });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("getProperties with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: { Counter: 10 }, statusCode: 200 }, { body: { Counter: 10 }, statusCode: 200 }]);

    await client.getProperties("/Game/Maps/Main.Main:Actor");
    await client.getProperties({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("setProperty with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: {}, statusCode: 200 }, { body: {}, statusCode: 200 }]);

    await client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 42);
    await client.setProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter", propertyValue: 42 });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("describe with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: { Name: "Test" }, statusCode: 200 }, { body: { Name: "Test" }, statusCode: 200 }]);

    await client.describe("/Game/Maps/Main.Main:Actor");
    await client.describe({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("searchAssets with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: { Assets: [] }, statusCode: 200 }, { body: { Assets: [] }, statusCode: 200 }]);

    await client.searchAssets("Chair", { recursivePaths: true });
    await client.searchAssets({ query: "Chair", recursivePaths: true });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });

  test("thumbnail with positional args produces same body as object args", async () => {
    const { client, requests } = makeHttpClient([{ body: "data:image/png;base64,abc", statusCode: 200 }, { body: "data:image/png;base64,abc", statusCode: 200 }]);

    await client.thumbnail("/Game/Maps/Main.Main:Actor");
    await client.thumbnail({ objectPath: "/Game/Maps/Main.Main:Actor" });

    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.url).toBe(requests[1]?.url);
  });
});

// ── Batch helper overloads ───────────────────────────────────────────

describe("batch helper overloads", () => {
  test("buildCallRequest with positional args matches object args", () => {
    const positional = buildCallRequest("/Game/Maps/Main.Main:Actor", "DoThing", { Delta: 5 }, { transaction: true });
    const objectForm = buildCallRequest({ objectPath: "/Game/Maps/Main.Main:Actor", functionName: "DoThing", parameters: { Delta: 5 }, transaction: true });

    expect(positional).toEqual(objectForm);
  });
});

// ── BatchBuilder method overloads ─────────────────────────────────────

describe("BatchBuilder method overloads", () => {
  test("call with positional args matches object args", () => {
    const b1 = new BatchBuilder();
    const b2 = new BatchBuilder();

    b1.call("/Game/Maps/Main.Main:Actor", "DoThing", { Delta: 5 });
    b2.call({ objectPath: "/Game/Maps/Main.Main:Actor", functionName: "DoThing", parameters: { Delta: 5 } });

    expect(b1["getRequests"]()).toEqual(b2["getRequests"]());
  });

  test("getProperty with positional args matches object args", () => {
    const b1 = new BatchBuilder();
    const b2 = new BatchBuilder();

    b1.getProperty("/Game/Maps/Main.Main:Actor", "Counter");
    b2.getProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter" });

    expect(b1["getRequests"]()).toEqual(b2["getRequests"]());
  });

  test("setProperty with positional args matches object args", () => {
    const b1 = new BatchBuilder();
    const b2 = new BatchBuilder();

    b1.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 42);
    b2.setProperty({ objectPath: "/Game/Maps/Main.Main:Actor", propertyName: "Counter", propertyValue: 42 });

    expect(b1["getRequests"]()).toEqual(b2["getRequests"]());
  });

  test("searchAssets with positional args matches object args", () => {
    const b1 = new BatchBuilder();
    const b2 = new BatchBuilder();

    b1.searchAssets("Chair", { recursivePaths: true });
    b2.searchAssets({ query: "Chair", recursivePaths: true });

    expect(b1["getRequests"]()).toEqual(b2["getRequests"]());
  });
});
