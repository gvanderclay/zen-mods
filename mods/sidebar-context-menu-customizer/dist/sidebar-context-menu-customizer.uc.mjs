// Generated from src/ by build.mjs — do not edit.

// src/core/policy.ts
var PROMOTION_COPY_LINKS = "share.copy-links";
var copyLinksPromotionState = (promotedIds, shareableCount) => ({
  visible: promotedIds.has(PROMOTION_COPY_LINKS),
  disabled: shareableCount < 1,
  labelCount: Math.max(1, shareableCount)
});
var coalesceCustomizationActions = (actions) => {
  const byLabel = /* @__PURE__ */ new Map();
  for (const action of actions) {
    const normalizedLabel = action.label.trim().toLocaleLowerCase();
    const variants = byLabel.get(normalizedLabel) ?? [];
    variants.push(action);
    byLabel.set(normalizedLabel, variants);
  }
  return [...byLabel.values()].map((variants) => {
    const keys = variants.map((action) => action.key).sort();
    const first = variants[0];
    return {
      key: keys[0],
      keys,
      label: first.label,
      selected: variants.some((action) => action.selected),
      actions: variants
    };
  });
};
var groupCustomizationActions = (actions) => {
  const alphabetically = (left, right) => left.label.localeCompare(right.label, void 0, {
    numeric: true,
    sensitivity: "base"
  }) || left.key.localeCompare(right.key);
  return {
    selected: actions.filter((action) => action.selected).sort(alphabetically),
    unselected: actions.filter((action) => !action.selected).sort(alphabetically)
  };
};
var actionPreferenceKey = ({
  id,
  l10nId,
  command
}) => {
  if (id.trim()) {
    return id.trim();
  }
  if (l10nId?.trim()) {
    return `l10n:${l10nId.trim()}`;
  }
  if (command?.trim()) {
    return `command:${command.trim()}`;
  }
  return null;
};
var decodeHiddenIds = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return /* @__PURE__ */ new Set();
    }
    return new Set(
      parsed.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    );
  } catch {
    return /* @__PURE__ */ new Set();
  }
};
var encodeHiddenIds = (ids) => JSON.stringify([...ids].sort());
var resolveHiddenIds = (stored, discoveredIds) => {
  if (stored !== null) {
    return { ids: new Set(stored), initialized: false };
  }
  return {
    ids: new Set(discoveredIds.map((id) => id.trim()).filter(Boolean)),
    initialized: true
  };
};
var separatorsToHide = (nodes) => {
  const hidden = /* @__PURE__ */ new Set();
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "separator" || !node.visible) {
      continue;
    }
    let previousItem = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = nodes[cursor];
      if (candidate?.kind === "item" && candidate.visible) {
        previousItem = cursor;
        break;
      }
    }
    const nextItem = nodes.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && candidate.kind === "item" && candidate.visible
    );
    const earlierSeparator = nodes.slice(previousItem + 1, index).some((candidate) => candidate.kind === "separator" && candidate.visible);
    if (previousItem < 0 || nextItem < 0 || earlierSeparator) {
      hidden.add(index);
    }
  }
  return hidden;
};

// src/platform/menu.ts
var { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs"
);
var TAB_MENU_ID = "tabContextMenu";
var CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
var CUSTOMIZER_MENU_ID = "sidebar-context-menu-customizer-tab-menu";
var CUSTOMIZER_POPUP_ID = "sidebar-context-menu-customizer-tab-popup";
var RESET_SEPARATOR_ID = "sidebar-context-menu-customizer-reset-separator";
var RESET_ID = "sidebar-context-menu-customizer-reset";
var PROMOTE_MENU_ID = "sidebar-context-menu-customizer-promote-menu";
var PROMOTE_POPUP_ID = "sidebar-context-menu-customizer-promote-popup";
var PROMOTE_SHARE_MENU_ID = "sidebar-context-menu-customizer-promote-share-menu";
var PROMOTE_SHARE_POPUP_ID = "sidebar-context-menu-customizer-promote-share-popup";
var PROMOTE_COPY_LINKS_TOGGLE_ID = "sidebar-context-menu-customizer-promote-copy-links-toggle";
var PROMOTED_COPY_LINKS_ID = "sidebar-context-menu-customizer-promoted-copy-links";
var SELECTED_HEADING_ID = "sidebar-context-menu-customizer-selected-heading";
var UNSELECTED_HEADING_ID = "sidebar-context-menu-customizer-unselected-heading";
var TARGET_ATTRIBUTE = "data-sidebar-context-menu-customizer-target";
var PROMOTION_TARGET_ATTRIBUTE = "data-sidebar-context-menu-customizer-promotion-target";
var USER_HIDDEN_ATTRIBUTE = "data-sidebar-context-menu-customizer-hidden";
var EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";
var ownIds = /* @__PURE__ */ new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_MENU_ID,
  CUSTOMIZER_POPUP_ID,
  RESET_SEPARATOR_ID,
  RESET_ID,
  PROMOTE_MENU_ID,
  PROMOTE_POPUP_ID,
  PROMOTE_SHARE_MENU_ID,
  PROMOTE_SHARE_POPUP_ID,
  PROMOTE_COPY_LINKS_TOGGLE_ID,
  PROMOTED_COPY_LINKS_ID
]);
var preferenceKey = (node) => actionPreferenceKey({
  id: node.id,
  l10nId: node.getAttribute("data-l10n-id") ?? node.getAttribute("data-lazy-l10n-id"),
  command: node.getAttribute("command"),
  className: node.getAttribute("class")
});
var isAction = (node) => (node.localName === "menu" || node.localName === "menuitem") && !ownIds.has(node.id) && preferenceKey(node) !== null;
var browserShows = (node) => !node.hidden;
var fallbackLabel = (id) => id.replace(/^context_/, "").replace(/^zen-/, "").replaceAll(/[-_]+/g, " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
var itemLabel = (node) => node.getAttribute("label")?.trim() || fallbackLabel(
  node.id || node.getAttribute("data-l10n-id") || node.getAttribute("data-lazy-l10n-id") || preferenceKey(node) || "action"
);
var applyHiddenItems = (menu, hiddenIds, hideTemporarily) => {
  for (const node of menu.children) {
    const key = isAction(node) ? preferenceKey(node) : null;
    if (key && hiddenIds.has(key)) {
      hideTemporarily(node, USER_HIDDEN_ATTRIBUTE);
    } else {
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
    }
  }
};
var cleanSeparators = (menu, hideTemporarily) => {
  const nodes = [...menu.children];
  const hiddenIndexes = separatorsToHide(
    nodes.map((node) => ({
      kind: node.localName === "menuseparator" ? "separator" : "item",
      visible: browserShows(node)
    }))
  );
  for (const [index, node] of nodes.entries()) {
    if (node.localName !== "menuseparator") {
      continue;
    }
    if (hiddenIndexes.has(index)) {
      hideTemporarily(node, EMPTY_SEPARATOR_ATTRIBUTE);
    } else {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  }
};
var checkboxFor = (document, source, targetIds, selected) => {
  const checkbox = document.createXULElement("menuitem");
  checkbox.setAttribute("type", "checkbox");
  checkbox.setAttribute("closemenu", "none");
  const l10nId = source.getAttribute("data-l10n-id") ?? source.getAttribute("data-lazy-l10n-id");
  if (source.getAttribute("label") || !l10nId) {
    checkbox.setAttribute("label", itemLabel(source));
  } else {
    checkbox.setAttribute("data-l10n-id", l10nId);
  }
  checkbox.setAttribute(TARGET_ATTRIBUTE, JSON.stringify(targetIds));
  checkbox.toggleAttribute("checked", selected);
  return checkbox;
};
var targetIdsFor = (node) => {
  try {
    const parsed = JSON.parse(node.getAttribute(TARGET_ATTRIBUTE) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
};
var headingFor = (document, id, label) => {
  const heading = document.createXULElement("menuitem");
  heading.id = id;
  heading.setAttribute("label", label);
  heading.setAttribute("disabled", "true");
  return heading;
};
var installTabMenuCustomizer = (readHiddenIds, writeHiddenIds, readPromotedIds, writePromotedIds) => {
  const document = window.document;
  const tabMenu = document.getElementById(TAB_MENU_ID);
  if (!tabMenu || typeof document.createXULElement !== "function") {
    console.error("[sidebar-context-menu-customizer] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(CUSTOMIZER_SEPARATOR_ID)?.remove();
  document.getElementById(CUSTOMIZER_MENU_ID)?.remove();
  document.getElementById(PROMOTED_COPY_LINKS_ID)?.remove();
  const promotedCopyLinks = document.createXULElement("menuitem");
  promotedCopyLinks.id = PROMOTED_COPY_LINKS_ID;
  promotedCopyLinks.classList.add("menuitem-iconic");
  promotedCopyLinks.setAttribute("image", "chrome://global/skin/icons/link.svg");
  promotedCopyLinks.hidden = true;
  tabMenu.append(promotedCopyLinks);
  const customizerSeparator = document.createXULElement("menuseparator");
  customizerSeparator.id = CUSTOMIZER_SEPARATOR_ID;
  const customizerMenu = document.createXULElement("menu");
  customizerMenu.id = CUSTOMIZER_MENU_ID;
  customizerMenu.setAttribute("label", "Customize tab menu");
  const customizerPopup = document.createXULElement("menupopup");
  customizerPopup.id = CUSTOMIZER_POPUP_ID;
  customizerMenu.append(customizerPopup);
  tabMenu.append(customizerSeparator, customizerMenu);
  const browserHiddenStates = /* @__PURE__ */ new Map();
  const observer = new MutationObserver((records) => {
    const hiddenIds = currentHiddenIds();
    for (const { target } of records) {
      const node = target;
      const key = isAction(node) ? preferenceKey(node) : null;
      if (!key || !hiddenIds.has(key)) {
        continue;
      }
      browserHiddenStates.set(node, node.hidden);
      node.hidden = true;
    }
    observer.takeRecords();
  });
  const stopObserving = () => {
    observer.disconnect();
    observer.takeRecords();
  };
  const clearPresentation = () => {
    stopObserving();
    for (const [node, hidden] of browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    browserHiddenStates.clear();
    for (const node of tabMenu.children) {
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  };
  const hideTemporarily = (node, attribute) => {
    if (!browserHiddenStates.has(node)) {
      browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(attribute, "true");
    node.hidden = true;
  };
  const currentHiddenIds = () => {
    const resolved = resolveHiddenIds(
      readHiddenIds(),
      [...tabMenu.children].filter(isAction).map(preferenceKey).filter((key) => key !== null)
    );
    if (resolved.initialized) {
      writeHiddenIds(resolved.ids);
    }
    return resolved.ids;
  };
  const currentPromotedIds = () => new Set(readPromotedIds());
  const currentShareMenu = () => {
    const [primary, ...duplicates] = [...tabMenu.children].filter(
      (node) => node.classList.contains("share-tab-url-item")
    );
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
    return primary ?? null;
  };
  const updatePromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (!shareMenu) {
      promotedCopyLinks.hidden = true;
      return;
    }
    shareMenu.after(promotedCopyLinks);
    const state2 = copyLinksPromotionState(
      currentPromotedIds(),
      SharingUtils.getLinksToShare(shareMenu).length
    );
    document.l10n.setAttributes(promotedCopyLinks, "menu-share-copy-links", {
      count: state2.labelCount
    });
    promotedCopyLinks.toggleAttribute("disabled", state2.disabled);
    promotedCopyLinks.hidden = !state2.visible;
  };
  const refreshPresentation = () => {
    clearPresentation();
    updatePromotedCopyLinks();
    applyHiddenItems(tabMenu, currentHiddenIds(), hideTemporarily);
    cleanSeparators(tabMenu, hideTemporarily);
    observer.observe(tabMenu, {
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: false
    });
  };
  const rebuildCustomizer = () => {
    const hiddenIds = currentHiddenIds();
    const promotedIds = currentPromotedIds();
    customizerPopup.replaceChildren();
    const actions = [...tabMenu.children].flatMap((source) => {
      if (!isAction(source)) {
        return [];
      }
      const key = preferenceKey(source);
      return key ? [{ key, label: itemLabel(source), selected: !hiddenIds.has(key), source }] : [];
    });
    const grouped = groupCustomizationActions(coalesceCustomizationActions(actions));
    const appendGroup = (headingId, headingLabel, group) => {
      if (group.length === 0) {
        return;
      }
      if (customizerPopup.childElementCount > 0) {
        customizerPopup.append(document.createXULElement("menuseparator"));
      }
      customizerPopup.append(headingFor(document, headingId, headingLabel));
      for (const action of group) {
        const representative = action.actions[0];
        if (representative) {
          customizerPopup.append(
            checkboxFor(document, representative.source, action.keys, action.selected)
          );
        }
      }
    };
    appendGroup(SELECTED_HEADING_ID, "Selected", grouped.selected);
    appendGroup(UNSELECTED_HEADING_ID, "Not selected", grouped.unselected);
    if (customizerPopup.childElementCount > 0) {
      customizerPopup.append(document.createXULElement("menuseparator"));
    }
    const promoteMenu = document.createXULElement("menu");
    promoteMenu.id = PROMOTE_MENU_ID;
    promoteMenu.setAttribute("label", "Promote from submenu");
    const promotePopup = document.createXULElement("menupopup");
    promotePopup.id = PROMOTE_POPUP_ID;
    promoteMenu.append(promotePopup);
    const promoteShareMenu = document.createXULElement("menu");
    promoteShareMenu.id = PROMOTE_SHARE_MENU_ID;
    promoteShareMenu.setAttribute("label", "Share");
    const promoteSharePopup = document.createXULElement("menupopup");
    promoteSharePopup.id = PROMOTE_SHARE_POPUP_ID;
    promoteShareMenu.append(promoteSharePopup);
    const copyLinksToggle = document.createXULElement("menuitem");
    copyLinksToggle.id = PROMOTE_COPY_LINKS_TOGGLE_ID;
    copyLinksToggle.setAttribute("type", "checkbox");
    copyLinksToggle.setAttribute("closemenu", "none");
    copyLinksToggle.setAttribute("label", "Copy Link(s)");
    copyLinksToggle.setAttribute(PROMOTION_TARGET_ATTRIBUTE, PROMOTION_COPY_LINKS);
    copyLinksToggle.toggleAttribute("checked", promotedIds.has(PROMOTION_COPY_LINKS));
    promoteSharePopup.append(copyLinksToggle);
    promotePopup.append(promoteShareMenu);
    customizerPopup.append(promoteMenu);
    const resetSeparator = document.createXULElement("menuseparator");
    resetSeparator.id = RESET_SEPARATOR_ID;
    const reset = document.createXULElement("menuitem");
    reset.id = RESET_ID;
    reset.setAttribute("label", "Show all actions");
    reset.setAttribute("closemenu", "none");
    reset.toggleAttribute("disabled", hiddenIds.size === 0);
    customizerPopup.append(resetSeparator, reset);
  };
  const onBeforeShowing = (event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onShowing = (event) => {
    if (event.target === tabMenu) {
      refreshPresentation();
    } else if (event.target === customizerPopup) {
      rebuildCustomizer();
    }
  };
  const onHidden = (event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onCommand = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const promotionId = target.getAttribute(PROMOTION_TARGET_ATTRIBUTE);
    if (promotionId) {
      const promotedIds = currentPromotedIds();
      if (promotedIds.has(promotionId)) {
        promotedIds.delete(promotionId);
      } else {
        promotedIds.add(promotionId);
      }
      writePromotedIds(promotedIds);
      target.toggleAttribute("checked", promotedIds.has(promotionId));
      refreshPresentation();
      return;
    }
    const hiddenIds = currentHiddenIds();
    if (target.id === RESET_ID) {
      hiddenIds.clear();
    } else {
      const sourceIds = targetIdsFor(target).filter((id) => !ownIds.has(id));
      if (sourceIds.length === 0) {
        return;
      }
      const selected = sourceIds.some((id) => !hiddenIds.has(id));
      if (selected) {
        for (const id of sourceIds) {
          hiddenIds.add(id);
        }
      } else {
        for (const id of sourceIds) {
          hiddenIds.delete(id);
        }
      }
      target.toggleAttribute("checked", !selected);
    }
    writeHiddenIds(hiddenIds);
    refreshPresentation();
    if (target.id === RESET_ID) {
      rebuildCustomizer();
    }
  };
  const onPromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (shareMenu) {
      SharingUtils.copyLink(shareMenu);
    }
  };
  tabMenu.addEventListener("popupshowing", onBeforeShowing, true);
  tabMenu.addEventListener("popupshowing", onShowing);
  tabMenu.addEventListener("popuphidden", onHidden);
  customizerPopup.addEventListener("command", onCommand);
  promotedCopyLinks.addEventListener("command", onPromotedCopyLinks);
  return () => {
    tabMenu.removeEventListener("popupshowing", onBeforeShowing, true);
    tabMenu.removeEventListener("popupshowing", onShowing);
    tabMenu.removeEventListener("popuphidden", onHidden);
    customizerPopup.removeEventListener("command", onCommand);
    promotedCopyLinks.removeEventListener("command", onPromotedCopyLinks);
    clearPresentation();
    promotedCopyLinks.remove();
    customizerSeparator.remove();
    customizerMenu.remove();
  };
};

// src/platform/prefs.ts
var PREF_HIDDEN_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.hidden-items";
var PREF_TAB_ITEMS_INITIALIZED = "zen.sidebar-context-menu-customizer.tab.opt-in-initialized";
var PREF_PROMOTED_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.promoted-items";
var readHiddenTabItems = () => {
  try {
    if (!Services.prefs.prefHasUserValue(PREF_TAB_ITEMS_INITIALIZED)) {
      return null;
    }
    return decodeHiddenIds(Services.prefs.getStringPref(PREF_HIDDEN_TAB_ITEMS, "[]"));
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not read preferences", error);
    return /* @__PURE__ */ new Set();
  }
};
var writeHiddenTabItems = (ids) => {
  try {
    Services.prefs.setStringPref(PREF_HIDDEN_TAB_ITEMS, encodeHiddenIds(ids));
    Services.prefs.setBoolPref(PREF_TAB_ITEMS_INITIALIZED, true);
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not save preferences", error);
  }
};
var readPromotedTabItems = () => {
  try {
    return decodeHiddenIds(Services.prefs.getStringPref(PREF_PROMOTED_TAB_ITEMS, "[]"));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not read promoted actions",
      error
    );
    return /* @__PURE__ */ new Set();
  }
};
var writePromotedTabItems = (ids) => {
  try {
    Services.prefs.setStringPref(PREF_PROMOTED_TAB_ITEMS, encodeHiddenIds(ids));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not save promoted actions",
      error
    );
  }
};

// src/platform/sine.ts
window.zenSidebarContextMenuCustomizer ??= { disposers: [] };
var state = window.zenSidebarContextMenuCustomizer;
var runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("[sidebar-context-menu-customizer] disposer failed", error);
    }
  }
  state.disposers = [];
};
var onUnload = (teardown2) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown2);
  } else {
    console.error("[sidebar-context-menu-customizer] Sine unload hook is unavailable");
  }
};

// src/main.ts
var teardown = () => {
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
    writePromotedTabItems
  )
);
console.info("[sidebar-context-menu-customizer] ready");
