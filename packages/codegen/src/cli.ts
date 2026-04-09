#!/usr/bin/env bun
/**
 * CLI entry point for @unreal-rc/codegen.
 *
 * Usage:
 *   # Transform-only (JSON already exists):
 *   unreal-rc-codegen --intermediateDir ./Intermediate/Build/Win64/UnrealEditor/Inc \
 *                     --moduleFilter "Mana*" \
 *                     --outDir ./generated
 *
 *   # Full pipeline (extract + transform):
 *   unreal-rc-codegen --extract \
 *                     --engineDir "C:/UE5" \
 *                     --projectFile "C:/MyProject/MyProject.uproject" \
 *                     --target "MyProjectEditor" \
 *                     --moduleFilter "Mana*" \
 *                     --outDir ./generated
 */
import { parseArgs } from "node:util";
import { generate } from "./index.js";
import type { CodegenConfig } from "./types.js";

const { values } = parseArgs({
  options: {
    // Extract options
    extract: { type: "boolean", default: false },
    engineDir: { type: "string" },
    projectFile: { type: "string" },
    target: { type: "string" },
    platform: { type: "string", default: "Win64" },
    configuration: { type: "string", default: "Development" },

    // Discover/filter options
    intermediateDir: { type: "string" },
    moduleFilter: { type: "string" },
    functionFlags: { type: "string" },

    // Emit options
    outDir: { type: "string" },
    format: { type: "string", default: "effect-schema" },
    objectRefStyle: { type: "string", default: "string" },

    // Meta
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
@unreal-rc/codegen — Generate TypeScript types from Unreal Header Tool reflection data.

OPTIONS:
  --extract               Run UHT to produce JSON files (requires engine/project opts)
  --engineDir <path>      Path to Unreal Engine root directory
  --projectFile <path>    Path to .uproject file
  --target <name>         Editor build target (e.g. "MyProjectEditor")
  --platform <name>       Target platform (default: Win64)
  --configuration <name>  Build configuration (default: Development)

  --intermediateDir <path>  Path to existing UHT JSON output (required if --extract is not set)
  --moduleFilter <glob>     Filter modules by name (e.g. "Mana*")
  --functionFlags <flags>   Comma-separated function flags filter (default: BlueprintCallable)

  --outDir <path>         Output directory for generated TypeScript files (required)
  --format <type>         Output format: types | effect-schema | both (default: types)
  --objectRefStyle <type> UObject reference style: string | branded (default: string)

  -h, --help              Show this help message
`);
  process.exit(0);
}

// Validate required options
if (!values.outDir) {
  console.error("Error: --outDir is required");
  process.exit(1);
}

if (!values.extract && !values.intermediateDir) {
  console.error("Error: either --extract (with engine opts) or --intermediateDir is required");
  process.exit(1);
}

if (values.extract && (!values.engineDir || !values.projectFile || !values.target)) {
  console.error("Error: --extract requires --engineDir, --projectFile, and --target");
  process.exit(1);
}

const format = values.format as CodegenConfig["format"];
if (format !== "types" && format !== "effect-schema" && format !== "both") {
  console.error(`Error: --format must be one of: types, effect-schema, both`);
  process.exit(1);
}

const config: CodegenConfig = {
  extract: values.extract,
  engineDir: values.engineDir,
  projectFile: values.projectFile,
  target: values.target,
  platform: values.platform,
  configuration: values.configuration,
  intermediateDir: values.intermediateDir,
  moduleFilter: values.moduleFilter,
  functionFlags: values.functionFlags?.split(","),
  outDir: values.outDir,
  format,
  objectRefStyle: values.objectRefStyle as CodegenConfig["objectRefStyle"],
};

generate(config);
