import { Deferred, Effect, Fiber, ManagedRuntime } from "effect";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocketTransportLive, type WebSocketTransportOptions } from "../src/internal/ws.js";
import { Transport } from "../src/internal/transport.js";

// Explicit events make connection races, immediate replies, and interruption deterministic.
class ControlledWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: ControlledWebSocket[] = [];
  readyState = ControlledWebSocket.CONNECTING;
  sent: Array<{ Parameters: { RequestId: number } }> = [];
  replyOnSend = false;

  constructor() {
    super();
    ControlledWebSocket.instances.push(this);
  }
  open() {
    this.readyState = ControlledWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  send(raw: string) {
    const envelope = JSON.parse(raw);
    this.sent.push(envelope);
    if (this.replyOnSend) {
      this.message({
        RequestId: envelope.Parameters.RequestId,
        ResponseCode: 200,
        ResponseBody: null,
      });
    }
  }
  message(body: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(body) }));
  }
  close() {
    if (this.readyState === ControlledWebSocket.CLOSED) return;
    this.readyState = ControlledWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.reverse()) await dispose();
  cleanup.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ControlledWebSocket.instances = [];
});

const setup = async (options: WebSocketTransportOptions = {}) => {
  vi.stubGlobal("WebSocket", ControlledWebSocket);
  const runtime = ManagedRuntime.make(
    WebSocketTransportLive({
      autoReconnect: false,
      pingIntervalMs: 0,
      ...options,
    }),
  );
  cleanup.push(() => runtime.dispose());
  const transport = await runtime.runPromise(Transport);
  await vi.waitFor(() => expect(ControlledWebSocket.instances).toHaveLength(1));
  const socket = ControlledWebSocket.instances[0];
  if (!socket) throw new Error("Missing socket");
  return { runtime, transport, socket };
};

describe("WebSocket lifecycle", () => {
  test("concurrent requests correlate replies arriving in reverse order", async () => {
    const { transport, socket } = await setup();
    socket.open();
    const requests = Array.from({ length: 64 }, (_, index) =>
      Effect.runPromise(transport.request({ verb: "GET", url: `/value/${index}` })),
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(64));
    for (const envelope of [...socket.sent].reverse()) {
      const requestId = envelope.Parameters.RequestId;
      socket.message({ RequestId: requestId, ResponseCode: 200, ResponseBody: requestId });
    }
    expect((await Promise.all(requests)).map((response) => response.body)).toEqual(
      Array.from({ length: 64 }, (_, index) => index + 1),
    );
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
  });

  test("successful requests cancel their deadline while the calling fiber keeps running", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { transport, socket } = await setup();
    socket.replyOnSend = true;
    socket.open();
    const completed = Effect.runSync(Deferred.make<void>());
    const fiber = Effect.runFork(
      transport
        .request({ verb: "GET", url: "/fast", timeoutMs: 15000 })
        .pipe(Effect.andThen(Deferred.succeed(completed, undefined)), Effect.andThen(Effect.never)),
    );
    try {
      await Effect.runPromise(Deferred.await(completed));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await Effect.runPromise(Fiber.interrupt(fiber));
    }
  });

  test.each([null, true, 200.5])(
    "invalid response status %s fails with request metadata",
    async (status) => {
      const { transport, socket } = await setup();
      socket.open();
      const request = Effect.runPromise(transport.request({ verb: "GET", url: "/invalid" })).catch(
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
      socket.message({ RequestId: 1, ResponseCode: status });
      expect(await request).toMatchObject({
        _tag: "DecodeError",
        requestId: 1,
        verb: "GET",
        url: "/invalid",
      });
    },
  );

  test("expired queued requests release capacity before a reconnect", async () => {
    const { transport, socket } = await setup({ maxQueueSize: 1 });
    await expect(
      Effect.runPromise(transport.request({ verb: "GET", url: "/expired", timeoutMs: 10 })),
    ).rejects.toMatchObject({ _tag: "TimeoutError" });
    const request = Effect.runPromise(transport.request({ verb: "GET", url: "/next" }));
    socket.replyOnSend = true;
    socket.open();
    expect(await request).toMatchObject({ statusCode: 200 });
    expect(socket.sent).toHaveLength(1);
  });

  test("a full disconnected queue rejects promptly instead of suspending past its deadline", async () => {
    const { transport } = await setup({ maxQueueSize: 1 });
    const first = Effect.runPromise(
      transport.request({ verb: "GET", url: "/first", timeoutMs: 0 }),
    ).catch((error: unknown) => error);
    await expect(
      Effect.runPromise(transport.request({ verb: "GET", url: "/second", timeoutMs: 20 })),
    ).rejects.toMatchObject({
      _tag: "DisconnectError",
      message: expect.stringContaining("queue limit"),
    });
    await Effect.runPromise(transport.dispose);
    expect(await first).toMatchObject({ _tag: "DisconnectError" });
  });

  test.each([false, true])(
    "disposal settles requests when connected=%s without a timeout",
    async (connected) => {
      const { transport, socket } = await setup();
      if (connected) socket.open();
      const request = Effect.runPromise(
        transport.request({ verb: "GET", url: "/hang", timeoutMs: 0 }),
      ).catch((error: unknown) => error);
      if (connected) await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
      await Effect.runPromise(transport.dispose);
      expect(await request).toMatchObject({ _tag: "DisconnectError" });
      expect(socket.readyState).toBe(ControlledWebSocket.CLOSED);
      expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
    },
  );

  test("runtime disposal closes a connection still being established", async () => {
    const { runtime, socket } = await setup();
    await runtime.dispose();
    expect(socket.readyState).toBe(ControlledWebSocket.CLOSED);
  });

  test("disconnect settles in-flight requests immediately", async () => {
    const { transport, socket } = await setup();
    socket.open();
    const request = Effect.runPromise(
      transport.request({ verb: "GET", url: "/hang", timeoutMs: 0 }),
    ).catch((error: unknown) => error);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.close();
    expect(await request).toMatchObject({ _tag: "DisconnectError" });
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
  });

  test("interruption removes in-flight requests", async () => {
    const { transport, socket } = await setup();
    socket.open();
    const fiber = Effect.runFork(transport.request({ verb: "GET", url: "/hang", timeoutMs: 0 }));
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
  });

  test("immediate responses are correlated and preserve a JSON null body", async () => {
    const { transport, socket } = await setup();
    socket.replyOnSend = true;
    socket.open();
    expect(await Effect.runPromise(transport.request({ verb: "GET", url: "/null" }))).toMatchObject(
      { body: null, statusCode: 200 },
    );
    expect(await Effect.runPromise(transport.pendingRequests)).toEqual([]);
  });

  test("unrelated JSON and boolean IDs cannot resolve a pending request", async () => {
    const { transport, socket } = await setup();
    socket.open();
    const request = Effect.runPromise(transport.request({ verb: "GET", url: "/value" }));
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    socket.message(null);
    socket.message([]);
    socket.message({ RequestId: true, ResponseCode: 200, ResponseBody: "wrong" });
    socket.message({ RequestId: "1", ResponseCode: "200", ResponseBody: "correct" });
    expect(await request).toMatchObject({ body: "correct" });
  });
});
