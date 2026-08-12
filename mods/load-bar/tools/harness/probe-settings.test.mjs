import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

describe("settings probe", () => {
  it("keeps its embedded Marionette body parseable", async () => {
    const source = await readFile(resolve(DIRECTORY, "probe-settings.mjs"), "utf8");
    const probe = source.match(
      /const PROBE = `([\s\S]*?)`;\n\nconst startFixtureServer/,
    )?.[1];

    expect(probe).toBeTruthy();
    expect(() => new Function(probe)).not.toThrow();
  });

  it("binds every required assertion to one browser-side check", async () => {
    const source = await readFile(resolve(DIRECTORY, "probe-settings.mjs"), "utf8");
    const required = source.match(/const REQUIRED_ASSERTIONS = \[([\s\S]*?)\];/)?.[1];
    const probe = source.match(
      /const PROBE = `([\s\S]*?)`;\n\nconst startFixtureServer/,
    )?.[1];
    const names = text =>
      [...(text ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
    const checks = [...(probe ?? "").matchAll(/check\(\s*"([^"]+)"/g)]
      .map(match => match[1])
      .sort();

    expect(checks).toEqual(names(required));
    expect(new Set(checks).size).toBe(checks.length);
  });
});
