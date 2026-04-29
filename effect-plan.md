# Plan For unreal-rc Effect + Promise API

**Goal:** make unreal-rc Effect-native without breaking existing Promise users. Add typed Effect methods, public tagged errors, raw request support, schema-driven return decoding, and an injectable Effect service.

**Status:** Phase 0 (remove positional overloads) is **done**. Object-arg-only signatures across all public APIs.

---

## Principles

- Implement core operations once as Effect.
- Keep Promise methods as thin wrappers over Effect methods.
- Preserve existing public API behavior unless explicitly versioned.
- Public Promise API throws `TransportRequestError`.
- Public Effect API fails with tagged `TransportError` variants.
- Avoid duplicating transport, retry, validation, hooks, and timeout logic.
- **Object-argument signatures only** — no positional overloads in any namespace.
- `ue.effect.*` is additive, never breaks `ue.*`.

---

## Phase 0: Remove Positional Overloads ✅ DONE

All public methods now take a single object-argument. This applies to `UnrealRC` methods,
`BatchBuilder` methods, and `buildCallRequest`. Related option types that existed only to
serve positional overloads (`CallOptions`, `GetPropertyOptions`, `SetPropertyOptions`,
`DescribeOptions`, `SearchAssetsOptions`, `ThumbnailOptions`, `BuildCallRequestOptions`)
have been removed.

Promise API shape:
```ts
await ue.call({ objectPath, functionName, parameters, transaction, timeoutMs, retry });
await ue.getProperty({ objectPath, propertyName, access, timeoutMs, retry });
// etc.
```

Effect API (future Phase 4) will use the same object-arg shape — no positional overloads needed.

---

## Phase 1: Inventory Current Behavior

1. Confirm every Promise-returning method:
   `call`, `getProperty`, `getProperties`, `setProperty`, `describe`, `searchAssets`, `info`,
   `event`, `thumbnail`, `batch`, `ping`, `pendingRequests`, `dispose`.
2. Review internal Effect pieces:
   `internal/runtime.ts`, `internal/transport.ts`, `internal/http.ts`, `internal/ws.ts`,
   `internal/retry.ts`, `internal/errors.ts`.
3. Confirm current test coverage and capture Promise error behavior for compatibility.

---

## Phase 2: Public Tagged Error Surface

1. Export the internal tagged error classes from the public API:
   `TimeoutError`, `ConnectError`, `DisconnectError`, `HttpStatusError`, `RemoteStatusError`, `DecodeError`.
2. Export the `TransportError` union publicly.
3. **Export location:** tagged errors (`Data.TaggedError` subclasses) live in `unreal-rc/effect`
   (the Effect subpath). They are for the Effect error channel, not for `throw`.
   Promise users interact exclusively with `TransportRequestError` from the main entrypoint.
4. `TransportRequestError` and `toTransportRequestError` remain on the main entrypoint for Promise consumers.
5. Document the relationship:
   - Effect methods fail with `TransportError` (tagged union, `_tag`-discriminated).
   - Promise methods throw `TransportRequestError`.
   - `TransportRequestError.kind` maps to tagged error names (`"timeout"`, `"connect"`, etc.).
   - Effect users narrow with `Effect.catchTag("ConnectError", ...)` or `Effect.catchTags`.
6. Add tests asserting public exports exist, can be narrowed by `_tag`, and the mapping is correct.

---

## Phase 3: Extract Effect-Native Send Pipeline

Refactor the private `send(...)` method into two layers:

1. **`sendEffect(...)`** — pure Effect layer:
   ```ts
   sendEffect<T>(verb, url, body, responseSchema, options):
     Effect.Effect<{ decoded: T; statusCode; requestId; rawBody }, TransportError, Transport>
   ```
   Handles: transport dispatch, schema decode (or skip if `validateResponses: false`), retry wrapping.
   Retry operates on tagged `TransportError`, not public `TransportRequestError`.
   **Hooks remain outside the Effect pipeline** — they fire in the Promise wrapper (see below).

2. **Promise wrapper** — thin Promise layer that:
   - Fires request hook (before Effect pipeline)
   - Runs `sendEffect` via `runtime.runPromise`
   - Fires response hook (on success) or error hook (on failure)
   - Maps errors with `toPublicError` at the boundary
   - Returns `decoded` value

3. Preserve existing behavior for: response validation, `validateResponses: false`, retry policies,
   hooks, redaction, timeout propagation, request IDs.

4. Hook boundary note: hooks currently fire around `runPromise`. This is intentional — hooks are
   a Promise-layer concern. Effect-native hooks are a Phase 8 item.

5. Add tests proving `sendEffect` preserves decode failure, HTTP failure, timeout, retry, and
   hook execution order.

---

## Phase 4: Add Effect API On `UnrealRC`

Add `ue.effect.*` namespace — object-arg only, same `*Args` types as the Promise API.

```ts
const ue = new UnrealRC();

// Promise
await ue.call({ objectPath, functionName, parameters, transaction, timeoutMs, retry });

// Effect — same args type, returns Effect instead of Promise
yield* ue.effect.call({ objectPath, functionName, parameters, transaction, timeoutMs, retry });
```

**Implementation:**

1. Add a `readonly effect` object on `UnrealRC`.
2. Include Effect versions of all request methods:
   `call`, `getProperty`, `getProperties`, `setProperty`, `describe`, `searchAssets`,
   `info`, `event`, `thumbnail`, `batch`, `ping`, `pendingRequests`, `dispose`.
3. **Single object-arg signature per method** — no positional overloads. Uses existing `*Args` types.
4. Promise methods delegate to Effect methods:
   ```ts
   async call(args: CallArgs): Promise<ObjectCallResponse> {
     return this.runtime.runPromise(
       this.effect.call(args).pipe(Effect.mapError(toPublicError))
     );
   }
   ```
   This preserves the existing hook-firing wrapper around `runPromise`.

5. **BatchBuilder in Effect context:** the `batch` method keeps the callback-based builder pattern
   since it's inherently imperative (builder accumulates requests synchronously). Both Promise and
   Effect APIs share the same signature:
   ```ts
   yield* ue.effect.batch((b) => {
     b.call({ objectPath, functionName, parameters });
     b.getProperty({ objectPath, propertyName });
   });
   ```

6. Add type tests:
   - Promise API still returns `Promise<T>`.
   - Effect API returns `Effect.Effect<T, TransportError>`.
   - Existing `*Args` types compile in both namespaces.

---

## Phase 5: Add Generic Request APIs

Add public APIs for routes not wrapped by convenience methods.

**Promise API:**
```ts
await ue.request({ verb: "PUT", url: "/remote/object/call", body, responseSchema });
await ue.requestRaw({ verb: "PUT", url: "/remote/object/call", body });
```

**Effect API:**
```ts
yield* ue.effect.request({ verb: "PUT", url: "/remote/object/call", body, responseSchema });
yield* ue.effect.requestRaw({ verb: "PUT", url: "/remote/object/call", body });
```

**Details:**

1. `request` decodes with an optional `Schema.Schema<T>`. If omitted, returns `unknown`.
2. `requestRaw` returns the `TransportResponse` shape:
   ```ts
   { body: unknown; statusCode?: number; requestId?: number | string }
   ```
   Reuse the existing internal `TransportResponse` type publicly.
3. Both reuse timeout, retry, validation, hook, redaction, passphrase, and transport behavior.
4. All existing behavior (hooks, retry, timeout, redaction) applies to generic requests — they
   use the same `sendEffect` pipeline.
5. Add tests covering arbitrary endpoint requests.
6. This eliminates the need for direct `fetch()` calls in Electroswag for
   `/remote/search/assets` and `/remote/object/call`.

---

## Phase 6: Schema-Driven Return Decoding

Add `callReturn` — calls `/remote/object/call` and decodes only the `ReturnValue` field.

**Promise API:**
```ts
await ue.callReturn({ objectPath, functionName, parameters, returnSchema: MySchema });
```

**Effect API:**
```ts
yield* ue.effect.callReturn({ objectPath, functionName, parameters, returnSchema: MySchema });
```

**Behavior:**

1. Calls `/remote/object/call` (same endpoint).
2. Normalizes the alternate single-key return format into `ReturnValue` (reuses existing
   `normalizeCallResponse` logic).
3. Decodes only `ReturnValue` with the provided schema.
4. Fails with `DecodeError` in Effect API.
5. Throws mapped `TransportRequestError` in Promise API.
6. Separate method name avoids complicating the existing `call` signature.

**Tests:** valid return value, missing return value, invalid return value,
Unreal's alternate single-key response shape.

---

## Phase 7: Effect Layer / Service

Expose an injectable service for full Effect apps.

**Import path:** `unreal-rc/effect` (requires `package.json` `exports` field update).

**Implementation:**

1. Start with a `Context.Tag`:
   ```ts
   export class UnrealRCService extends Context.Tag("UnrealRCService")<
     UnrealRCService,
     UnrealRCEffectApi  // same shape as ue.effect.* (request methods only)
   >() {}
   ```
   `UnrealRCEffectApi` scopes to the request methods (`call`, `getProperty`, etc.).
   Lifecycle concerns (`ping`, `watchHealth`, `dispose`) are managed by the Layer.

2. Add `UnrealRCLive(options)` Layer using `Effect.acquireRelease` for proper resource scoping:
   ```ts
   export const UnrealRCLive = (options: UnrealRCOptions) =>
     Layer.scoped(UnrealRCService, Effect.gen(function* () { ... }));
   ```

3. Add `UnrealRCTest` helper Layer for tests.

4. Document use with `Effect.provide`:
   ```ts
   const program = Effect.gen(function* () {
     const ue = yield* UnrealRCService;
     const result = yield* ue.call({ objectPath, functionName });
   });
   await Effect.runPromise(program.pipe(Effect.provide(UnrealRCLive(options))));
   ```

5. **Package exports**: add `"./effect"` subpath to `package.json` exports field.

---

## Phase 8: Observability Improvements

1. Keep existing callback hooks for backward compatibility.
2. Add optional Effect-native hooks (in the `sendEffect` pipeline):
   ```ts
   onRequestEffect?: (ctx) => Effect.Effect<void>
   onResponseEffect?: (ctx) => Effect.Effect<void>
   onErrorEffect?: (ctx) => Effect.Effect<void>
   ```
3. Add tracing/log annotations around each request:
   `transport`, `verb`, `url`, `requestId`, `statusCode`, `durationMs`.
4. Effect-native hooks should **not** silently swallow failures — failures propagate unless
   explicitly caught. This differs from the current callback hooks which silently ignore errors.
5. Tests verify hook execution order and error behavior.

---

## Phase 9: Documentation

Update `packages/core/README.md` with:
1. Existing Promise examples (updated to object-arg form).
2. Effect examples:
   ```ts
   const result = yield* ue.effect.call({ objectPath, functionName, parameters });
   ```
3. Error handling:
   ```ts
   yield* ue.effect.call({ objectPath, functionName }).pipe(
     Effect.catchTag("ConnectError", () => ...)
   );
   ```
4. Raw request example.
5. `callReturn` schema example.
6. Layer/service example with `Effect.provide`.
7. Migration note: positional overloads removed; use object-arg form.

---

## Phase 10: Tests

Add or update tests for:

1. **Public exports:** tagged errors, `TransportError`, Effect API types.
2. **Runtime behavior:**
   - Promise methods resolve/reject as before (existing tests should pass unmodified as regression suite).
   - Effect methods fail with tagged errors.
   - Retries, validation, `validateResponses: false` all work.
3. **Request API:** decoded request, raw request, timeout/retry/options propagation.
4. **callReturn:** success, decode failure, missing return, normalized single-key response.
5. **Layer/service:** injectable, scoped disposal, test layer.

---

## Phase 11: Electroswag Follow-Up

After unreal-rc ships this, update Electroswag:

1. Replace `Effect.tryPromise(() => getTransport().call(...))` with `ue.effect.call(...)`.
2. Remove string matching in `formatServiceError`.
3. Use `Effect.catchTags` for `ConnectError`, `TimeoutError`, `HttpStatusError`, etc.
4. Replace direct `fetch()` in `src/main/unreal-transport.ts` with `ue.requestRaw` or `ue.effect.requestRaw`.
5. Use `callReturn({ returnSchema })` where Electroswag currently unwraps `ReturnValue` manually.
6. Pass custom Unreal port consistently to `UnrealRC`; current adapter should pass port.

---

## Suggested Execution Order

```
✅ Phase 0: Remove positional overloads
✅ Phase 1: Inventory current behavior (verify nothing broke)
✅ Phase 2: Public tagged error exports
✅ Phase 3: Extract sendEffect pipeline
✅ Phase 4: Add ue.effect.* namespace (object-arg only)
✅ Phase 5: Generic request / requestRaw
✅ Phase 6: callReturn with schema decoding
✅ Phase 7: Layer / service + package.json exports
⬜ Phase 8: Observability hooks + tracing
⬜ Phase 9: Documentation
⬜ Phase 10: Test suite (run after each phase)
⬜ Phase 11: Electroswag follow-up
```

---

## Compatibility Checklist

- [x] `new UnrealRC(options)` still works.
- [x] `await ue.call({ objectPath, functionName, ... })` works (object-arg only).
- [x] Existing thrown error class remains `TransportRequestError`.
- [ ] Existing README examples work (updated to object-arg form).
- [x] Package still has the same main export.
- [x] New Effect API (`ue.effect.*`) is additive only.
- [x] `unreal-rc/effect` subpath export works.
- [ ] No dependency version conflict with consumer-provided `effect`.
