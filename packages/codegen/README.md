# @unreal-rc/codegen

Generate typed [Effect Schemas](https://effect.website/docs/schema/introduction) from your Unreal Engine project's C++ source — so every `client.call()` through `unreal-rc` is type-safe and validated before it ever hits the engine.

## How It Works

Unreal Engine's **Unreal Header Tool (UHT)** already parses every `UFUNCTION`, `UPROPERTY`, `USTRUCT`, and `UENUM` in your project during compilation. This tool taps into that:

```
Your C++ Source
  → UHT parses it (already happens every build)
    → We extract the reflection data as JSON (-Json flag)
      → codegen reads the JSON
        → Emits Effect Schemas for every BlueprintCallable function
```

No custom C++ parser. No regex. The authoritative Unreal compiler does the parsing — we just transform the output.

## Prerequisites

- **Bun** runtime (the monorepo package manager)
- **.NET SDK** (`dotnet` on PATH) — required to invoke UnrealBuildTool
- **Unreal Engine source build** — the codegen patches UHT's JSON exporter (stock UE has a serialization bug). The patch is applied automatically on first run.

## Quick Start

### 1. Generate schemas from an existing build

If your project has been built at least once (so UHT intermediate files exist):

```bash
bun packages/codegen/src/cli.ts \
  --intermediateDir "C:/MyProject/Intermediate/Build/Win64/UnrealEditor/Inc" \
  --moduleFilter "MyGame*" \
  --outDir ./src/generated
```

### 2. Generate schemas with UHT extraction

Run the full pipeline — patches the engine exporter, invokes UHT, and generates schemas in one step:

```bash
bun packages/codegen/src/cli.ts \
  --extract \
  --engineDir "C:/UnrealEngine" \
  --projectFile "C:/MyProject/MyProject.uproject" \
  --target "MyProjectEditor" \
  --moduleFilter "MyGame*" \
  --outDir ./src/generated
```

This will:
1. Check if your engine has the patched JSON exporter — if not, copy it in and rebuild UBT (~8s)
2. Run UHT with `-Json -NoDefaultExporters` (~3s for a large project)
3. Discover JSON files for matching modules
4. Filter to `BlueprintCallable` functions
5. Emit Effect Schema files to `--outDir`

## Using the Generated Schemas

### Validate parameters before calling Unreal

```typescript
import { Schema } from "effect";
import { UnrealRC } from "unreal-rc";
import { M_ProjectileBase_SetTargetActorParams } from "./generated/ManaProjectile.js";

const client = new UnrealRC();

// Schema.decodeSync validates at runtime — typos and wrong types
// are caught immediately, before anything is sent to Unreal.
const params = Schema.decodeSync(M_ProjectileBase_SetTargetActorParams)({
  target: "/Game/Maps/Main.Main:EnemyActor",
});

await client.call("/Game/Maps/Main.Main:MyProjectile", "SetTargetActor", params);
```

### Use the inferred TypeScript types

Every schema export has a matching type export of the same name:

```typescript
import type { M_ProjectileBase_SetTargetActorParams } from "./generated/ManaProjectile.js";

// Full autocomplete and type checking — no runtime cost
function launchAt(params: M_ProjectileBase_SetTargetActorParams) {
  return client.call(objectPath, "SetTargetActor", params);
}

launchAt({ target: "/Game/.../Enemy" });  // OK
launchAt({ target: 42 });                 // Type error: number is not string
launchAt({ taget: "/Game/.../Enemy" });   // Type error: 'taget' does not exist
```

### Use the class-level function map

Each class gets a `const` map grouping all its callable functions:

```typescript
import { M_ProjectileBase } from "./generated/ManaProjectile.js";

// Autocomplete shows every BlueprintCallable function on the class
const fn = M_ProjectileBase.SetTargetActor;

fn.functionName;   // "SetTargetActor" (string literal type)
fn.params;         // Schema.Struct<{ target: typeof Schema.String }>
fn.returnSchema;   // present if the function has a return value

// Use it to build generic helpers:
async function callFn<P>(
  client: UnrealRC,
  objectPath: string,
  fn: { functionName: string; params: Schema.Schema<P> },
  rawParams: unknown,
) {
  const validated = Schema.decodeSync(fn.params)(rawParams);
  return client.call(objectPath, fn.functionName, validated as Record<string, unknown>);
}

await callFn(client, myProjectile, M_ProjectileBase.SetTargetActor, {
  target: "/Game/.../Enemy",
});
```

## Including Engine Schemas

By default, `--moduleFilter` limits output to your game modules. To also generate schemas for engine types (every `BlueprintCallable` in the engine):

```bash
# All modules (engine + project + plugins) — generates hundreds of files
bun packages/codegen/src/cli.ts \
  --intermediateDir "C:/MyProject/Intermediate/Build/Win64/UnrealEditor/Inc" \
  --outDir ./src/generated

# Or combine engine and project with separate runs
bun packages/codegen/src/cli.ts \
  --intermediateDir "C:/UE5/Engine/Intermediate/Build/Win64/UnrealEditor/Inc" \
  --moduleFilter "Engine" \
  --outDir ./src/generated/engine

bun packages/codegen/src/cli.ts \
  --intermediateDir "C:/MyProject/Intermediate/Build/Win64/UnrealEditor/Inc" \
  --moduleFilter "MyGame*" \
  --outDir ./src/generated/game
```

> **Note:** Engine modules are found in your engine's `Intermediate/` directory, while project modules are in your project's `Intermediate/` directory. When using `--extract`, both are generated together into the project's intermediate directory.

## What Gets Generated

For a C++ function like:

```cpp
UFUNCTION(BlueprintCallable, Category="Projectile")
void SetProjectileLifeTime(float lifeTime);
```

The codegen produces:

```typescript
// Params schema (runtime validation + type inference)
export const M_ProjectileBase_SetProjectileLifeTimeParams = Schema.Struct({
  lifeTime: Schema.Number,
});

// Inferred TypeScript type (zero runtime cost)
export type M_ProjectileBase_SetProjectileLifeTimeParams =
  typeof M_ProjectileBase_SetProjectileLifeTimeParams.Type;
// → { readonly lifeTime: number }
```

For functions with return values:

```cpp
UFUNCTION(BlueprintCallable, BlueprintPure)
float GetProjectileLifeTime() const;
```

```typescript
export const M_ProjectileBase_GetProjectileLifeTimeParams = Schema.Struct({});
export type M_ProjectileBase_GetProjectileLifeTimeParams = typeof M_ProjectileBase_GetProjectileLifeTimeParams.Type;

export const M_ProjectileBase_GetProjectileLifeTimeReturn = Schema.Number;
export type M_ProjectileBase_GetProjectileLifeTimeReturn = typeof M_ProjectileBase_GetProjectileLifeTimeReturn.Type;
```

### Type Mapping

| C++ / UHT Type | Generated Schema | TypeScript Type |
|---|---|---|
| `float`, `double` | `Schema.Number` | `number` |
| `int32`, `uint32`, `int8`, `uint8` | `Schema.Number` | `number` |
| `bool` | `Schema.Boolean` | `boolean` |
| `FString` | `Schema.String` | `string` |
| `FName` | `Schema.String` | `string` |
| `FText` | `Schema.String` | `string` |
| `UObject*`, `AActor*`, etc. | `Schema.String` | `string` (object path) |
| `TSubclassOf<T>` | `Schema.String` | `string` (class path) |
| `TSoftObjectPtr<T>` | `Schema.String` | `string` (soft ref path) |
| `TArray<T>` | `Schema.Array(...)` | `T[]` |
| `TMap<K, V>` | `Schema.Record(...)` | `Record<K, V>` |
| `USTRUCT` types | `Schema.Unknown` (TODO) | `unknown` |
| `UENUM` types | `Schema.Unknown` (TODO) | `unknown` |

> Struct and enum resolution is planned — currently emits `Schema.Unknown` for complex nested types.

## CLI Reference

```
bun packages/codegen/src/cli.ts [options]

EXTRACTION (optional — skipped if --intermediateDir is provided):
  --extract                 Run UHT to produce JSON from source
  --engineDir <path>        Unreal Engine root directory
  --projectFile <path>      Path to .uproject file
  --target <name>           Editor build target (e.g. "MyProjectEditor")
  --platform <name>         Target platform (default: Win64)
  --configuration <name>    Build configuration (default: Development)

INPUT (required if --extract is not set):
  --intermediateDir <path>  Path to UHT JSON output directory

FILTERING:
  --moduleFilter <glob>     Filter modules by name (e.g. "MyGame*")
  --functionFlags <flags>   Comma-separated flags (default: BlueprintCallable)

OUTPUT:
  --outDir <path>           Output directory for generated .ts files (required)
  --format <type>           effect-schema | types | both (default: effect-schema)

OTHER:
  -h, --help                Show help
```

## Recommended Workflow

1. **First time setup:** Run with `--extract` to patch the engine exporter and generate JSON. This only patches once — subsequent runs detect the patch is already in place.

2. **Day-to-day:** After each C++ change that adds/modifies `BlueprintCallable` functions, re-run the codegen. With `--extract` it takes ~3 seconds. Without (if you already built in the editor), even faster.

3. **Check in the generated files** (or don't — your call). The generated schemas are deterministic, so they can be regenerated from any build.

4. **CI integration:** Add the codegen step after your UE build. The `--intermediateDir` mode doesn't need the engine — just the JSON files from the build artifacts.

## Architecture

```
                    ┌──────────────────────────────────────────────────┐
                    │              @unreal-rc/codegen                   │
                    │                                                   │
  C++ Source ──→  UHT (-Json) ──→  .json files ──→  codegen pipeline  │
                    │                                  │                │
                    │                    ┌──────────────┤                │
                    │                    │              │                │
                    │              0. Extract     1. Discover            │
                    │              (optional)     2. Parse               │
                    │                             3. Filter              │
                    │                             4. Resolve             │
                    │                             5. Emit                │
                    │                                  │                │
                    │                                  ▼                │
                    │                          generated .ts files      │
                    └──────────────────────────────────────────────────┘
                                                       │
                                                       ▼
                                              import in your app
                                                       │
                                                       ▼
                                            unreal-rc client.call()
                                            with validated params
```
