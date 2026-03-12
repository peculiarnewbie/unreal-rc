# unreal-rc monorepo

Monorepo for Unreal Engine Remote Control tooling.

## Packages

- `packages/core` - runtime client package (`unreal-rc`)
- `packages/codegen` - planned source parser/type generator
- `packages/explorer` - planned local GUI app
- `packages/www` - planned docs/homepage

## Quick start

```bash
bun install
bun run typecheck
bun run build
```

## Working on core

```bash
bun run --cwd packages/core typecheck
bun run --cwd packages/core build
```

## Unreal Fixture

Unreal-backed tests use this fixture precedence:

1. `UNREAL_FIXTURE_DIR`
2. default path `fixtures/unreal-project` (intended for a git submodule)

Commands:

```bash
bun run fixture:status
bun run fixture:init
bun run fixture:update
bun run test:e2e
```

`bun run test:e2e` now includes a launch smoke test that boots the fixture `.uproject` and waits for Unreal Remote Control HTTP at `/remote/info`.

Editor discovery order:

1. `UNREAL_EDITOR_BIN`
2. `UNREAL_ENGINE_ROOT`
3. editor on `PATH`
4. common install roots

Examples:

```bash
UNREAL_ENGINE_ROOT="/Users/Shared/Epic Games/UE_5.7" \
UNREAL_EDITOR_ARGS_JSON='["-stdout","-FullStdOutLogOutput"]' \
bun run test:e2e
```

```bash
UNREAL_ENGINE_ROOT="$HOME/UnrealEngine" bun run test:e2e
```

On Windows, a Launcher install like `C:\Program Files\Epic Games\UE_5.7` is one of the paths the helper now scans automatically.

If you already have a local Unreal fixture project elsewhere:

```bash
UNREAL_FIXTURE_DIR=/abs/path/to/project bun run test:e2e
```

More detail is in `fixtures/README.md`.
