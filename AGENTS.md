# AGENTS.md

Guidance for coding agents working in `unreal-rc`.

## Scope and Intent

- This repository is a Bun workspace monorepo.
- The only active implementation package is `packages/core` (`unreal-rc`).
- Other packages (`packages/codegen`, `packages/explorer`, `packages/www`) are placeholders.
- Prefer minimal, focused changes and keep generated output out of commits unless requested.

## Rule Files Check

- `.cursorrules`: not present.
- `.cursor/rules/`: not present.
- `.github/copilot-instructions.md`: not present.
- There are currently no Cursor/Copilot rule files to mirror.
- If any of these files are added later, treat them as highest-priority agent instructions and update this file.

## Environment and Tooling

- Package manager: `bun` (`packageManager` is `bun@1.2.21`).
- Language: TypeScript (ESM, NodeNext).
- Runtime baseline: Node `>=18` for `packages/core`.
- Validation library: `zod`.
- No lint framework is configured right now (no ESLint/Biome config found).
- No dedicated test runner config is committed right now.

## Repository Layout

- Root workspace config: `package.json`.
- Shared TS config: `tsconfig.base.json`.
- Project reference entrypoint: `tsconfig.json`.
- Publishable package: `packages/core`.
- Core source: `packages/core/src`.
- Core build output: `packages/core/dist`.

## Canonical Commands

Run from repo root unless noted.

### Install

- `bun install`

### Build

- Root build (core): `bun run build`
- Direct core build: `bun run --cwd packages/core build`

### Typecheck

- Root typecheck (core): `bun run typecheck`
- Direct core typecheck: `bun run --cwd packages/core typecheck`

### Clean

- Root clean (core): `bun run clean`
- Direct core clean: `bun run --cwd packages/core clean`

### Package Verification

- Dry-run npm pack for publishability: `bun run pack:core`
- Direct command: `bun run --cwd packages/core pack:check`

### Lint

- No lint script exists today.
- Do not invent a lint command in CI/docs unless a lint tool is added.
- Use TypeScript strict checks as the current quality gate.

### Test

- No test files are currently committed.
- No `test` script is currently defined in root or `packages/core`.
- If adding tests with Bun test runner, use:
- All tests: `bun test`
- Single file: `bun test packages/core/src/<name>.test.ts`
- Single test by name: `bun test packages/core/src/<name>.test.ts -t "<test name>"`
- Watch mode (optional): `bun test --watch`

## Minimum Pre-PR Validation

- `bun run typecheck`
- `bun run build`
- If packaging-related changes were made: `bun run pack:core`
- If tests exist in your branch: run relevant `bun test` command(s), including targeted single-test runs while iterating.

## TypeScript Compiler Constraints

From `tsconfig.base.json` and package configs:

- `strict: true` is required.
- `noUncheckedIndexedAccess: true` is enabled.
- `exactOptionalPropertyTypes: true` is enabled.
- `verbatimModuleSyntax: true` is enabled.
- Module system is `NodeNext` with ESM output.
- Keep imports/exports ESM-compatible with explicit `.js` path suffixes in TS source.

## Code Style and Conventions

### Imports and Exports

- Use `import type` for type-only imports.
- Keep value imports and type imports distinct when practical.
- Use explicit relative module paths with `.js` extension (for NodeNext compatibility).
- Prefer named exports over default exports.
- Keep root public API centralized via `packages/core/src/index.ts` barrel exports.

### Formatting

- Match existing style: 2-space indentation, semicolons, double quotes.
- Prefer trailing commas only when already produced by surrounding style; keep formatting consistent with nearby code.
- Keep line length readable; break long object literals/parameter lists across lines.
- Avoid adding comments unless a block is genuinely non-obvious.

### Types and Validation

- Never introduce `any` unless absolutely unavoidable; prefer `unknown` + narrowing.
- Validate request/response boundary payloads with Zod schemas.
- Co-locate schema/type pairs using `FooSchema` + `type Foo = z.infer<typeof FooSchema>`.
- Use `.strict()` for exact input payload contracts when appropriate.
- Use `.passthrough()` only when API responses legitimately contain extra keys.
- Keep exported function/method return types explicit where clarity matters.

### Naming

- `PascalCase`: classes, interfaces, exported types, Zod schemas.
- `camelCase`: functions, methods, local variables, object fields.
- `UPPER_SNAKE_CASE`: module-level constants.
- Use descriptive names reflecting Unreal RC domain terms (`objectPath`, `propertyName`, `RequestId`, etc.).

### Error Handling

- Use `TransportRequestError` for transport-level failures.
- Preserve cause chains via `{ cause }` when rethrowing.
- Include `statusCode` and `details` when available.
- Throw early on invalid inputs through schema parsing or explicit guards.
- Prefer predictable typed errors over raw thrown primitives.

### Async, Timeouts, and Resource Cleanup

- Thread timeout options through public APIs (`timeoutMs`) to transport calls.
- Ensure timers/controllers are cleared in `finally` blocks.
- Ensure `dispose()` is safe and idempotent in transport implementations.
- Reject/flush pending work on shutdown/disconnect paths.

### API and Transport Patterns

- Keep `UnrealRC` transport-agnostic; do not leak transport internals into client API.
- Build request bodies via schemas before send.
- Parse responses conditionally based on `validateResponses` behavior.
- Maintain endpoint/method consistency with Unreal Remote Control routes.

## File and Change Hygiene

- Edit source under `packages/core/src`; avoid hand-editing `packages/core/dist`.
- Keep workspace scripts aligned with actual package capabilities.
- Do not add new dependencies unless required by the task.
- Keep placeholder packages lightweight unless explicitly implementing them.

## Agent Workflow Tips

- Prefer root scripts for standard checks; use `--cwd packages/core` for package-local iteration.
- For rapid debugging, run a single targeted test file/name once tests exist.
- When adding new public API surface, update barrel exports and README usage snippets.
- When changing wire contracts, update Zod schemas and inferred types together.
