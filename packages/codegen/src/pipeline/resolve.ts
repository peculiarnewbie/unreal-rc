/**
 * Stage 4: Cross-module type resolution.
 *
 * Builds a global registry of struct/enum types so that when a function
 * parameter references a StructProperty or EnumProperty, we can resolve it
 * to the actual type definition (which may live in a different module).
 *
 * TODO: This stage is a placeholder. Full resolution requires:
 * - Correlating EngineClassName "StructProperty" with the actual struct name
 *   (available via MetaData or inner property references in UHT)
 * - Walking cross-module references
 * - Handling inheritance chains for classes
 */
import type { FilteredModule } from "./filter.js";
import type { UhtStruct, UhtEnum } from "./parse.js";

export interface TypeRegistry {
  readonly structs: ReadonlyMap<string, UhtStruct>;
  readonly enums: ReadonlyMap<string, UhtEnum>;
}

export function buildTypeRegistry(modules: readonly FilteredModule[]): TypeRegistry {
  const structs = new Map<string, UhtStruct>();
  const enums = new Map<string, UhtEnum>();

  for (const mod of modules) {
    for (const s of mod.structs) {
      structs.set(s.SourceName, s);
    }
    for (const e of mod.enums) {
      enums.set(e.SourceName, e);
    }
  }

  return { structs, enums };
}
