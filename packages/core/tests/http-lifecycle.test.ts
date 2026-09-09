import { createServer, type RequestListener } from "node:http";
import { Effect, Fiber, ManagedRuntime } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { HttpTransportLive } from "../src/internal/http.js";
import { Transport } from "../src/internal/transport.js";
import { UnrealRC, TransportRequestError } from "../src/index.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup.length = 0;
});

const startServer = async (listener: RequestListener) => {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing server address");
  return `http://127.0.0.1:${address.port}`;
};

const makeTransport = async (baseUrl: string) => {
  const runtime = ManagedRuntime.make(HttpTransportLive({ baseUrl }));
  cleanup.push(() => runtime.dispose());
  return runtime.runPromise(Transport);
};

describe("HTTP lifecycle", () => {
  test("reusing a layer across runtimes keeps disposal independent", async () => {
    const baseUrl = await startServer((_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
    });
    const layer = HttpTransportLive({ baseUrl });
    const first = ManagedRuntime.make(layer);
    const second = ManagedRuntime.make(layer);
    cleanup.push(
      () => first.dispose(),
      () => second.dispose(),
    );
    const firstTransport = await first.runPromise(Transport);
    const secondTransport = await second.runPromise(Transport);
    await first.dispose();
    await expect(
      Effect.runPromise(firstTransport.request({ verb: "GET", url: "/closed" })),
    ).rejects.toMatchObject({ _tag: "DisconnectError" });
    expect(
      await second.runPromise(secondTransport.request({ verb: "GET", url: "/open" })),
    ).toMatchObject({ statusCode: 200 });
  });

  test("runtime disposal aborts requests made through its acquired service", async () => {
    let received = false;
    const baseUrl = await startServer(() => {
      received = true;
    });
    const runtime = ManagedRuntime.make(HttpTransportLive({ baseUrl }));
    cleanup.push(() => runtime.dispose());
    const transport = await runtime.runPromise(Transport);
    const request = Effect.runPromise(
      transport.request({ verb: "GET", url: "/hang", timeoutMs: 0 }),
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(received).toBe(true));
    await runtime.dispose();
    expect(await request).toMatchObject({ _tag: "ConnectError" });
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
  });

  test("interrupting a request aborts the real connection and clears pending state", async () => {
    let received = false;
    let closed = false;
    const baseUrl = await startServer((_request, response) => {
      received = true;
      response.on("close", () => {
        closed = true;
      });
    });
    const transport = await makeTransport(baseUrl);
    const fiber = Effect.runFork(transport.request({ verb: "GET", url: "/hang", timeoutMs: 0 }));
    await vi.waitFor(() => expect(received).toBe(true));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
    await vi.waitFor(() => expect(closed).toBe(true));
  });

  test.each([
    { label: "invalid URL", url: "http://[", body: undefined },
    { label: "unserializable body", url: "/request", body: { value: 1n } },
  ])("normalizes $label failures and clears pending state", async ({ url, body }) => {
    const client = new UnrealRC({ transport: "http" });
    cleanup.push(() => client.dispose());
    await expect(client.requestRaw({ verb: "PUT", url, body })).rejects.toMatchObject({
      name: "TransportRequestError",
      kind: "connect",
      cause: expect.any(Error),
    });
    expect(await client.pendingRequests()).toEqual([]);
  });

  test("preserves a caller's Content-Type header regardless of casing", async () => {
    const baseUrl = await startServer((request, response) => {
      request.resume();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ contentType: request.headers["content-type"] }));
    });
    const client = new UnrealRC({
      transport: "http",
      http: { baseUrl, headers: { "Content-Type": "application/custom+json" } },
    });
    cleanup.push(() => client.dispose());
    expect(await client.request({ verb: "PUT", url: "/headers", body: {} })).toEqual({
      contentType: "application/custom+json",
    });
  });

  test("a real request timeout is a public transport error and clears pending state", async () => {
    const baseUrl = await startServer(() => {});
    const client = new UnrealRC({ transport: "http", http: { baseUrl } });
    cleanup.push(() => client.dispose());
    const error = await client.info({ timeoutMs: 50 }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(TransportRequestError);
    expect(error).toMatchObject({ kind: "timeout" });
    expect(await client.pendingRequests()).toEqual([]);
  });

  test("disposed transports reject new requests", async () => {
    const transport = await makeTransport("http://127.0.0.1:30010");
    await Effect.runPromise(transport.dispose);
    await expect(
      Effect.runPromise(transport.request({ verb: "GET", url: "/info" })),
    ).rejects.toMatchObject({ _tag: "DisconnectError" });
  });
});
