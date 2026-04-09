/**
 * @unreal-rc/codegen — public API
 *
 * Orchestrates the full pipeline:
 *   0. Extract (optional) — invoke UHT to produce JSON
 *   1. Discover — find JSON files by module
 *   2. Parse — read JSON into typed structures
 *   3. Filter — keep BlueprintCallable functions
 *   4. Resolve — build cross-module type registry
 *   5. Emit — generate TypeScript / Effect Schema files
 */
import { dirname, resolve } from "node:path";
import { join } from "node:path";
import type { CodegenConfig, ResolvedConfig } from "./types.js";
import { extract, deriveEnginePaths } from "./pipeline/extract.js";
import { discover } from "./pipeline/discover.js";
import { parse } from "./pipeline/parse.js";
import { filter } from "./pipeline/filter.js";
import { buildTypeRegistry } from "./pipeline/resolve.js";
import { emit } from "./pipeline/emit.js";

export type { CodegenConfig, ResolvedConfig } from "./types.js";

/**
 * Run the full codegen pipeline.
 */
export function generate(config: CodegenConfig): void {
  const resolved = resolveConfig(config);

  // Stage 0: Extract (optional)
  if (resolved.extract) {
    console.log("[codegen] Stage 0: Extracting UHT JSON...");
    const result = extract(resolved);
    console.log(`[codegen]   → ${result.jsonFiles.length} JSON files in ${result.durationMs}ms`);
  }

  // Stage 1: Discover
  console.log("[codegen] Stage 1: Discovering modules...");
  const discovered = discover(resolved);
  console.log(`[codegen]   → ${discovered.length} module(s) matched`);

  if (discovered.length === 0) {
    console.log("[codegen] No modules found. Check intermediateDir and moduleFilter.");
    return;
  }

  // Stage 2: Parse
  console.log("[codegen] Stage 2: Parsing UHT JSON...");
  const parsed = parse(discovered);

  // Stage 3: Filter
  console.log("[codegen] Stage 3: Filtering declarations...");
  const filtered = filter(parsed, resolved);
  const fnCount = filtered.reduce(
    (sum, m) => sum + m.classes.reduce((s, c) => s + c.functions.length, 0),
    0,
  );
  console.log(`[codegen]   → ${filtered.length} module(s) with ${fnCount} function(s)`);

  // Stage 4: Resolve
  console.log("[codegen] Stage 4: Building type registry...");
  const registry = buildTypeRegistry(filtered);
  console.log(`[codegen]   → ${registry.structs.size} struct(s), ${registry.enums.size} enum(s)`);

  // Stage 5: Emit
  console.log("[codegen] Stage 5: Emitting TypeScript...");
  emit(filtered, registry, resolved);

  console.log("[codegen] Done.");
}

// ── Config resolution ──────────────────────────────────────────────

function resolveConfig(config: CodegenConfig): ResolvedConfig {
  const shouldExtract = config.extract === true;
  const platform = config.platform ?? "Win64";

  let intermediateDir: string;
  let engineDir: string;
  let projectFile: string;
  let target: string;

  if (shouldExtract) {
    if (!config.engineDir || !config.projectFile || !config.target) {
      throw new Error(
        "When extract is true, engineDir, projectFile, and target are required.",
      );
    }
    engineDir = resolve(config.engineDir);
    projectFile = resolve(config.projectFile);
    target = config.target;

    const paths = deriveEnginePaths(engineDir, projectFile, platform);
    intermediateDir = paths.intermediateDir;
  } else {
    if (!config.intermediateDir) {
      throw new Error(
        "When extract is false, intermediateDir is required.",
      );
    }
    intermediateDir = resolve(config.intermediateDir);
    engineDir = config.engineDir ?? "";
    projectFile = config.projectFile ?? "";
    target = config.target ?? "";
  }

  return {
    extract: shouldExtract,
    engineDir,
    projectFile,
    target,
    platform,
    configuration: config.configuration ?? "Development",
    intermediateDir,
    moduleFilter: config.moduleFilter ?? null,
    functionFlags: config.functionFlags ?? ["BlueprintCallable"],
    includeDependentTypes: config.includeDependentTypes ?? true,
    outDir: resolve(config.outDir),
    format: config.format ?? "effect-schema",
    objectRefStyle: config.objectRefStyle ?? "string",
  };
}
