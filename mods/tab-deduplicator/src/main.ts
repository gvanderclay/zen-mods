import { dedupeMenuState } from "./core/menu.ts";
import { closeDuplicateTabs, duplicateFacts } from "./platform/browser.ts";
import {
  installFolderCloseMenuItem,
  installFolderGroupingMenuItem,
} from "./platform/folder-menu.ts";
import { installDedupeMenuItem } from "./platform/menu.ts";
import { readIncludePinnedPreference } from "./platform/prefs.ts";
import { onUnload, runDisposers, state } from "./platform/sine.ts";
import { installSpaceGroupingMenuItem } from "./platform/space-menu.ts";

const teardown = () => {
  runDisposers();
  console.info("[tab-deduplicator] unloaded");
};

// Defensive even if Sine's unload hook ran: a failed prior teardown must not leave
// two menu items or listeners after the module is cache-busted and imported again.
runDisposers();
onUnload(teardown);

state.disposers.push(
  installDedupeMenuItem(() => dedupeMenuState(duplicateFacts()), closeDuplicateTabs),
  installSpaceGroupingMenuItem(readIncludePinnedPreference),
  installFolderGroupingMenuItem(readIncludePinnedPreference),
  installFolderCloseMenuItem(readIncludePinnedPreference),
);

console.info("[tab-deduplicator] ready");
