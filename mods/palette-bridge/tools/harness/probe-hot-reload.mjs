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
  ".benchmarks/live/palette-bridge-hot-reload.smoke.json",
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

const SECOND_PALETTE = {
  schemaVersion: 1,
  displayName: "Exact replacement",
  mode: "light",
  accent: "#335577",
  mainBackground: "#f0f2f5",
  secondarySurface: "#ffffff",
  selectionSurface: "#dbe7f3",
  border: "#8a96a3",
  normalForeground: "#18212b",
  mutedForeground: "#5d6873",
  strongForeground: "#000000",
};

const OVERRIDE_PALETTE = {
  ...SECOND_PALETTE,
  displayName: "Exact override",
  accent: "#765432",
};

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "default profile palette applies exact chrome values",
  "mode stylesheet follows the active palette",
  "sidebar labels use the normal foreground",
  "serialized polling stays within the measured budget",
  "valid replacement applies within one polling interval",
  "bad update keeps the last valid palette",
  "path preference applies immediately",
  "Zen update topic reapplies the active palette",
  "private and unsynced windows remain native without polling",
  "closing native-only windows drains their generations",
  "Sine rebuild replaces the generation",
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
  const summarize = values => {
    const sorted = [...values].sort((left, right) => left - right);
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const variance = sorted.reduce(
      (sum, value) => sum + (value - mean) ** 2,
      0,
    ) / sorted.length;
    const percentile = ratio =>
      sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
    return {
      count: sorted.length,
      max: sorted.at(-1),
      mean,
      median: percentile(0.5),
      min: sorted[0],
      p95: percentile(0.95),
      standardDeviation: Math.sqrt(variance),
    };
  };
  const cssRgb = value => {
    const color = Number.parseInt(value.slice(1), 16);
    return "rgb(" + [color >> 16, (color >> 8) & 255, color & 255].join(", ") + ")";
  };

  (async () => {
    let enabled = false;
    let manager;
    let originalPathPreference;
    let originalPathPreferenceWasUserSet = false;
    let originalReadJSON;
    let privateWindow;
    let unsyncedWindow;
    let utils;
    const readMeasurements = {
      active: 0,
      durations: [],
      maximumConcurrent: 0,
      starts: [],
    };
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

      originalPathPreference = Services.prefs.getStringPref(
        options.pathPreference,
        "",
      );
      originalPathPreferenceWasUserSet = Services.prefs.prefHasUserValue(
        options.pathPreference,
      );
      originalReadJSON = IOUtils.readJSON;
      IOUtils.readJSON = async function(path, ...rest) {
        const measured =
          path === options.palettePath || path === options.overridePalettePath;
        if (!measured) {
          return originalReadJSON.call(IOUtils, path, ...rest);
        }
        const startedAt = ChromeUtils.now();
        readMeasurements.starts.push(startedAt);
        readMeasurements.active += 1;
        readMeasurements.maximumConcurrent = Math.max(
          readMeasurements.maximumConcurrent,
          readMeasurements.active,
        );
        try {
          return await originalReadJSON.call(IOUtils, path, ...rest);
        } finally {
          readMeasurements.active -= 1;
          readMeasurements.durations.push(ChromeUtils.now() - startedAt);
        }
      };

      await manager.toggleTheme(await utils.getMods(), options.modId);
      enabled = true;
      const first = await waitFor("initial palette application", () => {
        const facade = window.zenPaletteBridge;
        return facade?.controller.snapshot().activePaletteIdentity &&
          root.getAttribute("zen-palette-bridge-generation") === facade.generationToken
          ? facade
          : null;
      });
      const initialIdentity = first.controller.snapshot().activePaletteIdentity;
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

      await waitFor(
        "twelve serialized palette reads",
        () =>
          readMeasurements.starts.length >= 12 &&
          readMeasurements.durations.length >= 12 &&
          readMeasurements.active === 0,
      );
      const durationStats = summarize(readMeasurements.durations.slice(1, 12));
      const intervalStats = summarize(
        readMeasurements.starts
          .slice(2, 12)
          .map((startedAt, index) => startedAt - readMeasurements.starts[index + 1]),
      );
      const meanReadDutyPercent = (durationStats.mean / 1000) * 100;
      report.performance = {
        durationMilliseconds: durationStats,
        intervalMilliseconds: intervalStats,
        maximumConcurrentReads: readMeasurements.maximumConcurrent,
        meanReadDutyPercent,
        paletteFileBytes: new TextEncoder().encode(
          JSON.stringify(options.palette, null, 2) + "\\n",
        ).length,
        warmupReads: 1,
      };
      check(
        "serialized polling stays within the measured budget",
        readMeasurements.maximumConcurrent === 1 &&
          durationStats.median < 5 &&
          meanReadDutyPercent < 2.5 &&
          intervalStats.min >= 900 &&
          intervalStats.p95 < 1500,
        JSON.stringify(report.performance),
      );

      const replacementStartedAt = ChromeUtils.now();
      await IOUtils.writeJSON(options.palettePath, options.secondPalette);
      const second = await waitFor("valid palette replacement", () => {
        const facade = window.zenPaletteBridge;
        return facade?.controller.snapshot().activePaletteIdentity !==
            initialIdentity &&
          root.style.getPropertyValue("--zen-primary-color") ===
            options.secondPalette.accent
          ? facade
          : null;
      });
      const replacementMilliseconds = ChromeUtils.now() - replacementStartedAt;
      check(
        "valid replacement applies within one polling interval",
        replacementMilliseconds < 1500 &&
          root.style.getPropertyValue("--toolbox-textcolor") ===
            options.secondPalette.normalForeground &&
          getComputedStyle(root).colorScheme === options.secondPalette.mode,
        JSON.stringify({
          accent: root.style.getPropertyValue("--zen-primary-color"),
          milliseconds: replacementMilliseconds,
          mode: getComputedStyle(root).colorScheme,
        }),
      );

      const secondIdentity = second.controller.snapshot().activePaletteIdentity;
      const readsBeforeBadUpdate = readMeasurements.starts.length;
      await IOUtils.writeJSON(options.palettePath, { schemaVersion: 1 });
      await waitFor(
        "bad palette read",
        () =>
          readMeasurements.starts.length > readsBeforeBadUpdate &&
          readMeasurements.active === 0,
      );
      await wait(25);
      check(
        "bad update keeps the last valid palette",
        second.controller.snapshot().activePaletteIdentity === secondIdentity &&
          root.style.getPropertyValue("--zen-primary-color") ===
            options.secondPalette.accent,
        JSON.stringify({
          accent: root.style.getPropertyValue("--zen-primary-color"),
          identity: second.controller.snapshot().activePaletteIdentity,
        }),
      );

      await IOUtils.writeJSON(options.palettePath, options.secondPalette);
      await IOUtils.writeJSON(options.overridePalettePath, options.overridePalette);
      const pathChangeStartedAt = ChromeUtils.now();
      Services.prefs.setStringPref(
        options.pathPreference,
        options.overridePalettePath,
      );
      await waitFor(
        "path preference palette",
        () =>
          root.style.getPropertyValue("--zen-primary-color") ===
          options.overridePalette.accent,
      );
      const pathChangeMilliseconds = ChromeUtils.now() - pathChangeStartedAt;
      check(
        "path preference applies immediately",
        pathChangeMilliseconds < 500,
        JSON.stringify({
          accent: root.style.getPropertyValue("--zen-primary-color"),
          milliseconds: pathChangeMilliseconds,
        }),
      );
      Services.prefs.setStringPref(options.pathPreference, originalPathPreference);
      await waitFor(
        "default path palette restoration",
        () =>
          root.style.getPropertyValue("--zen-primary-color") ===
          options.secondPalette.accent,
      );

      root.style.setProperty("--zen-primary-color", "#0a0b0c", "important");
      Services.obs.notifyObservers(null, "zen-space-gradient-update");
      await waitFor(
        "Zen topic palette reapplication",
        () =>
          root.style.getPropertyValue("--zen-primary-color") ===
          options.secondPalette.accent,
      );
      check(
        "Zen update topic reapplies the active palette",
        root.style.getPropertyValue("--zen-primary-color") ===
          options.secondPalette.accent,
        root.style.getPropertyValue("--zen-primary-color"),
      );

      privateWindow = OpenBrowserWindow({ private: true });
      await waitFor(
        "private window startup",
        () =>
          !privateWindow.closed &&
          privateWindow.gZenStartup?.promiseInitialized &&
          typeof privateWindow.addUnloadListener === "function",
      );
      await privateWindow.gZenStartup.promiseInitialized;
      const privateFacade = await waitFor("private native generation", () => {
        const facade = privateWindow.zenPaletteBridge;
        return facade?.controller.snapshot().started ? facade : null;
      });

      const dndPreference = "zen.tabs.dnd-open-blank-window";
      const dndPreferenceWasUserSet = Services.prefs.prefHasUserValue(dndPreference);
      const originalDndPreference = Services.prefs.getBoolPref(dndPreference, true);
      Services.prefs.setBoolPref(dndPreference, true);
      try {
        const unsyncedTab = gBrowser.addTab("about:blank", {
          skipAnimation: true,
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        });
        unsyncedWindow = gBrowser.replaceTabWithWindow(unsyncedTab, {});
      } finally {
        if (dndPreferenceWasUserSet) {
          Services.prefs.setBoolPref(dndPreference, originalDndPreference);
        } else if (Services.prefs.prefHasUserValue(dndPreference)) {
          Services.prefs.clearUserPref(dndPreference);
        }
      }
      await waitFor(
        "unsynced window startup",
        () =>
          unsyncedWindow &&
          !unsyncedWindow.closed &&
          unsyncedWindow.gZenStartup?.promiseInitialized &&
          typeof unsyncedWindow.addUnloadListener === "function" &&
          unsyncedWindow.document.documentElement.hasAttribute(
            "zen-unsynced-window",
          ),
      );
      await unsyncedWindow.gZenStartup.promiseInitialized;
      const unsyncedFacade = await waitFor("unsynced native generation", () => {
        const facade = unsyncedWindow.zenPaletteBridge;
        return facade?.controller.snapshot().started ? facade : null;
      });

      await IOUtils.writeJSON(options.palettePath, options.overridePalette);
      await waitFor(
        "ordinary window update beside native-only windows",
        () =>
          root.style.getPropertyValue("--zen-primary-color") ===
          options.overridePalette.accent,
      );
      await wait(1100);
      const nativeOnlyFacts = candidate => {
        const candidateRoot = candidate.document.documentElement;
        const candidateSnapshot = candidate.zenPaletteBridge.controller.snapshot();
        return {
          activePaletteIdentity: candidateSnapshot.activePaletteIdentity,
          eligible: candidateSnapshot.eligible,
          live: candidateSnapshot.live,
          marker: candidateRoot.getAttribute(
            "zen-palette-bridge-generation",
          ),
          mode: candidateRoot.style.getPropertyValue(
            "--zen-palette-bridge-color-scheme",
          ),
          pendingTimers: candidateSnapshot.pendingTimers,
          pendingWaits: candidateSnapshot.pendingWaits,
          readInFlight: candidateSnapshot.readInFlight,
        };
      };
      const privateFacts = nativeOnlyFacts(privateWindow);
      const unsyncedFacts = nativeOnlyFacts(unsyncedWindow);
      check(
        "private and unsynced windows remain native without polling",
        PrivateBrowsingUtils.isWindowPrivate(privateWindow) &&
          privateWindow.document.documentElement.hasAttribute(
            "zen-private-window",
          ) &&
          unsyncedWindow.document.documentElement.hasAttribute(
            "zen-unsynced-window",
          ) &&
          !PrivateBrowsingUtils.isWindowPrivate(unsyncedWindow) &&
          [privateFacts, unsyncedFacts].every(
            facts =>
              facts.activePaletteIdentity === null &&
              facts.eligible === false &&
              facts.live === true &&
              facts.marker === null &&
              facts.mode === "" &&
              facts.pendingTimers === 0 &&
              facts.pendingWaits === 0 &&
              facts.readInFlight === false,
          ),
        JSON.stringify({ private: privateFacts, unsynced: unsyncedFacts }),
      );

      await IOUtils.writeJSON(options.palettePath, options.secondPalette);
      await waitFor(
        "ordinary window palette restoration",
        () =>
          root.style.getPropertyValue("--zen-primary-color") ===
          options.secondPalette.accent,
      );
      privateWindow.close();
      unsyncedWindow.close();
      await waitFor(
        "native-only window cleanup",
        () =>
          privateWindow.closed &&
          unsyncedWindow.closed &&
          !privateFacade.controller.snapshot().live &&
          !unsyncedFacade.controller.snapshot().live,
      );
      const privateStopped = privateFacade.controller.snapshot();
      const unsyncedStopped = unsyncedFacade.controller.snapshot();
      check(
        "closing native-only windows drains their generations",
        [privateStopped, unsyncedStopped].every(
          stopped =>
            stopped.stopReason === "window-unload" &&
            stopped.pendingTimers === 0 &&
            stopped.pendingWaits === 0 &&
            stopped.readInFlight === false &&
            stopped.readRequested === false &&
            stopped.reapplyQueued === false,
        ),
        JSON.stringify({ private: privateStopped, unsynced: unsyncedStopped }),
      );

      root.style.setProperty("--zen-primary-color", "#0a0b0c", "important");
      await manager.rebuildMods();
      const replacement = await waitFor(
        "Sine rebuild palette generation",
        () => {
          const facade = window.zenPaletteBridge;
          const state = facade?.controller.snapshot();
          return facade && facade !== first &&
            state.activePaletteIdentity && state.pendingTimers === 1 &&
            state.pendingWaits === 0 && state.readInFlight === false &&
            root.getAttribute("zen-palette-bridge-generation") === facade.generationToken
            ? facade
            : null;
        },
        5000,
      );
      const firstStopped = first.controller.snapshot();
      const replacementReady = replacement.controller.snapshot();
      check(
        "Sine rebuild replaces the generation",
        firstStopped.live === false &&
          firstStopped.stopReason === "sine-unload" &&
          firstStopped.pendingTimers === 0 &&
          firstStopped.pendingWaits === 0 &&
          firstStopped.readInFlight === false &&
          firstStopped.readRequested === false &&
          firstStopped.reapplyQueued === false &&
          replacementReady.live === true &&
          replacementReady.pendingTimers === 1 &&
          replacementReady.pendingWaits === 0 &&
          replacementReady.readInFlight === false &&
          replacementReady.readRequested === false &&
          replacementReady.reapplyQueued === false &&
          root.style.getPropertyValue("--zen-primary-color") ===
            options.secondPalette.accent,
        JSON.stringify({
          first: firstStopped,
          replacement: replacementReady,
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
          stopped.pendingTimers === 0 && stopped.pendingWaits === 0 &&
          stopped.readInFlight === false && stopped.readRequested === false &&
          stopped.reapplyQueued === false,
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
      if (originalReadJSON) {
        IOUtils.readJSON = originalReadJSON;
      }
      if (originalPathPreference !== undefined) {
        try {
          if (originalPathPreferenceWasUserSet) {
            Services.prefs.setStringPref(
              options.pathPreference,
              originalPathPreference,
            );
          } else if (Services.prefs.prefHasUserValue(options.pathPreference)) {
            Services.prefs.clearUserPref(options.pathPreference);
          }
        } catch (error) {
          report.preferenceRestoreError = String(error?.stack ?? error);
        }
      }
      for (const candidate of [privateWindow, unsyncedWindow]) {
        if (candidate && !candidate.closed) {
          try {
            candidate.close();
          } catch (error) {
            report.windowCloseError = String(error?.stack ?? error);
          }
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
  const overridePalettePath = resolve(zen.profile, "chrome/palette-bridge-override.json");
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
    label: "Palette Bridge hot reload",
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
        overridePalette: OVERRIDE_PALETTE,
        overridePalettePath,
        palette: PALETTE,
        palettePath,
        pathPreference: "zen.palette-bridge.path",
        secondPalette: SECOND_PALETTE,
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
    console.log(`Raw hot-reload evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Palette Bridge hot-reload probe failed: ${error.stack ?? error}`);
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
