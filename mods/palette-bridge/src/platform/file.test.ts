import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirefoxPaletteFilePort, createPaletteFilePort } from "./file.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("palette file port", () => {
  it("reads the profile default or exact configured path", async () => {
    let overridePath = "";
    const readJson = vi.fn(async (path: string) => ({ path }));
    const file = createPaletteFilePort({
      joinPath: (...segments) => segments.join("/"),
      overridePath: () => overridePath,
      profileDirectory: "/profile",
      readJson,
    });

    const defaultPath = file.currentPath();
    expect(defaultPath).toBe("/profile/chrome/palette-bridge.json");
    await expect(file.read(defaultPath)).resolves.toEqual({ path: defaultPath });

    overridePath = "/producer/current.json";
    expect(file.currentPath()).toBe(overridePath);
    await expect(file.read(overridePath)).resolves.toEqual({ path: overridePath });
    expect(readJson).toHaveBeenCalledTimes(2);
  });

  it("adapts the Firefox profile, preference, path, and JSON APIs", async () => {
    const getDirectory = vi.fn(() => ({ path: "/profile" }));
    const getStringPref = vi.fn(() => "");
    const join = vi.fn((...segments: string[]) => segments.join("/"));
    const readJSON = vi.fn(async () => ({ schemaVersion: 1 }));
    const nsIFile = {};
    vi.stubGlobal("Ci", { nsIFile });
    vi.stubGlobal("IOUtils", { readJSON });
    vi.stubGlobal("PathUtils", { join });
    vi.stubGlobal("Services", {
      dirsvc: { get: getDirectory },
      prefs: { getStringPref },
    });

    const file = createFirefoxPaletteFilePort();
    const path = file.currentPath();
    await file.read(path);

    expect(getDirectory).toHaveBeenCalledWith("ProfD", nsIFile);
    expect(getStringPref).toHaveBeenCalledWith("zen.palette-bridge.path", "");
    expect(join).toHaveBeenCalledWith("/profile", "chrome", "palette-bridge.json");
    expect(readJSON).toHaveBeenCalledWith(path);
  });
});
