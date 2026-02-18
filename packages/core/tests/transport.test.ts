import { describe, expect, test } from "bun:test";
import { TransportRequestError, isConnectableTransport, type ConnectableTransport } from "../src/transport.js";

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
      statusCode: 500,
      details: { reason: "bad" },
      cause
    });

    expect(error.name).toBe("TransportRequestError");
    expect(error.message).toBe("failed");
    expect(error.statusCode).toBe(500);
    expect(error.details).toEqual({ reason: "bad" });
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
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
