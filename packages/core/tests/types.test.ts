import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  BatchRequestItemSchema,
  ObjectCallRequestSchema,
  ObjectCallResponseSchema,
  ObjectPropertyRequestSchema,
  SearchAssetsRequestSchema
} from "../src/index.js";

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
