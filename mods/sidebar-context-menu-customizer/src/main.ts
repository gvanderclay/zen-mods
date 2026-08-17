import { installTabMenuCustomizer } from "./platform/menu.ts";
import { readExcludedRootTabItems, writeExcludedRootTabItems } from "./platform/prefs.ts";
import { startGeneration } from "./platform/sine.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[sidebar-context-menu-customizer] unloaded");
});

try {
  generation.defer(
    installTabMenuCustomizer(readExcludedRootTabItems, writeExcludedRootTabItems),
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[sidebar-context-menu-customizer] ready");
