import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const readPreview = () => readFile(resolve(DIRECTORY, "preview-palettes.mjs"), "utf8");

const embeddedScript = (source, name) =>
  source.match(
    new RegExp(/const NAME = `([\s\S]*?)`;/.source.replace("NAME", name)),
  )?.[1];

describe("Palette Bridge visual preview", () => {
  it("keeps every embedded Marionette body parseable", async () => {
    const source = await readPreview();

    for (const name of ["SETUP", "WAIT_FOR_PALETTE", "DISABLE"]) {
      const script = embeddedScript(source, name);
      expect(script, name).toBeTruthy();
      expect(() => new Function(script), name).not.toThrow();
    }
  });

  it("waits for polling instead of forcing a Sine rebuild", async () => {
    const source = await readPreview();
    const script = embeddedScript(source, "WAIT_FOR_PALETTE");

    expect(script).toContain("activePaletteIdentity");
    expect(script).not.toContain("rebuildMods");
  });
});
