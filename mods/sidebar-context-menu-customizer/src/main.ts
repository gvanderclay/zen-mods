import { installTabMenuCustomizer } from "./platform/menu.ts";
import { readHiddenTabItems, writeHiddenTabItems } from "./platform/prefs.ts";
import { onUnload, runDisposers, state } from "./platform/sine.ts";

const teardown = () => {
  runDisposers();
  console.info("[sidebar-context-menu-customizer] unloaded");
};

runDisposers();
onUnload(teardown);
state.disposers.push(installTabMenuCustomizer(readHiddenTabItems, writeHiddenTabItems));

console.info("[sidebar-context-menu-customizer] ready");
