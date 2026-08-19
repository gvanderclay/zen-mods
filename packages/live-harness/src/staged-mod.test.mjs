import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectStagedModEvidence, validateStagedMod } from "./staged-mod.mjs";

const stagedMod = {
  enabled: false,
  manifest: {
    id: "keep-loaded",
    name: "Keep Loaded",
    scripts: { "dist/keep-loaded.uc.mjs": {} },
  },
  relativePaths: ["dist/keep-loaded.uc.mjs", "styles/chrome.css"],
  sourceDirectory: "/tmp/keep-loaded",
};

describe("live Zen staged mod boundary", () => {
  it("accepts an explicit allowlist and resolves its source root", () => {
    expect(validateStagedMod(stagedMod)).toEqual(stagedMod);
  });

  it.each([
    ["parent traversal", { ...stagedMod, relativePaths: ["../outside"] }],
    ["absolute path", { ...stagedMod, relativePaths: ["/tmp/outside"] }],
    ["duplicate path", { ...stagedMod, relativePaths: ["dist/a", "dist/a"] }],
    ["nested id", { ...stagedMod, manifest: { ...stagedMod.manifest, id: "a/b" } }],
  ])("rejects a %s", (_label, value) => {
    expect(() => validateStagedMod(value)).toThrow();
  });

  it("hashes the exact staged bytes rather than a mutable source snapshot", async () => {
    const target = await mkdtemp(join(tmpdir(), "zen-staged-evidence-"));
    try {
      await mkdir(join(target, "dist"));
      await mkdir(join(target, "styles"));
      await writeFile(join(target, "dist/keep-loaded.uc.mjs"), "// staged\n");
      await writeFile(join(target, "styles/chrome.css"), "/* staged */\n");
      await writeFile(
        join(target, "theme.json"),
        `${JSON.stringify(stagedMod.manifest)}\n`,
      );
      const evidence = await collectStagedModEvidence({
        manifest: stagedMod.manifest,
        relativePaths: stagedMod.relativePaths,
        target,
      });
      await writeFile(join(target, "dist/keep-loaded.uc.mjs"), "// changed later\n");

      const expected = createHash("sha256").update("// staged\n").digest("hex");
      expect(evidence.files["dist/keep-loaded.uc.mjs"]).toEqual({
        bytes: Buffer.byteLength("// staged\n"),
        sha256: expected,
      });
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  });
});
