import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFixture } from "./unreal-fixture.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const E2E_TESTS_DIR = join(ROOT_DIR, "packages", "core", "tests", "e2e");

const collectTestFiles = (directory: string): string[] => {
  if (!existsSync(directory)) {
    return [];
  }

  const testFiles: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      testFiles.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && extname(entry.name) === ".ts" && entry.name.endsWith(".test.ts")) {
      testFiles.push(fullPath);
    }
  }

  return testFiles.sort();
};

try {
  const fixture = resolveFixture({ requireReady: true });
  const testFiles = collectTestFiles(E2E_TESTS_DIR);

  if (testFiles.length === 0) {
    console.log(`Fixture ready at ${fixture.fixtureDir}`);
    console.log("No Unreal-backed tests are wired yet under packages/core/tests/e2e.");
    process.exit(0);
  }

  const result = spawnSync("bun", ["test", ...testFiles], {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      UNREAL_E2E: "1",
      UNREAL_FIXTURE_DIR: fixture.fixtureDir
    }
  });

  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
