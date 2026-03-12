# Unreal-backed Tests

This directory is reserved for tests that require a real Unreal fixture project.

Run them from the repo root with:

```bash
bun run test:e2e
```

Fixture resolution order:

1. `UNREAL_FIXTURE_DIR`
2. `fixtures/unreal-project`

The launch smoke test starts the fixture `.uproject`, then polls `http://127.0.0.1:30010/remote/info` until Unreal Remote Control responds.

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
UNREAL_E2E_BOOT_TIMEOUT_MS=180000
UNREAL_E2E_POLL_INTERVAL_MS=1000
UNREAL_E2E_REQUEST_TIMEOUT_MS=2000
```
