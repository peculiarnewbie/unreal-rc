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
