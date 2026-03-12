# Unreal-backed Tests

This directory is reserved for tests that require a real Unreal fixture project.

Run them from the repo root with:

```bash
bun run test:e2e
```

Fixture resolution order:

1. `UNREAL_FIXTURE_DIR`
2. `fixtures/unreal-project`

The launch smoke test starts the fixture `.uproject`, then waits for:

- `http://127.0.0.1:30010/remote/info`
- `ws://127.0.0.1:30020` to accept a WebSocket connection

The launcher opens the fixture project with the test map as a command-line argument:

```bash
UnrealEditor <Project>.uproject /Game/Maps/RemoteControlE2E
```

The protocol roundtrip test then:

- describes a known fixture actor
- writes and reads a numeric property over HTTP
- calls a mutating function over HTTP and verifies the new value over WebSocket
- writes and reads the same property over WebSocket
- calls the same function over WebSocket and verifies the new value over HTTP

Editor discovery order:

```bash
UNREAL_EDITOR_BIN=/abs/path/to/UnrealEditor
UNREAL_ENGINE_ROOT=/abs/path/to/UE_5.7
```

If neither is set, the helper falls back to:

1. editor on `PATH`
2. common install roots

The common roots currently include:

```bash
# macOS Launcher installs
/Users/Shared/Epic Games/UE_[version]

# Linux source or unpacked installs, best-effort scan
$HOME/UnrealEngine
$HOME/EpicGames/UE_[version]
/opt/unreal-engine
/opt/UnrealEngine
```

For Linux there is no single fixed install root. The stable part is the binary path inside the engine root:

```bash
Engine/Binaries/Linux/UnrealEditor
```

Optional env vars:

```bash
UNREAL_EDITOR_ARGS_JSON='["-stdout","-FullStdOutLogOutput"]'
UNREAL_E2E_HOST=127.0.0.1
UNREAL_E2E_HTTP_PORT=30010
UNREAL_E2E_WS_PORT=30020
UNREAL_E2E_BOOT_TIMEOUT_MS=180000
UNREAL_E2E_POLL_INTERVAL_MS=1000
UNREAL_E2E_REQUEST_TIMEOUT_MS=2000
```

Fixture contract env vars:

```bash
UNREAL_E2E_MAP_PATH=/Game/Maps/RemoteControlE2E
UNREAL_E2E_LAUNCH_MAP_PATH=/Game/Maps/RemoteControlE2E
UNREAL_E2E_WORLD_NAME=RemoteControlE2E
UNREAL_E2E_ACTOR_NAME=E2EFixtureActor
UNREAL_E2E_OBJECT_PATH=/Game/Maps/RemoteControlE2E.RemoteControlE2E:PersistentLevel.E2EFixtureActor_C_1
UNREAL_E2E_PROPERTY_NAME=Counter
UNREAL_E2E_BASELINE_VALUE=0
UNREAL_E2E_HTTP_WRITE_VALUE=10
UNREAL_E2E_HTTP_CALL_DELTA=5
UNREAL_E2E_WS_WRITE_VALUE=20
UNREAL_E2E_WS_CALL_DELTA=7
UNREAL_E2E_FUNCTION_NAME=AddToCounter
UNREAL_E2E_FUNCTION_ARGUMENT_NAME=Delta
```

If you build the fixture to match those defaults, no extra env configuration is needed beyond the fixture path and editor location.

Fixture-project prompt:

```text
Create or update the Unreal fixture project used for unreal-rc e2e tests with this exact contract:

- Enable the Remote Control API plugin and any required dependencies.
- Create a map at /Game/Maps/RemoteControlE2E.
- Create an actor Blueprint that can be placed in the level.
- Place exactly one instance in the map and rename the placed actor instance to E2EFixtureActor so its object path resolves to /Game/Maps/RemoteControlE2E.RemoteControlE2E:PersistentLevel.E2EFixtureActor_C_1.
- Add an integer variable named Counter, editable through Remote Control, with default value 0.
- Add a BlueprintCallable function named AddToCounter with one integer input parameter named Delta and an integer return value.
- Implement AddToCounter so it adds Delta to Counter, stores the new Counter value, and returns the new Counter value.
- Save the map and all assets.

The unreal-rc harness will open that map explicitly via command-line arguments, so do not change the project's default startup map just for the test.

Do not change those names unless you also plan to override the unreal-rc e2e env vars.
```
