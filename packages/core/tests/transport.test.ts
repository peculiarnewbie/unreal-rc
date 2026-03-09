import { describe, expect, test } from "bun:test";
import {
  TransportRequestError,
  isConnectableTransport,
  toTransportRequestError,
  type ConnectableTransport
} from "../src/transport.js";

class ConnectableStub implements ConnectableTransport {
  connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async request(): Promise<unknown> {
    return {};
  }

  dispose(): void {}
}

describe("transport helpers", () => {
  test("creates transport request errors with metadata", () => {
    const cause = new Error("boom");
    const error = new TransportRequestError("failed", {
      kind: "http_status",
      statusCode: 500,
      details: { reason: "bad" },
      verb: "PUT",
      url: "/remote/object/call",
      transport: "http",
      requestId: 7,
      cause
    });

    expect(error.name).toBe("TransportRequestError");
    expect(error.message).toBe("failed");
    expect(error.kind).toBe("http_status");
    expect(error.statusCode).toBe(500);
    expect(error.details).toEqual({ reason: "bad" });
    expect(error.verb).toBe("PUT");
    expect(error.url).toBe("/remote/object/call");
    expect(error.transport).toBe("http");
    expect(error.requestId).toBe(7);
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
  });

  test("normalizes unknown errors into transport request errors", () => {
    const error = toTransportRequestError(new Error("boom"), {
      kind: "connect",
      verb: "GET",
      url: "/remote/info",
      transport: "ws"
    });

    expect(error).toBeInstanceOf(TransportRequestError);
    expect(error.kind).toBe("connect");
    expect(error.verb).toBe("GET");
    expect(error.url).toBe("/remote/info");
    expect(error.transport).toBe("ws");
  });

  test("detects connectable transport shape", () => {
    const connectable = new ConnectableStub();
    const plain = {
      request: async (): Promise<unknown> => ({}),
      dispose: (): void => {}
    };

    expect(isConnectableTransport(connectable)).toBe(true);
    expect(isConnectableTransport(plain)).toBe(false);
  });
});
