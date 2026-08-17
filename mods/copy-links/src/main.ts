import { copyPlainText, getLinksToShare } from "./platform/browser.ts";
import { installCopyLinksMenuItem } from "./platform/menu.ts";
import { startGeneration } from "./platform/sine.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[copy-links] unloaded");
});

try {
  generation.defer(
    installCopyLinksMenuItem({
      copyText: copyPlainText,
      getLinksToShare,
      report: error => console.error("[copy-links] action failed", error),
    }),
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[copy-links] ready");
