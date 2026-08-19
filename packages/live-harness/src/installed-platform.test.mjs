import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertMatchingPlatform,
  captureInstalledPlatform,
  captureSineStamp,
  selectPlatformStamp,
} from "./installed-platform.mjs";
import { validatePlatformStamp } from "./platform-stamp.mjs";

const temporaryRoots = [];
const sha256 = contents => createHash("sha256").update(contents).digest("hex");

const writeFixtureFile = async (root, relativePath, contents) => {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
};

const createPlatformFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "zen-installed-platform-"));
  temporaryRoots.push(root);
  const zenResources = join(root, "Zen.app", "Contents", "Resources");
  const sineChromeDirectory = join(root, "profile", "chrome");
  await writeFixtureFile(
    zenResources,
    "application.ini",
    [
      "; fixture",
      "[App]",
      "Version=1.2.3b",
      "BuildID=20260819010203",
      "SourceStamp=0123456789abcdef0123456789abcdef01234567",
      "",
      "[Gecko]",
      "MaxVersion=154.0",
      "",
    ].join("\n"),
  );
  await writeFixtureFile(zenResources, "browser/omni.ja", "omni\n");
  await writeFixtureFile(zenResources, "config.js", "config\n");
  await writeFixtureFile(zenResources, "defaults/pref/config-prefs.js", "prefs\n");
  await writeFixtureFile(
    sineChromeDirectory,
    "JS/engine.json",
    `${JSON.stringify({ version: "2.3.3.0" })}\n`,
  );
  await writeFixtureFile(
    sineChromeDirectory,
    "JS/services/module_loader.mjs",
    "loader\n",
  );
  await writeFixtureFile(sineChromeDirectory, "JS/core/manager.sys.mjs", "manager\n");
  await writeFixtureFile(sineChromeDirectory, "JS/core/utils.sys.mjs", "utils\n");
  await writeFixtureFile(sineChromeDirectory, "utils/chrome.manifest", "manifest\n");
  return { sineChromeDirectory, zenResources };
};

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, { force: true, recursive: true })),
  );
});

describe("installed platform evidence", () => {
  it("captures the exact installed Zen metadata and Zen/Sine bytes", async () => {
    const paths = await createPlatformFixture();
    const stamp = await captureInstalledPlatform(paths);
    const applicationIni = await readFile(join(paths.zenResources, "application.ini"));

    expect(validatePlatformStamp(stamp)).toEqual({ ok: true, errors: [], stamp });
    expect(stamp.zen).toMatchObject({
      applicationIniSha256: sha256(applicationIni),
      buildId: "20260819010203",
      geckoVersion: "154.0",
      sourceStamp: "0123456789abcdef0123456789abcdef01234567",
      version: "1.2.3b",
    });
    expect(stamp.sine.version).toBe("2.3.3.0");
    expect(Object.keys(stamp.sine.files)).toEqual([
      "JS/core/manager.sys.mjs",
      "JS/core/utils.sys.mjs",
      "JS/engine.json",
      "JS/services/module_loader.mjs",
      "utils/chrome.manifest",
    ]);
  });

  it("uses observed evidence by default and requires an exact match when pinned", async () => {
    const observed = await captureInstalledPlatform(await createPlatformFixture());
    const pinned = structuredClone(observed);
    pinned.zen.version = "older";

    expect(selectPlatformStamp({ mode: "observed", observed, pinned })).toBe(observed);
    expect(() => selectPlatformStamp({ mode: "pinned", observed, pinned })).toThrow(
      "installed platform differs from the pinned stamp at zen.version",
    );
    expect(() => selectPlatformStamp({ mode: "other", observed, pinned })).toThrow(
      "platformMode must be observed or pinned",
    );
  });

  it("proves a copied Sine tree matches the captured source", async () => {
    const paths = await createPlatformFixture();
    const source = await captureSineStamp(paths.sineChromeDirectory);
    const copy = join(paths.sineChromeDirectory, "..", "copied-chrome");
    await mkdir(copy, { recursive: true });
    await cp(join(paths.sineChromeDirectory, "JS"), join(copy, "JS"), {
      recursive: true,
    });
    await cp(join(paths.sineChromeDirectory, "utils"), join(copy, "utils"), {
      recursive: true,
    });
    const copied = await captureSineStamp(copy);

    expect(() =>
      assertMatchingPlatform({ sine: source }, { sine: copied }, "staged Sine"),
    ).not.toThrow();
  });

  it("detects Zen and Sine changes after evidence was captured", async () => {
    const paths = await createPlatformFixture();
    const before = await captureInstalledPlatform(paths);
    await writeFixtureFile(paths.zenResources, "browser/omni.ja", "updated omni\n");
    await writeFixtureFile(
      paths.sineChromeDirectory,
      "JS/core/manager.sys.mjs",
      "updated manager\n",
    );
    const after = await captureInstalledPlatform(paths);

    expect(() => assertMatchingPlatform(before, after, "live run platform")).toThrow(
      "live run platform differs at sine.files.JS/core/manager.sys.mjs, " +
        "sine.jsTreeSha256, zen.browserOmniSha256",
    );
  });
});
