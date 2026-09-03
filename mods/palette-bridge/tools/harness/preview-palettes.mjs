#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import {
  installShutdownSignals,
  launchLiveZen,
} from "@zen-mods/live-harness/zen-launcher";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const PRODUCTION_PATHS = [
  "dist/palette-bridge.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const DARK_PALETTE = {
  schemaVersion: 1,
  displayName: "Dark preview",
  mode: "dark",
  accent: "#7aa2f7",
  mainBackground: "#1a1b26",
  secondarySurface: "#24283b",
  selectionSurface: "#414868",
  border: "#565f89",
  normalForeground: "#c0caf5",
  mutedForeground: "#a9b1d6",
  strongForeground: "#ffffff",
};

const LIGHT_PALETTE = {
  schemaVersion: 1,
  displayName: "Light preview",
  mode: "light",
  accent: "#34548a",
  mainBackground: "#e6e7ed",
  secondarySurface: "#d5d6db",
  selectionSurface: "#c4c8da",
  border: "#9699a3",
  normalForeground: "#343b58",
  mutedForeground: "#6172b0",
  strongForeground: "#1a1b26",
};

const SETUP = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async read => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for Palette Bridge preview");
  };
  (async () => {
    const manager = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/manager.sys.mjs",
    ).default;
    const utils = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/utils.sys.mjs",
    ).default;
    await waitFor(() => typeof window.addUnloadListener === "function");
    await manager.toggleTheme(await utils.getMods(), options.modId);
    const facade = await waitFor(() =>
      window.zenPaletteBridge?.controller.snapshot().activePaletteIdentity
        ? window.zenPaletteBridge
        : null,
    );
    done({
      computedMode: getComputedStyle(document.documentElement).colorScheme,
      generationToken: facade.generationToken,
      paletteIdentity: facade.controller.snapshot().activePaletteIdentity,
    });
  })().catch(error => done({ error: String(error?.stack ?? error) }));
`;

const RELOAD = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async read => {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for light Palette Bridge preview");
  };
  (async () => {
    const previous = window.zenPaletteBridge;
    const manager = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/manager.sys.mjs",
    ).default;
    await manager.rebuildMods(true, false);
    const facade = await waitFor(() => {
      const current = window.zenPaletteBridge;
      return current && current !== previous &&
        current.controller.snapshot().activePaletteIdentity &&
        getComputedStyle(document.documentElement).colorScheme === options.mode
        ? current
        : null;
    });
    done({
      computedMode: getComputedStyle(document.documentElement).colorScheme,
      generationToken: facade.generationToken,
      paletteIdentity: facade.controller.snapshot().activePaletteIdentity,
    });
  })().catch(error => done({ error: String(error?.stack ?? error) }));
`;

const DISABLE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  (async () => {
    const manager = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/manager.sys.mjs",
    ).default;
    const utils = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/utils.sys.mjs",
    ).default;
    if ((await utils.getMods())[options.modId]?.enabled) {
      await manager.toggleTheme(await utils.getMods(), options.modId);
    }
    done({ disabled: window.zenPaletteBridge === undefined });
  })().catch(error => done({ error: String(error?.stack ?? error) }));
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const readCommand = () =>
  new Promise(resolveCommand => {
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.once("data", value => {
      process.stdin.pause();
      resolveCommand(value.trim().toLowerCase());
    });
  });

const assertPreviewResult = result => {
  if (result?.error) throw new Error(result.error);
  if (!result?.paletteIdentity) throw new Error("Palette Bridge preview did not apply");
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const zen = await launchLiveZen({
    headless: false,
    stagedMod: {
      enabled: false,
      manifest,
      relativePaths: PRODUCTION_PATHS,
      sourceDirectory: MOD_DIRECTORY,
    },
  });
  const palettePath = resolve(zen.profile, "chrome/palette-bridge.json");
  await atomicWriteJson(palettePath, DARK_PALETTE);
  let client;
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        if (client) {
          await client.executeAsync(DISABLE, [{ modId: manifest.id }]).catch(() => {});
          await client.quit();
        }
      } finally {
        await zen.stop();
      }
    })();
    return shutdownPromise;
  };
  const removeSignals = installShutdownSignals({
    label: "Palette Bridge preview",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(120_000);
    const dark = await client.executeAsync(SETUP, [{ modId: manifest.id }]);
    assertPreviewResult(dark);
    console.log(`Dark preview ready: ${JSON.stringify(dark)}`);
    console.log("Enter light to switch palettes, or quit to close the fixture.");
    if ((await readCommand()) !== "light") return;

    await atomicWriteJson(palettePath, LIGHT_PALETTE);
    const light = await client.executeAsync(RELOAD, [{ mode: "light" }]);
    assertPreviewResult(light);
    console.log(`Light preview ready: ${JSON.stringify(light)}`);
    console.log("Enter quit to close the fixture.");
    await readCommand();
  } finally {
    try {
      await shutdown();
    } finally {
      removeSignals();
    }
  }
};

await main();
