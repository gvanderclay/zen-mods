import {
  installFolderCloseMenuItem,
  installFolderGroupingMenuItem,
} from "./platform/folder-menu.ts";
import {
  installDedupeMenuItem,
  installEmptySidebarDedupeMenuItem,
} from "./platform/menu.ts";
import { readIncludePinnedPreference } from "./platform/prefs.ts";
import { installCloseReviewDialog } from "./platform/review-dialog.ts";
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
  const review = installCloseReviewDialog({
    document: window.document,
    isLive: generation.isLive,
  });
  generation.defer(review.dispose);
  const readSpaceCloseState = () =>
    currentSpaceCloseMenuState(readIncludePinnedPreference());
  const closeSpaceDuplicates = (confirmationAnchor: unknown) =>
    closeCurrentSpaceDuplicates(
      readIncludePinnedPreference(),
      confirmationAnchor,
      review,
      generation.isLive,
    );
  for (const dispose of [
    installUnpinCloseMenuItem(),
    installDedupeMenuItem(readSpaceCloseState, closeSpaceDuplicates),
    installEmptySidebarDedupeMenuItem(readSpaceCloseState, closeSpaceDuplicates),
    installSpaceGroupingMenuItem(readIncludePinnedPreference),
    installFolderGroupingMenuItem(readIncludePinnedPreference),
    installFolderCloseMenuItem(readIncludePinnedPreference, review, generation.isLive),
  ]) {
    generation.defer(dispose);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[tab-deduplicator] ready");
