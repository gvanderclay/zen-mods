// Generated from src/ by build.mjs — do not edit.

// src/core/menu.ts
var dedupeMenuState = ({
  supported: supported2,
  duplicateCount
}) => {
  if (!supported2) {
    return { label: "Deduplicate tabs (unsupported)", disabled: true };
  }
  const count = Number.isSafeInteger(duplicateCount) && duplicateCount > 0 ? duplicateCount : 0;
  if (count === 0) {
    return { label: "No duplicate tabs in this space", disabled: true };
  }
  return {
    label: `Close ${count} duplicate ${count === 1 ? "tab" : "tabs"} in this space`,
    disabled: false
  };
};

// src/platform/browser.ts
var supported = () => typeof gBrowser.getAllDuplicateTabsToClose === "function" && typeof gBrowser.removeAllDuplicateTabs === "function";
var duplicateFacts = () => ({
  supported: supported(),
  duplicateCount: supported() ? gBrowser.getAllDuplicateTabsToClose?.().length ?? 0 : 0
});
var closeDuplicateTabs = () => {
  if (supported()) {
    gBrowser.removeAllDuplicateTabs?.();
  }
};

// src/platform/menu.ts
var ITEM_ID = "tab-deduplicator-context-item";
var MENU_ID = "tabContextMenu";
var ANCHOR_ID = "context_closeDuplicateTabs";
var installDedupeMenuItem = (readState, run) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(`<menuitem id="${ITEM_ID}"/>`);
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] menu item insertion failed");
    return () => {
    };
  }
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const next = readState();
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
    } catch (error) {
      item.setAttribute("label", "Deduplicate tabs (unavailable)");
      item.setAttribute("disabled", "true");
      console.error("[tab-deduplicator] could not inspect tabs", error);
    }
  };
  const onCommand = () => {
    try {
      run();
    } catch (error) {
      console.error("[tab-deduplicator] could not close duplicate tabs", error);
    }
  };
  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);
  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};

// src/platform/sine.ts
window.zenTabDeduplicator ??= { disposers: [] };
var state = window.zenTabDeduplicator;
var runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("[tab-deduplicator] disposer failed", error);
    }
  }
  state.disposers = [];
};
var onUnload = (teardown2) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown2);
  } else {
    console.error(
      "[tab-deduplicator] Sine did not expose addUnloadListener; reload cleanup is unavailable"
    );
  }
};

// src/main.ts
var teardown = () => {
  runDisposers();
  console.info("[tab-deduplicator] unloaded");
};
runDisposers();
onUnload(teardown);
state.disposers.push(
  installDedupeMenuItem(() => dedupeMenuState(duplicateFacts()), closeDuplicateTabs)
);
console.info("[tab-deduplicator] ready");
