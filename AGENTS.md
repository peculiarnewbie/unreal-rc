# AGENTS.md

Guidance for coding agents working in `unreal-rc`.

## Project Facts

- Bun workspace monorepo.
- Active implementation package: `packages/core` (`unreal-rc`).
- Source lives in `packages/core/src`; tests live in `packages/core/tests`; build output is `packages/core/dist`.
- TypeScript ESM/NodeNext package. Use explicit `.js` suffixes for relative TS imports.
- Runtime validation uses Effect `Schema`.

## Commands

Run from repo root unless package-local iteration is clearer.

- Install: `bun install`
- Typecheck: `bun run typecheck`
- Build: `bun run build`
- Test: `bun run test`
- E2E tests: `bun run test:e2e`
- Package dry run: `bun run pack:core`
- Clean: `bun run clean`

Minimum validation:

- Normal code changes: `bun run typecheck`, `bun run build`, and relevant `bun run test`
- Packaging changes: also run `bun run pack:core`
- E2E/protocol changes: run relevant e2e tests when feasible

## Core Rules

- Prefer minimal, focused changes.
- Edit source under `packages/core/src`; do not hand-edit `packages/core/dist`.
- Match existing style: 2-space indentation, semicolons, double quotes.
- Do not add dependencies unless required.
- Keep root public API centralized through `packages/core/src/index.ts`.
- Use `import type` for type-only imports.
- Keep placeholder packages lightweight unless explicitly implementing them.

## Type And API Rules

- Validate request/response boundary payloads with Effect `Schema`.
- Keep public request/response types aligned with Effect schemas; prefer schema-derived types where package boundaries allow, or add focused type tests proving parity.
- Build request bodies via schemas before send.
- Preserve `UnrealRC` as transport-agnostic.
- Thread public timeout options (`timeoutMs`) through transport calls.
- Preserve cause chains via `{ cause }` when rethrowing transport-level failures.
- Use `TransportRequestError` for public transport-level failures.
- For public API hardening, prefer additive object-argument overloads before replacing positional signatures.
- Avoid ambiguous positional domain strings in new internal APIs; prefer object parameters or narrowed/branded types for `objectPath`, `functionName`, `propertyName`, URLs, and request IDs.
- Treat branded public types and discriminated replacements for existing boolean state shapes as breaking unless introduced additively.

<!-- effect-solutions:start -->
## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.
<!-- effect-solutions:end -->
