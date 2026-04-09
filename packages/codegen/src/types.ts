/**
 * Configuration for the UHT JSON extraction and TypeScript codegen pipeline.
 */
export interface CodegenConfig {
  // ── Stage 0: Extract (optional) ──────────────────────────────────

  /**
   * Whether to run UHT extraction to produce JSON files.
   * When `false`, `intermediateDir` must point to existing JSON output.
   * @default false
   */
  readonly extract?: boolean | undefined;

  /** Path to the Unreal Engine root directory (contains Engine/Binaries/...). */
  readonly engineDir?: string | undefined;

  /** Path to the .uproject file. */
  readonly projectFile?: string | undefined;

  /** Editor build target name (e.g. "ManaBreakPrototypeEditor"). */
  readonly target?: string | undefined;

  /** Target platform. @default "Win64" */
  readonly platform?: string | undefined;

  /** Build configuration. @default "Development" */
  readonly configuration?: string | undefined;

  // ── Stages 1–4: Discover / Parse / Filter / Resolve ──────────────

  /**
   * Path to the UHT intermediate output directory containing JSON files.
   * When `extract` is true this is derived from projectFile + platform.
   * When `extract` is false this must be provided explicitly.
   */
  readonly intermediateDir?: string | undefined;

  /** Glob pattern to filter which modules to process (e.g. "Mana*"). */
  readonly moduleFilter?: string | undefined;

  /**
   * Only emit functions whose FunctionFlags contain these strings.
   * @default ["BlueprintCallable"]
   */
  readonly functionFlags?: readonly string[] | undefined;

  /**
   * Also generate types for structs/enums referenced by matched functions.
   * @default true
   */
  readonly includeDependentTypes?: boolean | undefined;

  // ── Stage 5: Emit ────────────────────────────────────────────────

  /** Output directory for generated TypeScript files. */
  readonly outDir: string;

  /** What to generate. @default "effect-schema" */
  readonly format?: "types" | "effect-schema" | "both" | undefined;

  /** How to represent UObject references in generated code. @default "string" */
  readonly objectRefStyle?: "string" | "branded" | undefined;
}

/**
 * Resolved configuration with all defaults applied.
 * Exactly one of two modes:
 *   - extract mode: engineDir, projectFile, target are required
 *   - prebuilt mode: intermediateDir is required
 */
export interface ResolvedConfig {
  readonly extract: boolean;
  readonly engineDir: string;
  readonly projectFile: string;
  readonly target: string;
  readonly platform: string;
  readonly configuration: string;
  readonly intermediateDir: string;
  readonly moduleFilter: string | null;
  readonly functionFlags: readonly string[];
  readonly includeDependentTypes: boolean;
  readonly outDir: string;
  readonly format: "types" | "effect-schema" | "both";
  readonly objectRefStyle: "string" | "branded";
}

/** Result of the UHT extract stage. */
export interface ExtractResult {
  /** Directory containing the generated JSON files. */
  readonly intermediateDir: string;

  /** Paths to all generated .json files. */
  readonly jsonFiles: readonly string[];

  /** Whether UBT was rebuilt as part of this run. */
  readonly ubtRebuilt: boolean;

  /** UHT execution time in milliseconds. */
  readonly durationMs: number;
}

/** Derived paths computed from engine/project locations. */
export interface EnginePaths {
  readonly ubtDll: string;
  readonly buildUbtScript: string;
  readonly exporterSource: string;
  readonly projectDir: string;
  readonly intermediateDir: string;
}
