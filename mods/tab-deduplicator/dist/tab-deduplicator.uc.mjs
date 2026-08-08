// Generated from src/ by build.mjs — do not edit.

// src/core/menu.ts
var dedupeMenuState = ({
  supported: supported3,
  duplicateCount
}) => {
  if (!supported3) {
    return { label: "Deduplicate tabs (unsupported)", disabled: true };
  }
  const count = Number.isSafeInteger(duplicateCount) && duplicateCount > 0 ? duplicateCount : 0;
  if (count === 0) {
    return { label: "No duplicate tabs", disabled: true };
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

// src/core/duplicates.ts
var compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var normalizedPosition = (position) => Number.isFinite(position) ? position : Number.POSITIVE_INFINITY;
var normalizedRecency = (lastSeenActive) => Number.isFinite(lastSeenActive) ? lastSeenActive : Number.NEGATIVE_INFINITY;
var compareLanePosition = (left, right) => normalizedPosition(left.position) - normalizedPosition(right.position) || compareText(left.id, right.id);
var compareKeeperPriority = (left, right) => normalizedRecency(right.lastSeenActive) - normalizedRecency(left.lastSeenActive) || compareLanePosition(left, right);
var effectiveUrl = ({ currentUrl, pinned, pinnedUrl }) => {
  if (pinned && pinnedUrl) {
    return pinnedUrl;
  }
  return currentUrl || null;
};
var laneFacts = (facts) => {
  const spaces = /* @__PURE__ */ new Map();
  for (const fact of facts) {
    const lanes = spaces.get(fact.spaceId) ?? /* @__PURE__ */ new Map();
    spaces.set(fact.spaceId, lanes);
    const tabs = lanes.get(fact.laneId) ?? [];
    lanes.set(fact.laneId, tabs);
    tabs.push(fact);
  }
  return [...spaces.entries()].sort(([left], [right]) => compareText(left, right)).flatMap(
    ([spaceId, lanes]) => [...lanes.entries()].sort(([left], [right]) => compareText(left, right)).map(([laneId2, tabs]) => ({
      spaceId,
      laneId: laneId2,
      tabs: tabs.toSorted(compareLanePosition)
    }))
  );
};
var chooseKeeper = (tabs) => {
  const essentials = tabs.filter((tab) => tab.essential);
  const pins = tabs.filter((tab) => tab.pinned);
  const candidates = essentials.length > 0 ? essentials : pins.length > 0 ? pins : tabs;
  const keeper = candidates.toSorted(compareKeeperPriority)[0];
  if (!keeper) {
    throw new Error("Cannot choose a keeper without duplicate tabs");
  }
  return keeper;
};
var clusterLane = (lane, includePinned) => {
  const positionById = new Map(lane.tabs.map((tab, index) => [tab.id, index]));
  const tabsByUrl = /* @__PURE__ */ new Map();
  for (const tab of lane.tabs) {
    const url = effectiveUrl(tab);
    if (!url) {
      continue;
    }
    const tabsByContainer = tabsByUrl.get(url) ?? /* @__PURE__ */ new Map();
    tabsByUrl.set(url, tabsByContainer);
    const tabs = tabsByContainer.get(tab.containerId) ?? [];
    tabsByContainer.set(tab.containerId, tabs);
    tabs.push(tab);
  }
  const clusters = [];
  for (const [url, tabsByContainer] of tabsByUrl) {
    for (const [containerId, unsortedTabs] of tabsByContainer) {
      if (unsortedTabs.length < 2) {
        continue;
      }
      const tabs = unsortedTabs.toSorted(compareLanePosition);
      const keeper = chooseKeeper(tabs);
      const ordinaryCandidateIds = [];
      const pinnedCandidateIds = [];
      const protectedDuplicateIds = [];
      for (const tab of tabs) {
        if (tab.id === keeper.id) {
          continue;
        }
        if (tab.essential || tab.pinned && !includePinned) {
          protectedDuplicateIds.push(tab.id);
        } else if (tab.pinned) {
          pinnedCandidateIds.push(tab.id);
        } else {
          ordinaryCandidateIds.push(tab.id);
        }
      }
      clusters.push({
        identity: {
          url,
          containerId,
          spaceId: lane.spaceId,
          laneId: lane.laneId
        },
        tabIds: tabs.map((tab) => tab.id),
        keeperId: keeper.id,
        ordinaryCandidateIds,
        pinnedCandidateIds,
        protectedDuplicateIds
      });
    }
  }
  return clusters.toSorted((left, right) => {
    const leftPosition = positionById.get(left.keeperId) ?? Number.POSITIVE_INFINITY;
    const rightPosition = positionById.get(right.keeperId) ?? Number.POSITIVE_INFINITY;
    return leftPosition - rightPosition || compareText(left.identity.url, right.identity.url) || left.identity.containerId - right.identity.containerId;
  });
};
var groupLane = (lane, clusters, includePinned) => {
  const factsById = new Map(lane.tabs.map((tab) => [tab.id, tab]));
  const previousById = /* @__PURE__ */ new Map();
  const nextById = /* @__PURE__ */ new Map();
  for (const [index, tab] of lane.tabs.entries()) {
    previousById.set(tab.id, lane.tabs[index - 1]?.id ?? null);
    nextById.set(tab.id, lane.tabs[index + 1]?.id ?? null);
  }
  let headId = lane.tabs[0]?.id ?? null;
  const moves = [];
  for (const cluster of clusters) {
    let anchorId = cluster.keeperId;
    for (const tabId of cluster.tabIds) {
      if (tabId === cluster.keeperId) {
        continue;
      }
      const tab = factsById.get(tabId);
      if (!tab || tab.essential || tab.pinned && !includePinned) {
        continue;
      }
      if (nextById.get(anchorId) !== tabId) {
        const previousId = previousById.get(tabId) ?? null;
        const nextId = nextById.get(tabId) ?? null;
        if (previousId) {
          nextById.set(previousId, nextId);
        } else {
          headId = nextId;
        }
        if (nextId) {
          previousById.set(nextId, previousId);
        }
        const nextAnchorId = nextById.get(anchorId) ?? null;
        nextById.set(anchorId, tabId);
        previousById.set(tabId, anchorId);
        nextById.set(tabId, nextAnchorId);
        if (nextAnchorId) {
          previousById.set(nextAnchorId, tabId);
        }
        moves.push({ tabId, afterTabId: anchorId, laneId: lane.laneId });
      }
      anchorId = tabId;
    }
  }
  const currentOrder = [];
  while (headId) {
    currentOrder.push(headId);
    headId = nextById.get(headId) ?? null;
  }
  return { moves, currentOrder };
};
var planDuplicates = (facts, { includePinned = false } = {}) => {
  const clusters = [];
  const moves = [];
  const laneOrders = [];
  for (const lane of laneFacts(facts)) {
    const laneClusters = clusterLane(lane, includePinned);
    if (laneClusters.length === 0) {
      continue;
    }
    clusters.push(...laneClusters);
    const grouping = groupLane(lane, laneClusters, includePinned);
    moves.push(...grouping.moves);
    laneOrders.push({
      spaceId: lane.spaceId,
      laneId: lane.laneId,
      tabIds: grouping.currentOrder
    });
  }
  return {
    clusters,
    ordinaryCandidateIds: clusters.flatMap((cluster) => cluster.ordinaryCandidateIds),
    pinnedCandidateIds: clusters.flatMap((cluster) => cluster.pinnedCandidateIds),
    protectedDuplicateIds: clusters.flatMap((cluster) => cluster.protectedDuplicateIds),
    moves,
    laneOrders
  };
};

// src/core/folder-menu.ts
var safeCount = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
var folderGroupingMenuState = ({
  supported: supported3,
  moveCount: rawMoveCount,
  pinnedMoveCount: rawPinnedMoveCount
}) => {
  if (!supported3) {
    return { label: "Group duplicate tabs (unsupported)", disabled: true };
  }
  const moveCount = safeCount(rawMoveCount);
  if (moveCount > 0) {
    return {
      label: `Group ${moveCount} duplicate tab${moveCount === 1 ? "" : "s"} in this folder`,
      disabled: false
    };
  }
  if (safeCount(rawPinnedMoveCount) > 0) {
    return {
      label: "Enable pinned tabs to group duplicates in this folder",
      disabled: true
    };
  }
  return {
    label: "No duplicate tabs to group in this folder",
    disabled: true
  };
};

// src/platform/snapshot.ts
var CURRENT_SPACE_ID = "current-space";
var TOP_LEVEL_PINNED_LANE = "top-level-pinned";
var TOP_LEVEL_ORDINARY_LANE = "top-level-ordinary";
var generatedIds = /* @__PURE__ */ new WeakMap();
var nextGeneratedId = 1;
var nonEmptyString = (value) => typeof value === "string" && value.length > 0 ? value : null;
var runtimeId = (tab) => {
  const browserId = nonEmptyString(tab.id);
  if (browserId) {
    return browserId;
  }
  const existing = generatedIds.get(tab);
  if (existing) {
    return existing;
  }
  const generated = `tab-deduplicator-tab-${nextGeneratedId++}`;
  generatedIds.set(tab, generated);
  return generated;
};
var folderLaneId = (folderId) => `folder:${folderId}`;
var isSplitViewTab = (tab) => tab.group?.hasAttribute("split-view-group") ?? false;
var enclosingZenFolder = (tab) => {
  const immediateGroup = tab.group;
  const candidate = isSplitViewTab(tab) ? immediateGroup?.group : immediateGroup;
  return candidate?.isZenFolder && nonEmptyString(candidate.id) ? candidate : null;
};
var laneId = (tab) => {
  const folder = enclosingZenFolder(tab);
  if (folder) {
    return folderLaneId(folder.id);
  }
  return tab.pinned || tab.hasAttribute("zen-essential") ? TOP_LEVEL_PINNED_LANE : TOP_LEVEL_ORDINARY_LANE;
};
var tabFacts = (tab, position) => ({
  id: runtimeId(tab),
  currentUrl: nonEmptyString(tab.linkedBrowser?.currentURI?.spec),
  pinnedUrl: nonEmptyString(tab._zenPinnedInitialState?.entry?.url),
  containerId: tab.userContextId,
  spaceId: CURRENT_SPACE_ID,
  laneId: laneId(tab),
  pinned: tab.pinned,
  essential: tab.hasAttribute("zen-essential"),
  lastSeenActive: tab.lastSeenActive,
  position
});
var snapshotDuplicateTabs = (tabs = gBrowser.tabs) => {
  const facts = [];
  const tabsById = /* @__PURE__ */ new Map();
  for (const [position, tab] of tabs.entries()) {
    const fact = tabFacts(tab, position);
    facts.push(fact);
    tabsById.set(fact.id, tab);
  }
  return { facts, tabsById };
};

// src/platform/folder-menu.ts
var ITEM_ID = "tab-deduplicator-group-folder";
var MENU_ID = "zenFolderActions";
var ANCHOR_ID = "context_zenFolderUnloadAll";
var contextNode = (value) => typeof value === "object" && value !== null ? value : null;
var zenFolder = (value) => {
  const candidate = contextNode(value);
  return candidate?.isZenFolder === true && typeof candidate.id === "string" && candidate.id.length > 0 ? candidate : null;
};
var isLabel = (value, check) => {
  try {
    return check(value);
  } catch {
    return false;
  }
};
var resolveFolderContextTarget = (target, isTabGroupLabel) => {
  const candidate = contextNode(target);
  if (!candidate) {
    return null;
  }
  if (isLabel(target, isTabGroupLabel)) {
    return zenFolder(candidate.group);
  }
  const parent = contextNode(candidate.parentElement);
  if (parent && isLabel(parent, isTabGroupLabel)) {
    return zenFolder(parent.group);
  }
  if (candidate.classList?.contains("tab-group-label-container")) {
    return zenFolder(candidate.parentElement);
  }
  return null;
};
var validFolderMove = (move, tabsById) => {
  const tab = tabsById.get(move.tabId);
  const anchor = tabsById.get(move.afterTabId);
  if (!tab || !anchor || isSplitViewTab(tab) || isSplitViewTab(anchor)) {
    return null;
  }
  const tabFolder = enclosingZenFolder(tab);
  const anchorFolder = enclosingZenFolder(anchor);
  if (!tabFolder || !anchorFolder || tabFolder.id !== anchorFolder.id || move.laneId !== folderLaneId(tabFolder.id)) {
    return null;
  }
  return { tab, anchor };
};
var executableFolderMoves = (moves, tabsById) => moves.filter((move) => validFolderMove(move, tabsById) !== null);
var applyFolderMoves = (moves, tabsById, moveAfter) => {
  let moved = 0;
  for (const move of moves) {
    const live = validFolderMove(move, tabsById);
    if (!live) {
      continue;
    }
    moveAfter(live.tab, live.anchor);
    moved += 1;
  }
  return moved;
};
var currentFolderPlan = (folderId, includePinned) => {
  const snapshot = snapshotDuplicateTabs();
  const laneId2 = folderLaneId(folderId);
  const plan = planDuplicates(snapshot.facts, { includePinned });
  const moves = executableFolderMoves(
    plan.moves.filter((move) => move.laneId === laneId2),
    snapshot.tabsById
  );
  if (includePinned || moves.length > 0) {
    return { moves, tabsById: snapshot.tabsById, pinnedMoveCount: 0 };
  }
  const withPinned = planDuplicates(snapshot.facts, { includePinned: true });
  const pinnedMoves = executableFolderMoves(
    withPinned.moves.filter((move) => move.laneId === laneId2),
    snapshot.tabsById
  );
  return {
    moves,
    tabsById: snapshot.tabsById,
    pinnedMoveCount: pinnedMoves.length
  };
};
var supported2 = () => typeof gBrowser.moveTabAfter === "function" && typeof gBrowser.isTabGroupLabel === "function";
var installFolderGroupingMenuItem = (readIncludePinned) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] folder context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID}" hidden="true" disabled="true"/>`
  );
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] folder menu item insertion failed");
    return () => {
    };
  }
  let currentFolderId = null;
  const clearFolder = () => {
    currentFolderId = null;
    item.setAttribute("hidden", "true");
    item.setAttribute("disabled", "true");
  };
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const folder = resolveFolderContextTarget(
        event.explicitOriginalTarget,
        (target) => gBrowser.isTabGroupLabel?.(target) ?? false
      );
      if (!folder) {
        clearFolder();
        return;
      }
      currentFolderId = folder.id;
      const isSupported = supported2();
      const plan = isSupported ? currentFolderPlan(folder.id, readIncludePinned()) : { moves: [], pinnedMoveCount: 0 };
      const next = folderGroupingMenuState({
        supported: isSupported,
        moveCount: plan.moves.length,
        pinnedMoveCount: plan.pinnedMoveCount
      });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
      item.removeAttribute("hidden");
    } catch (error) {
      item.setAttribute("label", "Group duplicate tabs (unavailable)");
      item.setAttribute("disabled", "true");
      item.removeAttribute("hidden");
      console.error("[tab-deduplicator] could not inspect folder duplicates", error);
    }
  };
  const onCommand = () => {
    const moveAfter = gBrowser.moveTabAfter;
    if (!currentFolderId || !supported2() || !moveAfter) {
      return;
    }
    try {
      const plan = currentFolderPlan(currentFolderId, readIncludePinned());
      applyFolderMoves(
        plan.moves,
        plan.tabsById,
        (tab, anchor2) => moveAfter.call(gBrowser, tab, anchor2)
      );
    } catch (error) {
      console.error("[tab-deduplicator] could not group folder duplicates", error);
    }
  };
  const onHidden = (event) => {
    if (event.target === menu) {
      clearFolder();
    }
  };
  menu.addEventListener("popupshowing", onShowing);
  menu.addEventListener("popuphidden", onHidden);
  item.addEventListener("command", onCommand);
  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    menu.removeEventListener("popuphidden", onHidden);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};

// src/platform/menu.ts
var ITEM_ID2 = "tab-deduplicator-context-item";
var MENU_ID2 = "tabContextMenu";
var ANCHOR_ID2 = "context_closeDuplicateTabs";
var installDedupeMenuItem = (readState, run) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID2);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID2)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(`<menuitem id="${ITEM_ID2}"/>`);
  const anchor = document.getElementById(ANCHOR_ID2);
  if (anchor) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID2);
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

// src/core/defaults.ts
var PREF_INCLUDE_PINNED = "zen.tab-deduplicator.include-pinned";
var DEFAULT_INCLUDE_PINNED = false;

// src/platform/prefs.ts
var readIncludePinnedPreference = (read = (name, fallback) => Services.prefs.getBoolPref(name, fallback)) => {
  try {
    const value = read(PREF_INCLUDE_PINNED, DEFAULT_INCLUDE_PINNED);
    return typeof value === "boolean" ? value : DEFAULT_INCLUDE_PINNED;
  } catch (error) {
    console.error("[tab-deduplicator] could not read pinned-tab preference", error);
    return DEFAULT_INCLUDE_PINNED;
  }
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
  installDedupeMenuItem(() => dedupeMenuState(duplicateFacts()), closeDuplicateTabs),
  installFolderGroupingMenuItem(readIncludePinnedPreference)
);
console.info("[tab-deduplicator] ready");
