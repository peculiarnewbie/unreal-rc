# Effect v4 Rewrite of `packages/core`

## Context

The `unreal-rc` core package (~2K LOC) is a typed client for Unreal Engine's Remote Control plugin. The WebSocket transport (516 LOC) has complex interleaved async lifecycle management (reconnect, queueing, keepalive, pending request tracking, timeouts) that caused e2e test hangs from unresolved promises. Effect v4's structured concurrency eliminates this class of bug entirely.

This is a clean rewrite — not a migration. The user is the sole consumer. We go all-in on Effect + Effect Schema internally, with a Promise-based public API.

---

## New File Structure

```
packages/core/src/
  internal/
    schemas.ts          # Effect Schema definitions (replaces 21 Zod schemas)
    errors.ts           # Tagged Effect errors (Data.TaggedError)
    transport.ts        # Transport service tag + TransportRequest/Response
    http.ts             # HTTP transport layer (Effect + fetch)
    correlation.ts      # Pending request map, ID gen, per-request timeout
    heartbeat.ts        # Ping fiber (Schedule-based)
    ws.ts               # WS transport layer (fibers for reconnect/messages/queue)
    hooks.ts            # Hook service (onRequest/onResponse/onError/redact)
    retry.ts            # Effect Schedule-based retry policy
    batch.ts            # Batch builder + correlation (pure logic)
    runtime.ts          # ManagedRuntime, layer composition, config service
  public/
    client.ts           # UnrealRC class — Promise-based, calls runtime.runPromise
    types.ts            # Plain TS types extracted from schemas, zero Effect imports
    errors.ts           # TransportRequestError class (plain Error subclass)
    helpers.ts          # UE path/value constructors (unchanged from current)
    index.ts            # Barrel exports
  index.ts              # Re-exports public/index.ts
```

---

## Key Design Decisions

### 1. Schemas → Effect Schema
All 21 Zod schemas become `Schema.Struct` definitions. Request schemas stay strict (no extra keys). Response schemas stay open (extra keys pass through). Types extracted via `Schema.Type<>` and re-exported from `public/types.ts` with zero Effect dependency.

### 2. Errors — tagged internal, plain public
Internal: 6 `Data.TaggedError` subclasses (`TimeoutError`, `ConnectError`, `DisconnectError`, `HttpStatusError`, `RemoteStatusError`, `DecodeError`) with discriminated union `TransportError`.

Public: single `TransportRequestError` extends `Error` with `kind` field — same shape consumers already use. A `toPublicError()` maps tags to kinds at the boundary.

### 3. Transport as Effect Service
```ts
class Transport extends Context.Tag("Transport")<Transport, {
  readonly name: string
  readonly request: (req: TransportRequest) => Effect<TransportResponse, TransportError>
  readonly dispose: Effect<void>
}>() {}
```
HTTP and WS each provide a `Layer.Layer<Transport>`. Selected by config in `runtime.ts`.

### 4. WS Lifecycle as Supervised Fibers
The 516 LOC imperative WS transport becomes ~3 scoped fibers:
- **Connection manager** — `connectOnce` + `Effect.retry(reconnectSchedule)`. On connect, forks child fibers. On disconnect, scope closes → all children interrupted → all Deferreds resolved.
- **Heartbeat** — `Effect.repeat(Schedule.spaced(pingInterval))`, scoped to connection. ~7 lines replaces 25 LOC of setInterval management.
- **Message loop** — `Effect.async` wrapping WS `message`/`close` events. Correlates responses via `PendingRequests` service.
- **Queue drainer** — takes from `Queue`, sends via socket, adds to pending.

Per-request timeouts use `Deferred.await` + `Effect.timeout`. When the connection scope closes, all pending Deferreds are failed automatically. **No unresolved promises possible.**

### 5. Correlation as Service
`PendingRequests` service manages `Ref<HashMap<number, PendingRequest>>` where each pending request has a `Deferred`. Provides: `nextId`, `add`, `resolve`, `reject`, `rejectAll`. Testable in isolation.

### 6. Retry via Schedule
```ts
Schedule.exponential(baseDelay, 2).pipe(
  Schedule.intersect(Schedule.recurs(maxAttempts - 1)),
  Schedule.whileInput(shouldRetry)
)
```
Replaces 70 LOC manual while loop. `defaultShouldRetry` pattern-matches on `_tag`.

### 7. Hooks as Service
`Hooks` service with `onRequest`, `onResponse`, `onError`, `redactPayload`. Provided via layer. Errors in hooks are `Effect.ignore`d. Testable with `HooksTest` (no-op layer).

### 8. Public Boundary
`UnrealRC` class creates `ManagedRuntime.make(fullLayer)` in constructor. Each method calls `runtime.runPromise(effect.pipe(Effect.mapError(toPublicError)))`. `dispose()` calls `runtime.dispose()` which closes all scopes/fibers automatically.

### 9. Batch
`BatchBuilder` stays as a pure class (just data construction). `batch()` method builds requests, sends via transport, correlates responses. Mostly unchanged logic.

---

## Implementation Order

| # | File | Notes |
|---|------|-------|
| 1 | `internal/errors.ts` | 6 tagged errors + union type |
| 2 | `internal/schemas.ts` | Port all 21 schemas to Effect Schema |
| 3 | `public/types.ts` | Extract `Schema.Type<>` for each schema |
| 4 | `public/errors.ts` | `TransportRequestError` class + `toPublicError` |
| 5 | `public/helpers.ts` | Copy from current, unchanged |
| 6 | `internal/transport.ts` | Transport service tag |
| 7 | `internal/hooks.ts` | Hooks service + HooksLive layer |
| 8 | `internal/retry.ts` | Schedule factory + defaultShouldRetry |
| 9 | `internal/http.ts` | HTTP transport layer |
| 10 | `internal/batch.ts` | BatchBuilder + correlateBatchResponses |
| 11 | `internal/correlation.ts` | PendingRequests service |
| 12 | `internal/heartbeat.ts` | Heartbeat fiber |
| 13 | `internal/ws.ts` | WS transport layer (depends on 11, 12) |
| 14 | `internal/runtime.ts` | Layer composition + config |
| 15 | `public/client.ts` | UnrealRC class wrapping runtime |
| 16 | `public/index.ts` + `src/index.ts` | Barrel exports |
| 17 | Tests | Unit tests per module, then integration, then e2e |

---

## Dependencies Change

```diff
- "zod": "^4.0.11"
+ "effect": "^3.x"    // latest stable — note: "Effect v4" is the ecosystem version, npm package is effect@3.x
+ "@effect/schema": "^0.x"   // or bundled in effect — verify at install time
```

Dev deps unchanged (bun, typescript).

---

## Public API Contract (Preserved)

The public API shape stays the same:
- `UnrealRC` class with `call`, `getProperty`, `setProperty`, `describe`, `searchAssets`, `info`, `event`, `thumbnail`, `batch`, `dispose`
- `HttpTransport` / `WebSocketTransport` — still exported for advanced usage (now as layer constructors)
- All type exports preserved (`ObjectCallRequest`, etc.)
- `TransportRequestError` with `.kind` field
- Helper functions unchanged
- Schema exports change from Zod to Effect Schema (breaking but user is sole consumer)

---

## Verification

1. `bun run typecheck` — strict mode passes
2. `bun test tests` — all unit tests pass (rewritten for Effect)
3. `bun run build` — dist output, clean .d.ts files with no Effect types in public surface
4. E2E: `UNREAL_E2E=1 bun run test:e2e` — protocol roundtrip works on both transports
5. Manually verify: `import { UnrealRC } from "unreal-rc"` — no Effect in autocomplete suggestions
