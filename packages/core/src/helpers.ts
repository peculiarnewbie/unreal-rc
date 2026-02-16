const ensureNonEmpty = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} cannot be empty`);
  }
  return normalized;
};

const stripSurroundingSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

export const objectPath = (mapPath: string, worldName: string, objectName: string): string => {
  const normalizedMapPath = ensureNonEmpty(mapPath, "mapPath");
  const normalizedWorldName = ensureNonEmpty(worldName, "worldName");
  const normalizedObjectName = ensureNonEmpty(objectName, "objectName");

  const packagePath = normalizedMapPath.startsWith("/")
    ? normalizedMapPath
    : `/${normalizedMapPath}`;

  return `${packagePath}.${normalizedWorldName}:${normalizedObjectName}`;
};

export const piePath = (mapName: string, instanceId = 0): string => {
  const normalizedMapName = ensureNonEmpty(mapName, "mapName");
  const leaf = stripSurroundingSlashes(normalizedMapName).split("/").pop() ?? normalizedMapName;
  const cleanMapName = leaf.includes(".") ? leaf.slice(leaf.lastIndexOf(".") + 1) : leaf;
  return `UEDPIE_${instanceId}_${cleanMapName}`;
};

export const blueprintLibraryPath = (moduleName: string, className: string): string => {
  const normalizedModuleName = ensureNonEmpty(moduleName, "moduleName");
  const normalizedClassName = ensureNonEmpty(className, "className");
  return `/Script/${normalizedModuleName}.Default__${normalizedClassName}`;
};

export const vector = (x: number, y: number, z: number): { X: number; Y: number; Z: number } => ({
  X: x,
  Y: y,
  Z: z
});

export const rotator = (
  pitch: number,
  yaw: number,
  roll: number
): { Pitch: number; Yaw: number; Roll: number } => ({
  Pitch: pitch,
  Yaw: yaw,
  Roll: roll
});

export const linearColor = (
  r: number,
  g: number,
  b: number,
  a = 1
): { R: number; G: number; B: number; A: number } => ({
  R: r,
  G: g,
  B: b,
  A: a
});

export const transform = (
  location: { X: number; Y: number; Z: number },
  rotation: { Pitch: number; Yaw: number; Roll: number },
  scale3D = vector(1, 1, 1)
): {
  Translation: { X: number; Y: number; Z: number };
  Rotation: { Pitch: number; Yaw: number; Roll: number };
  Scale3D: { X: number; Y: number; Z: number };
} => ({
  Translation: location,
  Rotation: rotation,
  Scale3D: scale3D
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const parseReturnValue = <T = unknown>(value: unknown, key?: string): T | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (key) {
    return value[key] as T | undefined;
  }

  return value.ReturnValue as T | undefined;
};
