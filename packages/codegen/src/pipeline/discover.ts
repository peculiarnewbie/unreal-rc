/**
 * Stage 1: Discover UHT JSON files in the intermediate directory.
 *
 * Globs for JSON files and filters by module name pattern.
 */
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import type { ResolvedConfig } from "../types.js";

export interface DiscoveredModule {
  /** Module short name (e.g. "ManaCombat"). */
  readonly name: string;

  /** Absolute path to the module's JSON file. */
  readonly jsonPath: string;
}

export function discover(config: ResolvedConfig): readonly DiscoveredModule[] {
  const { intermediateDir, moduleFilter } = config;

  const modules: DiscoveredModule[] = [];

  let entries;
  try {
    entries = readdirSync(intermediateDir, { withFileTypes: true });
  } catch {
    throw new Error(`Cannot read intermediate directory: ${intermediateDir}`);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const moduleName = entry.name;
    const jsonPath = join(intermediateDir, moduleName, "UHT", `${moduleName}.json`);

    // Check if JSON exists (lightweight: just try stat)
    try {
      const { statSync } = require("node:fs") as typeof import("node:fs");
      statSync(jsonPath);
    } catch {
      continue; // No JSON for this module
    }

    if (moduleFilter !== null && !matchesGlob(moduleName, moduleFilter)) {
      continue;
    }

    modules.push({ name: moduleName, jsonPath });
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Simple glob matching: supports `*` as wildcard prefix/suffix.
 * "Mana*" matches "ManaCombat", "*Editor" matches "ManaItemEditor".
 */
function matchesGlob(name: string, pattern: string): boolean {
  if (pattern === "*") return true;

  if (pattern.startsWith("*") && pattern.endsWith("*")) {
    return name.includes(pattern.slice(1, -1));
  }
  if (pattern.endsWith("*")) {
    return name.startsWith(pattern.slice(0, -1));
  }
  if (pattern.startsWith("*")) {
    return name.endsWith(pattern.slice(1));
  }

  return name === pattern;
}
