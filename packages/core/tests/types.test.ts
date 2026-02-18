import { describe, expect, test } from "bun:test";
import {
  BatchRequestItemSchema,
  ObjectCallRequestSchema,
  ObjectCallResponseSchema,
  ObjectPropertyRequestSchema,
  SearchAssetsRequestSchema
} from "../src/types.js";

describe("types schemas", () => {
  test("enforces strict object call request shape", () => {
    expect(() =>
      ObjectCallRequestSchema.parse({
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: "DoThing",
        extra: true
      })
    ).toThrow();
  });

  test("allows passthrough keys for search assets request", () => {
    const parsed = SearchAssetsRequestSchema.parse({
      query: "Chair",
      vendorExtension: "ok"
    });

    expect(parsed.query).toBe("Chair");
    expect((parsed as Record<string, unknown>).vendorExtension).toBe("ok");
  });

  test("validates batch request ids", () => {
    expect(() =>
      BatchRequestItemSchema.parse({
        RequestId: -1,
        URL: "/remote/info",
        Verb: "GET"
      })
    ).toThrow();

    expect(() =>
      BatchRequestItemSchema.parse({
        RequestId: 1.5,
        URL: "/remote/info",
        Verb: "GET"
      })
    ).toThrow();
  });

  test("requires non-empty object path for property requests", () => {
    expect(() =>
      ObjectPropertyRequestSchema.parse({
        objectPath: "",
        propertyName: "Counter"
      })
    ).toThrow();
  });

  test("allows passthrough fields for object call responses", () => {
    const parsed = ObjectCallResponseSchema.parse({ ReturnValue: 1, Custom: true });
    expect(parsed.ReturnValue).toBe(1);
    expect((parsed as Record<string, unknown>).Custom).toBe(true);
  });
});
