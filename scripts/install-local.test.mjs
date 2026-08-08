import { describe, expect, it } from "vitest";
import {
  localModEntry,
  profilePathFromIni,
  validateManifest,
  zenProcessIsRunning,
} from "./install-local-core.mjs";

describe("profilePathFromIni", () => {
  it("resolves the relative default profile", () => {
    const ini = `
[Profile0]
Name=Default
IsRelative=1
Path=Profiles/abc.default
Default=1

[Profile1]
Name=Other
IsRelative=1
Path=Profiles/other.default
`;

    expect(profilePathFromIni(ini, "/zen-root")).toBe("/zen-root/Profiles/abc.default");
  });

  it("preserves an absolute default profile path", () => {
    const ini = `
[Profile0]
IsRelative=0
Path=/profiles/zen
Default=1
`;

    expect(profilePathFromIni(ini, "/zen-root")).toBe("/profiles/zen");
  });

  it("rejects an ambiguous profile file", () => {
    const ini = `
[Profile0]
Path=Profiles/one
Default=1
[Profile1]
Path=Profiles/two
Default=1
`;

    expect(() => profilePathFromIni(ini, "/zen-root")).toThrow(
      "exactly one default profile",
    );
  });
});

describe("validateManifest", () => {
  it("accepts a matching Sine mod manifest", () => {
    expect(
      validateManifest(
        {
          id: "tab-deduplicator",
          name: "Tab Deduplicator",
          scripts: { "dist/tab-deduplicator.uc.mjs": {} },
        },
        "tab-deduplicator",
      ),
    ).toBeUndefined();
  });

  it("rejects an id that does not match its directory", () => {
    expect(() =>
      validateManifest({ id: "different", name: "Different" }, "tab-deduplicator"),
    ).toThrow("must match");
  });
});

describe("localModEntry", () => {
  it("uses the manifest and marks the mod as a local no-update install", () => {
    const manifest = {
      id: "tab-deduplicator",
      name: "Tab Deduplicator",
      version: "0.1.0",
    };

    expect(localModEntry(manifest)).toEqual({
      ...manifest,
      origin: "local",
      "no-updates": true,
      enabled: true,
    });
  });

  it("preserves an existing disabled choice and unrelated Sine metadata", () => {
    expect(
      localModEntry(
        { id: "example", name: "New name", version: "2" },
        { id: "example", name: "Old name", enabled: false, stars: 4 },
      ),
    ).toEqual({
      id: "example",
      name: "New name",
      version: "2",
      enabled: false,
      stars: 4,
      origin: "local",
      "no-updates": true,
    });
  });
});

describe("zenProcessIsRunning", () => {
  it("recognizes the Zen application process without matching helpers", () => {
    expect(
      zenProcessIsRunning([
        "/Applications/Zen.app/Contents/MacOS/zen --profile /tmp/profile",
        "/Applications/Zen.app/Contents/MacOS/plugin-container -parentPid 42",
      ]),
    ).toBe(true);
  });

  it("does not mistake plugin containers for the browser", () => {
    expect(
      zenProcessIsRunning([
        "/Applications/Zen.app/Contents/MacOS/plugin-container -parentPid 42",
      ]),
    ).toBe(false);
  });
});
