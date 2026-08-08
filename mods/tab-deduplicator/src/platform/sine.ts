/** Module scope is discarded on each Sine reload, so registrations live on the window. */
window.zenTabDeduplicator ??= { disposers: [] };
export const state = window.zenTabDeduplicator;

export const runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("[tab-deduplicator] disposer failed", error);
    }
  }
  state.disposers = [];
};

export const onUnload = (teardown: () => void) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown);
  } else {
    console.error(
      "[tab-deduplicator] Sine did not expose addUnloadListener; reload cleanup is unavailable",
    );
  }
};
