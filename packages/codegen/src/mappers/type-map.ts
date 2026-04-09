/**
 * Maps UHT EngineClassName values to TypeScript type strings.
 */

const ENGINE_CLASS_TO_TS: Record<string, string> = {
  // Numeric
  FloatProperty: "number",
  DoubleProperty: "number",
  IntProperty: "number",
  UInt32Property: "number",
  Int8Property: "number",
  ByteProperty: "number",

  // Boolean
  BoolProperty: "boolean",

  // String-like
  StrProperty: "string",
  NameProperty: "string",
  TextProperty: "string",

  // Object references (represented as object path strings for Remote Control)
  ObjectProperty: "string",
  ClassProperty: "string",
  SoftObjectProperty: "string",
  SoftClassProperty: "string",
  WeakObjectProperty: "string",

  // Containers (element types resolved separately)
  ArrayProperty: "unknown[]",
  MapProperty: "Record<string, unknown>",
  SetProperty: "unknown[]",

  // Special
  OptionalProperty: "unknown | undefined",

  // Delegates (not callable via Remote Control — skip in codegen)
  DelegateProperty: "unknown",
  MulticastInlineDelegateProperty: "unknown",
};

/**
 * Map an EngineClassName to a TypeScript type string.
 * Returns `"unknown"` for unrecognized types.
 */
export function engineClassToTs(engineClassName: string): string {
  return ENGINE_CLASS_TO_TS[engineClassName] ?? "unknown";
}

/**
 * Returns true if the EngineClassName represents a container type
 * whose inner/element type needs separate resolution.
 */
export function isContainerType(engineClassName: string): boolean {
  return (
    engineClassName === "ArrayProperty" ||
    engineClassName === "MapProperty" ||
    engineClassName === "SetProperty"
  );
}

/**
 * Returns true if the EngineClassName represents a type that requires
 * cross-module resolution (struct or enum).
 */
export function needsResolution(engineClassName: string): boolean {
  return (
    engineClassName === "StructProperty" ||
    engineClassName === "EnumProperty"
  );
}
