/** Sine cache-busts module imports, so registrations survive only on the window. */
window.zenSidebarContextMenuCustomizer ??= { disposers: [] };
export const state = window.zenSidebarContextMenuCustomizer;

export const runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("[sidebar-context-menu-customizer] disposer failed", error);
    }
  }
  state.disposers = [];
};

export const onUnload = (teardown: () => void) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown);
  } else {
    console.error("[sidebar-context-menu-customizer] Sine unload hook is unavailable");
  }
};
