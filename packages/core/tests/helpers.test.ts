import { describe, expect, test } from "bun:test";
import {
  blueprintLibraryPath,
  linearColor,
  objectPath,
  parseReturnValue,
  piePath,
  rotator,
  transform,
  vector
} from "../src/helpers.js";

describe("helpers", () => {
  test("builds normalized object paths", () => {
    expect(objectPath("Game/Maps/Main", "Main", "MyActor")).toBe("/Game/Maps/Main.Main:MyActor");
    expect(objectPath(" /Game/Maps/Main ", " Main ", " MyActor ")).toBe(
      "/Game/Maps/Main.Main:MyActor"
    );
  });

  test("rejects empty object path segments", () => {
    expect(() => objectPath("", "Main", "Actor")).toThrow("mapPath cannot be empty");
    expect(() => objectPath("/Game/Maps/Main", "", "Actor")).toThrow("worldName cannot be empty");
    expect(() => objectPath("/Game/Maps/Main", "Main", "")).toThrow("objectName cannot be empty");
  });

  test("builds PIE map names", () => {
    expect(piePath("/Game/Maps/Main.Main")).toBe("UEDPIE_0_Main");
    expect(piePath("Main", 2)).toBe("UEDPIE_2_Main");
  });

  test("builds blueprint library paths", () => {
    expect(blueprintLibraryPath("Gameplay", "MyLibrary")).toBe(
      "/Script/Gameplay.Default__MyLibrary"
    );
  });

  test("creates UE value helper objects", () => {
    expect(vector(1, 2, 3)).toEqual({ X: 1, Y: 2, Z: 3 });
    expect(rotator(10, 20, 30)).toEqual({ Pitch: 10, Yaw: 20, Roll: 30 });
    expect(linearColor(1, 0.5, 0.25)).toEqual({ R: 1, G: 0.5, B: 0.25, A: 1 });
    expect(linearColor(1, 0.5, 0.25, 0.75)).toEqual({ R: 1, G: 0.5, B: 0.25, A: 0.75 });
  });

  test("creates transforms with default scale", () => {
    expect(transform(vector(1, 2, 3), rotator(10, 20, 30))).toEqual({
      Translation: { X: 1, Y: 2, Z: 3 },
      Rotation: { Pitch: 10, Yaw: 20, Roll: 30 },
      Scale3D: { X: 1, Y: 1, Z: 1 }
    });
  });

  test("parses return values by key or default ReturnValue", () => {
    expect(parseReturnValue<number>({ Counter: 7 }, "Counter")).toBe(7);
    expect(parseReturnValue<number>({ ReturnValue: 22 })).toBe(22);
    expect(parseReturnValue<number>("nope")).toBeUndefined();
  });
});
