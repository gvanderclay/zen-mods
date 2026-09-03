#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "@zen-mods/live-harness/core";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import {
  installShutdownSignals,
  launchLiveZen,
} from "@zen-mods/live-harness/zen-launcher";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/palette-bridge-once.smoke.json",
);
const PRODUCTION_PATHS = [
  "dist/palette-bridge.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const PALETTE = {
  schemaVersion: 1,
  displayName: "Exact probe",
  mode: "dark",
  accent: "#112233",
  mainBackground: "#223344",
  secondarySurface: "#334455",
  selectionSurface: "#445566",
  border: "#556677",
  normalForeground: "#ccddee",
  mutedForeground: "#aabbcc",
  strongForeground: "#ffffff",
};

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "default profile palette applies exact chrome values",
  "mode stylesheet follows the active palette",
  "sidebar labels use the normal foreground",
  "Sine unload and cache-busted import replace the generation",
  "disable restores owned styles and drains the generation",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], fatal: null, platform: null };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
    return Boolean(condition);
  };
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const snapshot = (target, property) => ({
    priority: target.style.getPropertyPriority(property),
    value: target.style.getPropertyValue(property),
  });
  const sameSnapshot = (left, right) =>
    left.priority === right.priority && left.value === right.value;
  const cssRgb = value => {
    const color = Number.parseInt(value.slice(1), 16);
    return "rgb(" + [color >> 16, (color >> 8) & 255, color & 255].join(", ") + ")";
  };

  (async () => {
    let enabled = false;
    let manager;
    let utils;
    const root = document.documentElement;
    const browserBackground = document.getElementById("zen-browser-background");
    const toolbarBackground = document.getElementById("zen-toolbar-background");
    let original;
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      utils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && browserBackground &&
          toolbarBackground && gBrowser.selectedTab?.querySelector(".tab-label") &&
          gBrowser.selectedTab?.closest("zen-workspace")?.querySelector(
            "#tabs-newtab-button",
          ) && document.querySelector(".zen-current-workspace-indicator-name"),
      );
      const workspace = gBrowser.selectedTab.closest("zen-workspace");
      original = {
        accent: snapshot(root, "--zen-primary-color"),
        border: snapshot(root, "--zen-colors-border"),
        browser: snapshot(browserBackground, "--zen-main-browser-background"),
        mode: snapshot(root, "--zen-palette-bridge-color-scheme"),
        toolbar: snapshot(
          toolbarBackground,
          "--zen-main-browser-background-toolbar",
        ),
        workspace: {
          accent: snapshot(workspace, "--zen-primary-color"),
          background: snapshot(workspace, "--tab-background-color-selected"),
          mode: snapshot(workspace, "color-scheme"),
          selectedText: snapshot(workspace, "--tab-selected-textcolor"),
          text: snapshot(workspace, "--toolbox-textcolor"),
        },
      };
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      check(
        "exact stamped platform is running",
        Services.appinfo.version === options.zenVersion &&
          Services.appinfo.appBuildID === options.buildId &&
          Services.appinfo.platformVersion === options.geckoVersion,
        JSON.stringify(report.platform),
      );
      check(
        "manifest declares unload support",
        options.supportsUnload === true,
        "supportsUnload=" + String(options.supportsUnload),
      );

      const initialMods = await utils.getMods();
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false &&
          window.zenPaletteBridge === undefined &&
          !root.hasAttribute("zen-palette-bridge-generation"),
        JSON.stringify({
          enabled: initialMods[options.modId]?.enabled,
          generation: Boolean(window.zenPaletteBridge),
          marker: root.getAttribute("zen-palette-bridge-generation"),
        }),
      );

      await manager.toggleTheme(await utils.getMods(), options.modId);
      enabled = true;
      const first = await waitFor("initial palette application", () => {
        const facade = window.zenPaletteBridge;
        return facade?.controller.snapshot().activePaletteIdentity &&
          root.getAttribute("zen-palette-bridge-generation") === facade.generationToken
          ? facade
          : null;
      });
      const resolvedPath = PathUtils.join(
        Services.dirsvc.get("ProfD", Ci.nsIFile).path,
        "chrome",
        "palette-bridge.json",
      );
      check(
        "default profile palette applies exact chrome values",
        resolvedPath === options.palettePath &&
          root.style.getPropertyValue("--zen-primary-color") === options.palette.accent &&
          root.style.getPropertyValue("--zen-colors-primary") ===
            options.palette.secondarySurface &&
          root.style.getPropertyValue("--zen-colors-hover-bg") ===
            options.palette.selectionSurface &&
          root.style.getPropertyValue("--zen-colors-border") === options.palette.border &&
          root.style.getPropertyValue("--toolbox-textcolor") ===
            options.palette.normalForeground &&
          browserBackground.style.getPropertyValue("--zen-main-browser-background") ===
            options.palette.mainBackground &&
          toolbarBackground.style.getPropertyValue(
            "--zen-main-browser-background-toolbar",
          ) === options.palette.mainBackground &&
          workspace.style.getPropertyValue("--toolbox-textcolor") ===
            options.palette.normalForeground &&
          workspace.style.getPropertyValue("--tab-background-color-selected") ===
            options.palette.selectionSurface &&
          workspace.style.getPropertyValue("--tab-selected-textcolor") ===
            options.palette.normalForeground,
        JSON.stringify({
          accent: root.style.getPropertyValue("--zen-primary-color"),
          browser: browserBackground.style.getPropertyValue(
            "--zen-main-browser-background",
          ),
          resolvedPath,
          toolbar: toolbarBackground.style.getPropertyValue(
            "--zen-main-browser-background-toolbar",
          ),
        }),
      );
      check(
        "mode stylesheet follows the active palette",
        root.style.getPropertyValue("--zen-palette-bridge-color-scheme") === "dark" &&
          getComputedStyle(root).colorScheme === "dark",
        JSON.stringify({
          computed: getComputedStyle(root).colorScheme,
          inline: root.style.getPropertyValue("--zen-palette-bridge-color-scheme"),
        }),
      );
      const activeTabLabel = gBrowser.selectedTab.querySelector(".tab-label");
      const newTabButton = workspace.querySelector("#tabs-newtab-button");
      const workspaceName = document.querySelector(
        ".zen-current-workspace-indicator-name",
      );
      check(
        "sidebar labels use the normal foreground",
        getComputedStyle(activeTabLabel).color ===
          cssRgb(options.palette.normalForeground) &&
          getComputedStyle(newTabButton).color ===
            cssRgb(options.palette.normalForeground) &&
          getComputedStyle(workspaceName).color ===
            cssRgb(options.palette.normalForeground),
        JSON.stringify({
          actual: getComputedStyle(activeTabLabel).color,
          expected: cssRgb(options.palette.normalForeground),
          newTab: newTabButton ? getComputedStyle(newTabButton).color : null,
          workspaceName: workspaceName ? getComputedStyle(workspaceName).color : null,
        }),
      );

      root.style.setProperty("--zen-primary-color", "#0a0b0c", "important");
      await manager.triggerUnloadListener(options.scriptPath, window);
      await import(options.scriptPath + "?probe=" + Date.now());
      const replacement = await waitFor(
        "replacement palette generation",
        () => {
          const facade = window.zenPaletteBridge;
          return facade && facade !== first &&
            facade.controller.snapshot().activePaletteIdentity &&
            root.getAttribute("zen-palette-bridge-generation") === facade.generationToken
            ? facade
            : null;
        },
        5000,
      );
      check(
        "Sine unload and cache-busted import replace the generation",
        first.controller.snapshot().live === false &&
          first.controller.snapshot().stopReason === "sine-unload" &&
          replacement.controller.snapshot().live === true &&
          root.style.getPropertyValue("--zen-primary-color") === options.palette.accent,
        JSON.stringify({
          first: first.controller.snapshot(),
          replacement: replacement.controller.snapshot(),
        }),
      );

      await manager.toggleTheme(await utils.getMods(), options.modId);
      enabled = false;
      await waitFor("Palette Bridge disable", () =>
        window.zenPaletteBridge === undefined &&
          !root.hasAttribute("zen-palette-bridge-generation"),
      );
      const stopped = replacement.controller.snapshot();
      check(
        "disable restores owned styles and drains the generation",
        root.style.getPropertyValue("--zen-primary-color") === "#0a0b0c" &&
          sameSnapshot(snapshot(root, "--zen-colors-border"), original.border) &&
          sameSnapshot(
            snapshot(browserBackground, "--zen-main-browser-background"),
            original.browser,
          ) &&
          sameSnapshot(
            snapshot(toolbarBackground, "--zen-main-browser-background-toolbar"),
            original.toolbar,
          ) &&
          sameSnapshot(
            snapshot(root, "--zen-palette-bridge-color-scheme"),
            original.mode,
          ) &&
          sameSnapshot(
            snapshot(workspace, "--zen-primary-color"),
            original.workspace.accent,
          ) &&
          sameSnapshot(
            snapshot(workspace, "--tab-background-color-selected"),
            original.workspace.background,
          ) &&
          sameSnapshot(
            snapshot(workspace, "color-scheme"),
            original.workspace.mode,
          ) &&
          sameSnapshot(
            snapshot(workspace, "--tab-selected-textcolor"),
            original.workspace.selectedText,
          ) &&
          sameSnapshot(
            snapshot(workspace, "--toolbox-textcolor"),
            original.workspace.text,
          ) &&
          stopped.live === false && stopped.stopReason === "sine-unload" &&
          stopped.pendingTimers === 0 && stopped.pendingWaits === 0,
        JSON.stringify({
          accent: snapshot(root, "--zen-primary-color"),
          border: snapshot(root, "--zen-colors-border"),
          browser: snapshot(browserBackground, "--zen-main-browser-background"),
          mode: snapshot(root, "--zen-palette-bridge-color-scheme"),
          stopped,
          toolbar: snapshot(
            toolbarBackground,
            "--zen-main-browser-background-toolbar",
          ),
          workspace: {
            accent: snapshot(workspace, "--zen-primary-color"),
            background: snapshot(workspace, "--tab-background-color-selected"),
            mode: snapshot(workspace, "color-scheme"),
            selectedText: snapshot(workspace, "--tab-selected-textcolor"),
            text: snapshot(workspace, "--toolbox-textcolor"),
          },
        }),
      );
      if (original.accent.value === "") {
        root.style.removeProperty("--zen-primary-color");
      } else {
        root.style.setProperty(
          "--zen-primary-color",
          original.accent.value,
          original.accent.priority,
        );
      }
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      if (enabled && manager && utils) {
        try {
          await manager.toggleTheme(await utils.getMods(), options.modId);
        } catch (error) {
          report.disableError = String(error?.stack ?? error);
        }
      }
    }
    done(report);
  })();
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const zen = await launchLiveZen({
    stagedMod: {
      enabled: false,
      manifest,
      relativePaths: PRODUCTION_PATHS,
      sourceDirectory: MOD_DIRECTORY,
    },
  });
  const palettePath = resolve(zen.profile, "chrome/palette-bridge.json");
  await atomicWriteJson(palettePath, PALETTE);
  let client;
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await client?.quit();
      } finally {
        await zen.stop();
      }
    })();
    return shutdownPromise;
  };
  const removeSignals = installShutdownSignals({
    label: "Palette Bridge apply-once",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(120_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        palette: PALETTE,
        palettePath,
        scriptPath: `chrome://sine/content/${manifest.id}/dist/palette-bridge.uc.mjs`,
        sineVersion: zen.platformStamp.sine.version,
        supportsUnload: manifest.supportsUnload,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    let validationError = null;
    let verdicts = null;
    try {
      verdicts = collectVerdicts(validateAssertionManifest(result, REQUIRED_ASSERTIONS));
    } catch (error) {
      validationError = String(error?.stack ?? error);
    }
    const artifact = {
      recordedAt: new Date().toISOString(),
      stagedProduction: zen.stagedMod,
      stamp: zen.platformStamp,
      marionette: client.hello,
      runner: {
        node: process.version,
        v8: process.versions.v8,
        os: { arch: arch(), platform: platform(), release: release() },
      },
      contract: { requiredAssertions: REQUIRED_ASSERTIONS },
      validation: { error: validationError, verdicts },
      result,
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw apply-once evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Palette Bridge apply-once probe failed: ${error.stack ?? error}`);
    console.error(zen.output.join("").slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      await shutdown();
    } finally {
      removeSignals();
    }
  }
};

await main();
