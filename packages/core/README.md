# unreal-rc

Typed TypeScript client for Unreal Engine's [Remote Control](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine) plugin. Communicate with a running Unreal Editor or game instance over WebSocket or HTTP.

- **Transport-agnostic** — swap between WebSocket and HTTP with one option
- **Type-safe** — Effect Schema validation on request and response payloads
- **Resilient** — auto-reconnect, configurable retries, end-to-end request timeouts
- **Observable** — lifecycle hooks for logging and tracing
- **Single runtime dependency**: [Effect](https://effect.website)

## Install

```bash
npm install unreal-rc
```

## Setup

Enable the **Remote Control** plugin in your Unreal project (Edit > Plugins > search "Remote Control"). The plugin opens two localhost endpoints:

| Protocol | Default Port |
|----------|-------------|
| HTTP | `30010` |
| WebSocket | `30020` |

## Creating a Client

```ts
import { UnrealRC } from "unreal-rc";

// WebSocket (default) — persistent connection with auto-reconnect
const ue = new UnrealRC();

// HTTP — stateless fetch-based requests
const ue = new UnrealRC({ transport: "http" });

// Full options
const ue = new UnrealRC({
  transport: "ws",          // "ws" | "http"
  host: "127.0.0.1",       // Unreal host
  port: 30020,             // Port (default: 30020 for ws, 30010 for http)
  validateResponses: true,  // Validate response schemas with Effect Schema
  retry: {                  // Retry policy (or `true` for defaults, `false` to disable)
    maxAttempts: 3,
    delayMs: 100,           // or (context) => context.attempt * 200
    shouldRetry: (ctx) => ctx.error.kind !== "decode",
  },
});

// Always dispose when done
await ue.dispose();
```

## API Reference

### `call(objectPath, functionName, parameters?, options?)`

Call a function on a remote UObject.

```ts
// Call a Blueprint function
await ue.call(
  "/Game/Maps/Main.Main:PersistentLevel.MyActor",
  "SetActorHiddenInGame",
  { bNewHidden: false }
);

// Call with transaction support (for undo/redo in the editor)
await ue.call(path, "IncrementCounter", { Delta: 5 }, { transaction: true });

// Access the return value
const result = await ue.call(path, "GetHealth");
console.log(result.ReturnValue); // e.g. 100
```

**Options:** `CallOptions`

| Option | Type | Description |
|--------|------|-------------|
| `transaction` | `boolean` | Wrap in an editor transaction (enables undo) |
| `timeoutMs` | `number` | Per-request timeout override for the full request lifecycle, including queued websocket time |
| `retry` | `RetryOptions` | Per-request retry override |

---

### `getProperty<T>(objectPath, propertyName, options?)`

Read a single property from a remote UObject. Returns the property value directly.

```ts
const health = await ue.getProperty<number>(path, "Health");
// health === 100

const location = await ue.getProperty<{ X: number; Y: number; Z: number }>(
  path,
  "RelativeLocation"
);
```

---

### `getProperties<T>(objectPath, options?)`

Read all properties from a remote UObject at once.

```ts
const props = await ue.getProperties<{ Health: number; Mana: number }>(path);
// props.Health, props.Mana
```

---

### `setProperty(objectPath, propertyName, value, options?)`

Write a property on a remote UObject.

```ts
await ue.setProperty(path, "Health", 100);

// With transaction support
await ue.setProperty(path, "Health", 100, { transaction: true });

// Setting a struct property
import { vector } from "unreal-rc";
await ue.setProperty(path, "RelativeLocation", vector(100, 200, 300));
```

**Options:** `SetPropertyOptions`

| Option | Type | Description |
|--------|------|-------------|
| `access` | `"WRITE_ACCESS" \| "WRITE_TRANSACTION_ACCESS"` | Access mode |
| `transaction` | `boolean` | Wrap in an editor transaction |
| `timeoutMs` | `number` | Per-request timeout override for the full request lifecycle, including queued websocket time |
| `retry` | `RetryOptions` | Per-request retry override |

---

### `describe(objectPath, options?)`

Get metadata about a remote UObject — its properties, functions, class, and display name.

```ts
const meta = await ue.describe(path);

// List all exposed functions
for (const fn of meta.Functions ?? []) {
  console.log(fn.Name, fn.Arguments);
}

// List all exposed properties
for (const prop of meta.Properties ?? []) {
  console.log(prop.Name, prop.Type);
}
```

**Returns:** `ObjectDescribeResponse`

```ts
{
  Name?: string;
  Class?: string;
  DisplayName?: string;
  Path?: string;
  Properties?: PropertyMetadata[];
  Functions?: FunctionMetadata[];
}
```

---

### `searchAssets(query, options?)`

Search for assets in the project.

```ts
const result = await ue.searchAssets("Chair");

for (const asset of result.Assets ?? []) {
  console.log(asset.Name, asset.ObjectPath, asset.AssetClass);
}
```

**Options:** `SearchAssetsOptions`

| Option | Type | Description |
|--------|------|-------------|
| `classNames` | `string[]` | Filter by asset class |
| `packagePaths` | `string[]` | Filter by package path |
| `recursivePaths` | `boolean` | Search subdirectories |
| `recursiveClasses` | `boolean` | Include subclasses |

---

### `info(options?)`

List all available Remote Control HTTP routes.

```ts
const info = await ue.info();
for (const route of info.HttpRoutes ?? info.Routes ?? []) {
  console.log(route.Verb, route.Path, route.Description);
}
```

---

### `event(request, options?)`

Wait for a property change event on a remote UObject.

```ts
const change = await ue.event({
  objectPath: path,
  propertyName: "Health",
  timeoutSeconds: 30,
});
console.log(change.propertyValue); // new value after change
```

---

### `thumbnail(objectPath, options?)`

Get a thumbnail image for an asset.

```ts
const thumb = await ue.thumbnail("/Game/Meshes/Chair");
```

---

### `batch(configure, options?)`

Execute multiple requests in a single round-trip. Each sub-request returns a `BatchResult` with its own status code and body.

```ts
const results = await ue.batch((b) => {
  b.call(path, "ResetFixtures");
  b.getProperty(path, "Health");
  b.setProperty(path, "Score", 0);
  b.describe(path);
  b.searchAssets("Chair");
  b.request("GET", "/remote/info"); // raw request
});

for (const result of results) {
  console.log(result.requestId, result.statusCode, result.body);
}
```

**`BatchResult`:**

```ts
{
  requestId: number;
  statusCode: number;
  body: unknown;
  request: BatchRequestItem;
}
```

---

### `dispose()`

Shut down the transport and release resources. Always call this when done.

```ts
await ue.dispose();
```

## Helpers

Utility functions for building Unreal-specific values.

### Path Builders

```ts
import { objectPath, piePath, blueprintLibraryPath } from "unreal-rc";

// Build an object path: "/Game/Maps/Main.Main:MyActor"
objectPath("/Game/Maps/Main", "Main", "MyActor");

// Build a PIE (Play In Editor) world name: "UEDPIE_0_Main"
piePath("Main");
piePath("Main", 1); // "UEDPIE_1_Main"

// Build a Blueprint function library path
blueprintLibraryPath("MyModule", "MyBlueprintLibrary");
// "/Script/MyModule.Default__MyBlueprintLibrary"
```

### Struct Constructors

```ts
import { vector, rotator, linearColor, transform } from "unreal-rc";

vector(100, 200, 300);
// { X: 100, Y: 200, Z: 300 }

rotator(0, 90, 0);
// { Pitch: 0, Yaw: 90, Roll: 0 }

linearColor(1, 0, 0);
// { R: 1, G: 0, B: 0, A: 1 }

linearColor(1, 0, 0, 0.5);
// { R: 1, G: 0, B: 0, A: 0.5 }

transform(vector(0, 0, 0), rotator(0, 90, 0));
// { Translation: {...}, Rotation: {...}, Scale3D: { X: 1, Y: 1, Z: 1 } }
```

### Response Parsing

```ts
import { parseReturnValue } from "unreal-rc";

const response = await ue.call(path, "GetHealth");
const health = parseReturnValue<number>(response);          // reads .ReturnValue
const health = parseReturnValue<number>(response, "Health"); // reads .Health
```

## Error Handling

All transport errors are thrown as `TransportRequestError` with structured metadata.

```ts
import { TransportRequestError } from "unreal-rc";

try {
  await ue.call(path, "DoSomething");
} catch (error) {
  if (error instanceof TransportRequestError) {
    error.kind;       // "timeout" | "connect" | "disconnect" | "http_status"
                      // | "remote_status" | "decode" | "unknown"
    error.statusCode; // HTTP status code (if applicable)
    error.details;    // Response body from Unreal
    error.verb;       // "GET" | "PUT" | ...
    error.url;        // "/remote/object/call"
    error.transport;  // "ws" | "http"
    error.requestId;  // Server-assigned request ID
  }
}
```

### Error Kinds

| Kind | Description |
|------|-------------|
| `timeout` | Request exceeded the timeout |
| `connect` | Could not connect to Unreal |
| `disconnect` | Connection dropped mid-request |
| `http_status` | Non-2xx HTTP response from Unreal |
| `remote_status` | Unreal returned an application-level error |
| `decode` | Response did not match the expected schema |
| `unknown` | Unexpected error |

### Retries

By default, `timeout`, `connect`, `disconnect`, and HTTP 502/503/504 errors are retried. Configure globally or per-request:

```ts
// Global retry policy
const ue = new UnrealRC({
  retry: { maxAttempts: 5, delayMs: 200 },
});

// Per-request override
await ue.call(path, "SlowFunction", {}, {
  retry: { maxAttempts: 10, delayMs: 500 },
  timeoutMs: 30000,
});

// Disable retries for a specific request
await ue.call(path, "FastFunction", {}, { retry: false });
```

## Hooks

Lifecycle hooks for observability — logging, metrics, tracing.

```ts
const ue = new UnrealRC({
  onRequest: (ctx) => {
    console.log(`>> ${ctx.verb} ${ctx.url}`);
  },
  onResponse: (ctx) => {
    console.log(`<< ${ctx.statusCode} (${ctx.durationMs}ms)`);
  },
  onError: (ctx) => {
    console.error(`!! ${ctx.error.kind}: ${ctx.error.message}`);
  },
  // Redact sensitive data before it reaches hooks
  redactPayload: (payload, ctx) => {
    if (ctx.phase === "request") return "[redacted]";
    return payload;
  },
});
```

### Hook Contexts

**`RequestHookContext`:** `{ transport, verb, url, body, attempt }`

**`ResponseHookContext`:** `{ transport, verb, url, body, requestBody, attempt, durationMs, statusCode, requestId }`

**`ErrorHookContext`:** `{ transport, verb, url, body, error, errorBody, attempt, durationMs, statusCode, requestId }`

## Low-Level Exports

For building custom tooling or higher-level abstractions, the package also exports:

- **Request builders:** `buildCallRequest`, `buildPropertyRequest`, `buildDescribeRequest`, `buildBatchRequest`
- **Batch builder class:** `BatchBuilder`
- **All Effect schemas:** `ObjectCallRequestSchema`, `ObjectCallResponseSchema`, etc.
- **Transport layers:** `HttpTransportLive`, `WebSocketTransportLive` (for Effect-based usage)
- **All TypeScript types:** `ObjectCallRequest`, `ObjectCallResponse`, `FunctionMetadata`, etc.

```ts
import { buildCallRequest, BatchBuilder } from "unreal-rc";

// Build a raw request body
const body = buildCallRequest(path, "SetActorHiddenInGame", { bNewHidden: false });
// Use with your own HTTP client, CLI tool, etc.
```

## License

MIT
