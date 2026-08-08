import { installTabMenuCustomizer } from "./platform/menu.ts";
import {
  readHiddenTabItems,
  readPromotedTabItems,
  writeHiddenTabItems,
  writePromotedTabItems,
} from "./platform/prefs.ts";
import { onUnload, runDisposers, state } from "./platform/sine.ts";

const teardown = () => {
  runDisposers();
  console.info("[sidebar-context-menu-customizer] unloaded");
};

runDisposers();
onUnload(teardown);
state.disposers.push(
  installTabMenuCustomizer(
    readHiddenTabItems,
    writeHiddenTabItems,
    readPromotedTabItems,
    writePromotedTabItems,
  ),
);

console.info("[sidebar-context-menu-customizer] ready");
