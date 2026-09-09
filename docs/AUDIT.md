# Core library audit — 2026-09-08

This audit focused on `packages/core`: transport lifecycle, request correlation, boundary decoding, retry behavior, health polling, and their tests. The public API and schemas were also inspected. Placeholder packages and the website were outside this implementation pass.

## Findings fixed

| Priority | Finding | Change and evidence |
| --- | --- | --- |
| High | A full WebSocket queue suspended `Queue.offer`, preventing callers from observing their request deadline. Expired entries also occupied queue capacity until reconnection. | Reject overflow immediately and reclaim completed entries when the queue fills, preserving FIFO order. Regression tests cover saturation and reuse of expired slots. |
| High | WebSocket disconnect/disposal interrupted response-forwarding fibers before they settled callers. Requests without deadlines could hang indefinitely. | Correlation now owns the caller's deferred directly. Disconnect and disposal reject outstanding requests; disposal also rejects queued requests. Tests cover both connected and connecting states. |
| High | HTTP interruption left fetches running; URL/body serialization exceptions escaped cleanup and typed transport errors. HTTP layer instances also shared mutable state across runtimes. | Abort on interruption, register layer finalization, allocate state during layer acquisition, and include request construction in the error/cleanup boundary. Tests use real local HTTP connections and independent runtimes. |
| Medium | WebSocket request deadlines and forwarding work could outlive completed requests. | Remove the duplicate deferred, response-forwarding fiber, and second timeout worker. Use one request deadline that is cancelled on completion. A regression test verifies zero remaining timers while the calling fiber is still running. No throughput or latency improvement is claimed without a benchmark. |
| Medium | WebSocket connection attempts/listeners lacked interruption cleanup, and pending-map operations used separate reads and writes. | Close connecting sockets, unregister listeners, register runtime finalization, and atomically remove or drain pending entries. Tests include interruption, immediate responses, and 64 concurrent requests with replies in reverse order. |
| Medium | Malformed WebSocket JSON could cause defects or incorrectly correlate boolean IDs; JSON `null` response bodies became `undefined`. | Validate the envelope as a record, constrain IDs/status values, preserve null bodies, and report malformed statuses as decode errors with request metadata. Select ArrayBuffer delivery for binary frames. |
| Medium | Retry predicates always received attempt 1, and delay callbacks ran once against a fabricated `init` error before the request. | Evaluate callbacks through the retry schedule using each actual failure, attempt, status, and request body. Tests cover evolving contexts, early termination, and no delay callback on success. Numeric delays retain exponential backoff; callback delays specify each retry's delay directly. |
| Medium | Health polling could report healthy after its first failed ping. A throwing observer stopped polling, and client disposal left watcher timers running. | Preserve unhealthy status until a successful ping, isolate observer exceptions, and dispose registered watchers with the client. Tests use controlled time. |
| Low | HTTP default headers ignored the case-insensitive nature of Content-Type. | Preserve caller-provided Content-Type in any casing; verify against a real HTTP server. |
| Low | Two Unreal smoke tests used unsupported assertion matchers. | Replace `toStartWith`/`toEndWith` with supported boolean assertions. |

## Validation

- Baseline: 286 unit tests passed.
- Updated suite: 313 tests passed, including 27 added regressions.
- `pnpm typecheck` and `pnpm build` passed.
- All eight Unreal-backed tests passed using the local UE 5.7 fixture, with `UNREAL_E2E_BOOT_TIMEOUT_MS=30000` for the completed run. This covers both transports, cross-transport mutations, batches, asset search, startup, and error paths.
- `pnpm lint` passed with pre-existing warnings. Formatting is checked for the changed files; unrelated formatting/lint cleanup is excluded.
- No dependencies, public signatures, or package export paths were changed.

## Follow-up findings

1. **Schema service requirements are erased by public types.** `RequestArgs` and `CallReturnArgs` accept `Schema.Schema<T>`, while synchronous `callReturn` decoding requires a decoder without services and currently uses an `any` cast. Effect pipelines also cast away requirements. A future API revision should distinguish service-free Promise decoders from Effect decoders with explicit requirements, with compile-time tests for both. Narrowing today's accepted schema type can break consumers, so it is left for a deliberate API change. See [client.ts](../packages/core/src/public/client.ts).
2. **General hook attempt metadata is still ambiguous.** Promise request/response/error hooks wrap the logical operation and report `attempt: 1`, even when retry callbacks now receive accurate attempt numbers. Decide whether hooks represent each transport attempt or the overall operation before changing their invocation count. See `fireRequestHook`, `fireResponseHook`, and `fireErrorHook` in [client.ts](../packages/core/src/public/client.ts).
3. **Runtime compatibility needs a tested matrix.** The package declares Node `>=18`, while WebSocket transport construction uses the global `WebSocket` constructor without an injected factory. Test supported runtimes explicitly and document the required global or introduce an additive constructor option. This pass validates the installed runtime and Unreal fixture, not every declared runtime or Effect peer version. See [package.json](../packages/core/package.json) and [ws.ts](../packages/core/src/internal/ws.ts).

These follow-ups are not claims that the entire library is defect-free. They identify remaining compatibility and API-design work after the concrete lifecycle and correctness fixes above.
