import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

const readProbeBody = async () => {
  const source = await readFile(resolve(DIRECTORY, "probe-lifecycle.mjs"), "utf8");
  return source.match(/const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/)?.[1];
};

describe("Sidebar context menu customizer live probe", () => {
  it("keeps its embedded Marionette body parseable", async () => {
    const probe = await readProbeBody();

    expect(probe).toBeTruthy();
    expect(() => new Function(probe)).not.toThrow();
  });

  it("selects a real tab before the first context fixture", async () => {
    const probe = await readProbeBody();
    const start = probe?.indexOf("const contextTab =") ?? -1;
    const end =
      probe?.indexOf('const warmShown = waitForEvent(menu, "popupshown")') ?? -1;
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const stage = probe.slice(start, end);

    // Zen 1.24.1b opens a window whose only tab is the hidden zen-empty-tab
    // placeholder. Firefox filters invisible tabs out of its multiselect bookkeeping
    // and a panel anchored to one never reports popupshown, so the fixture tab must
    // be a real tab that is selected before the first menu opening.
    expect(stage).toContain('gBrowser.addTab("about:blank"');
    expect(stage).toContain("gBrowser.selectedTab = contextTab");
    expect(stage).toContain("contextTab.visible");
    expect(stage).not.toContain("const contextTab = gBrowser.selectedTab;");
  });
});
