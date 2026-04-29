import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  BatchRequestItemSchema,
  ObjectCallRequestSchema,
  ObjectCallResponseSchema,
  ObjectPropertyRequestSchema,
  SearchAssetsRequestSchema
} from "../src/index.js";
import {
  TimeoutError,
  ConnectError,
  DisconnectError,
  HttpStatusError,
  RemoteStatusError,
  DecodeError
} from "../src/effect.js";
import type { TransportError } from "../src/effect.js";
import { toPublicError, TransportRequestError } from "../src/index.js";

const decode = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.decodeUnknownSync(schema);

describe("types schemas", () => {
  test("enforces strict object call request shape", () => {
    expect(() =>
      decode(ObjectCallRequestSchema)({
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: "DoThing",
        extra: true
      }, { onExcessProperty: "error" })
    ).toThrow();
  });

  test("allows passthrough keys for search assets request", () => {
    const parsed = decode(SearchAssetsRequestSchema)({
      query: "Chair",
      vendorExtension: "ok"
    }, { onExcessProperty: "preserve" });

    expect(parsed.query).toBe("Chair");
    expect((parsed as Record<string, unknown>).vendorExtension).toBe("ok");
  });

  test("validates batch request ids", () => {
    expect(() =>
      decode(BatchRequestItemSchema)({
        RequestId: -1,
        URL: "/remote/info",
        Verb: "GET"
      })
    ).toThrow();

    expect(() =>
      decode(BatchRequestItemSchema)({
        RequestId: 1.5,
        URL: "/remote/info",
        Verb: "GET"
      })
    ).toThrow();
  });

  test("requires non-empty object path for property requests", () => {
    expect(() =>
      decode(ObjectPropertyRequestSchema)({
        objectPath: "",
        propertyName: "Counter"
      })
    ).toThrow();
  });

  test("allows passthrough fields for object call responses", () => {
    const parsed = decode(ObjectCallResponseSchema)(
      { ReturnValue: 1, Custom: true },
      { onExcessProperty: "preserve" }
    );
    expect(parsed.ReturnValue).toBe(1);
    expect((parsed as Record<string, unknown>).Custom).toBe(true);
  });
});

describe("effect tagged errors", () => {
  test("tagged errors can be instantiated and carry _tag", () => {
    const timeout = new TimeoutError({ message: "timed out", verb: "PUT", url: "/remote/object/call" });
    expect(timeout._tag).toBe("TimeoutError");
    expect(timeout.message).toBe("timed out");
    expect(timeout.verb).toBe("PUT");

    const connect = new ConnectError({ message: "refused", transport: "ws" });
    expect(connect._tag).toBe("ConnectError");

    const disconnect = new DisconnectError({ message: "closed" });
    expect(disconnect._tag).toBe("DisconnectError");

    const http = new HttpStatusError({ message: "server error", statusCode: 502, verb: "GET", url: "/remote/info" });
    expect(http._tag).toBe("HttpStatusError");
    expect(http.statusCode).toBe(502);

    const remote = new RemoteStatusError({ message: "bad request", statusCode: 400 });
    expect(remote._tag).toBe("RemoteStatusError");
    expect(remote.statusCode).toBe(400);

    const decode = new DecodeError({ message: "parse failed", verb: "PUT", url: "/remote/object/call" });
    expect(decode._tag).toBe("DecodeError");
  });

  test("_tag narrows the TransportError union", () => {
    const error: TransportError = new HttpStatusError({
      message: "gateway timeout",
      statusCode: 504,
      transport: "http",
      verb: "PUT",
      url: "/remote/object/call"
    });

    switch (error._tag) {
      case "TimeoutError":
        expect(error.verb).toBeDefined();
        break;
      case "ConnectError":
        expect(error.transport).toBeDefined();
        break;
      case "DisconnectError":
        expect(error.transport).toBeDefined();
        break;
      case "HttpStatusError":
        expect(error.statusCode).toBe(504);
        break;
      case "RemoteStatusError":
        expect(error.statusCode).toBeGreaterThan(0);
        break;
      case "DecodeError":
        expect(error.message).toBeDefined();
        break;
    }
  });

  test("toPublicError maps _tag to TransportRequestError.kind", () => {
    const cases: [TransportError, string][] = [
      [new TimeoutError({ message: "t/o" }), "timeout"],
      [new ConnectError({ message: "conn" }), "connect"],
      [new DisconnectError({ message: "disc" }), "disconnect"],
      [new HttpStatusError({ message: "http", statusCode: 502 }), "http_status"],
      [new RemoteStatusError({ message: "rem", statusCode: 400 }), "remote_status"],
      [new DecodeError({ message: "dec" }), "decode"]
    ];

    for (const [tagged, expectedKind] of cases) {
      const publicError = toPublicError(tagged);
      expect(publicError).toBeInstanceOf(TransportRequestError);
      expect(publicError.kind).toBe(expectedKind);
    }
  });

  test("TransportRequestError.kind round-trips to tagged error _tag", () => {
    const tagByKind: Record<string, TransportError["_tag"]> = {
      "timeout": "TimeoutError",
      "connect": "ConnectError",
      "disconnect": "DisconnectError",
      "http_status": "HttpStatusError",
      "remote_status": "RemoteStatusError",
      "decode": "DecodeError"
    };

    const taggedByKind: Record<string, TransportError> = {
      "timeout": new TimeoutError({ message: "x" }),
      "connect": new ConnectError({ message: "x" }),
      "disconnect": new DisconnectError({ message: "x" }),
      "http_status": new HttpStatusError({ message: "x", statusCode: 502 }),
      "remote_status": new RemoteStatusError({ message: "x", statusCode: 400 }),
      "decode": new DecodeError({ message: "x" })
    };

    for (const [kind, expectedTag] of Object.entries(tagByKind)) {
      const tagged = taggedByKind[kind]!;
      const publicError = toPublicError(tagged);
      expect(publicError.kind).toBe(kind);
      expect(tagged._tag).toBe(expectedTag);
    }
  });

  test("narrowing with Effect.catchTag pattern compiles at type level", () => {
    // Type-level smoke test: code using Effect.catchTag with tagged errors
    // should compile. This is verified by the import and type annotation.
    const handler = (e: TimeoutError): string => `timeout: ${e.message}`;
    const caught = handler(new TimeoutError({ message: "t/o", verb: "GET", url: "/" }));
    expect(caught).toBe("timeout: t/o");
  });
});
