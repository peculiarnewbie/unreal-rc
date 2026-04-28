# TypeScript Hardening Plan

## Findings

1. `packages/core/src/public/types.ts` manually duplicates schema shapes from `packages/core/src/internal/schemas.ts`. Deriving public types from Effect schemas with `Schema.Schema.Type<typeof FooSchema>` would keep runtime contracts and TypeScript types from drifting.
2. `packages/core/src/public/client.ts` exposes positional string APIs such as `call(objectPath, functionName, ...)`, `getProperty(objectPath, propertyName, ...)`, and `setProperty(objectPath, propertyName, propertyValue, ...)`. These allow swapped arguments to compile. Because this is public API, direct replacement would be breaking; add object-argument overloads or alternatives first.
3. `packages/core/src/internal/batch.ts` repeats the same positional-argument pattern in exported builders and `BatchBuilder` methods.
4. `packages/core/src/public/helpers.ts` uses positional args where object args would be clearer, especially `objectPath(mapPath, worldName, objectName)` and vector-like helpers.
5. `TransportRequestId` is currently `number | string`, and domain values such as object paths, function names, and property names are plain `string`. Effect branded schemas could make `ObjectPath`, `FunctionName`, `PropertyName`, and request IDs harder to mix up, but this is a larger API design change.
6. Hook handling is duplicated: `Hooks` is built into the runtime, but `UnrealRC` stores and fires hooks directly. This is not a type-safety bug, but it is an abstraction smell and makes hook attempt metadata currently hardcoded as `1`.
7. Health state is modeled with booleans plus optional fields, such as `PingResult.reachable` with optional `latencyMs` and `HealthStatus.healthy` with related fields. A discriminated union would make impossible combinations unrepresentable, but changing this public API should be treated as a breaking change.
8. Test coverage is present and includes unit tests plus e2e fixtures. Add type-focused tests when changing public API shape or schema-derived types.

## Recommended Plan

1. Derive public request and response types from Effect schemas where possible, preserving exported type names and runtime behavior.
2. Add branded internal aliases for domain strings using Effect schema primitives if compatible with the current Effect version: `ObjectPath`, `FunctionName`, `PropertyName`, `RemoteUrl`, and `RequestId`. Keep public input acceptance as `string` initially to avoid breaking consumers.
3. Add object-argument overloads for public client methods while keeping existing positional signatures. For example, support `client.call({ objectPath, functionName, parameters, transaction, timeoutMs, retry })` alongside the existing signature.
4. Add object-argument overloads for `BatchBuilder` and exported builder helpers while preserving existing positional signatures.
5. Clean up hook handling so the runtime `Hooks` service is either actually used by request sending, or removed if direct client hooks are the intended design.
6. Add new discriminated health result types as additive exports, then migrate methods only in a future breaking release.
7. Run `bun run typecheck`, `bun run build`, and `bun test` after implementation changes.

## Progress

### Completed

- [x] Item 1: Derive public request and response types from Effect schemas (`packages/core/src/public/types.ts`). Types now use `Schema.Schema.Type<typeof FooSchema>` with a `WithIndex<T>` helper preserving `[key: string]: unknown` on response types. Health/transport types without schema counterparts remain manual.
- [x] Item 2: Add object-argument overloads for `UnrealRC` methods (`call`, `getProperty`, `getProperties`, `setProperty`, `describe`, `searchAssets`, `thumbnail`). Each method now accepts either positional args or a single `*Args` object. New exported types: `CallArgs`, `GetPropertyArgs`, `GetPropertiesArgs`, `SetPropertyArgs`, `DescribeArgs`, `SearchAssetsArgs`, `ThumbnailArgs`, `WritableAccessMode`.
- [x] Item 3: Add object-argument overloads for batch helpers (`buildCallRequest`) and `BatchBuilder` methods (`call`, `getProperty`, `setProperty`, `searchAssets`). New exported types: `BuildCallArgs`, `BuildGetPropertyArgs`, `BuildSetPropertyArgs`, `BuildSearchAssetsArgs`.
- [x] Item 4: Add focused tests (`tests/overloads.test.ts`) proving both positional and object forms compile and produce identical request bodies for all client methods, batch helpers, and `BatchBuilder` methods.

### Completed

- [x] Item 5: Removed dead `Hooks` Effect service (`HooksService`, `Hooks`, `HooksLive`, `HooksNoop`) from `internal/hooks.ts`. Removed `makeHooksLayer` and hooks fields from `RuntimeConfig` in `internal/runtime.ts`. Hook firing remains entirely in `UnrealRC`'s private imperative methods (`fireRequestHook`, `fireResponseHook`, `fireErrorHook`), which was the only path actually used.
- [x] Item 6: Added discriminated health result types as additive exports alongside existing `PingResult` and `HealthStatus` in `packages/core/src/public/types.ts`. New public types: `DiscriminatedPingResult` (`"reachable" | "unreachable"`) and `DiscriminatedHealthStatus` (`"healthy" | "unhealthy"`). Method return types unchanged (deferred to future breaking release).

### Deferred

Branded public types and discriminated health-state method migration until there is appetite for a major version or a carefully staged compatibility path.
