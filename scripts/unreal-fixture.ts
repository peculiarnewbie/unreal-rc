import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ResolveFixtureOptions = {
  requireReady?: boolean;
};

type ResolvedFixture = {
  fixtureDir: string;
  source: "env" | "default";
  exists: boolean;
  ready: boolean;
  uprojectPath: string | undefined;
  defaultFixtureDir: string;
  defaultFixtureRelativeDir: string;
  submoduleConfigured: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");
const DEFAULT_FIXTURE_DIR = join(ROOT_DIR, "fixtures", "unreal-project");
const DEFAULT_FIXTURE_RELATIVE_DIR = relative(ROOT_DIR, DEFAULT_FIXTURE_DIR);

const findUProject = (fixtureDir: string): string | undefined => {
  if (!existsSync(fixtureDir)) {
    return undefined;
  }

  for (const entry of readdirSync(fixtureDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".uproject")) {
      return join(fixtureDir, entry.name);
    }
  }

  return undefined;
};

const isDefaultFixtureSubmoduleConfigured = (): boolean => {
  const gitmodulesPath = join(ROOT_DIR, ".gitmodules");
  if (!existsSync(gitmodulesPath)) {
    return false;
  }

  const gitmodules = readFileSync(gitmodulesPath, "utf8");
  return gitmodules.includes(`path = ${DEFAULT_FIXTURE_RELATIVE_DIR}`);
};

export const resolveFixture = (options: ResolveFixtureOptions = {}): ResolvedFixture => {
  const envFixtureDir = process.env.UNREAL_FIXTURE_DIR?.trim();
  const fixtureDir = resolve(envFixtureDir || DEFAULT_FIXTURE_DIR);
  const source: ResolvedFixture["source"] = envFixtureDir ? "env" : "default";
  const exists = existsSync(fixtureDir);
  const uprojectPath = findUProject(fixtureDir);
  const ready = exists && uprojectPath !== undefined;

  if (options.requireReady && !ready) {
    const baseMessage = envFixtureDir
      ? `UNREAL_FIXTURE_DIR points to "${fixtureDir}", but no .uproject file was found there.`
      : `No Unreal fixture is ready at "${fixtureDir}".`;
    const followUp = envFixtureDir
      ? "Update UNREAL_FIXTURE_DIR to point at your Unreal fixture project root."
      : [
          "Run `bun run fixture:init` after configuring the fixture submodule,",
          "or set UNREAL_FIXTURE_DIR to an existing Unreal fixture project root."
        ].join(" ");

    throw new Error(`${baseMessage} ${followUp}`);
  }

  return {
    fixtureDir,
    source,
    exists,
    ready,
    uprojectPath,
    defaultFixtureDir: DEFAULT_FIXTURE_DIR,
    defaultFixtureRelativeDir: DEFAULT_FIXTURE_RELATIVE_DIR,
    submoduleConfigured: isDefaultFixtureSubmoduleConfigured()
  };
};

const printStatus = (): void => {
  const fixture = resolveFixture();

  console.log(`Fixture source: ${fixture.source === "env" ? "UNREAL_FIXTURE_DIR" : "default path"}`);
  console.log(`Fixture dir: ${fixture.fixtureDir}`);
  console.log(`Default dir: ${fixture.defaultFixtureRelativeDir}`);
  console.log(`Submodule configured: ${fixture.submoduleConfigured ? "yes" : "no"}`);
  console.log(`Directory exists: ${fixture.exists ? "yes" : "no"}`);
  console.log(`.uproject found: ${fixture.uprojectPath ?? "no"}`);

  if (!fixture.ready) {
    if (fixture.source === "env") {
      console.log(
        "Fixture is not ready. Point UNREAL_FIXTURE_DIR at a project root containing a .uproject file."
      );
      return;
    }

    console.log("Fixture is not ready. Configure the default submodule or set UNREAL_FIXTURE_DIR.");
  }
};

const initDefaultFixtureSubmodule = (): void => {
  const fixture = resolveFixture();

  if (fixture.source === "env") {
    console.log(
      "UNREAL_FIXTURE_DIR is set. Skipping submodule init because a custom fixture path is in use."
    );
    return;
  }

  if (!fixture.submoduleConfigured) {
    throw new Error(
      [
        `No submodule is configured at "${fixture.defaultFixtureRelativeDir}" yet.`,
        `Add it with: git submodule add <fixture-repo-url> ${fixture.defaultFixtureRelativeDir}`
      ].join(" ")
    );
  }

  execFileSync(
    "git",
    ["submodule", "update", "--init", "--recursive", "--", fixture.defaultFixtureRelativeDir],
    {
      cwd: ROOT_DIR,
      stdio: "inherit"
    }
  );
};

const command = process.argv[2] ?? "status";

if (process.argv[1] === __filename) {
  try {
    if (command === "init") {
      initDefaultFixtureSubmodule();
      printStatus();
    } else if (command === "status") {
      printStatus();
    } else {
      throw new Error(`Unknown command "${command}". Expected "status" or "init".`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
