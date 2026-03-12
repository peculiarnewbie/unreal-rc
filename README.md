# unreal-rc

A typed TypeScript client for [Unreal Engine's Remote Control](https://dev.epicgames.com/documentation/en-us/unreal-engine/remote-control-for-unreal-engine) plugin. Control a running Unreal Editor or game instance over WebSocket or HTTP.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`packages/core`](./packages/core) | Runtime client library (published as `unreal-rc`) | Available |
| `packages/codegen` | Source parser / type generator | Planned |
| `packages/explorer` | Local GUI app for exploring RC endpoints | Planned |
| `packages/www` | Documentation site | Planned |

## Prerequisites

- **Unreal Engine 5.x** with the **Remote Control** plugin enabled
- **Node.js >= 18**, **Bun**, or any runtime with `fetch` and `WebSocket` support

The Remote Control plugin exposes two endpoints on localhost:

| Protocol | Default Port | Use Case |
|----------|-------------|----------|
| HTTP | `30010` | Simple request/response |
| WebSocket | `30020` | Persistent connection with auto-reconnect |

## Quick Start

```bash
npm install unreal-rc
```

```ts
import { UnrealRC } from "unreal-rc";

const ue = new UnrealRC(); // defaults to WebSocket on 127.0.0.1:30020

// Call a function on an actor
await ue.call(
  "/Game/Maps/Main.Main:PersistentLevel.MyActor",
  "SetActorHiddenInGame",
  { bNewHidden: false }
);

// Read a property
const location = await ue.getProperty(
  "/Game/Maps/Main.Main:PersistentLevel.MyActor",
  "RelativeLocation"
);

// Clean up
await ue.dispose();
```

See the [core package README](./packages/core/README.md) for full API documentation.

## Development

```bash
bun install
bun run typecheck
bun run build
```

### Working on core

```bash
bun run --cwd packages/core typecheck
bun run --cwd packages/core build
bun run --cwd packages/core test
```

### E2E Tests

E2E tests launch a real Unreal Editor instance and exercise the full protocol.

**Unreal fixture** precedence:

1. `UNREAL_FIXTURE_DIR` environment variable
2. Default path `fixtures/unreal-project` (intended for a git submodule)

**Editor discovery** order:

1. `UNREAL_EDITOR_BIN`
2. `UNREAL_ENGINE_ROOT`
3. Editor on `PATH`
4. Common install roots (e.g. `C:\Program Files\Epic Games\UE_5.7`)

```bash
# Fixture management
bun run fixture:status
bun run fixture:init
bun run fixture:update

# Run E2E tests
bun run test:e2e

# With explicit engine root
UNREAL_ENGINE_ROOT="/Users/Shared/Epic Games/UE_5.7" bun run test:e2e

# With a custom fixture directory
UNREAL_FIXTURE_DIR=/abs/path/to/project bun run test:e2e
```

More detail is in [`fixtures/README.md`](./fixtures/README.md).

## License

MIT
