# unreal-rc — Comprehensive Library Plan

## Goal

A typed, transport-agnostic Node/Bun library for Unreal Engine's Remote Control plugin. Supports calling Blueprint-callable functions, reading/writing properties, object discovery, and asset search. No presets, no web app UI — just programmatic control.

---

## Current State

- Repo is now a monorepo with `packages/core` as the active package
- `packages/core` implements a typed `UnrealRC` client with both WebSocket and HTTP transports
- Zod schemas are in place for request/response validation across supported endpoints
- WebSocket transport has configurable IDs/timeouts/reconnect behavior and request queueing
- HTTP transport is fetch-based with timeout and error handling
- Release-oriented scripts/metadata exist for publishing `unreal-rc` to npm

---

## API Surface to Cover

| Endpoint | Method | Purpose |
|---|---|---|
| `/remote/info` | GET | List all available API routes |
| `/remote/object/call` | PUT | Call a BlueprintCallable function on a UObject |
| `/remote/object/property` | PUT | Read/write UObject properties (with access modes) |
| `/remote/object/describe` | PUT | Get metadata: properties, functions, types for a UObject |
| `/remote/search/assets` | PUT | Query the Asset Registry |
| `/remote/object/thumbnail` | PUT | Get asset thumbnail (binary) |
| `/remote/batch` | PUT | Execute multiple calls in one request |
| `/remote/object/event` | PUT | Block until property change event (experimental) |

### Currently missing from existing implementation
- `describe`, `search/assets`, `thumbnail`, `info`, `event` endpoints
- `access` field on property calls (`READ_ACCESS`, `WRITE_ACCESS`, `WRITE_TRANSACTION_ACCESS`)
- `generateTransaction` on `object/call`
- HTTP transport entirely

---

## Target Architecture (Core Package)

```
packages/
  core/
    src/
      types.ts            # Zod schemas + inferred TS types for all request/response shapes
      transport.ts        # Transport interface (shared contract)
      transports/
        ws.ts             # WebSocket transport (evolved from current ws.ts)
        http.ts           # HTTP transport (fetch-based)
      client.ts           # UnrealRC class — the main API, transport-agnostic
      helpers.ts          # Path builders, response parsing, common UE type helpers
      index.ts            # Public exports
```

---

## Target API

```ts
// Connect
const ue = new UnrealRC({ transport: "ws", host: "127.0.0.1", port: 30020 })
// or
const ue = new UnrealRC({ transport: "http", host: "127.0.0.1", port: 30010 })

// Call a function
await ue.call(objectPath, "SetActorLocation", {
  NewLocation: { X: 0, Y: 0, Z: 100 }
})

// Call with transaction (undoable, multi-user replicated)
await ue.call(objectPath, "DoThing", params, { transaction: true })

// Read a single property
const loc = await ue.getProperty(objectPath, "RelativeLocation")

// Read all properties
const all = await ue.getProperties(objectPath)

// Write a property
await ue.setProperty(objectPath, "RelativeLocation", { X: 1, Y: 2, Z: 3 })

// Write with transaction
await ue.setProperty(objectPath, "RelativeLocation", value, { transaction: true })

// Describe an object (metadata, available functions/properties)
const meta = await ue.describe(objectPath)

// Search assets
const assets = await ue.searchAssets("Chair", {
  classNames: ["StaticMesh"],
  packagePaths: ["/Game/Props"],
  recursivePaths: true
})

// Batch operations
const results = await ue.batch(b => {
  b.call(path, "Func1")
  b.call(path, "Func2", params)
  b.getProperty(path, "SomeProp")
})

// Get API route info
const routes = await ue.info()

// Dispose
ue.dispose()
```

---

## Implementation Steps

### Step 1: `types.ts` — Zod Schemas

Define schemas for every request and response body. This locks down the API contract before writing any logic.

Schemas needed:
- `ObjectCallRequest` / `ObjectCallResponse`
- `ObjectPropertyRequest` / `ObjectPropertyResponse` (read + write variants)
- `ObjectDescribeRequest` / `ObjectDescribeResponse`
- `SearchAssetsRequest` / `SearchAssetsResponse`
- `BatchRequest` / `BatchResponse`
- `InfoResponse`
- `ObjectEventRequest` / `ObjectEventResponse` (experimental, low priority)
- `ObjectThumbnailRequest` (low priority — binary response)
- Common types: access modes enum, property metadata, asset info

Export both the zod schemas and the inferred `z.infer<>` TypeScript types.

### Step 2: `transport.ts` — Transport Interface

```ts
interface Transport {
  request(verb: string, url: string, body?: unknown): Promise<unknown>
  dispose(): void
}

// Optional for transports that support it:
interface ConnectableTransport extends Transport {
  connect(): Promise<void>
  readonly connected: boolean
}
```

### Step 3: `transports/ws.ts` — WebSocket Transport

Refactor current `ws.ts` into a `Transport` implementation:
- Implement `Transport` interface
- Auto-incrementing request IDs (use a counter)
- Configurable host/port (no more hardcoded URL)
- Configurable timeouts (connect, request, ping interval)
- Auto-reconnect with exponential backoff (configurable)
- Connection state tracking
- Keep the ping keepalive logic
- Queue or reject calls while disconnected (configurable behavior)

### Step 4: `transports/http.ts` — HTTP Transport

Simple `fetch`-based implementation:
- Implement `Transport` interface
- Configurable host/port (default `http://127.0.0.1:30010`)
- Configurable request timeout
- No connection state needed (stateless)
- `dispose()` is a no-op (or aborts in-flight requests)

### Step 5: `client.ts` — `UnrealRC` Class

Transport-agnostic client that exposes the clean API:
- Constructor takes transport config, creates the appropriate transport
- Each API method (`call`, `getProperty`, `setProperty`, `describe`, `searchAssets`, `batch`, `info`) maps to the correct endpoint
- Validates request bodies with zod schemas before sending
- Parses and validates response bodies with zod schemas
- `batch()` uses a builder pattern — callback receives a builder, returns correlated results
- `dispose()` delegates to transport

### Step 6: `helpers.ts` — Utilities

- **Path builders**: `objectPath("/Game/Maps/Main", "Main", "MyActor")` → proper UObject path string
- **PIE path helper**: `piePath(mapName, instanceId?)` → `UEDPIE_0_MapName`
- **Blueprint library path**: `blueprintLibraryPath(moduleName, className)` → `/Script/Module.Default__Class`
- **Common UE type constructors**: `vector(x, y, z)`, `rotator(pitch, yaw, roll)`, `transform(loc, rot, scale)`, `linearColor(r, g, b, a)`
- **Response parsing**: typed `parseReturnValue` (evolve from current implementation)

### Step 7: `index.ts` — Public Exports

Clean barrel file:
- `UnrealRC` (the main class)
- All types from `types.ts`
- All helpers from `helpers.ts`
- Transport classes for advanced users who want to instantiate their own

---

## Cleanup

- Remove `luxon` and `@types/luxon` (not needed)
- Remove `wrangler` (not needed for this package)
- Evaluate if `ulidx` is still needed (counter-based IDs may suffice)
- Delete current `index.ts` (the `console.log("Hello via Bun!")` one)
- Update package exports to match the `packages/core` build output

---

## npm Release Preparation (`unreal-rc`)

### Package metadata and distribution hygiene

- Ensure `packages/core/package.json` is publishable:
  - `name: "unreal-rc"`
  - correct `version`, `description`, `license`, `engines`
  - `main`, `types`, and `exports` point to compiled `dist/`
  - `files` limits publish payload to `dist/`, `README.md` (and license)
- Keep monorepo root `private: true` and use workspaces
- Add `prepublishOnly` script in `packages/core` to run clean + typecheck + build

### Verification before publish

- Run from repo root:
  - `bun install`
  - `bun run --cwd packages/core typecheck`
  - `bun run --cwd packages/core build`
  - `bun run --cwd packages/core pack:check` (or `npm pack --dry-run`)
- Review tarball contents and size (confirm no source junk, no secrets, no lockfile churn artifacts)
- Smoke-test packed artifact in a throwaway project (`npm i ../unreal-rc-*.tgz`)

### npm account and release flow

- Confirm package name availability (`npm view unreal-rc`)
- Authenticate (`npm login`) with org/user that owns the name
- Enable 2FA on npm account (recommended for publish + settings)
- Publish from `packages/core`:
  - `npm publish --access public`
- Post-publish checks:
  - `npm view unreal-rc version`
  - install test: `npm i unreal-rc` in a clean project
  - tag release in git and write release notes/changelog

### Ongoing release process (recommended)

- Adopt semver discipline (`patch`/`minor`/`major`)
- Keep a changelog per release
- Add CI gate for `typecheck`, `build`, and `pack --dry-run`
- Consider provenance publishing when ready (`npm publish --provenance`)

---

## Future (Out of Scope for Now)

- **UE source code parser**: Read C++ headers / Blueprint metadata locally to generate typed wrappers (e.g. `ue.myActor.setActorLocation(...)` with full autocomplete)
- **Event streaming**: `object/event` endpoint support for reactive property watching
- **Thumbnail support**: Binary response handling for `object/thumbnail`
- **Typed describe results**: Use `describe()` output at dev-time to generate per-object type definitions
