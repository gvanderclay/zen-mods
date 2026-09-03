import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const readProbe = () => readFile(resolve(DIRECTORY, "probe-hot-reload.mjs"), "utf8");

describe("Palette Bridge live probe", () => {
  it("keeps its embedded Marionette body parseable", async () => {
    const source = await readProbe();
    const probe = source.match(
      /const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/,
    )?.[1];

    expect(probe).toBeTruthy();
    expect(() => new Function(probe)).not.toThrow();
  });

  it("binds the complete window matrix to unique browser checks", async () => {
    const source = await readProbe();
    const required = source.match(/const REQUIRED_ASSERTIONS = \[([\s\S]*?)\];/)?.[1];
    const probe = source.match(
      /const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/,
    )?.[1];
    const names = text =>
      [...(text ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]).sort();
    const checks = [...(probe ?? "").matchAll(/check\(\s*"([^"]+)"/g)]
      .map(match => match[1])
      .sort();

    expect(names(required)).toContain(
      "private and unsynced windows remain native without polling",
    );
    expect(names(required)).toContain(
      "closing native-only windows drains their generations",
    );
    expect(checks).toEqual(names(required));
    expect(new Set(checks).size).toBe(checks.length);
  });
});
