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
bun run test:e2e
```

If you already have a local Unreal fixture project elsewhere:

```bash
UNREAL_FIXTURE_DIR=/abs/path/to/project bun run test:e2e
```

More detail is in `fixtures/README.md`.
