import { installTabMenuCustomizer } from "./platform/menu.ts";
import {
  readExcludedRootTabItems,
  readPromotedTabItems,
  writeExcludedRootTabItems,
  writePromotedTabItems,
} from "./platform/prefs.ts";
import { startGeneration } from "./platform/sine.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[sidebar-context-menu-customizer] unloaded");
});

try {
  generation.defer(
    installTabMenuCustomizer(
      readExcludedRootTabItems,
      writeExcludedRootTabItems,
      readPromotedTabItems,
      writePromotedTabItems,
    ),
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[sidebar-context-menu-customizer] ready");
