// Generated from src/ by build.mjs — do not edit.

// src/core/folder-menu.ts
var safeCount = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
var folderGroupingMenuState = ({
  supported: supported2,
  moveCount: rawMoveCount
}) => {
  const moveCount = safeCount(rawMoveCount);
  return {
    label: "Group Duplicate Tabs",
    disabled: !supported2 || moveCount === 0
  };
};
var folderCloseMenuState = ({
  supported: supported2,
  candidateCount: rawCandidateCount
}) => {
  const candidateCount = safeCount(rawCandidateCount);
  return {
    label: "Close Duplicate Tabs",
    disabled: !supported2 || candidateCount === 0
  };
};

// src/core/duplicates.ts
var compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var normalizedPosition = (position) => Number.isFinite(position) ? position : Number.POSITIVE_INFINITY;
var normalizedRecency = (lastSeenActive) => Number.isFinite(lastSeenActive) ? lastSeenActive : Number.NEGATIVE_INFINITY;
var compareLanePosition = (left, right) => normalizedPosition(left.position) - normalizedPosition(right.position) || compareText(left.id, right.id);
var compareKeeperPriority = (left, right) => normalizedRecency(right.lastSeenActive) - normalizedRecency(left.lastSeenActive) || compareLanePosition(left, right);
var effectiveUrl = ({ currentUrl: currentUrl2, pinned, pinnedUrl }) => {
  const blankPinnedPlaceholder = pinnedUrl === "about:blank" && currentUrl2 !== null && currentUrl2 !== "about:blank";
  if (pinned && pinnedUrl && !blankPinnedPlaceholder) {
    return pinnedUrl;
  }
  return currentUrl2 || null;
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
    ([spaceId, lanes]) => [...lanes.entries()].sort(([left], [right]) => compareText(left, right)).map(([laneId, tabs]) => ({
      spaceId,
      laneId,
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

// src/core/review.ts
var defaultLaneLabel = (laneId) => {
  if (laneId.startsWith("folder:")) {
    return "Folder";
  }
  return laneId === "top-level-pinned" ? "Pinned tabs" : "Other tabs";
};
var clusterKey = ({ identity }) => [identity.spaceId, identity.laneId, identity.containerId, identity.url].join("\0");
var buildCloseReview = ({
  scope,
  plan,
  facts,
  labels,
  allowPinnedClose
}) => {
  const factsById = new Map(facts.map((item) => [item.id, item]));
  const groups = plan.clusters.map((cluster) => {
    const ordinary = new Set(cluster.ordinaryCandidateIds);
    const pinned = new Set(cluster.pinnedCandidateIds);
    const protectedIds = new Set(cluster.protectedDuplicateIds);
    const firstLabel = cluster.tabIds.map((id) => labels.get(id)?.laneLabel).find((label) => label && label.length > 0);
    const rows2 = cluster.tabIds.map((id) => {
      const fact = factsById.get(id);
      const label = labels.get(id);
      let state = "keeping";
      if (ordinary.has(id)) {
        state = "closing";
      } else if (pinned.has(id)) {
        state = allowPinnedClose ? "pinned-choice" : "protected";
      } else if (protectedIds.has(id)) {
        state = "protected";
      }
      return {
        id,
        title: label?.title || cluster.identity.url,
        state,
        pinned: fact?.pinned ?? pinned.has(id),
        essential: fact?.essential ?? false
      };
    });
    return {
      key: clusterKey(cluster),
      url: cluster.identity.url,
      containerId: cluster.identity.containerId,
      laneLabel: firstLabel || defaultLaneLabel(cluster.identity.laneId),
      rows: rows2
    };
  });
  const rows = groups.flatMap((group) => group.rows);
  const ordinaryCount = rows.filter((row) => row.state === "closing").length;
  const pinnedChoiceCount = rows.filter((row) => row.state === "pinned-choice").length;
  return {
    scope,
    groups,
    ordinaryCount,
    pinnedChoiceCount,
    stayingCount: rows.length - ordinaryCount
  };
};
var closeIdsForReview = (review, decision) => {
  if (decision.kind === "cancel") {
    return [];
  }
  return review.groups.flatMap(
    (group) => group.rows.filter(
      (row) => row.state === "closing" || decision.includePinned && row.state === "pinned-choice"
    ).map((row) => row.id)
  );
};
var closeReviewSignature = (review) => JSON.stringify({
  scope: review.scope,
  groups: review.groups.map((group) => ({
    key: group.key,
    rows: group.rows.map((row) => [row.id, row.state])
  }))
});
var runCloseReview = async ({
  initial,
  refresh,
  present,
  close,
  isLive
}) => {
  let shown = initial;
  let changed = false;
  while (isLive()) {
    const decision = await present(shown.review, { changed });
    if (!isLive() || decision.kind === "cancel") {
      return false;
    }
    const fresh = refresh();
    if (closeReviewSignature(fresh.review) !== closeReviewSignature(shown.review)) {
      shown = fresh;
      changed = true;
      continue;
    }
    const ids = closeIdsForReview(fresh.review, decision);
    const candidates = ids.flatMap((id) => {
      const candidate = fresh.candidatesById.get(id);
      return candidate === void 0 ? [] : [candidate];
    });
    if (ids.length === 0 || candidates.length !== ids.length) {
      return false;
    }
    close(candidates);
    return true;
  }
  return false;
};

// src/platform/snapshot.ts
var CURRENT_SPACE_ID = "current-space";
var TOP_LEVEL_PINNED_LANE = "top-level-pinned";
var TOP_LEVEL_ORDINARY_LANE = "top-level-ordinary";
var generatedIds = /* @__PURE__ */ new WeakMap();
var nextGeneratedId = 1;
var nonEmptyString = (value) => typeof value === "string" && value.length > 0 ? value : null;
var cachedSessionStore = null;
var browserSessionStore = () => {
  if (cachedSessionStore) {
    return cachedSessionStore;
  }
  try {
    cachedSessionStore = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore;
  } catch {
    return null;
  }
  return cachedSessionStore;
};
var stateUrl = (json) => {
  try {
    const state = JSON.parse(json);
    if (!Array.isArray(state?.entries) || state.entries.length === 0) {
      return null;
    }
    const requested = typeof state.index === "number" ? state.index : state.entries.length;
    const index = Math.min(Math.max(requested - 1, 0), state.entries.length - 1);
    return nonEmptyString(state.entries[index]?.url);
  } catch {
    return null;
  }
};
var currentUrl = (tab, provided) => {
  let live = tab.linkedPanel ? nonEmptyString(tab.linkedBrowser?.currentURI?.spec) : null;
  let reader = provided;
  if (!tab.linkedPanel) {
    reader ??= browserSessionStore();
    live = nonEmptyString(reader?.getLazyTabValue(tab, "url"));
  }
  if (live && live !== "about:blank") {
    return live;
  }
  reader ??= browserSessionStore();
  if (!reader) {
    return live;
  }
  try {
    const stored = stateUrl(reader.getTabState(tab));
    return stored && stored !== "about:blank" ? stored : live;
  } catch {
    return live;
  }
};
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
var tabLaneId = (tab) => {
  const folder = enclosingZenFolder(tab);
  if (folder) {
    return folderLaneId(folder.id);
  }
  return tab.pinned || tab.hasAttribute("zen-essential") ? TOP_LEVEL_PINNED_LANE : TOP_LEVEL_ORDINARY_LANE;
};
var tabFacts = (tab, position, sessionStore) => ({
  id: runtimeId(tab),
  currentUrl: currentUrl(tab, sessionStore),
  pinnedUrl: nonEmptyString(tab._zenPinnedInitialState?.entry?.url),
  containerId: tab.userContextId,
  spaceId: CURRENT_SPACE_ID,
  laneId: tabLaneId(tab),
  pinned: tab.pinned,
  essential: tab.hasAttribute("zen-essential"),
  lastSeenActive: tab.lastSeenActive,
  position
});
var snapshotDuplicateTabs = (tabs = gBrowser.tabs, sessionStore) => {
  const facts = [];
  const tabsById = /* @__PURE__ */ new Map();
  for (const [position, tab] of tabs.entries()) {
    const fact = tabFacts(tab, position, sessionStore);
    facts.push(fact);
    tabsById.set(fact.id, tab);
  }
  return { facts, tabsById };
};

// src/platform/review.ts
var nonEmpty = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
var tabReviewLabel = (tab) => ({
  title: nonEmpty(tab.label) ?? "Untitled tab",
  laneLabel: nonEmpty(enclosingZenFolder(tab)?.label) ?? (tab.pinned || tab.hasAttribute("zen-essential") ? "Pinned tabs" : "Other tabs")
});
var scopedPlan = (plan, laneId) => {
  const clusters = laneId ? plan.clusters.filter((cluster) => cluster.identity.laneId === laneId) : plan.clusters;
  return {
    clusters,
    ordinaryCandidateIds: clusters.flatMap((cluster) => cluster.ordinaryCandidateIds),
    pinnedCandidateIds: clusters.flatMap((cluster) => cluster.pinnedCandidateIds),
    protectedDuplicateIds: clusters.flatMap((cluster) => cluster.protectedDuplicateIds),
    moves: [],
    laneOrders: []
  };
};
var liveCandidate = (tab, laneId, pinned) => Boolean(
  tab && tab.pinned === pinned && !tab.hasAttribute("zen-essential") && tabLaneId(tab) === laneId
);
var buildCurrentCloseReview = (request, snapshot = snapshotDuplicateTabs()) => {
  const plan = scopedPlan(
    planDuplicates(snapshot.facts, { includePinned: true }),
    request.scope === "folder" ? request.laneId : void 0
  );
  const labels = new Map(
    plan.clusters.flatMap(
      (cluster) => cluster.tabIds.flatMap((id) => {
        const tab = snapshot.tabsById.get(id);
        return tab ? [[id, tabReviewLabel(tab)]] : [];
      })
    )
  );
  const review = buildCloseReview({
    scope: request.scope,
    plan,
    facts: snapshot.facts,
    labels,
    allowPinnedClose: request.allowPinnedClose
  });
  const candidatesById = /* @__PURE__ */ new Map();
  for (const cluster of plan.clusters) {
    for (const id of cluster.ordinaryCandidateIds) {
      const tab = snapshot.tabsById.get(id);
      if (liveCandidate(tab, cluster.identity.laneId, false)) {
        candidatesById.set(id, tab);
      }
    }
    for (const id of cluster.pinnedCandidateIds) {
      const tab = snapshot.tabsById.get(id);
      if (liveCandidate(tab, cluster.identity.laneId, true)) {
        candidatesById.set(id, tab);
      }
    }
  }
  return { review, candidatesById };
};

// src/platform/folder-commands.ts
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
var closeFolderCandidates = (confirmationAnchor, candidates, closingTabsType, close) => {
  if (candidates.length === 0) {
    return false;
  }
  close(confirmationAnchor, [...candidates], closingTabsType);
  return true;
};
var closeCurrentFolderDuplicates = (folder, includePinned, presenter, isLive, closeType, close) => {
  const request = {
    scope: "folder",
    laneId: folderLaneId(folder.id),
    allowPinnedClose: includePinned
  };
  return runCloseReview({
    initial: buildCurrentCloseReview(request),
    refresh: () => buildCurrentCloseReview(request),
    present: (review, status) => presenter.show(review, status),
    close: (candidates) => {
      closeFolderCandidates(folder, candidates, closeType, close);
    },
    isLive
  });
};
var currentFolderPlan = (folderId, includePinned) => {
  const snapshot = snapshotDuplicateTabs();
  const laneId = folderLaneId(folderId);
  const plan = planDuplicates(snapshot.facts, { includePinned });
  const moves = executableFolderMoves(
    plan.moves.filter((move) => move.laneId === laneId),
    snapshot.tabsById
  );
  if (includePinned || moves.length > 0) {
    return { moves, tabsById: snapshot.tabsById, pinnedMoveCount: 0 };
  }
  const withPinned = planDuplicates(snapshot.facts, { includePinned: true });
  const pinnedMoves = executableFolderMoves(
    withPinned.moves.filter((move) => move.laneId === laneId),
    snapshot.tabsById
  );
  return {
    moves,
    tabsById: snapshot.tabsById,
    pinnedMoveCount: pinnedMoves.length
  };
};

// src/platform/folder-menu.ts
var ITEM_ID = "tab-deduplicator-group-folder";
var CLOSE_ITEM_ID = "tab-deduplicator-close-folder";
var MENU_ID = "zenFolderActions";
var ANCHOR_ID = "context_zenFolderUnloadAll";
var supported = () => typeof gBrowser.moveTabAfter === "function" && typeof gBrowser.isTabGroupLabel === "function";
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
      const isSupported = supported();
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
      item.setAttribute("label", "Group Duplicate Tabs");
      item.setAttribute("disabled", "true");
      item.removeAttribute("hidden");
      console.error("[tab-deduplicator] could not inspect folder duplicates", error);
    }
  };
  const onCommand = () => {
    const moveAfter = gBrowser.moveTabAfter;
    if (!currentFolderId || !supported() || !moveAfter) {
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
var installFolderCloseMenuItem = (readIncludePinned, presenter, isLive) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] folder context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(CLOSE_ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${CLOSE_ITEM_ID}" hidden="true" disabled="true"/>`
  );
  const groupItem = document.getElementById(ITEM_ID);
  const anchor = document.getElementById(ANCHOR_ID);
  if (groupItem?.parentElement === menu) {
    groupItem.after(fragment);
  } else if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(CLOSE_ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] folder close item insertion failed");
    return () => {
    };
  }
  let currentFolder = null;
  const supported2 = () => typeof gBrowser._removeDuplicateTabs === "function" && typeof gBrowser.closingTabsEnum?.DUPLICATES === "number" && typeof gBrowser.isTabGroupLabel === "function";
  const clearFolder = () => {
    currentFolder = null;
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
      currentFolder = folder;
      const isSupported = supported2();
      let candidateCount = 0;
      if (isSupported) {
        const review = buildCurrentCloseReview({
          scope: "folder",
          laneId: folderLaneId(folder.id),
          allowPinnedClose: readIncludePinned()
        }).review;
        candidateCount = review.ordinaryCount + review.pinnedChoiceCount;
      }
      const next = folderCloseMenuState({ supported: isSupported, candidateCount });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
      item.removeAttribute("hidden");
    } catch (error) {
      item.setAttribute("label", "Close Duplicate Tabs");
      item.setAttribute("disabled", "true");
      item.removeAttribute("hidden");
      console.error(
        "[tab-deduplicator] could not inspect folder close candidates",
        error
      );
    }
  };
  const onCommand = () => {
    const close = gBrowser._removeDuplicateTabs;
    const closeType = gBrowser.closingTabsEnum?.DUPLICATES;
    if (!currentFolder || !close || typeof closeType !== "number") {
      return;
    }
    try {
      const folder = currentFolder;
      void closeCurrentFolderDuplicates(
        folder,
        readIncludePinned(),
        presenter,
        isLive,
        closeType,
        (anchor2, tabs, type) => close.call(gBrowser, anchor2, tabs, type)
      ).catch((error) => {
        console.error("[tab-deduplicator] could not review folder duplicates", error);
      });
    } catch (error) {
      console.error("[tab-deduplicator] could not close folder duplicates", error);
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

// src/platform/superseded.ts
var supersedeMenuAction = (element) => {
  const node = element;
  const originalHidden = node.hidden;
  const apply = () => {
    node.hidden = true;
  };
  apply();
  return {
    apply,
    restore() {
      node.hidden = originalHidden;
    }
  };
};

// src/platform/menu.ts
var ITEM_ID2 = "tab-deduplicator-context-item";
var MENU_ID2 = "tabContextMenu";
var ANCHOR_ID2 = "context_closeDuplicateTabs";
var TOOLBAR_ITEM_ID = "tab-deduplicator-toolbar-context-item";
var TOOLBAR_MENU_ID = "toolbar-context-menu";
var TOOLBAR_ANCHOR_ID = "toolbar-context-undoCloseTab";
var installMenuAction = (options, readState, run) => {
  const document = window.document;
  const menu = document.getElementById(options.menuId);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(options.itemId)?.remove();
  const contextType = options.contextType ? ` contexttype="${options.contextType}"` : "";
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${options.itemId}"${contextType}/>`
  );
  const anchor = document.getElementById(options.anchorId);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(options.itemId);
  if (!item) {
    console.error("[tab-deduplicator] menu item insertion failed");
    return () => {
    };
  }
  const superseded = options.supersededActionId ? document.getElementById(options.supersededActionId) : null;
  const nativePresentation = superseded ? supersedeMenuAction(superseded) : null;
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      nativePresentation?.apply();
      const next = readState();
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
    } catch (error) {
      item.setAttribute("label", "Close Duplicate Tabs");
      item.setAttribute("disabled", "true");
      console.error("[tab-deduplicator] could not inspect tabs", error);
    }
  };
  const onCommand = () => {
    const confirmationAnchor = options.confirmationAnchor(item);
    void Promise.resolve().then(() => run(confirmationAnchor)).catch((error) => {
      console.error("[tab-deduplicator] could not close duplicate tabs", error);
    });
  };
  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);
  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
    nativePresentation?.restore();
  };
};
var installDedupeMenuItem = (readState, run) => installMenuAction(
  {
    anchorId: ANCHOR_ID2,
    confirmationAnchor: (item) => window.TabContextMenu?.contextTab ?? item,
    itemId: ITEM_ID2,
    menuId: MENU_ID2,
    supersededActionId: ANCHOR_ID2
  },
  readState,
  run
);
var installEmptySidebarDedupeMenuItem = (readState, run) => installMenuAction(
  {
    anchorId: TOOLBAR_ANCHOR_ID,
    confirmationAnchor: (item) => item,
    contextType: "tabbar",
    itemId: TOOLBAR_ITEM_ID,
    menuId: TOOLBAR_MENU_ID
  },
  readState,
  run
);

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

// src/platform/review-dialog.ts
var DIALOG_ID = "tab-deduplicator-review";
var XHTML = "http://www.w3.org/1999/xhtml";
var create = (document, name, className) => {
  const element = document.createElementNS(XHTML, name);
  element.className = className;
  return element;
};
var createButton = (document, className, type) => {
  const button = document.createElementNS(XHTML, "moz-button");
  button.className = className;
  button.setAttribute("type", type);
  button.setAttribute("size", "small");
  return button;
};
var countLabel = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;
var rowDetail = (row) => {
  if (row.essential) {
    return "Essential";
  }
  return row.pinned ? "Pinned" : null;
};
var staticStateLabel = (row) => {
  if (row.state === "closing") {
    return "Close";
  }
  if (row.state === "protected") {
    return "Protected";
  }
  return "Keep";
};
var installCloseReviewDialog = ({
  document,
  isLive
}) => {
  const stale = document.getElementById(DIALOG_ID);
  stale?.dispatchEvent(new Event("tab-deduplicator-review-replaced"));
  stale?.remove();
  const dialog = create(document, "dialog", "tab-deduplicator-review");
  dialog.id = DIALOG_ID;
  dialog.setAttribute("aria-labelledby", `${DIALOG_ID}-title`);
  dialog.setAttribute("aria-describedby", `${DIALOG_ID}-summary ${DIALOG_ID}-changed`);
  const surface = create(document, "article", "tab-deduplicator-review-surface");
  const header = create(document, "header", "tab-deduplicator-review-header");
  const title = create(document, "h1", "tab-deduplicator-review-title");
  title.id = `${DIALOG_ID}-title`;
  title.textContent = "Review duplicates";
  const summary = create(document, "p", "tab-deduplicator-review-summary");
  summary.id = `${DIALOG_ID}-summary`;
  const changed = create(document, "p", "tab-deduplicator-review-changed");
  changed.id = `${DIALOG_ID}-changed`;
  changed.textContent = "The duplicate set changed. Review the updated tabs.";
  header.append(title, summary, changed);
  const groups = create(document, "div", "tab-deduplicator-review-groups");
  const pinnedControl = create(
    document,
    "label",
    "tab-deduplicator-review-pinned-control"
  );
  const pinnedChoice = create(document, "input", "tab-deduplicator-review-pinned-choice");
  pinnedChoice.type = "checkbox";
  const pinnedLabel = create(document, "span", "tab-deduplicator-review-pinned-label");
  pinnedControl.append(pinnedChoice, pinnedLabel);
  const footer = create(document, "footer", "tab-deduplicator-review-footer");
  const cancel = createButton(document, "tab-deduplicator-review-cancel", "default");
  cancel.textContent = "Cancel";
  const confirm = createButton(document, "tab-deduplicator-review-confirm", "primary");
  footer.append(cancel, confirm);
  surface.append(header, groups, pinnedControl, footer);
  dialog.append(surface);
  document.documentElement.append(dialog);
  let active = true;
  let pending = null;
  let currentReview = null;
  let pinnedRows = [];
  const closeCount = () => (currentReview?.ordinaryCount ?? 0) + (pinnedChoice.checked ? currentReview?.pinnedChoiceCount ?? 0 : 0);
  const updateChoice = () => {
    const review = currentReview;
    if (!review) {
      return;
    }
    const closing = closeCount();
    const total = review.groups.reduce((count, group) => count + group.rows.length, 0);
    summary.textContent = `${countLabel(closing, "tab")} will close. ${total - closing} will stay.`;
    confirm.textContent = `Close ${countLabel(closing, "tab")}`;
    confirm.disabled = closing === 0;
    for (const item of pinnedRows) {
      item.row.dataset.state = pinnedChoice.checked ? "closing" : "keeping";
      item.status.textContent = pinnedChoice.checked ? "Closing" : "Keeping";
    }
  };
  const render = (review, wasChanged) => {
    currentReview = review;
    pinnedRows = [];
    pinnedChoice.checked = review.pinnedChoiceCount > 0;
    changed.hidden = !wasChanged;
    pinnedControl.hidden = review.pinnedChoiceCount === 0;
    pinnedLabel.textContent = `Include ${countLabel(review.pinnedChoiceCount, "pinned duplicate")}`;
    const groupNodes = review.groups.map((group) => {
      const section = create(document, "section", "tab-deduplicator-review-group");
      const groupHeader = create(document, "div", "tab-deduplicator-review-group-header");
      const groupTitle = create(document, "h2", "tab-deduplicator-review-group-title");
      groupTitle.textContent = group.url;
      groupTitle.title = group.url;
      const context = create(document, "p", "tab-deduplicator-review-context");
      context.textContent = group.containerId > 0 ? `${group.laneLabel} · Container ${group.containerId}` : group.laneLabel;
      const url = create(document, "p", "tab-deduplicator-review-url");
      url.textContent = countLabel(group.rows.length, "copy");
      groupHeader.append(context, groupTitle, url);
      const rows = create(document, "div", "tab-deduplicator-review-rows");
      for (const row of group.rows) {
        const rowNode = create(document, "div", "tab-deduplicator-review-row");
        rowNode.dataset.state = row.state;
        if (row.state === "pinned-choice") {
          rowNode.className += " tab-deduplicator-review-row-pinned";
        }
        const copy = create(document, "div", "tab-deduplicator-review-row-copy");
        const rowTitle = create(document, "span", "tab-deduplicator-review-row-title");
        rowTitle.textContent = row.title;
        rowTitle.title = row.title;
        copy.append(rowTitle);
        const detailText = rowDetail(row);
        if (detailText) {
          const detail = create(document, "span", "tab-deduplicator-review-row-detail");
          detail.textContent = detailText;
          copy.append(detail);
        }
        const state = create(document, "span", "tab-deduplicator-review-row-state");
        state.textContent = staticStateLabel(row);
        rowNode.append(copy, state);
        rows.append(rowNode);
        if (row.state === "pinned-choice") {
          pinnedRows.push({ row: rowNode, status: state });
        }
      }
      section.append(groupHeader, rows);
      return section;
    });
    groups.replaceChildren(...groupNodes);
    updateChoice();
  };
  const settle = (decision, closeDialog = true) => {
    const resolve = pending;
    if (!resolve) {
      return;
    }
    pending = null;
    if (closeDialog && dialog.open) {
      dialog.close();
    }
    resolve(decision);
  };
  const onCancel = (event) => {
    event.preventDefault();
    settle({ kind: "cancel" });
  };
  const onClose = () => settle({ kind: "cancel" }, false);
  const onCancelClick = () => settle({ kind: "cancel" });
  const onConfirmClick = () => settle({ kind: "confirm", includePinned: pinnedChoice.checked });
  const onReplaced = () => settle({ kind: "cancel" }, false);
  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", onClose);
  dialog.addEventListener("tab-deduplicator-review-replaced", onReplaced);
  cancel.addEventListener("click", onCancelClick);
  confirm.addEventListener("click", onConfirmClick);
  pinnedChoice.addEventListener("change", updateChoice);
  return {
    show(review, status) {
      if (!active || !isLive()) {
        return Promise.resolve({ kind: "cancel" });
      }
      settle({ kind: "cancel" });
      render(review, status.changed);
      return new Promise((resolve, reject) => {
        pending = resolve;
        try {
          dialog.showModal();
          cancel.focus();
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    },
    dispose() {
      if (!active) {
        return;
      }
      active = false;
      settle({ kind: "cancel" });
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("tab-deduplicator-review-replaced", onReplaced);
      cancel.removeEventListener("click", onCancelClick);
      confirm.removeEventListener("click", onConfirmClick);
      pinnedChoice.removeEventListener("change", updateChoice);
      dialog.remove();
    }
  };
};

// ../../packages/sine-lifecycle/dist/errors.js
var isThenable = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var safeReporter = (report = () => {
}) => (error) => {
  try {
    const result = report(error);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {
      });
    }
  } catch {
  }
};
var synchronousDisposer = (disposer, report) => () => {
  const result = disposer();
  if (!isThenable(result)) {
    return;
  }
  void Promise.resolve(result).catch(report);
  throw new TypeError("lifecycle disposers must finish synchronously");
};

// ../../packages/sine-lifecycle/dist/disposable-scope.js
var DisposableScope = class {
  #disposers;
  #report;
  #live = true;
  constructor({ onDisposeError } = {}) {
    if (typeof DisposableStack !== "function") {
      throw new Error("@zen-mods/sine-lifecycle requires DisposableStack");
    }
    this.#disposers = new DisposableStack();
    this.#report = safeReporter(onDisposeError);
  }
  isLive() {
    return this.#live;
  }
  defer(disposer) {
    const synchronous = synchronousDisposer(disposer, this.#report);
    if (this.#live) {
      this.#disposers.defer(synchronous);
      return;
    }
    try {
      synchronous();
    } catch (error) {
      this.#report(error);
    }
  }
  stop() {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    try {
      this.#disposers.dispose();
    } catch (error) {
      this.#report(error);
    }
    return true;
  }
};

// ../../packages/sine-lifecycle/dist/sine-window.js
var bindSineWindowLifecycle = (target, owner) => {
  const stopForSine = () => owner.stop("sine-unload");
  const stopForWindow = () => owner.stop("window-unload");
  owner.defer(() => {
    target.removeEventListener("unload", stopForWindow, { capture: false });
  });
  target.addEventListener("unload", stopForWindow, { capture: false, once: true });
  const sineUnload = typeof target.addUnloadListener === "function" ? "registered" : "unavailable";
  if (sineUnload === "registered") {
    target.addUnloadListener?.(stopForSine);
  }
  return { sineUnload };
};

// src/platform/sine.ts
var startGeneration = () => {
  window.zenTabDeduplicator?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[tab-deduplicator] disposer failed", error);
    }
  });
  let stopReason = null;
  const generation2 = {
    get stopReason() {
      return stopReason;
    },
    defer: (disposer) => scope.defer(disposer),
    isLive: () => scope.isLive(),
    stop(reason = "manual") {
      if (!scope.isLive()) {
        return false;
      }
      stopReason = reason;
      return scope.stop();
    }
  };
  window.zenTabDeduplicator = generation2;
  generation2.defer(() => {
    if (window.zenTabDeduplicator === generation2) {
      delete window.zenTabDeduplicator;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[tab-deduplicator] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};

// src/core/menu.ts
var dedupeMenuState = ({
  supported: supported2,
  duplicateCount
}) => {
  const count = Number.isSafeInteger(duplicateCount) && duplicateCount > 0 ? duplicateCount : 0;
  return {
    label: "Close Duplicate Tabs",
    disabled: !supported2 || count === 0
  };
};

// src/core/space-menu.ts
var safeCount2 = (value) => Number.isSafeInteger(value) && value > 0 ? value : 0;
var spaceGroupingMenuState = ({
  supported: supported2,
  moveCount: rawMoveCount
}) => {
  const moveCount = safeCount2(rawMoveCount);
  return {
    label: "Group Duplicate Tabs",
    disabled: !supported2 || moveCount === 0
  };
};

// src/platform/space-menu.ts
var ITEM_ID3 = "tab-deduplicator-group-space";
var MENU_ID3 = "tabContextMenu";
var MOVE_TAB_ANCHOR_ID = "context_moveTabOptions";
var spaceCloseSupported = () => typeof gBrowser._removeDuplicateTabs === "function" && typeof gBrowser.closingTabsEnum?.DUPLICATES === "number";
var currentSpaceCloseMenuState = (includePinned) => {
  const isSupported = spaceCloseSupported();
  if (!isSupported) {
    return dedupeMenuState({ supported: false, duplicateCount: 0 });
  }
  const review = buildCurrentCloseReview({
    scope: "space",
    allowPinnedClose: includePinned
  }).review;
  const duplicateCount = review.ordinaryCount + review.pinnedChoiceCount;
  return dedupeMenuState({ supported: true, duplicateCount });
};
var closeCurrentSpaceDuplicates = (includePinned, confirmationAnchor, presenter, isLive) => {
  const close = gBrowser._removeDuplicateTabs;
  const closeType = gBrowser.closingTabsEnum?.DUPLICATES;
  if (!close || typeof closeType !== "number") {
    return false;
  }
  const request = { scope: "space", allowPinnedClose: includePinned };
  return runCloseReview({
    initial: buildCurrentCloseReview(request),
    refresh: () => buildCurrentCloseReview(request),
    present: (review, status) => presenter.show(review, status),
    close: (candidates) => close.call(gBrowser, confirmationAnchor, candidates, closeType),
    isLive
  });
};
var validSpaceMove = (move, tabsById) => {
  const tab = tabsById.get(move.tabId);
  const anchor = tabsById.get(move.afterTabId);
  if (!tab || !anchor || isSplitViewTab(tab) || isSplitViewTab(anchor)) {
    return null;
  }
  if (tab.hasAttribute("zen-essential") !== anchor.hasAttribute("zen-essential")) {
    return null;
  }
  if (tabLaneId(tab) !== move.laneId || tabLaneId(anchor) !== move.laneId) {
    return null;
  }
  return { tab, anchor };
};
var executableSpaceMoves = (moves, tabsById) => moves.filter((move) => validSpaceMove(move, tabsById) !== null);
var applySpaceMoves = (moves, tabsById, moveAfter) => {
  let moved = 0;
  for (const move of moves) {
    const live = validSpaceMove(move, tabsById);
    if (!live) {
      continue;
    }
    moveAfter(live.tab, live.anchor);
    moved += 1;
  }
  return moved;
};
var currentSpacePlan = (includePinned) => {
  const snapshot = snapshotDuplicateTabs();
  const plan = planDuplicates(snapshot.facts, { includePinned });
  const moves = executableSpaceMoves(plan.moves, snapshot.tabsById);
  if (includePinned || moves.length > 0) {
    return { moves, tabsById: snapshot.tabsById, pinnedMoveCount: 0 };
  }
  const withPinned = planDuplicates(snapshot.facts, { includePinned: true });
  return {
    moves,
    tabsById: snapshot.tabsById,
    pinnedMoveCount: executableSpaceMoves(withPinned.moves, snapshot.tabsById).length
  };
};
var installSpaceGroupingMenuItem = (readIncludePinned) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID3);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID3)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(`<menuitem id="${ITEM_ID3}"/>`);
  const anchor = document.getElementById(MOVE_TAB_ANCHOR_ID);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID3);
  if (!item) {
    console.error("[tab-deduplicator] space grouping item insertion failed");
    return () => {
    };
  }
  const supported2 = () => typeof gBrowser.moveTabAfter === "function";
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const isSupported = supported2();
      const plan = isSupported ? currentSpacePlan(readIncludePinned()) : { moves: [], pinnedMoveCount: 0 };
      const next = spaceGroupingMenuState({
        supported: isSupported,
        moveCount: plan.moves.length,
        pinnedMoveCount: plan.pinnedMoveCount
      });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
    } catch (error) {
      item.setAttribute("label", "Group Duplicate Tabs");
      item.setAttribute("disabled", "true");
      console.error("[tab-deduplicator] could not inspect space duplicates", error);
    }
  };
  const onCommand = () => {
    const moveAfter = gBrowser.moveTabAfter;
    if (!moveAfter) {
      return;
    }
    try {
      const plan = currentSpacePlan(readIncludePinned());
      applySpaceMoves(
        plan.moves,
        plan.tabsById,
        (tab, anchor2) => moveAfter.call(gBrowser, tab, anchor2)
      );
    } catch (error) {
      console.error("[tab-deduplicator] could not group space duplicates", error);
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

// src/core/unpin-close-menu.ts
var unpinCloseMenuState = ({
  supported: supported2,
  hasContextTab,
  live,
  pinned,
  essential,
  multiselected
}) => {
  const visible = supported2 && hasContextTab && live && pinned && !essential && !multiselected;
  return {
    label: "Unpin and close pinned tab…",
    hidden: !visible,
    disabled: !visible
  };
};

// src/platform/unpin-close.ts
var runPinnedCloseTransaction = async ({
  target,
  isEligible,
  runBeforeUnload,
  unpin,
  close
}) => {
  if (!isEligible(target)) {
    return "ineligible";
  }
  if (await runBeforeUnload([target])) {
    return "unload-blocked";
  }
  if (!isEligible(target)) {
    return "ineligible";
  }
  if (!unpin(target)) {
    return "unpin-failed";
  }
  close(target, { skipPermitUnload: true });
  return "closed";
};
var runContextUnpinClose = (contextTarget, close) => contextTarget ? close(contextTarget) : Promise.resolve("ineligible");
var closeBrowserPinnedTab = async (target, browser = gBrowser) => {
  const runBeforeUnload = browser.runBeforeUnloadForTabs;
  const unpin = browser.unpinTab;
  const close = browser.removeTabs;
  if (!runBeforeUnload || !unpin || !close) {
    return "unsupported";
  }
  const isEligible = (tab) => browser.tabs.includes(tab) && tab.pinned && tab.closing !== true && !tab.hasAttribute("zen-essential");
  return runPinnedCloseTransaction({
    target,
    isEligible,
    runBeforeUnload: (tabs) => runBeforeUnload.call(browser, tabs),
    unpin: (tab) => {
      unpin.call(browser, tab);
      return browser.tabs.includes(tab) && !tab.pinned;
    },
    close: (tab, options) => close.call(browser, [tab], options)
  });
};

// src/platform/unpin-close-menu.ts
var ITEM_ID4 = "tab-deduplicator-unpin-close-pinned";
var MENU_ID4 = "tabContextMenu";
var UNPIN_ANCHOR_ID = "context_unpinTab";
var PIN_ANCHOR_ID = "context_pinTab";
var browserSupported = () => typeof gBrowser.runBeforeUnloadForTabs === "function" && typeof gBrowser.unpinTab === "function" && typeof gBrowser.removeTabs === "function";
var installUnpinCloseMenuItem = () => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID4);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID4)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID4}" label="Unpin and close pinned tab…" hidden="true" disabled="true"/>`
  );
  const unpinAnchor = document.getElementById(UNPIN_ANCHOR_ID);
  const pinAnchor = document.getElementById(PIN_ANCHOR_ID);
  const anchor = unpinAnchor?.parentElement === menu ? unpinAnchor : pinAnchor;
  if (anchor?.parentElement === menu) {
    anchor.after(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID4);
  if (!item) {
    console.error("[tab-deduplicator] unpin-and-close item insertion failed");
    return () => {
    };
  }
  let currentTarget = null;
  const clearTarget = () => {
    currentTarget = null;
    item.setAttribute("hidden", "true");
    item.setAttribute("disabled", "true");
  };
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const target = window.TabContextMenu?.contextTab ?? null;
      const state = unpinCloseMenuState({
        supported: browserSupported(),
        hasContextTab: target !== null,
        live: target !== null && gBrowser.tabs.includes(target) && target.closing !== true,
        pinned: target?.pinned === true,
        essential: target?.hasAttribute("zen-essential") === true,
        multiselected: window.TabContextMenu?.multiselected === true || target?.multiselected === true
      });
      currentTarget = state.hidden ? null : target;
      item.setAttribute("label", state.label);
      item.toggleAttribute("hidden", state.hidden);
      item.toggleAttribute("disabled", state.disabled);
    } catch (error) {
      clearTarget();
      console.error("[tab-deduplicator] could not inspect unpin-and-close target", error);
    }
  };
  const onCommand = () => {
    const target = currentTarget;
    if (!target || !browserSupported()) {
      return;
    }
    void runContextUnpinClose(target, closeBrowserPinnedTab).catch((error) => {
      console.error("[tab-deduplicator] could not unpin and close tab", error);
    });
  };
  const onHidden = (event) => {
    if (event.target === menu) {
      clearTarget();
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

// src/main.ts
var generation = startGeneration();
generation.defer(() => {
  console.info("[tab-deduplicator] unloaded");
});
try {
  const review = installCloseReviewDialog({
    document: window.document,
    isLive: generation.isLive
  });
  generation.defer(review.dispose);
  const readSpaceCloseState = () => currentSpaceCloseMenuState(readIncludePinnedPreference());
  const closeSpaceDuplicates = (confirmationAnchor) => closeCurrentSpaceDuplicates(
    readIncludePinnedPreference(),
    confirmationAnchor,
    review,
    generation.isLive
  );
  for (const dispose of [
    installUnpinCloseMenuItem(),
    installDedupeMenuItem(readSpaceCloseState, closeSpaceDuplicates),
    installEmptySidebarDedupeMenuItem(readSpaceCloseState, closeSpaceDuplicates),
    installSpaceGroupingMenuItem(readIncludePinnedPreference),
    installFolderGroupingMenuItem(readIncludePinnedPreference),
    installFolderCloseMenuItem(readIncludePinnedPreference, review, generation.isLive)
  ]) {
    generation.defer(dispose);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
console.info("[tab-deduplicator] ready");
