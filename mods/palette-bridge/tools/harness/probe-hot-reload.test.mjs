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

  it("keeps a real tab in the probe window while moving one to the unsynced window", async () => {
    const source = await readProbe();
    const probe = source.match(
      /const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/,
    )?.[1];
    const start = probe?.indexOf('await mark("open unsynced window");') ?? -1;
    const end = probe?.indexOf('await waitFor(\n        "unsynced window startup"') ?? -1;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const stage = probe.slice(start, end);
    const added = [...stage.matchAll(/const (\w+) = gBrowser\.addTab\(/g)].map(
      match => match[1],
    );
    const moved = stage.match(/gBrowser\.replaceTabWithWindow\((\w+),/)?.[1];

    // Zen 1.24.1b closes a window whose only remaining tab is the zen-empty-tab
    // placeholder, so the tab moved out must not be the window's only real tab.
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(moved).toBe(added.at(-1));
  });
});
