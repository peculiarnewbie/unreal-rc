/**
 * Stage 3: Filter parsed modules to only include relevant declarations.
 *
 * Keeps functions matching the configured FunctionFlags (e.g. BlueprintCallable),
 * and optionally collects struct/enum dependencies used by those functions.
 */
import type {
  ParsedModule,
  UhtClass,
  UhtStruct,
  UhtEnum,
  UhtFunction,
  UhtProperty,
} from "./parse.js";
import type { ResolvedConfig } from "../types.js";

// ── Output types ───────────────────────────────────────────────────

export interface FilteredModule {
  readonly name: string;
  readonly classes: readonly FilteredClass[];
  readonly structs: readonly UhtStruct[];
  readonly enums: readonly UhtEnum[];
}

export interface FilteredClass {
  readonly sourceName: string;
  readonly engineName: string;
  readonly superClass: string | null;
  readonly functions: readonly UhtFunction[];
}

// ── Filter ─────────────────────────────────────────────────────────

export function filter(
  modules: readonly ParsedModule[],
  config: ResolvedConfig,
): readonly FilteredModule[] {
  const results: FilteredModule[] = [];

  for (const { name, module } of modules) {
    const classes: FilteredClass[] = [];
    const structMap = new Map<string, UhtStruct>();
    const enumMap = new Map<string, UhtEnum>();

    for (const pkg of module.Packages) {
      for (const child of pkg.Children) {
        if (child.Kind === "Class") {
          const cls = child as UhtClass;
          const matchedFunctions = cls.Functions.filter(
            (fn) => matchesFunctionFlags(fn, config.functionFlags),
          );

          if (matchedFunctions.length > 0) {
            classes.push({
              sourceName: cls.SourceName,
              engineName: cls.EngineName,
              superClass: cls.Super ?? null,
              functions: matchedFunctions,
            });

            // Collect dependent struct/enum types if configured
            if (config.includeDependentTypes) {
              for (const fn of matchedFunctions) {
                collectDependentTypes(fn.Parameters, pkg.Children, structMap, enumMap);
              }
            }
          }
        }

        // Also collect top-level structs/enums that might be referenced
        if (child.Kind === "Struct" && config.includeDependentTypes) {
          structMap.set((child as UhtStruct).SourceName, child as UhtStruct);
        }
        if (child.Kind === "Enum" && config.includeDependentTypes) {
          enumMap.set((child as UhtEnum).SourceName, child as UhtEnum);
        }
      }
    }

    if (classes.length > 0) {
      results.push({
        name,
        classes,
        structs: Array.from(structMap.values()),
        enums: Array.from(enumMap.values()),
      });
    }
  }

  return results;
}

// ── Helpers ────────────────────────────────────────────────────────

function matchesFunctionFlags(fn: UhtFunction, requiredFlags: readonly string[]): boolean {
  const flags = fn.FunctionFlags;
  return requiredFlags.every((flag) => flags.includes(flag));
}

function collectDependentTypes(
  properties: readonly UhtProperty[],
  _allTypes: readonly unknown[],
  _structs: Map<string, UhtStruct>,
  _enums: Map<string, UhtEnum>,
): void {
  for (const prop of properties) {
    // TODO: resolve StructProperty/EnumProperty to their actual type definitions
    // This requires cross-module lookup once the type registry (stage 4) is built.
    if (prop.Inner) {
      collectDependentTypes(prop.Inner, _allTypes, _structs, _enums);
    }
  }
}
