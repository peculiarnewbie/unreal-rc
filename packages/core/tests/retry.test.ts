import { afterEach, describe, expect, test } from "bun:test";
import { TransportRequestError, UnrealRC } from "../src/index.js";

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

// ── Retry tests ──────────────────────────────────────────────────────

describe("retry logic", () => {
  test("retries 502 Bad Gateway and succeeds on next attempt", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "gateway" }, statusCode: 502 },
        { body: { ReturnValue: 1 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(1);
    expect(requests).toHaveLength(2);
  });

  test("retries 503 Service Unavailable", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 2 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(2);
    expect(requests).toHaveLength(2);
  });

  test("retries 504 Gateway Timeout", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "timeout" }, statusCode: 504 },
        { body: { ReturnValue: 3 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(3);
    expect(requests).toHaveLength(2);
  });

  test("does not retry 400 Bad Request", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "bad request" }, statusCode: 400 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(requests).toHaveLength(1);
  });

  test("does not retry 404 Not Found", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "not found" }, statusCode: 404 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(requests).toHaveLength(1);
  });

  test("does not retry 500 Internal Server Error", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "internal" }, statusCode: 500 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(requests).toHaveLength(1);
  });

  test("exhausts all retry attempts then throws the last error", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { error: "busy" }, statusCode: 503 },
        { body: { error: "busy" }, statusCode: 503 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({
      kind: "http_status",
      statusCode: 503
    });
    expect(requests).toHaveLength(3);
  });

  test("does not retry when maxAttempts is 1", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 1, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(requests).toHaveLength(1);
  });

  test("does not retry when retry is false at client level", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: false }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(requests).toHaveLength(1);
  });

  test("per-call retry: false overrides client-level retry", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping", undefined, { retry: false })
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(requests).toHaveLength(1);
  });

  test("per-call retry policy overrides client-level defaults", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 10 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const result = await client.call(
      "/Game/Maps/Main.Main:Actor",
      "Ping",
      undefined,
      { retry: { maxAttempts: 3, delayMs: 0 } }
    );

    expect(result.ReturnValue).toBe(10);
    expect(requests).toHaveLength(3);
  });

  test("retries network-level fetch errors (connection refused)", async () => {
    const { client, requests } = makeHttpClient(
      [
        new TypeError("fetch failed"),
        { body: { ReturnValue: 77 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(77);
    expect(requests).toHaveLength(2);
  });

  test("retries succeed across multiple methods (info, describe, getProperty)", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { HttpRoutes: [] }, statusCode: 200 },
        { body: { error: "busy" }, statusCode: 503 },
        { body: { Name: "Actor" }, statusCode: 200 },
        { body: { error: "busy" }, statusCode: 503 },
        { body: { Counter: 42 }, statusCode: 200 }
      ],
      { retry: { maxAttempts: 2, delayMs: 0 } }
    );

    const info = await client.info();
    expect(info.HttpRoutes).toEqual([]);

    const desc = await client.describe("/Game/Maps/Main.Main:Actor");
    expect(desc.Name).toBe("Actor");

    const value = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Counter");
    expect(value).toBe(42);

    expect(requests).toHaveLength(6);
  });

  test("retry with boolean true uses default retry policy", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 5 }, statusCode: 200 }
      ],
      { retry: true }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(5);
    expect(requests).toHaveLength(2);
  });

  test("custom shouldRetry can make non-retryable errors retryable", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "not found" }, statusCode: 404 },
        { body: { ReturnValue: 8 }, statusCode: 200 }
      ],
      {
        retry: {
          maxAttempts: 2,
          delayMs: 0,
          shouldRetry: () => true
        }
      }
    );

    const result = await client.call("/Game/Maps/Main.Main:Actor", "Ping");
    expect(result.ReturnValue).toBe(8);
    expect(requests).toHaveLength(2);
  });

  test("custom shouldRetry can suppress retries for normally-retryable errors", async () => {
    const { client, requests } = makeHttpClient(
      [
        { body: { error: "busy" }, statusCode: 503 },
        { body: { ReturnValue: 99 }, statusCode: 200 }
      ],
      {
        retry: {
          maxAttempts: 3,
          delayMs: 0,
          shouldRetry: () => false
        }
      }
    );

    await expect(
      client.call("/Game/Maps/Main.Main:Actor", "Ping")
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(requests).toHaveLength(1);
  });
});
