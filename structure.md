# unreal-rc — Project Structure

## Overview

Monorepo with four packages: a transport-agnostic RC client library, a source code parser/type generator, a GUI explorer app, and a documentation/homepage.

```
unreal-rc/
  package.json          # workspace root (bun workspaces)
  packages/
    core/               # unreal-rc (publish target for now)
    codegen/            # @unreal-rc/codegen
    explorer/           # @unreal-rc/explorer
    www/                # @unreal-rc/www
```

---

## Packages

### `unreal-rc` (in `packages/core`) — RC Client Library

The runtime library. Talk to Unreal's Remote Control plugin over WebSocket or HTTP.

- Transport-agnostic client (`UnrealRC` class)
- Zod-validated request/response types
- WebSocket transport (auto-reconnect, keepalive, auto-incrementing IDs)
- HTTP transport (fetch-based)
- Helpers: path builders, PIE paths, common UE type constructors
- Zero filesystem access, zero UI, zero UE source knowledge
- Lightweight — no heavy dependencies

**Consumers**: Anyone who wants to control UE from Node/Bun. Also used by `explorer`.

> Note: while the monorepo folder is `packages/core`, the publishable package name is `unreal-rc` so installation stays simple (`npm i unreal-rc`).

See `plan.md` for detailed implementation plan.

### `@unreal-rc/codegen` — Source Parser + Type Generator

CLI/library that reads UE C++ source (and project source) to produce TypeScript types and metadata.

- Parse `.h` files for `UFUNCTION(BlueprintCallable)` signatures
- Extract `UPROPERTY` declarations and their metadata
- Find static functions, their object paths, parameter shapes
- Output `.ts` files with typed wrappers or JSON schemas
- Potentially understand UHT (Unreal Header Tool) macros
- Heavy dependencies are fine here (tree-sitter, AST parsing, etc.) — this is dev-time only

**Consumers**: Developers at build time. Output consumed by `explorer` and by anyone who wants typed access to their project's API.

### `@unreal-rc/explorer` — GUI App

Postman-like local app for exploring and calling UE functions.

- Run codegen, then browse the results in a GUI
- Explore available functions and properties per object
- Fill in parameters and fire test calls via `core`
- See responses, build sequences, reduce need for in-engine debug menus
- Local web app (Vite + React, or Bun server with simple frontend)

**Consumers**: UE developers who want a visual way to interact with Remote Control.

### `@unreal-rc/www` — Homepage

Documentation site and homepage for the library.

- Built with Docusaurus or similar static site generator
- API reference, guides, getting started docs
- Links to GitHub, npm
- Hosted on GitHub Pages or similar

**Consumers**: Anyone learning about or discovering the library.

---

## Dependency Graph

```
explorer  →  core      (makes RC calls)
explorer  →  codegen   (reads generated schemas to populate the UI)
codegen   →  core      (type reuse for RC request/response shapes)
www       →  core      (reference docs for the API)
core      →  (nothing in monorepo — it's the leaf)
```

---

## Design Decisions

**Why monorepo**: The four packages share types and evolve together. `codegen` produces types that `core` consumers use. `explorer` depends on both. `www` provides docs. Separate repos would drift out of sync.

**Why not a shared `types` package**: Premature. `core` owns the RC types. `codegen` imports from `core` if needed. Split into a fifth package later only if it gets awkward.

**Why `codegen` is separate from `core`**: Completely different dependencies (filesystem, C++ parsing, AST) and completely different consumers (dev-time CLI vs runtime library). Bundling them means everyone who installs the client also pulls in tree-sitter.

**Why `explorer` is not a separate repo**: It would immediately drift out of sync with the other two. Monorepo keeps versions aligned.

---

## Build Order

1. **`core`** — useful standalone, no dependencies on the other packages
2. **`codegen`** — even a rough version extracting `UFUNCTION(BlueprintCallable)` from `.h` files is immediately valuable
3. **`explorer`** — mostly UI work once core and codegen exist
