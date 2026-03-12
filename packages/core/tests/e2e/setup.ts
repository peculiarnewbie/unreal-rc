import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { delimiter } from "node:path";
import { dirname, join, resolve } from "node:path";
import { Socket } from "node:net";
import { resolveFixture } from "../../../../scripts/unreal-fixture.js";
import { UnrealRC, type InfoResponse } from "../../src/client.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 30010;
const DEFAULT_WS_PORT = 30020;
const DEFAULT_BOOT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const LOG_LINE_LIMIT = 200;
const UNIX_EDITOR_NAMES = ["UnrealEditor", "UE4Editor"];
const WINDOWS_EDITOR_NAMES = ["UnrealEditor.exe", "UE4Editor.exe"];
const DEFAULT_FIXTURE_MAP_NAME = "RemoteControlE2E";
const DEFAULT_FIXTURE_MAP_PATH = `/Game/Maps/${DEFAULT_FIXTURE_MAP_NAME}`;
const DEFAULT_FIXTURE_ACTOR_NAME = "E2EFixtureActor";
const DEFAULT_FIXTURE_OBJECT_PATH =
  "/Game/Maps/RemoteControlE2E.RemoteControlE2E:PersistentLevel.E2EFixtureActor_C_1";
const DEFAULT_FIXTURE_PROPERTY_NAME = "Counter";
const DEFAULT_FIXTURE_FUNCTION_NAME = "AddToCounter";
const DEFAULT_FIXTURE_FUNCTION_ARGUMENT_NAME = "Delta";

export interface UnrealLaunchOptions {
  editorBin: string;
  editorArgs: string[];
  host: string;
  httpPort: number;
  wsPort: number;
  bootTimeoutMs: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
}

export interface LaunchFixtureHandle {
  readonly fixtureDir: string;
  readonly uprojectPath: string;
  readonly command: string;
  readonly args: string[];
  readonly child: ChildProcess;
  readonly logs: string[];
  stop(): Promise<void>;
}

export interface RemoteControlHttpStatus {
  endpointUrl: string;
  attempts: number;
  portReachable: boolean;
  info: InfoResponse;
}

export interface RemoteControlWsStatus {
  endpointUrl: string;
  attempts: number;
  portReachable: boolean;
}

export interface FixtureProtocolContract {
  mapPath: string;
  launchMapPath: string;
  worldName: string;
  actorName: string;
  objectPath: string;
  propertyName: string;
  baselineValue: number;
  httpWriteValue: number;
  httpCallDelta: number;
  wsWriteValue: number;
  wsCallDelta: number;
  functionName: string;
  functionArgumentName: string;
}

export interface ProtocolClients {
  http: UnrealRC;
  ws: UnrealRC;
  dispose(): void;
}

interface UnrealEditorInstall {
  editorBin: string;
  source: "env" | "engine_root" | "path" | "common";
  engineVersion?: string;
  engineAssociation?: string;
}

export const getBootTimeoutMs = (): number => {
  return readNumberEnv("UNREAL_E2E_BOOT_TIMEOUT_MS", DEFAULT_BOOT_TIMEOUT_MS);
};

export const resolveLaunchOptions = (): UnrealLaunchOptions => {
  const fixture = resolveFixture({ requireReady: true });
  const install = discoverUnrealEditor(fixture.uprojectPath);

  return {
    editorBin: install.editorBin,
    editorArgs: readArgsEnv("UNREAL_EDITOR_ARGS_JSON"),
    host: process.env.UNREAL_E2E_HOST?.trim() || DEFAULT_HOST,
    httpPort: readNumberEnv("UNREAL_E2E_HTTP_PORT", DEFAULT_HTTP_PORT),
    wsPort: readNumberEnv("UNREAL_E2E_WS_PORT", DEFAULT_WS_PORT),
    bootTimeoutMs: getBootTimeoutMs(),
    pollIntervalMs: readNumberEnv("UNREAL_E2E_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS),
    requestTimeoutMs: readNumberEnv("UNREAL_E2E_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS)
  };
};

export const resolveFixtureContract = (): FixtureProtocolContract => {
  const mapPath = readStringEnv("UNREAL_E2E_MAP_PATH", DEFAULT_FIXTURE_MAP_PATH);
  const worldName = readStringEnv("UNREAL_E2E_WORLD_NAME", DEFAULT_FIXTURE_MAP_NAME);
  const actorName = readStringEnv("UNREAL_E2E_ACTOR_NAME", DEFAULT_FIXTURE_ACTOR_NAME);

  return {
    mapPath,
    launchMapPath: readStringEnv("UNREAL_E2E_LAUNCH_MAP_PATH", mapPath),
    worldName,
    actorName,
    objectPath: readStringEnv("UNREAL_E2E_OBJECT_PATH", DEFAULT_FIXTURE_OBJECT_PATH),
    propertyName: readStringEnv("UNREAL_E2E_PROPERTY_NAME", DEFAULT_FIXTURE_PROPERTY_NAME),
    baselineValue: readIntegerEnv("UNREAL_E2E_BASELINE_VALUE", 0),
    httpWriteValue: readIntegerEnv("UNREAL_E2E_HTTP_WRITE_VALUE", 10),
    httpCallDelta: readIntegerEnv("UNREAL_E2E_HTTP_CALL_DELTA", 5),
    wsWriteValue: readIntegerEnv("UNREAL_E2E_WS_WRITE_VALUE", 20),
    wsCallDelta: readIntegerEnv("UNREAL_E2E_WS_CALL_DELTA", 7),
    functionName: readStringEnv("UNREAL_E2E_FUNCTION_NAME", DEFAULT_FIXTURE_FUNCTION_NAME),
    functionArgumentName: readStringEnv(
      "UNREAL_E2E_FUNCTION_ARGUMENT_NAME",
      DEFAULT_FIXTURE_FUNCTION_ARGUMENT_NAME
    )
  };
};

export const createProtocolClients = (
  options: UnrealLaunchOptions = resolveLaunchOptions()
): ProtocolClients => {
  const http = new UnrealRC({
    transport: "http",
    host: options.host,
    port: options.httpPort,
    retry: false
  });
  const ws = new UnrealRC({
    transport: "ws",
    host: options.host,
    port: options.wsPort,
    retry: false
  });

  return {
    http,
    ws,
    dispose(): void {
      http.dispose();
      ws.dispose();
    }
  };
};

export const launchFixtureProject = (): LaunchFixtureHandle => {
  const fixture = resolveFixture({ requireReady: true });
  const launchOptions = resolveLaunchOptions();
  const contract = resolveFixtureContract();

  if (!fixture.uprojectPath) {
    throw new Error(`No .uproject file was found in "${fixture.fixtureDir}".`);
  }

  const logs: string[] = [];
  const launchArgs = [fixture.uprojectPath, contract.launchMapPath, ...launchOptions.editorArgs];
  const child = spawn(launchOptions.editorBin, launchArgs, {
    cwd: fixture.fixtureDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    pushLogLines(logs, chunk.toString());
  });
  child.stderr?.on("data", (chunk: string | Buffer) => {
    pushLogLines(logs, chunk.toString());
  });

  return {
    fixtureDir: fixture.fixtureDir,
    uprojectPath: fixture.uprojectPath,
    command: launchOptions.editorBin,
    args: launchArgs,
    child,
    logs,
    async stop(): Promise<void> {
      await stopChildProcess(child);
    }
  };
};

export const waitForRemoteControlHttp = async (
  handle: LaunchFixtureHandle,
  options: UnrealLaunchOptions = resolveLaunchOptions()
): Promise<RemoteControlHttpStatus> => {
  const client = new UnrealRC({
    transport: "http",
    host: options.host,
    port: options.httpPort,
    retry: false
  });

  return await waitForRemoteControl(handle, {
    client,
    endpointUrl: `http://${options.host}:${options.httpPort}/remote/info`,
    host: options.host,
    port: options.httpPort,
    bootTimeoutMs: options.bootTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    requestTimeoutMs: options.requestTimeoutMs,
    transportLabel: "HTTP"
  });
};

export const waitForRemoteControlWs = async (
  handle: LaunchFixtureHandle,
  options: UnrealLaunchOptions = resolveLaunchOptions()
): Promise<RemoteControlWsStatus> => {
  return await waitForWebSocketEndpoint(handle, {
    endpointUrl: `ws://${options.host}:${options.wsPort}`,
    host: options.host,
    port: options.wsPort,
    bootTimeoutMs: options.bootTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    requestTimeoutMs: options.requestTimeoutMs
  });
};

const stopChildProcess = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const exitedAfterTerm = await waitForExit(child, PROCESS_STOP_TIMEOUT_MS);
  if (exitedAfterTerm) {
    return;
  }

  child.kill("SIGKILL");
  await waitForExit(child, PROCESS_STOP_TIMEOUT_MS);
};

const waitForExit = async (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };

    const onExit = (): void => {
      cleanup();
      resolve(true);
    };

    child.once("exit", onExit);
  });
};

const canConnectToTcpPort = async (host: string, port: number): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const socket = new Socket();

    const finish = (result: boolean): void => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(DEFAULT_REQUEST_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
};

const pushLogLines = (logs: string[], rawChunk: string): void => {
  const normalizedChunk = rawChunk.replace(/\r\n/g, "\n");
  for (const line of normalizedChunk.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) {
      continue;
    }
    logs.push(trimmed);
  }

  if (logs.length > LOG_LINE_LIMIT) {
    logs.splice(0, logs.length - LOG_LINE_LIMIT);
  }
};

const readArgsEnv = (name: string): string[] => {
  const value = process.env[name]?.trim();
  if (!value) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${name} must be a JSON array of strings. Received: ${value}. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be a JSON array of strings.`);
  }

  return [...parsed];
};

const readStringEnv = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : fallback;
};

const readIntegerEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer. Received: ${raw}`);
  }

  return parsed;
};

const readNumberEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }

  return parsed;
};

const formatLaunchContext = (handle: LaunchFixtureHandle): string => {
  const recentLogs = handle.logs.length > 0 ? handle.logs.join("\n") : "(no stdout/stderr captured)";

  return [
    `Launch command: ${handle.command}`,
    `Launch args: ${handle.args.join(" ")}`,
    `Fixture project: ${handle.uprojectPath}`,
    "Recent Unreal output:",
    recentLogs
  ].join("\n");
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const canOpenWebSocket = async (endpointUrl: string, timeoutMs: number): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const socket = new WebSocket(endpointUrl);
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onCloseOrError);
      socket.removeEventListener("error", onCloseOrError);

      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        socket.close(1000, "Probe complete");
      }

      resolve(result);
    };

    const onOpen = (): void => finish(true);
    const onCloseOrError = (): void => finish(false);

    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    socket.addEventListener("open", onOpen, { once: true });
    socket.addEventListener("close", onCloseOrError, { once: true });
    socket.addEventListener("error", onCloseOrError, { once: true });
  });
};

const waitForRemoteControl = async (
  handle: LaunchFixtureHandle,
  options: {
    client: UnrealRC;
    endpointUrl: string;
    host: string;
    port: number;
    bootTimeoutMs: number;
    pollIntervalMs: number;
    requestTimeoutMs: number;
    transportLabel: string;
  }
): Promise<RemoteControlHttpStatus> => {
  const deadline = Date.now() + options.bootTimeoutMs;
  let attempts = 0;
  let lastError: unknown;
  let portReachable = false;

  try {
    while (Date.now() <= deadline) {
      attempts += 1;
      portReachable = portReachable || (await canConnectToTcpPort(options.host, options.port));

      if (handle.child.exitCode !== null) {
        throw new Error(
          [
            `Unreal exited before Remote Control became available (exit code ${handle.child.exitCode}).`,
            formatLaunchContext(handle)
          ].join("\n")
        );
      }

      if (handle.child.signalCode !== null) {
        throw new Error(
          [
            `Unreal exited before Remote Control became available (signal ${handle.child.signalCode}).`,
            formatLaunchContext(handle)
          ].join("\n")
        );
      }

      try {
        const info = await options.client.info({
          timeoutMs: options.requestTimeoutMs,
          retry: false
        });
        return {
          endpointUrl: options.endpointUrl,
          attempts,
          portReachable: true,
          info
        };
      } catch (error) {
        lastError = error;
      }

      await sleep(options.pollIntervalMs);
    }
  } finally {
    options.client.dispose();
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    [
      `Timed out waiting ${options.bootTimeoutMs}ms for Unreal Remote Control ${options.transportLabel} at ${options.endpointUrl}.`,
      `Last probe error: ${detail}`,
      `TCP port reachable during boot: ${portReachable ? "yes" : "no"}`,
      formatLaunchContext(handle)
    ].join("\n")
  );
};

const waitForWebSocketEndpoint = async (
  handle: LaunchFixtureHandle,
  options: {
    endpointUrl: string;
    host: string;
    port: number;
    bootTimeoutMs: number;
    pollIntervalMs: number;
    requestTimeoutMs: number;
  }
): Promise<RemoteControlWsStatus> => {
  const deadline = Date.now() + options.bootTimeoutMs;
  let attempts = 0;
  let portReachable = false;

  while (Date.now() <= deadline) {
    attempts += 1;
    portReachable = portReachable || (await canConnectToTcpPort(options.host, options.port));

    if (handle.child.exitCode !== null) {
      throw new Error(
        [
          `Unreal exited before Remote Control WebSocket became available (exit code ${handle.child.exitCode}).`,
          formatLaunchContext(handle)
        ].join("\n")
      );
    }

    if (handle.child.signalCode !== null) {
      throw new Error(
        [
          `Unreal exited before Remote Control WebSocket became available (signal ${handle.child.signalCode}).`,
          formatLaunchContext(handle)
        ].join("\n")
      );
    }

    if (await canOpenWebSocket(options.endpointUrl, options.requestTimeoutMs)) {
      return {
        endpointUrl: options.endpointUrl,
        attempts,
        portReachable: true
      };
    }

    await sleep(options.pollIntervalMs);
  }

  throw new Error(
    [
      `Timed out waiting ${options.bootTimeoutMs}ms for Unreal Remote Control WebSocket at ${options.endpointUrl}.`,
      `TCP port reachable during boot: ${portReachable ? "yes" : "no"}`,
      formatLaunchContext(handle)
    ].join("\n")
  );
};

const discoverUnrealEditor = (uprojectPath: string | undefined): UnrealEditorInstall => {
  const requestedBin = process.env.UNREAL_EDITOR_BIN?.trim();
  const engineAssociation = readEngineAssociation(uprojectPath);

  if (requestedBin) {
    if (!existsSync(requestedBin)) {
      throw new Error(`UNREAL_EDITOR_BIN points to "${requestedBin}", but that file does not exist.`);
    }

    return {
      editorBin: requestedBin,
      source: "env",
      ...(engineAssociation !== undefined ? { engineAssociation } : {})
    };
  }

  const candidates = [
    ...discoverFromEngineRoot(engineAssociation),
    ...discoverFromPath(engineAssociation),
    ...discoverFromCommonLocations(engineAssociation)
  ];

  const uniqueCandidates = dedupeInstalls(candidates);
  if (uniqueCandidates.length === 0) {
    throw new Error(buildEditorNotFoundMessage(engineAssociation));
  }

  const exactMatch = engineAssociation ? uniqueCandidates.find((candidate) => isCompatible(candidate, engineAssociation)) : undefined;
  return exactMatch ?? uniqueCandidates[0];
};

const dedupeInstalls = (installs: UnrealEditorInstall[]): UnrealEditorInstall[] => {
  const seen = new Set<string>();
  const result: UnrealEditorInstall[] = [];

  for (const install of installs) {
    const key = resolve(install.editorBin);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(install);
  }

  return result;
};

const discoverFromEngineRoot = (engineAssociation: string | undefined): UnrealEditorInstall[] => {
  const engineRoot = process.env.UNREAL_ENGINE_ROOT?.trim();
  if (!engineRoot) {
    return [];
  }

  const editorBin = resolveEditorFromRoot(engineRoot);
  if (!editorBin) {
    throw new Error(
      `UNREAL_ENGINE_ROOT points to "${engineRoot}", but no Unreal editor binary was found under that root.`
    );
  }

  return [
    {
      editorBin,
      source: "engine_root",
      engineVersion: readEngineVersionFromEditor(editorBin),
      ...(engineAssociation !== undefined ? { engineAssociation } : {})
    }
  ];
};

const discoverFromPath = (engineAssociation: string | undefined): UnrealEditorInstall[] => {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const editorNames = getEditorBinaryNames();
  const installs: UnrealEditorInstall[] = [];

  for (const entry of pathEntries) {
    for (const editorName of editorNames) {
      const editorBin = join(entry, editorName);
      if (!existsSync(editorBin)) {
        continue;
      }

      installs.push({
        editorBin,
        source: "path",
        engineVersion: readEngineVersionFromEditor(editorBin),
        ...(engineAssociation !== undefined ? { engineAssociation } : {})
      });
    }
  }

  return installs;
};

const discoverFromCommonLocations = (engineAssociation: string | undefined): UnrealEditorInstall[] => {
  const installs: UnrealEditorInstall[] = [];

  for (const root of getCommonEngineRoots()) {
    const editorBin = resolveEditorFromRoot(root);
    if (!editorBin) {
      continue;
    }

    installs.push({
      editorBin,
      source: "common",
      engineVersion: readEngineVersionFromEditor(editorBin),
      ...(engineAssociation !== undefined ? { engineAssociation } : {})
    });
  }

  return installs;
};

const getCommonEngineRoots = (): string[] => {
  if (process.platform === "win32") {
    const roots = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"]
    ]
      .filter((entry): entry is string => Boolean(entry))
      .map((entry) => join(entry, "Epic Games"));

    return collectEpicVersionedRoots(roots);
  }

  if (process.platform === "darwin") {
    return collectEpicVersionedRoots([
      "/Users/Shared/Epic Games",
      "/Applications/Epic Games"
    ]);
  }

  const home = process.env.HOME;
  const roots = [
    home ? join(home, "Epic", "UE") : undefined,
    home ? join(home, "EpicGames") : undefined,
    home ? join(home, "UnrealEngine") : undefined,
    "/opt/EpicGames",
    "/opt/unreal-engine",
    "/opt/UnrealEngine",
    "/usr/local/share/UnrealEngine"
  ].filter((entry): entry is string => Boolean(entry));

  return [...collectEpicVersionedRoots(roots), ...roots];
};

const collectEpicVersionedRoots = (parents: string[]): string[] => {
  const roots: string[] = [];

  for (const parent of parents) {
    if (!existsSync(parent)) {
      continue;
    }

    roots.push(parent);

    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.startsWith("UE_") || entry.name.startsWith("UnrealEngine")) {
        roots.push(join(parent, entry.name));
      }
    }
  }

  return roots;
};

const resolveEditorFromRoot = (root: string): string | undefined => {
  const candidateSuffixes =
    process.platform === "win32"
      ? [
          join("Engine", "Binaries", "Win64", "UnrealEditor.exe"),
          join("Engine", "Binaries", "Win64", "UE4Editor.exe")
        ]
      : process.platform === "darwin"
        ? [
            join("Engine", "Binaries", "Mac", "UnrealEditor.app", "Contents", "MacOS", "UnrealEditor"),
            join("Engine", "Binaries", "Mac", "UE4Editor.app", "Contents", "MacOS", "UE4Editor"),
            join("Engine", "Binaries", "Mac", "UnrealEditor"),
            join("Engine", "Binaries", "Mac", "UE4Editor")
          ]
        : [
            join("Engine", "Binaries", "Linux", "UnrealEditor"),
            join("Engine", "Binaries", "Linux", "UE4Editor")
          ];

  for (const suffix of candidateSuffixes) {
    const editorBin = join(root, suffix);
    if (existsSync(editorBin)) {
      return editorBin;
    }
  }

  return undefined;
};

const getEditorBinaryNames = (): string[] => {
  return process.platform === "win32" ? WINDOWS_EDITOR_NAMES : UNIX_EDITOR_NAMES;
};

const readEngineAssociation = (uprojectPath: string | undefined): string | undefined => {
  if (!uprojectPath || !existsSync(uprojectPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(uprojectPath, "utf8");
    const parsed = JSON.parse(raw) as { EngineAssociation?: unknown };
    return typeof parsed.EngineAssociation === "string" && parsed.EngineAssociation.trim().length > 0
      ? parsed.EngineAssociation.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

const readEngineVersionFromEditor = (editorBin: string): string | undefined => {
  const versionFile = join(resolveEngineRootFromEditor(editorBin), "Engine", "Build", "Build.version");
  if (!existsSync(versionFile)) {
    return undefined;
  }

  try {
    const raw = readFileSync(versionFile, "utf8");
    const parsed = JSON.parse(raw) as {
      MajorVersion?: unknown;
      MinorVersion?: unknown;
      PatchVersion?: unknown;
    };
    const major = typeof parsed.MajorVersion === "number" ? parsed.MajorVersion : undefined;
    const minor = typeof parsed.MinorVersion === "number" ? parsed.MinorVersion : undefined;
    const patch = typeof parsed.PatchVersion === "number" ? parsed.PatchVersion : undefined;
    if (major === undefined || minor === undefined) {
      return undefined;
    }

    return patch === undefined ? `${major}.${minor}` : `${major}.${minor}.${patch}`;
  } catch {
    return undefined;
  }
};

const resolveEngineRootFromEditor = (editorBin: string): string => {
  return resolve(dirname(editorBin), "..", "..", "..");
};

const isCompatible = (install: UnrealEditorInstall, engineAssociation: string): boolean => {
  const normalizedAssociation = normalizeVersion(engineAssociation);
  if (!normalizedAssociation) {
    return false;
  }

  const normalizedVersion = normalizeVersion(install.engineVersion);
  if (normalizedVersion && normalizedVersion.startsWith(normalizedAssociation)) {
    return true;
  }

  return normalizePath(install.editorBin).includes(`ue_${normalizedAssociation}`);
};

const normalizeVersion = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const match = value.match(/\d+(?:\.\d+){0,2}/);
  return match?.[0];
};

const normalizePath = (value: string): string => {
  return value.replace(/\\/g, "/").toLowerCase();
};

const buildEditorNotFoundMessage = (engineAssociation: string | undefined): string => {
  const expected = engineAssociation
    ? `No compatible Unreal editor install was discovered for EngineAssociation "${engineAssociation}".`
    : "No Unreal editor install was discovered automatically.";

  return [
    expected,
    "Set UNREAL_EDITOR_BIN to the editor executable, or set UNREAL_ENGINE_ROOT to an engine root.",
    "Supported auto-discovery sources: UNREAL_ENGINE_ROOT, PATH, and common Epic/Unreal install directories."
  ].join(" ");
};
