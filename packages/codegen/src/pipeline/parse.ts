/**
 * Stage 2: Parse UHT JSON files into typed structures.
 */
import { readFileSync } from "node:fs";
import type { DiscoveredModule } from "./discover.js";

// ── UHT JSON shape ─────────────────────────────────────────────────

export interface UhtModule {
  readonly ShortName: string;
  readonly Packages: readonly UhtPackage[];
}

export interface UhtPackage {
  readonly SourceName: string;
  readonly Children: readonly UhtType[];
}

export type UhtType = UhtClass | UhtStruct | UhtEnum | UhtFunction | UhtProperty;

export interface UhtClass {
  readonly Kind: "Class";
  readonly SourceName: string;
  readonly EngineName: string;
  readonly EngineClassName: string;
  readonly ClassFlags: string;
  readonly ClassType: string;
  readonly Super?: string | undefined;
  readonly MetaData?: Readonly<Record<string, string>> | undefined;
  readonly Functions: readonly UhtFunction[];
  readonly Properties: readonly UhtProperty[];
}

export interface UhtStruct {
  readonly Kind: "Struct";
  readonly SourceName: string;
  readonly EngineName: string;
  readonly EngineClassName: string;
  readonly Super?: string | undefined;
  readonly MetaData?: Readonly<Record<string, string>> | undefined;
  readonly Properties: readonly UhtProperty[];
}

export interface UhtEnum {
  readonly Kind: "Enum";
  readonly SourceName: string;
  readonly EngineName: string;
  readonly CppForm: string;
  readonly UnderlyingType: string;
  readonly MetaData?: Readonly<Record<string, string>> | undefined;
  readonly Values: readonly UhtEnumValue[];
}

export interface UhtEnumValue {
  readonly Name: string;
  readonly Value: number;
}

export interface UhtFunction {
  readonly Kind: "Function";
  readonly SourceName: string;
  readonly EngineName: string;
  readonly FunctionFlags: string;
  readonly FunctionExportFlags: string;
  readonly FunctionType: string;
  readonly MetaData?: Readonly<Record<string, string>> | undefined;
  readonly Parameters: readonly UhtProperty[];
}

export interface UhtProperty {
  readonly Kind: "Property";
  readonly SourceName: string;
  readonly EngineName: string;
  readonly EngineClassName: string;
  readonly PropertyCategory: string;
  readonly PropertyFlags: string;
  readonly PropertyExportFlags: string;
  readonly MetaData?: Readonly<Record<string, string>> | undefined;
  readonly Inner?: readonly UhtProperty[] | undefined;
}

// ── Parser ─────────────────────────────────────────────────────────

export interface ParsedModule {
  readonly name: string;
  readonly module: UhtModule;
}

export function parse(discovered: readonly DiscoveredModule[]): readonly ParsedModule[] {
  return discovered.map((d) => {
    const raw = readFileSync(d.jsonPath, "utf-8");
    const module = JSON.parse(raw) as UhtModule;
    return { name: d.name, module };
  });
}
