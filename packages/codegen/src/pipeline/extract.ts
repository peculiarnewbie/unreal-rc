/**
 * Stage 0: Extract UHT JSON reflection data from an Unreal Engine project.
 *
 * Invokes UnrealBuildTool in UHT mode with the `-Json` exporter flag.
 * Optionally patches the engine's JSON exporter if it hasn't been patched yet.
 */
import { existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { globSync } from "node:fs";
import type { ExtractResult, EnginePaths, ResolvedConfig } from "../types.js";

// ── Path derivation ────────────────────────────────────────────────

export function deriveEnginePaths(
  engineDir: string,
  projectFile: string,
  platform: string,
): EnginePaths {
  const projectDir = dirname(resolve(projectFile));
  return {
    ubtDll: join(engineDir, "Engine", "Binaries", "DotNET", "UnrealBuildTool", "UnrealBuildTool.dll"),
    buildUbtScript: join(engineDir, "Engine", "Build", "BatchFiles", "BuildUBT.bat"),
    exporterSource: join(
      engineDir,
      "Engine", "Source", "Programs", "Shared",
      "EpicGames.UHT", "Exporters", "Json", "UhtJsonExporter.cs",
    ),
    projectDir,
    intermediateDir: join(projectDir, "Intermediate", "Build", platform, "UnrealEditor", "Inc"),
  };
}

// ── Validation ─────────────────────────────────────────────────────

export function validateExtractPreconditions(paths: EnginePaths): void {
  if (!existsSync(paths.ubtDll)) {
    throw new Error(
      `UnrealBuildTool not found at: ${paths.ubtDll}\n` +
      `Ensure engineDir points to a built Unreal Engine source tree.`,
    );
  }

  try {
    execSync("dotnet --version", { stdio: "pipe", encoding: "utf-8" });
  } catch {
    throw new Error(
      "dotnet CLI not found on PATH. " +
      "Install the .NET SDK (https://dotnet.microsoft.com/download).",
    );
  }
}

// ── Patch management ───────────────────────────────────────────────

const PATCH_FILE = resolve(
  import.meta.dirname ?? dirname(new URL(import.meta.url).pathname),
  "..", "..", "patches", "UhtJsonExporter.cs",
);

/**
 * Returns true if the engine's exporter matches our patched version.
 * If the engine file is read-only (Perforce), it is made writable before patching.
 */
export function ensureExporterPatched(paths: EnginePaths): boolean {
  if (!existsSync(PATCH_FILE)) {
    throw new Error(`Patch file not found at: ${PATCH_FILE}`);
  }

  const patchContent = readFileSync(PATCH_FILE, "utf-8");
  let engineContent = "";

  if (existsSync(paths.exporterSource)) {
    engineContent = readFileSync(paths.exporterSource, "utf-8");
  }

  if (normalizeLineEndings(engineContent) === normalizeLineEndings(patchContent)) {
    return false; // already patched
  }

  // Make writable (Perforce keeps files read-only)
  try {
    execSync(`chmod +w "${paths.exporterSource}"`, { stdio: "pipe" });
  } catch {
    // chmod may fail on Windows without git-bash; try icacls as fallback
    try {
      execSync(`icacls "${paths.exporterSource}" /grant Everyone:M`, { stdio: "pipe" });
    } catch {
      // Ignore — the write below will fail with a clear error if still read-only
    }
  }

  copyFileSync(PATCH_FILE, paths.exporterSource);
  return true;
}

function normalizeLineEndings(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

// ── UBT rebuild ────────────────────────────────────────────────────

export function rebuildUbt(paths: EnginePaths): void {
  const opts: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    stdio: "pipe",
    cwd: dirname(paths.buildUbtScript),
  };

  // BuildUBT.bat is a Windows batch file; invoke via PowerShell for reliability
  const result = execSync(
    `powershell.exe -Command "& '${paths.buildUbtScript}' 2>&1"`,
    { ...opts, timeout: 120_000 },
  );

  if (result.includes("Build FAILED") || result.includes("Error(s)")) {
    throw new Error(`UBT rebuild failed:\n${result}`);
  }
}

// ── UHT invocation ─────────────────────────────────────────────────

export function invokeUht(
  config: ResolvedConfig,
  paths: EnginePaths,
): string {
  const targetArg = [
    config.target,
    config.platform,
    config.configuration,
    `-Project=${config.projectFile}`,
  ].join(" ");

  const cmd = [
    "dotnet",
    `"${paths.ubtDll}"`,
    "-Mode=UnrealHeaderTool",
    `"-Target=${targetArg}"`,
    "-Json",
    "-NoDefaultExporters",
  ].join(" ");

  const result = execSync(
    `powershell.exe -Command "& ${cmd} 2>&1"`,
    { encoding: "utf-8", timeout: 600_000 },
  );

  if (result.includes("Result: Failed")) {
    throw new Error(`UHT extraction failed:\n${result}`);
  }

  return result;
}

// ── Orchestrator ───────────────────────────────────────────────────

export function extract(config: ResolvedConfig): ExtractResult {
  const paths = deriveEnginePaths(config.engineDir, config.projectFile, config.platform);

  // 1. Validate prerequisites
  validateExtractPreconditions(paths);

  // 2. Ensure our JSON exporter is in place
  const wasPatched = ensureExporterPatched(paths);

  // 3. Rebuild UBT if the exporter was just patched
  let ubtRebuilt = false;
  if (wasPatched) {
    console.log("[codegen] Patched UHT JSON exporter — rebuilding UBT...");
    rebuildUbt(paths);
    ubtRebuilt = true;
  }

  // 4. Run UHT
  console.log("[codegen] Running UHT with -Json exporter...");
  const start = performance.now();
  const output = invokeUht(config, paths);
  const durationMs = Math.round(performance.now() - start);

  // Extract file count from UHT output (e.g. "692 files written")
  const filesMatch = output.match(/(\d+) files? written/);
  const fileCount = filesMatch ? parseInt(filesMatch[1]!, 10) : 0;
  console.log(`[codegen] UHT completed in ${durationMs}ms (${fileCount} files written)`);

  // 5. Collect generated JSON file paths
  const jsonFiles = findJsonFiles(paths.intermediateDir);

  return {
    intermediateDir: paths.intermediateDir,
    jsonFiles,
    ubtRebuilt,
    durationMs,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function findJsonFiles(intermediateDir: string): readonly string[] {
  if (!existsSync(intermediateDir)) {
    return [];
  }

  // Walk the directory for **/UHT/*.json
  const results: string[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".json") && dir.endsWith("UHT")) {
        results.push(full);
      }
    }
  };
  walk(intermediateDir);
  return results;
}
