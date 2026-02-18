import { describe, expect, test } from "bun:test";
import { BatchBuilder, UnrealRC } from "../src/client.js";
import type { ConnectableTransport, Transport, TransportRequestOptions } from "../src/transport.js";
import type { HttpVerb } from "../src/types.js";

type RecordedRequest = {
  verb: HttpVerb;
  url: string;
  body?: unknown;
  options?: TransportRequestOptions;
};

class MockTransport implements Transport {
  readonly requests: RecordedRequest[] = [];
  disposed = false;
  private readonly responses: unknown[];

  constructor(responses: unknown[] = []) {
    this.responses = [...responses];
  }

  enqueueResponse(response: unknown): void {
    this.responses.push(response);
  }

  async request(
    verb: HttpVerb,
    url: string,
    body?: unknown,
    options?: TransportRequestOptions
  ): Promise<unknown> {
    const request: RecordedRequest = {
      verb,
      url,
      ...(body !== undefined ? { body } : {}),
      ...(options !== undefined ? { options } : {})
    };
    this.requests.push(request);

    const next = this.responses.shift();
    if (next instanceof Error) {
      throw next;
    }

    return next;
  }

  dispose(): void {
    this.disposed = true;
  }
}

class MockConnectableTransport extends MockTransport implements ConnectableTransport {
  connected = false;
  connectCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.connected = true;
  }
}

describe("UnrealRC client", () => {
  test("auto-connects connectable transports before requests", async () => {
    const transport = new MockConnectableTransport([{}]);
    const client = new UnrealRC({ transport });

    await client.info();

    expect(transport.connectCalls).toBe(1);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]).toEqual({
      verb: "GET",
      url: "/remote/info"
    });
  });

  test("builds call payloads with transaction option", async () => {
    const transport = new MockTransport([{ ReturnValue: 123 }]);
    const client = new UnrealRC({ transport });

    const response = await client.call(
      "/Game/Maps/Main.Main:Actor",
      "IncrementCounter",
      { Delta: 5 },
      { transaction: true }
    );

    expect(response.ReturnValue).toBe(123);
    expect(transport.requests[0]).toEqual({
      verb: "PUT",
      url: "/remote/object/call",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        functionName: "IncrementCounter",
        parameters: { Delta: 5 },
        generateTransaction: true
      }
    });
  });

  test("parses property responses using property name then ReturnValue", async () => {
    const transport = new MockTransport([{ Counter: 9 }, { ReturnValue: 33 }]);
    const client = new UnrealRC({ transport });

    const direct = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Counter");
    const fallback = await client.getProperty<number>("/Game/Maps/Main.Main:Actor", "Missing");

    expect(direct).toBe(9);
    expect(fallback).toBe(33);
  });

  test("defaults setProperty access and supports transaction access", async () => {
    const transport = new MockTransport([{ ReturnValue: null }, { ReturnValue: null }]);
    const client = new UnrealRC({ transport });

    await client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 1);
    await client.setProperty("/Game/Maps/Main.Main:Actor", "Counter", 2, { transaction: true });

    expect(transport.requests[0]).toEqual({
      verb: "PUT",
      url: "/remote/object/property",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        propertyName: "Counter",
        propertyValue: 1,
        access: "WRITE_ACCESS"
      }
    });

    expect(transport.requests[1]).toEqual({
      verb: "PUT",
      url: "/remote/object/property",
      body: {
        objectPath: "/Game/Maps/Main.Main:Actor",
        propertyName: "Counter",
        propertyValue: 2,
        access: "WRITE_TRANSACTION_ACCESS"
      }
    });
  });

  test("correlates batch responses back to requests", async () => {
    const transport = new MockTransport([
      {
        Responses: [
          { RequestId: 1, ResponseCode: 204 },
          { RequestId: 0, ResponseCode: 200, ResponseBody: { ReturnValue: true } }
        ]
      }
    ]);
    const client = new UnrealRC({ transport });

    const results = await client.batch((builder) => {
      builder.call("/Game/Maps/Main.Main:Actor", "ResetFixtures");
      builder.describe("/Game/Maps/Main.Main:Actor");
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      requestId: 0,
      statusCode: 200,
      body: { ReturnValue: true }
    });
    expect(results[1]).toMatchObject({
      requestId: 1,
      statusCode: 204
    });
  });

  test("skips response schema parsing when validateResponses is false", async () => {
    const transport = new MockTransport([123]);
    const client = new UnrealRC({ transport, validateResponses: false });

    const raw = await client.info();

    expect(raw).toBe(123);
  });

  test("fails fast on invalid input before sending request", async () => {
    const transport = new MockTransport();
    const client = new UnrealRC({ transport });

    await expect(client.call("", "Fn")).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });
});

describe("BatchBuilder", () => {
  test("creates sequential request ids", () => {
    const builder = new BatchBuilder();

    const first = builder.describe("/Game/Maps/Main.Main:Actor");
    const second = builder.request("GET", "/remote/info");

    expect(first).toBe(0);
    expect(second).toBe(1);
    expect(builder.toRequestBody()).toEqual({
      Requests: [
        {
          RequestId: 0,
          URL: "/remote/object/describe",
          Verb: "PUT",
          Body: { objectPath: "/Game/Maps/Main.Main:Actor" }
        },
        {
          RequestId: 1,
          URL: "/remote/info",
          Verb: "GET"
        }
      ]
    });
  });
});
