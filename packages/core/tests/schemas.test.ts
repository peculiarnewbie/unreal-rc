import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AccessModeSchema,
  AssetInfoSchema,
  BatchRequestItemSchema,
  BatchRequestSchema,
  BatchResponseItemSchema,
  BatchResponseSchema,
  FunctionArgumentSchema,
  FunctionMetadataSchema,
  HttpVerbSchema,
  InfoResponseSchema,
  ObjectCallRequestSchema,
  ObjectCallResponseSchema,
  ObjectDescribeRequestSchema,
  ObjectDescribeResponseSchema,
  ObjectEventRequestSchema,
  ObjectEventResponseSchema,
  ObjectPropertyRequestSchema,
  ObjectPropertyResponseSchema,
  ObjectThumbnailRequestSchema,
  ObjectThumbnailResponseSchema,
  PropertyMetadataSchema,
  RouteInfoSchema,
  SearchAssetsRequestSchema,
  SearchAssetsResponseSchema
} from "../src/index.js";

const decode = <S extends Schema.Schema.Any>(schema: S) =>
  Schema.decodeUnknownSync(schema);

// ── Enum schemas ──────────────────────────────────────────────────────

describe("HttpVerbSchema", () => {
  test("accepts all valid HTTP verbs", () => {
    for (const verb of ["GET", "PUT", "POST", "PATCH", "DELETE"]) {
      expect(decode(HttpVerbSchema)(verb)).toBe(verb);
    }
  });

  test("rejects invalid verb", () => {
    expect(() => decode(HttpVerbSchema)("OPTIONS")).toThrow();
    expect(() => decode(HttpVerbSchema)("get")).toThrow();
    expect(() => decode(HttpVerbSchema)("")).toThrow();
  });
});

describe("AccessModeSchema", () => {
  test("accepts all valid access modes", () => {
    for (const mode of ["READ_ACCESS", "WRITE_ACCESS", "WRITE_TRANSACTION_ACCESS"]) {
      expect(decode(AccessModeSchema)(mode)).toBe(mode);
    }
  });

  test("rejects invalid access mode", () => {
    expect(() => decode(AccessModeSchema)("ADMIN_ACCESS")).toThrow();
    expect(() => decode(AccessModeSchema)("read_access")).toThrow();
  });
});

// ── Object Call schemas ───────────────────────────────────────────────

describe("ObjectCallRequestSchema", () => {
  test("decodes minimal call request", () => {
    const result = decode(ObjectCallRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "DoThing"
    });
    expect(result.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(result.functionName).toBe("DoThing");
  });

  test("decodes call request with parameters and transaction", () => {
    const result = decode(ObjectCallRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "Add",
      parameters: { Delta: 5, Label: "test" },
      generateTransaction: true
    });
    expect(result.parameters).toEqual({ Delta: 5, Label: "test" });
    expect(result.generateTransaction).toBe(true);
  });

  test("rejects empty objectPath", () => {
    expect(() =>
      decode(ObjectCallRequestSchema)({
        objectPath: "",
        functionName: "DoThing"
      })
    ).toThrow();
  });

  test("rejects empty functionName", () => {
    expect(() =>
      decode(ObjectCallRequestSchema)({
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: ""
      })
    ).toThrow();
  });

  test("rejects missing required fields", () => {
    expect(() => decode(ObjectCallRequestSchema)({})).toThrow();
    expect(() =>
      decode(ObjectCallRequestSchema)({ objectPath: "/Game/Maps/Main.Main:Actor" })
    ).toThrow();
  });
});

describe("ObjectCallResponseSchema", () => {
  test("decodes response with ReturnValue", () => {
    const result = decode(ObjectCallResponseSchema)({ ReturnValue: 42 });
    expect(result.ReturnValue).toBe(42);
  });

  test("decodes response without ReturnValue", () => {
    const result = decode(ObjectCallResponseSchema)({});
    expect(result.ReturnValue).toBeUndefined();
  });

  test("decodes response with complex ReturnValue", () => {
    const result = decode(ObjectCallResponseSchema)({
      ReturnValue: { X: 1, Y: 2, Z: 3 }
    });
    expect(result.ReturnValue).toEqual({ X: 1, Y: 2, Z: 3 });
  });
});

// ── Object Property schemas ──────────────────────────────────────────

describe("ObjectPropertyRequestSchema", () => {
  test("decodes read property request", () => {
    const result = decode(ObjectPropertyRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      access: "READ_ACCESS"
    });
    expect(result.access).toBe("READ_ACCESS");
  });

  test("decodes write property request with value", () => {
    const result = decode(ObjectPropertyRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: { Counter: 10 },
      access: "WRITE_ACCESS"
    });
    expect(result.propertyValue).toEqual({ Counter: 10 });
    expect(result.access).toBe("WRITE_ACCESS");
  });

  test("decodes minimal request with only objectPath", () => {
    const result = decode(ObjectPropertyRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor"
    });
    expect(result.objectPath).toBe("/Game/Maps/Main.Main:Actor");
    expect(result.propertyName).toBeUndefined();
  });

  test("rejects invalid access mode", () => {
    expect(() =>
      decode(ObjectPropertyRequestSchema)({
        objectPath: "/Game/Maps/Main.Main:Actor",
        access: "INVALID"
      })
    ).toThrow();
  });
});

describe("ObjectPropertyResponseSchema", () => {
  test("decodes property response as record", () => {
    const result = decode(ObjectPropertyResponseSchema)({ Counter: 42 });
    expect(result).toEqual({ Counter: 42 });
  });

  test("decodes empty response", () => {
    const result = decode(ObjectPropertyResponseSchema)({});
    expect(result).toEqual({});
  });
});

// ── Object Describe schemas ──────────────────────────────────────────

describe("ObjectDescribeRequestSchema", () => {
  test("decodes describe request", () => {
    const result = decode(ObjectDescribeRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor"
    });
    expect(result.objectPath).toBe("/Game/Maps/Main.Main:Actor");
  });

  test("rejects empty objectPath", () => {
    expect(() =>
      decode(ObjectDescribeRequestSchema)({ objectPath: "" })
    ).toThrow();
  });
});

describe("PropertyMetadataSchema", () => {
  test("decodes minimal property metadata", () => {
    const result = decode(PropertyMetadataSchema)({ Name: "Counter" });
    expect(result.Name).toBe("Counter");
  });

  test("decodes full property metadata", () => {
    const result = decode(PropertyMetadataSchema)({
      Name: "Counter",
      Description: "A counter value",
      Type: "int32",
      Metadata: { Category: "Stats" }
    });
    expect(result.Type).toBe("int32");
    expect(result.Metadata).toEqual({ Category: "Stats" });
  });

  test("rejects missing Name", () => {
    expect(() => decode(PropertyMetadataSchema)({})).toThrow();
  });
});

describe("FunctionArgumentSchema", () => {
  test("decodes minimal function argument", () => {
    const result = decode(FunctionArgumentSchema)({ Name: "Delta" });
    expect(result.Name).toBe("Delta");
  });

  test("decodes full function argument", () => {
    const result = decode(FunctionArgumentSchema)({
      Name: "Delta",
      Type: "int32",
      Description: "Amount to add",
      Metadata: { Range: "0-100" }
    });
    expect(result.Type).toBe("int32");
    expect(result.Description).toBe("Amount to add");
  });
});

describe("FunctionMetadataSchema", () => {
  test("decodes minimal function metadata", () => {
    const result = decode(FunctionMetadataSchema)({ Name: "AddToCounter" });
    expect(result.Name).toBe("AddToCounter");
  });

  test("decodes function metadata with arguments", () => {
    const result = decode(FunctionMetadataSchema)({
      Name: "AddToCounter",
      ReturnType: "int32",
      Arguments: [
        { Name: "Delta", Type: "int32" },
        { Name: "Label", Type: "FString" }
      ]
    });
    expect(result.Arguments).toHaveLength(2);
    expect(result.Arguments?.[0]?.Name).toBe("Delta");
    expect(result.ReturnType).toBe("int32");
  });

  test("rejects missing Name", () => {
    expect(() => decode(FunctionMetadataSchema)({})).toThrow();
  });
});

describe("ObjectDescribeResponseSchema", () => {
  test("decodes full describe response", () => {
    const result = decode(ObjectDescribeResponseSchema)({
      Name: "E2EFixtureActor",
      Class: "Blueprint",
      DisplayName: "E2E Fixture Actor",
      Path: "/Game/Maps/RemoteControlE2E.RemoteControlE2E:PersistentLevel.E2EFixtureActor_C_1",
      Properties: [{ Name: "Counter", Type: "int32" }],
      Functions: [
        {
          Name: "AddToCounter",
          ReturnType: "int32",
          Arguments: [{ Name: "Delta" }]
        }
      ]
    });
    expect(result.Name).toBe("E2EFixtureActor");
    expect(result.Properties).toHaveLength(1);
    expect(result.Functions).toHaveLength(1);
    expect(result.Functions?.[0]?.Arguments?.[0]?.Name).toBe("Delta");
  });

  test("decodes empty describe response", () => {
    const result = decode(ObjectDescribeResponseSchema)({});
    expect(result.Name).toBeUndefined();
    expect(result.Properties).toBeUndefined();
    expect(result.Functions).toBeUndefined();
  });
});

// ── Search Assets schemas ────────────────────────────────────────────

describe("SearchAssetsRequestSchema", () => {
  test("decodes search request with all fields", () => {
    const result = decode(SearchAssetsRequestSchema)({
      query: "Chair",
      classNames: ["StaticMesh"],
      packagePaths: ["/Game/Meshes"],
      recursivePaths: true,
      recursiveClasses: false,
      includeOnlyOnDiskAssets: true
    });
    expect(result.query).toBe("Chair");
    expect(result.classNames).toEqual(["StaticMesh"]);
    expect(result.recursivePaths).toBe(true);
  });

  test("decodes empty search request", () => {
    const result = decode(SearchAssetsRequestSchema)({});
    expect(result.query).toBeUndefined();
  });
});

describe("AssetInfoSchema", () => {
  test("decodes full asset info", () => {
    const result = decode(AssetInfoSchema)({
      Name: "Chair",
      ObjectPath: "/Game/Meshes/Chair.Chair",
      PackageName: "/Game/Meshes/Chair",
      PackagePath: "/Game/Meshes",
      AssetClass: "StaticMesh",
      Class: "StaticMesh"
    });
    expect(result.Name).toBe("Chair");
    expect(result.ObjectPath).toBe("/Game/Meshes/Chair.Chair");
  });

  test("decodes empty asset info", () => {
    const result = decode(AssetInfoSchema)({});
    expect(result.Name).toBeUndefined();
  });
});

describe("SearchAssetsResponseSchema", () => {
  test("decodes response with Assets array", () => {
    const result = decode(SearchAssetsResponseSchema)({
      Assets: [
        { Name: "Chair", ObjectPath: "/Game/Meshes/Chair.Chair" }
      ]
    });
    expect(result.Assets).toHaveLength(1);
    expect(result.Assets?.[0]?.Name).toBe("Chair");
  });

  test("decodes response with Results array", () => {
    const result = decode(SearchAssetsResponseSchema)({
      Results: [{ Name: "Table" }]
    });
    expect(result.Results).toHaveLength(1);
  });

  test("decodes empty response", () => {
    const result = decode(SearchAssetsResponseSchema)({});
    expect(result.Assets).toBeUndefined();
    expect(result.Results).toBeUndefined();
  });
});

// ── Batch schemas ────────────────────────────────────────────────────

describe("BatchRequestItemSchema", () => {
  test("decodes valid batch request item", () => {
    const result = decode(BatchRequestItemSchema)({
      RequestId: 0,
      URL: "/remote/info",
      Verb: "GET"
    });
    expect(result.RequestId).toBe(0);
    expect(result.Verb).toBe("GET");
  });

  test("decodes batch request item with Body", () => {
    const result = decode(BatchRequestItemSchema)({
      RequestId: 1,
      URL: "/remote/object/call",
      Verb: "PUT",
      Body: { objectPath: "/Game/Maps/Main.Main:Actor", functionName: "Ping" }
    });
    expect(result.Body).toEqual({
      objectPath: "/Game/Maps/Main.Main:Actor",
      functionName: "Ping"
    });
  });

  test("rejects negative RequestId", () => {
    expect(() =>
      decode(BatchRequestItemSchema)({ RequestId: -1, URL: "/remote/info", Verb: "GET" })
    ).toThrow();
  });

  test("rejects fractional RequestId", () => {
    expect(() =>
      decode(BatchRequestItemSchema)({ RequestId: 1.5, URL: "/remote/info", Verb: "GET" })
    ).toThrow();
  });

  test("rejects empty URL", () => {
    expect(() =>
      decode(BatchRequestItemSchema)({ RequestId: 0, URL: "", Verb: "GET" })
    ).toThrow();
  });

  test("rejects invalid Verb", () => {
    expect(() =>
      decode(BatchRequestItemSchema)({ RequestId: 0, URL: "/remote/info", Verb: "HEAD" })
    ).toThrow();
  });
});

describe("BatchRequestSchema", () => {
  test("decodes batch with multiple requests", () => {
    const result = decode(BatchRequestSchema)({
      Requests: [
        { RequestId: 0, URL: "/remote/info", Verb: "GET" },
        { RequestId: 1, URL: "/remote/object/call", Verb: "PUT" }
      ]
    });
    expect(result.Requests).toHaveLength(2);
  });

  test("decodes batch with empty requests array", () => {
    const result = decode(BatchRequestSchema)({ Requests: [] });
    expect(result.Requests).toHaveLength(0);
  });

  test("rejects missing Requests field", () => {
    expect(() => decode(BatchRequestSchema)({})).toThrow();
  });
});

describe("BatchResponseItemSchema", () => {
  test("decodes response item with body", () => {
    const result = decode(BatchResponseItemSchema)({
      RequestId: 0,
      ResponseCode: 200,
      ResponseBody: { ReturnValue: 42 }
    });
    expect(result.ResponseCode).toBe(200);
    expect(result.ResponseBody).toEqual({ ReturnValue: 42 });
  });

  test("decodes response item without body", () => {
    const result = decode(BatchResponseItemSchema)({
      RequestId: 1,
      ResponseCode: 404
    });
    expect(result.ResponseBody).toBeUndefined();
  });
});

describe("BatchResponseSchema", () => {
  test("decodes response with items", () => {
    const result = decode(BatchResponseSchema)({
      Responses: [
        { RequestId: 0, ResponseCode: 200, ResponseBody: {} },
        { RequestId: 1, ResponseCode: 404 }
      ]
    });
    expect(result.Responses).toHaveLength(2);
  });

  test("decodes response without Responses field", () => {
    const result = decode(BatchResponseSchema)({});
    expect(result.Responses).toBeUndefined();
  });
});

// ── Info schemas ─────────────────────────────────────────────────────

describe("RouteInfoSchema", () => {
  test("decodes full route info", () => {
    const result = decode(RouteInfoSchema)({
      Path: "/remote/object/call",
      Verb: "PUT",
      Description: "Call a function on an object"
    });
    expect(result.Path).toBe("/remote/object/call");
  });

  test("decodes empty route info", () => {
    const result = decode(RouteInfoSchema)({});
    expect(result.Path).toBeUndefined();
  });
});

describe("InfoResponseSchema", () => {
  test("decodes info response with HttpRoutes", () => {
    const result = decode(InfoResponseSchema)({
      HttpRoutes: [
        { Path: "/remote/info", Verb: "GET" },
        { Path: "/remote/object/call", Verb: "PUT" }
      ]
    });
    expect(result.HttpRoutes).toHaveLength(2);
  });

  test("decodes info response with Routes", () => {
    const result = decode(InfoResponseSchema)({
      Routes: [{ Path: "/remote/object/call" }]
    });
    expect(result.Routes).toHaveLength(1);
  });

  test("decodes empty info response", () => {
    const result = decode(InfoResponseSchema)({});
    expect(result.HttpRoutes).toBeUndefined();
    expect(result.Routes).toBeUndefined();
  });
});

// ── Event schemas ────────────────────────────────────────────────────

describe("ObjectEventRequestSchema", () => {
  test("decodes event request with all fields", () => {
    const result = decode(ObjectEventRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      timeoutSeconds: 30
    });
    expect(result.timeoutSeconds).toBe(30);
  });

  test("decodes minimal event request", () => {
    const result = decode(ObjectEventRequestSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor"
    });
    expect(result.propertyName).toBeUndefined();
    expect(result.timeoutSeconds).toBeUndefined();
  });

  test("rejects empty objectPath", () => {
    expect(() =>
      decode(ObjectEventRequestSchema)({ objectPath: "" })
    ).toThrow();
  });

  test("rejects zero timeoutSeconds", () => {
    expect(() =>
      decode(ObjectEventRequestSchema)({
        objectPath: "/Game/Maps/Main.Main:Actor",
        timeoutSeconds: 0
      })
    ).toThrow();
  });

  test("rejects negative timeoutSeconds", () => {
    expect(() =>
      decode(ObjectEventRequestSchema)({
        objectPath: "/Game/Maps/Main.Main:Actor",
        timeoutSeconds: -5
      })
    ).toThrow();
  });
});

describe("ObjectEventResponseSchema", () => {
  test("decodes event response with value", () => {
    const result = decode(ObjectEventResponseSchema)({
      objectPath: "/Game/Maps/Main.Main:Actor",
      propertyName: "Counter",
      propertyValue: 42
    });
    expect(result.propertyValue).toBe(42);
  });

  test("decodes empty event response", () => {
    const result = decode(ObjectEventResponseSchema)({});
    expect(result.objectPath).toBeUndefined();
  });
});

// ── Thumbnail schemas ────────────────────────────────────────────────

describe("ObjectThumbnailRequestSchema", () => {
  test("decodes thumbnail request", () => {
    const result = decode(ObjectThumbnailRequestSchema)({
      objectPath: "/Game/Meshes/Chair.Chair"
    });
    expect(result.objectPath).toBe("/Game/Meshes/Chair.Chair");
  });

  test("rejects empty objectPath", () => {
    expect(() =>
      decode(ObjectThumbnailRequestSchema)({ objectPath: "" })
    ).toThrow();
  });
});

describe("ObjectThumbnailResponseSchema", () => {
  test("accepts any value (Unknown)", () => {
    expect(decode(ObjectThumbnailResponseSchema)("base64data")).toBe("base64data");
    expect(decode(ObjectThumbnailResponseSchema)(null)).toBeNull();
    expect(decode(ObjectThumbnailResponseSchema)(42)).toBe(42);
  });
});
