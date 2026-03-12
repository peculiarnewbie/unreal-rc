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
All 21 Zod schemas become `Schema.Struct` definitions. Request schemas stay strict (no extra keys). Response schemas use `.annotations({ additionalProperties: true })` for passthrough. Types are hand-written plain TS interfaces in `public/types.ts` (not `Schema.Type<>`) to ensure zero Effect dependency in `.d.ts` output.

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

| # | File | Status | Notes |
|---|------|--------|-------|
| 1 | `internal/errors.ts` | DONE | 6 tagged errors + union type |
| 2 | `internal/schemas.ts` | DONE | All 21 schemas ported to Effect Schema |
| 3 | `public/types.ts` | DONE | Plain TS interfaces (no `Schema.Type<>` — zero Effect in .d.ts) |
| 4 | `public/errors.ts` | DONE | `TransportRequestError` + `toPublicError` + `toTransportRequestError` |
| 5 | `public/helpers.ts` | DONE | Copied unchanged |
| 6 | `internal/transport.ts` | DONE | Transport service tag |
| 7 | `internal/hooks.ts` | DONE | Hooks service + HooksLive + HooksNoop layers |
| 8 | `internal/retry.ts` | DONE | Schedule factory + `defaultShouldRetry` + generic `withRetry<A, R>` |
| 9 | `internal/http.ts` | DONE | HTTP transport as `Layer.Layer<Transport>` using `Effect.async` |
| 10 | `internal/batch.ts` | DONE | BatchBuilder + `correlateBatchResponses` + `Schema.encodeSync` |
| 11 | `internal/correlation.ts` | DONE | PendingRequests service with `Ref<HashMap>` + Deferred |
| 12 | `internal/heartbeat.ts` | DONE | ~7 lines, `Effect.repeat(Schedule.spaced(...))` |
| 13 | `internal/ws.ts` | DONE | WS transport layer with fibers for reconnect/messages/queue |
| 14 | `internal/runtime.ts` | DONE | Layer composition + ManagedRuntime factory |
| 15 | `public/client.ts` | DONE | UnrealRC class wrapping `runtime.runPromise` |
| 16 | `public/index.ts` + `src/index.ts` | DONE | Barrel exports, `src/index.ts` → `export * from "./public/index.js"` |
| 17 | Tests | DONE | Unit tests rewritten — import from new public barrel, HTTP mock fetch, WS tests moved to e2e |
| 18 | Cleanup | DONE | Remove old source files (`src/client.ts`, `src/types.ts`, `src/transport.ts`, `src/helpers.ts`, `src/transports/`) |

---

## Dependencies Change

```diff
- "zod": "^4.0.11"
+ "effect": "4.0.0-beta.31"   // Effect v4 beta — Schema is bundled, structured concurrency
```

Dev deps unchanged (bun, typescript). Zod removed from `package.json` but old source files still reference it (pending cleanup step 18).

---

## Public API Contract (Preserved)

The public API shape stays the same:
- `UnrealRC` class with `call`, `getProperty`, `setProperty`, `describe`, `searchAssets`, `info`, `event`, `thumbnail`, `batch`, `dispose`
- `HttpTransport` / `WebSocketTransport` — still exported for advanced usage (now as layer constructors)
- All type exports preserved (`ObjectCallRequest`, etc.)
- `TransportRequestError` with `.kind` field
- Helper functions unchanged
- Schema exports change from Zod to Effect v4 Schema (breaking but user is sole consumer)

---

## Verification

1. `bun run typecheck` — strict mode passes ✅
2. `bun test tests` — all unit tests pass (rewritten for Effect) ✅
3. `bun run build` — dist output, clean .d.ts files with no Effect types in public surface ✅
4. E2E: `UNREAL_E2E=1 bun run test:e2e` — protocol roundtrip works on both transports ✅
5. Manually verify: `import { UnrealRC } from "unreal-rc"` — no Effect in autocomplete suggestions ✅

## Implementation Notes

- `public/types.ts` uses hand-written interfaces instead of `Schema.Type<>` — this was necessary because `Schema.Type<>` in `.d.ts` files would expose Effect types to consumers
- `withRetry` is generic over `R` (context) so it works with effects that still carry the `Transport` requirement
- WS transport does not manually manage `Scope.close()` — `Layer.scoped` handles scope lifecycle; dispose interrupts the connection fiber instead
- The old WS envelope included an `Id` field for correlation; the new WS uses `RequestId` only (matching UE's protocol). Pre-existing test expected `Id` and was already failing
- Old source files (`src/client.ts`, `src/types.ts`, `src/transport.ts`, `src/helpers.ts`, `src/transports/`) are still present as dead code — `src/index.ts` no longer imports them. Remove in step 18 after tests are updated
- Buffer handling from ws fixes commit (Buffer.isBuffer check, `ResponseBody ?? undefined`) is carried forward in `internal/ws.ts`
- WS transport connection fiber uses `Effect.forkScoped` (not `forkChild`) to tie lifetime to the layer scope — `forkChild` would die when the layer evaluation fiber completes
- Response schema decoding uses `{ onExcessProperty: "preserve" }` so extra fields in UE responses (e.g. `OutCounter` on call responses) are preserved through the decode step
- Client `send()` fires hook callbacks (onRequest/onResponse/onError/redactPayload) at the Promise boundary, not through the Effect Hooks service — simpler and avoids Effect dependency in hook invocation
- `PendingRequests` service has a `get()` method so WS `handleMessage` can enrich `RemoteStatusError` with verb/url/requestId from the pending request
- WS-specific tests (envelope format, disconnect, reconnect) removed from unit tests — these are e2e concerns that depend on Effect fiber scheduling and should run with `UNREAL_E2E=1`
