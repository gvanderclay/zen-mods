import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

describe("lifecycle probe", () => {
  it("keeps its embedded Marionette body parseable", async () => {
    const source = await readFile(resolve(DIRECTORY, "probe-lifecycle.mjs"), "utf8");
    const match = source.match(/const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/);

    expect(match?.[1]).toBeTruthy();
    expect(() => new Function(match[1])).not.toThrow();
  });
});
