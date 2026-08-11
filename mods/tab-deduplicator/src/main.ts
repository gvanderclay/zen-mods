import {
  installFolderCloseMenuItem,
  installFolderGroupingMenuItem,
} from "./platform/folder-menu.ts";
import { installDedupeMenuItem } from "./platform/menu.ts";
import { readIncludePinnedPreference } from "./platform/prefs.ts";
import { startGeneration } from "./platform/sine.ts";
import {
  closeCurrentSpaceDuplicates,
  currentSpaceCloseMenuState,
  installSpaceGroupingMenuItem,
} from "./platform/space-menu.ts";
import { installUnpinCloseMenuItem } from "./platform/unpin-close-menu.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[tab-deduplicator] unloaded");
});

try {
  for (const dispose of [
    installUnpinCloseMenuItem(),
    installDedupeMenuItem(
      () => currentSpaceCloseMenuState(readIncludePinnedPreference()),
      confirmationAnchor =>
        closeCurrentSpaceDuplicates(readIncludePinnedPreference(), confirmationAnchor),
    ),
    installSpaceGroupingMenuItem(readIncludePinnedPreference),
    installFolderGroupingMenuItem(readIncludePinnedPreference),
    installFolderCloseMenuItem(readIncludePinnedPreference),
  ]) {
    generation.defer(dispose);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[tab-deduplicator] ready");
