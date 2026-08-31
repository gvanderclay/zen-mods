// Generated from src/ by build.mjs — do not edit.

// src/core/pop-out.ts
var decideWindowToggle = (snapshot) => {
  if (snapshot.privateWindow) {
    return { kind: "blocked", reason: "private-window" };
  }
  if (!snapshot.activeId) {
    return { kind: "blocked", reason: "invalid-selection" };
  }
  const requestedIds = snapshot.hasMultiSelection ? snapshot.selectedIds : [snapshot.activeId];
  const tabsById = new Map(snapshot.tabs.map((tab) => [tab.id, tab]));
  const requested = new Set(requestedIds);
  const tabIds = snapshot.tabs.filter((tab) => requested.has(tab.id)).map((tab) => tab.id);
  if (tabIds.length === 0 || tabIds.length !== requestedIds.length || !tabIds.includes(snapshot.activeId) || requestedIds.some((id) => !tabsById.has(id))) {
    return { kind: "blocked", reason: "invalid-selection" };
  }
  for (const id of tabIds) {
    const tab = tabsById.get(id);
    if (tab?.essential) return { kind: "blocked", reason: "essential" };
    if (tab?.grouped) return { kind: "blocked", reason: "grouped" };
    if (tab?.split) return { kind: "blocked", reason: "split" };
  }
  const selected = new Set(tabIds);
  const sourceWouldEmpty = snapshot.realTabIds.length > 0 && snapshot.realTabIds.every((id) => selected.has(id));
  const closeSourceWindow = snapshot.sourceUnsynced && sourceWouldEmpty;
  const destination = snapshot.sourceUnsynced ? snapshot.sharedWindowAvailable ? "existing-shared" : "new-shared" : snapshot.isolatedWindowCount > 0 ? "existing-isolated" : "new-isolated";
  return {
    closeSourceWindow,
    createSourceTab: !closeSourceWindow && (snapshot.currentSpaceTabIds.length > 0 && snapshot.currentSpaceTabIds.every((id) => selected.has(id)) || !snapshot.sourceUnsynced && sourceWouldEmpty),
    destination,
    kind: "move",
    tabIds
  };
};

// src/platform/browser.ts
var liveEnvironment = () => {
  const { ZenWindowSync } = ChromeUtils.importESModule(
    "resource:///modules/zen/ZenWindowSync.sys.mjs"
  );
  return {
    browserWindows: [
      ...Services.wm.getEnumerator("navigator:browser")
    ],
    firstSharedWindow: ZenWindowSync.firstSyncedWindow,
    isPrivateWindow: (target) => PrivateBrowsingUtils.isWindowPrivate(target),
    sourceWindow: window,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  };
};
var isUnsynced = (target) => target.document.documentElement.hasAttribute("zen-unsynced-window");
var addSourceTab = (environment) => environment.sourceWindow.gBrowser.addTab("about:newtab", {
  inBackground: true,
  skipAnimation: true,
  triggeringPrincipal: environment.triggeringPrincipal
});
var restoreCreatedWindowActivePosition = (destination, decision, activeId) => {
  const activeIndex = decision.tabIds.indexOf(activeId);
  if (activeIndex <= 0) return;
  destination.addEventListener(
    "before-initial-tab-adopted",
    () => {
      destination.addEventListener(
        "MozAfterPaint",
        () => {
          destination.setTimeout(() => {
            const activeTab = destination.gBrowser.selectedTab;
            if (!activeTab) return;
            const firstTabIndex = destination.gBrowser.tabs.findIndex(
              (tab) => !tab.hasAttribute("zen-empty-tab")
            );
            destination.gBrowser.moveTabTo(activeTab, {
              tabIndex: Math.max(0, firstTabIndex) + activeIndex
            });
          }, 0);
        },
        { once: true }
      );
    },
    { once: true }
  );
};
var createDestinationWindow = (environment, decision, activeId, activeTab) => {
  const browser = environment.sourceWindow.gBrowser;
  let provisionalTab = null;
  if (decision.createSourceTab || decision.closeSourceWindow) {
    provisionalTab = addSourceTab(environment);
    if (!provisionalTab) return null;
  }
  try {
    const destination = browser.replaceTabsWithWindow(activeTab, {});
    if (!destination) {
      if (provisionalTab) browser.removeTab(provisionalTab, { animate: false });
      return null;
    }
    destination._zenStartupSyncFlag = decision.destination === "new-shared" ? "synced" : "unsynced";
    restoreCreatedWindowActivePosition(destination, decision, activeId);
    if (decision.closeSourceWindow) {
      destination.addEventListener(
        "before-initial-tab-adopted",
        () => {
          if (!environment.sourceWindow.closed) environment.sourceWindow.close();
        },
        { once: true }
      );
    }
    destination.focus();
    return destination;
  } catch (error) {
    if (provisionalTab) browser.removeTab(provisionalTab, { animate: false });
    throw error;
  }
};
var moveIntoExistingWindow = async (environment, decision, destination, movingTabs, activeTab, sourceWorkspaceIndex) => {
  const workspaceId = destination.gZenWorkspaces.getWorkspaces()[sourceWorkspaceIndex]?.uuid ?? destination.gZenWorkspaces.activeWorkspace;
  const destinationElement = destination.gZenWorkspaces.workspaceElement(workspaceId);
  if (!destinationElement) return null;
  let provisionalTab = null;
  if (decision.createSourceTab) {
    provisionalTab = addSourceTab(environment);
    if (!provisionalTab) return null;
  }
  const adoptedTabs = [];
  for (const tab of movingTabs) {
    const adopted = destination.gBrowser.adoptTab(tab, {
      tabIndex: tab.pinned ? destination.gBrowser.pinnedTabCount : Number.POSITIVE_INFINITY
    });
    if (!adopted) {
      if (adoptedTabs.length === 0 && provisionalTab) {
        environment.sourceWindow.gBrowser.removeTab(provisionalTab, {
          animate: false
        });
      }
      return null;
    }
    destination.gZenWorkspaces.moveTabToWorkspace(adopted, workspaceId);
    const container = adopted.pinned ? destinationElement.pinnedTabsContainer : destinationElement.tabsContainer;
    destination.gBrowser.zenHandleTabMove(adopted, () => {
      container.insertBefore(adopted, container.lastChild);
    });
    adoptedTabs.push(adopted);
  }
  destination.gBrowser.tabContainer._invalidateCachedTabs();
  const activeIndex = movingTabs.indexOf(activeTab);
  const adoptedActive = adoptedTabs[activeIndex];
  if (!adoptedActive) return null;
  destination.gZenWorkspaces.lastSelectedWorkspaceTabs[workspaceId] = adoptedActive;
  await destination.gZenWorkspaces.changeWorkspaceWithID(workspaceId);
  destination.gBrowser.clearMultiSelectedTabs();
  destination.gBrowser.selectedTab = adoptedActive;
  if (adoptedTabs.length > 1) {
    for (const tab of adoptedTabs) destination.gBrowser.addToMultiSelectedTabs(tab);
  }
  destination.focus();
  destination.gBrowser.selectedBrowser?.focus();
  if (decision.closeSourceWindow && !environment.sourceWindow.closed) {
    environment.sourceWindow.close();
  }
  return destination;
};
var toggleSelectedTabsIsolation = async (environment = liveEnvironment()) => {
  const source = environment.sourceWindow;
  const browser = source.gBrowser;
  const activeTab = browser.selectedTab;
  const tabIds = new Map(browser.tabs.map((tab, index) => [tab, `tab-${String(index)}`]));
  const tabsById = new Map([...tabIds].map(([tab, id]) => [id, tab]));
  const activeId = activeTab ? tabIds.get(activeTab) ?? null : null;
  const workspaceId = source.gZenWorkspaces.activeWorkspace;
  const sourceWorkspaceIndex = source.gZenWorkspaces.getWorkspaces().findIndex((workspace) => workspace.uuid === workspaceId);
  const isolatedWindows = environment.browserWindows.filter(
    (candidate) => !candidate.closed && isUnsynced(candidate) && !environment.isPrivateWindow(candidate)
  );
  const sourceUnsynced = isUnsynced(source);
  const decision = decideWindowToggle({
    activeId,
    currentSpaceTabIds: browser.tabs.filter(
      (tab) => !tab.pinned && !tab.hasAttribute("zen-empty-tab") && (!workspaceId || tab.getAttribute("zen-workspace-id") === workspaceId)
    ).map((tab) => tabIds.get(tab)),
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    isolatedWindowCount: isolatedWindows.length,
    privateWindow: environment.isPrivateWindow(source),
    realTabIds: browser.tabs.filter((tab) => !tab.hasAttribute("zen-empty-tab")).map((tab) => tabIds.get(tab)),
    selectedIds: browser.selectedTabs.flatMap((tab) => {
      const id = tabIds.get(tab);
      return id ? [id] : [];
    }),
    sharedWindowAvailable: Boolean(environment.firstSharedWindow),
    sourceUnsynced,
    tabs: browser.tabs.map((tab) => ({
      essential: tab.hasAttribute("zen-essential"),
      grouped: Boolean(tab.group),
      id: tabIds.get(tab),
      split: Boolean(tab.splitview)
    }))
  });
  if (decision.kind === "blocked" || !activeTab || !activeId) return null;
  const movingTabs = decision.tabIds.map(
    (id) => tabsById.get(id)
  );
  if (decision.destination === "new-isolated" || decision.destination === "new-shared") {
    return createDestinationWindow(environment, decision, activeId, activeTab);
  }
  const destination = decision.destination === "existing-isolated" ? isolatedWindows[0] ?? null : environment.firstSharedWindow;
  if (!destination) return null;
  return moveIntoExistingWindow(
    environment,
    decision,
    destination,
    movingTabs,
    activeTab,
    sourceWorkspaceIndex
  );
};

// src/platform/command.ts
var COMMAND_SET_ID = "mainCommandSet";
var installCommands = (commands, { report }) => {
  if (new Set(commands.map((command) => command.id)).size !== commands.length) {
    throw new Error("command IDs must be unique");
  }
  const document = window.document;
  const commandSet = document.getElementById(COMMAND_SET_ID);
  if (!commandSet || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser command set is unavailable");
  }
  let destroyed = false;
  const installed = commands.map((definition) => {
    document.getElementById(definition.id)?.remove();
    const element = document.createXULElement("command");
    element.id = definition.id;
    const onCommand = () => {
      if (destroyed) return;
      try {
        void Promise.resolve(definition.run()).catch((error) => {
          if (!destroyed) report(error);
        });
      } catch (error) {
        report(error);
      }
    };
    element.addEventListener("command", onCommand);
    commandSet.append(element);
    return { element, onCommand };
  });
  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const { element, onCommand } of installed) {
      element.removeEventListener("command", onCommand);
      element.remove();
    }
  };
};

// src/platform/shortcut.ts
var POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
var LEGACY_POP_OUT_COMMAND_ID = "Pop Out Current Tab";
var POP_OUT_COMMAND_ID = "Pop Out / Merge Selected Tabs";
var EXTEND_SELECTION_NEXT_COMMAND_ID = "Extend Tab Selection Next";
var EXTEND_SELECTION_PREVIOUS_COMMAND_ID = "Extend Tab Selection Previous";
var CLEAR_SELECTION_COMMAND_ID = "Clear Tab Selection";
var LEGACY_POP_OUT_BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
var BINDING_PREFERENCE_PREFIX = "zen.extended-tab-shortcuts.saved-binding.";
var commandControlBinding = (key, keycode = "") => ({
  key,
  keycode,
  modifiers: {
    control: true,
    alt: false,
    shift: false,
    meta: true,
    accel: false
  }
});
var POP_OUT_SHORTCUT = {
  id: POP_OUT_SHORTCUT_ID,
  action: POP_OUT_COMMAND_ID,
  defaultBinding: commandControlBinding("o"),
  legacyActions: [LEGACY_POP_OUT_COMMAND_ID, "Pop Out Selected Tabs"],
  previousDefaultBindings: [commandControlBinding("n")]
};
var TAB_SELECTION_SHORTCUTS = [
  {
    id: "extended-tab-shortcuts-select-next-vim-key",
    action: EXTEND_SELECTION_NEXT_COMMAND_ID,
    defaultBinding: commandControlBinding("j")
  },
  {
    id: "extended-tab-shortcuts-select-next-arrow-key",
    action: EXTEND_SELECTION_NEXT_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_DOWN")
  },
  {
    id: "extended-tab-shortcuts-select-previous-vim-key",
    action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
    defaultBinding: commandControlBinding("k")
  },
  {
    id: "extended-tab-shortcuts-select-previous-arrow-key",
    action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_UP")
  },
  {
    id: "extended-tab-shortcuts-clear-selection-key",
    action: CLEAR_SELECTION_COMMAND_ID,
    defaultBinding: commandControlBinding("`")
  }
];
var validModifiers = (value) => {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return [
    candidate.control,
    candidate.alt,
    candidate.shift,
    candidate.meta,
    candidate.accel
  ].every((modifier) => typeof modifier === "boolean");
};
var parseBinding = (raw) => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.key !== "string" || typeof value.keycode !== "string" || !validModifiers(value.modifiers)) {
      return null;
    }
    return {
      key: value.key,
      keycode: value.keycode,
      modifiers: value.modifiers
    };
  } catch {
    return null;
  }
};
var preferenceBindingStore = {
  read: (id) => {
    const current = parseBinding(
      Services.prefs.getStringPref(`${BINDING_PREFERENCE_PREFIX}${id}`, "")
    );
    if (current || id !== POP_OUT_SHORTCUT_ID) return current;
    return parseBinding(
      Services.prefs.getStringPref(LEGACY_POP_OUT_BINDING_PREFERENCE, "")
    );
  },
  write: (id, binding) => {
    Services.prefs.setStringPref(
      `${BINDING_PREFERENCE_PREFIX}${id}`,
      JSON.stringify(binding)
    );
  }
};
var shortcutFor = (definition, binding) => ({
  id: definition.id,
  key: binding.key,
  keycode: binding.keycode,
  group: "zen-other",
  l10nId: null,
  modifiers: binding.modifiers,
  action: definition.action,
  disabled: false,
  reserved: true,
  internal: false
});
var bindingsMatch = (left, right) => left.key === right.key && left.keycode === right.keycode && left.modifiers.control === right.modifiers.control && left.modifiers.alt === right.modifiers.alt && left.modifiers.shift === right.modifiers.shift && left.modifiers.meta === right.modifiers.meta && left.modifiers.accel === right.modifiers.accel;
var migratePreviousDefault = (definition, binding) => definition.previousDefaultBindings?.some((previous) => bindingsMatch(previous, binding)) ? definition.defaultBinding : binding;
var validateDefinitions = (definitions) => {
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
    throw new Error("shortcut IDs must be unique");
  }
};
var registerShortcuts = async (definitions, manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  for (const definition of definitions) {
    const existing = saved.shortcuts.find((shortcut) => shortcut.id === definition.id);
    if (existing && existing.action !== definition.action && !definition.legacyActions?.includes(String(existing.action))) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
  }
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition])
  );
  let migrations = 0;
  const migrated = saved.shortcuts.map((shortcut) => {
    const definition = definitionsById.get(shortcut.id);
    if (!definition || shortcut.action === definition.action) return shortcut;
    migrations += 1;
    const binding = migratePreviousDefault(definition, shortcut);
    return {
      ...shortcut,
      action: definition.action,
      key: binding.key,
      keycode: binding.keycode,
      modifiers: binding.modifiers
    };
  });
  const additions = definitions.flatMap((definition) => {
    if (saved.shortcuts.some((shortcut) => shortcut.id === definition.id)) return [];
    const retained = bindingStore.read(definition.id);
    return [
      shortcutFor(
        definition,
        retained ? migratePreviousDefault(definition, retained) : definition.defaultBinding
      )
    ];
  });
  const changes = migrations + additions.length;
  if (changes === 0) return 0;
  await manager.loader.save({
    ...saved,
    shortcuts: [...migrated, ...additions]
  });
  await manager.init();
  return changes;
};
var unregisterShortcuts = async (definitions, manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  const existing = definitions.flatMap((definition) => {
    const shortcut = saved.shortcuts.find((candidate) => candidate.id === definition.id);
    if (!shortcut) return [];
    if (shortcut.action !== definition.action) {
      throw new Error(`shortcut ID is already owned by ${String(shortcut.action)}`);
    }
    return [shortcut];
  });
  if (existing.length === 0) return 0;
  for (const shortcut of existing) {
    bindingStore.write(shortcut.id, {
      key: shortcut.key,
      keycode: shortcut.keycode,
      modifiers: shortcut.modifiers
    });
  }
  const ownedIds = new Set(definitions.map((definition) => definition.id));
  await manager.loader.save({
    ...saved,
    shortcuts: saved.shortcuts.filter((shortcut) => !ownedIds.has(shortcut.id))
  });
  await manager.init();
  return existing.length;
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
  window.zenExtendedTabShortcuts?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[extended-tab-shortcuts] disposer failed", error);
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
  window.zenExtendedTabShortcuts = generation2;
  generation2.defer(() => {
    if (window.zenExtendedTabShortcuts === generation2) {
      delete window.zenExtendedTabShortcuts;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[extended-tab-shortcuts] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};
var installSineUnloadCleanup = (generation2, cleanup) => {
  if (typeof window.addUnloadListener !== "function") return false;
  window.addUnloadListener(async () => {
    try {
      await cleanup();
    } finally {
      generation2.stop("sine-unload");
    }
  });
  return true;
};

// src/core/space-move.ts
var decideSpaceMove = (snapshot) => {
  if (!snapshot.workspaceEnabled) {
    return { kind: "blocked", reason: "workspaces-disabled" };
  }
  if (!snapshot.activeId) {
    return { kind: "blocked", reason: "invalid-selection" };
  }
  const requestedIds = snapshot.hasMultiSelection ? snapshot.selectedIds : [snapshot.activeId];
  const requested = new Set(requestedIds);
  const tabsById = new Map(snapshot.tabs.map((tab) => [tab.id, tab]));
  const tabIds = snapshot.tabs.filter((tab) => requested.has(tab.id)).map((tab) => tab.id);
  if (tabIds.length === 0 || tabIds.length !== requestedIds.length || !tabIds.includes(snapshot.activeId) || requestedIds.some((id) => !tabsById.has(id))) {
    return { kind: "blocked", reason: "invalid-selection" };
  }
  for (const id of tabIds) {
    const tab = tabsById.get(id);
    if (tab?.essential) return { kind: "blocked", reason: "essential" };
    if (tab?.grouped) return { kind: "blocked", reason: "grouped" };
    if (tab?.split) return { kind: "blocked", reason: "split" };
    if (tab?.spaceId !== snapshot.currentSpaceId) {
      return { kind: "blocked", reason: "invalid-selection" };
    }
  }
  const currentIndex = snapshot.spaces.indexOf(snapshot.currentSpaceId);
  if (snapshot.spaces.length < 2 || currentIndex < 0) {
    return { kind: "blocked", reason: "no-destination" };
  }
  let destinationIndex = currentIndex + snapshot.direction;
  if (snapshot.wrap) {
    destinationIndex = (destinationIndex + snapshot.spaces.length) % snapshot.spaces.length;
  } else if (destinationIndex < 0 || destinationIndex >= snapshot.spaces.length) {
    return { kind: "blocked", reason: "no-destination" };
  }
  const destinationId = snapshot.spaces[destinationIndex];
  if (!destinationId || destinationId === snapshot.currentSpaceId) {
    return { kind: "blocked", reason: "no-destination" };
  }
  return { destinationId, kind: "move", tabIds };
};

// src/platform/space-move.ts
var liveEnvironment2 = () => ({
  browser: gBrowser,
  workspaces: gZenWorkspaces
});
var moveSelectedTabsToSpace = async (direction, environment = liveEnvironment2()) => {
  const { browser, workspaces } = environment;
  const activeTab = browser.selectedTab;
  const tabsById = new Map(
    browser.tabs.map((tab, index) => [`tab-${String(index)}`, tab])
  );
  const idsByTab = new Map([...tabsById].map(([id, tab]) => [tab, id]));
  const activeId = activeTab ? idsByTab.get(activeTab) ?? null : null;
  const spaces = workspaces.getWorkspaces();
  const decision = decideSpaceMove({
    activeId,
    currentSpaceId: workspaces.activeWorkspace,
    direction,
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    selectedIds: browser.selectedTabs.flatMap((tab) => {
      const id = idsByTab.get(tab);
      return id ? [id] : [];
    }),
    spaces: spaces.map((space) => space.uuid),
    tabs: [...tabsById].map(([id, tab]) => ({
      essential: tab.hasAttribute("zen-essential"),
      grouped: Boolean(tab.group),
      id,
      spaceId: tab.getAttribute("zen-workspace-id"),
      split: Boolean(tab.splitview)
    })),
    workspaceEnabled: workspaces.workspaceEnabled,
    wrap: workspaces.shouldWrapAroundNavigation
  });
  if (decision.kind === "blocked" || !activeTab) return false;
  const destination = spaces.find((space) => space.uuid === decision.destinationId);
  if (!destination) return false;
  const movingTabs = decision.tabIds.map((id) => tabsById.get(id));
  const destinationElement = workspaces.workspaceElement(decision.destinationId);
  if (!destinationElement) return false;
  if (!workspaces.moveTabsToWorkspace([...movingTabs], decision.destinationId)) {
    return false;
  }
  for (const tab of movingTabs) {
    const container = tab.pinned ? destinationElement.pinnedTabsContainer : destinationElement.tabsContainer;
    browser.zenHandleTabMove(tab, () => {
      container.insertBefore(tab, container.lastChild);
    });
  }
  browser.tabContainer._invalidateCachedTabs();
  workspaces.lastSelectedWorkspaceTabs[decision.destinationId] = activeTab;
  await workspaces.changeWorkspace(destination);
  browser.clearMultiSelectedTabs();
  browser.selectedTab = activeTab;
  if (movingTabs.length > 1) {
    for (const tab of movingTabs) browser.addToMultiSelectedTabs(tab);
  }
  return true;
};

// src/platform/space-shortcuts.ts
var MOVE_TABS_NEXT_SPACE_COMMAND_ID = "Move Selected Tabs to Next Space";
var MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID = "Move Selected Tabs to Previous Space";
var commandControlBinding2 = (key, keycode = "", shift = false) => ({
  key,
  keycode,
  modifiers: {
    control: true,
    alt: false,
    shift,
    meta: true,
    accel: false
  }
});
var SPACE_MOVE_SHORTCUTS = [
  {
    id: "extended-tab-shortcuts-move-next-space-vim-key",
    action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding2("n")
  },
  {
    id: "extended-tab-shortcuts-move-next-space-arrow-key",
    action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding2("", "VK_RIGHT", true)
  },
  {
    id: "extended-tab-shortcuts-move-previous-space-vim-key",
    action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding2("p")
  },
  {
    id: "extended-tab-shortcuts-move-previous-space-arrow-key",
    action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding2("", "VK_LEFT", true)
  }
];

// src/platform/tab-selection.ts
var hiddenByCollapsedGroup = (tab) => {
  if (tab.selected) return false;
  let group = tab.group;
  while (group) {
    if (group.collapsed && !group.activeTabs?.includes(tab)) return true;
    group = group.group;
  }
  const workspace = gZenWorkspaces.activeWorkspaceElement;
  if (tab.pinned && !tab.hasAttribute("zen-essential") && workspace?.hasCollapsedPinnedTabs && !workspace.collapsiblePins?.activeTabs?.includes(tab)) {
    return true;
  }
  return false;
};
var createBrowserTabSelectionPort = () => {
  const browser = gBrowser;
  const ids = /* @__PURE__ */ new WeakMap();
  const tabsById = /* @__PURE__ */ new Map();
  let nextId = 1;
  const idFor = (tab) => {
    let id = ids.get(tab);
    if (!id) {
      id = `tab-${nextId++}`;
      ids.set(tab, id);
    }
    tabsById.set(id, tab);
    return id;
  };
  const read = () => {
    const activeTab = browser.selectedTab;
    const visibleTabs = browser.visibleTabs.filter(
      (tab) => !hiddenByCollapsedGroup(tab) && (!activeTab || tab.pinned === activeTab.pinned)
    );
    const activeId = activeTab ? idFor(activeTab) : null;
    return {
      activeId,
      hasMultiSelection: browser.multiSelectedTabsCount > 0,
      selectedIds: browser.selectedTabs.map(idFor),
      visibleIds: visibleTabs.map(idFor)
    };
  };
  return {
    read,
    applySelection(selectionIds) {
      const desiredTabs = [];
      for (const id of selectionIds) {
        const tab = tabsById.get(id);
        if (!tab) {
          throw new Error("tab selection changed before it could be applied");
        }
        desiredTabs.push(tab);
      }
      const desiredIds = new Set(selectionIds);
      for (const tab of browser.selectedTabs) {
        if (tab.multiselected && !desiredIds.has(idFor(tab))) {
          browser.removeFromMultiSelectedTabs(tab);
        }
      }
      if (desiredTabs.length > 1) {
        for (const tab of desiredTabs) {
          if (!tab.multiselected) browser.addToMultiSelectedTabs(tab);
        }
      }
    },
    clearSelection: () => browser.clearMultiSelectedTabs(),
    onActiveChange(listener) {
      browser.tabContainer.addEventListener("TabSelect", listener);
      return () => browser.tabContainer.removeEventListener("TabSelect", listener);
    },
    onSelectionChange(listener) {
      browser.addEventListener("TabMultiSelect", listener);
      return () => browser.removeEventListener("TabMultiSelect", listener);
    }
  };
};

// src/core/tab-selection.ts
var sameSelection = (left, right) => {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
};
var rangeFor = (visibleIds, session) => {
  const anchorIndex = visibleIds.indexOf(session.anchorId);
  const headIndex = visibleIds.indexOf(session.headId);
  if (anchorIndex < 0 || headIndex < 0) return null;
  return visibleIds.slice(
    Math.min(anchorIndex, headIndex),
    Math.max(anchorIndex, headIndex) + 1
  );
};
var validSession = (snapshot, session) => {
  if (!session || !snapshot.activeId) return false;
  const expected = rangeFor(snapshot.visibleIds, session);
  if (!expected?.includes(snapshot.activeId)) return false;
  return sameSelection(snapshot.selectedIds, expected);
};
var adoptContiguousSelection = (snapshot, direction) => {
  if (snapshot.selectedIds.length < 2 || !snapshot.activeId) return null;
  const selectedIndices = snapshot.selectedIds.map((id) => snapshot.visibleIds.indexOf(id)).sort((left, right) => left - right);
  const firstIndex = selectedIndices[0];
  const lastIndex = selectedIndices.at(-1);
  if (firstIndex === void 0 || lastIndex === void 0 || firstIndex < 0 || lastIndex - firstIndex + 1 !== selectedIndices.length || !snapshot.selectedIds.includes(snapshot.activeId)) {
    return null;
  }
  const firstId = snapshot.visibleIds[firstIndex];
  const lastId = snapshot.visibleIds[lastIndex];
  if (!firstId || !lastId) return null;
  return direction === 1 ? { anchorId: firstId, headId: lastId } : { anchorId: lastId, headId: firstId };
};
var extendTabSelection = (snapshot, session, direction) => {
  const activeId = snapshot.activeId;
  const activeIndex = activeId ? snapshot.visibleIds.indexOf(activeId) : -1;
  if (!activeId || activeIndex < 0) {
    return { selectionIds: null, session: null };
  }
  const currentSession = validSession(snapshot, session) ? session : adoptContiguousSelection(snapshot, direction);
  const headIndex = currentSession ? snapshot.visibleIds.indexOf(currentSession.headId) : activeIndex;
  const nextHeadIndex = headIndex + direction;
  if (nextHeadIndex < 0 || nextHeadIndex >= snapshot.visibleIds.length) {
    return { selectionIds: null, session: currentSession };
  }
  const nextHeadId = snapshot.visibleIds[nextHeadIndex];
  if (!nextHeadId) return { selectionIds: null, session: currentSession };
  const nextSession = {
    anchorId: currentSession?.anchorId ?? activeId,
    headId: nextHeadId
  };
  return {
    selectionIds: rangeFor(snapshot.visibleIds, nextSession),
    session: nextSession
  };
};
var selectionsMatch = sameSelection;

// src/tab-selection.ts
var createTabSelectionController = (port) => {
  let destroyed = false;
  let session = null;
  let expectedSelection = null;
  const reset = () => {
    session = null;
    expectedSelection = null;
  };
  const onSelectionChange = () => {
    const selectedIds = port.read().selectedIds;
    if (expectedSelection && selectionsMatch(selectedIds, expectedSelection)) {
      expectedSelection = null;
      return;
    }
    reset();
  };
  const removeSelectionListener = port.onSelectionChange(onSelectionChange);
  const removeActiveListener = port.onActiveChange(reset);
  const move = (direction) => {
    if (destroyed) return;
    const snapshot = port.read();
    if (expectedSelection && selectionsMatch(snapshot.selectedIds, expectedSelection)) {
      expectedSelection = null;
    }
    const step = extendTabSelection(snapshot, session, direction);
    session = step.session;
    if (step.selectionIds && !selectionsMatch(snapshot.selectedIds, step.selectionIds)) {
      expectedSelection = step.selectionIds;
      port.applySelection(step.selectionIds);
    }
  };
  return {
    next: () => move(1),
    previous: () => move(-1),
    clear() {
      if (destroyed) return;
      session = null;
      const snapshot = port.read();
      if (!snapshot.hasMultiSelection) {
        expectedSelection = null;
        return;
      }
      expectedSelection = snapshot.activeId ? [snapshot.activeId] : [];
      port.clearSelection();
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      reset();
      removeActiveListener();
      removeSelectionListener();
    }
  };
};

// src/main.ts
var shortcuts = [POP_OUT_SHORTCUT, ...TAB_SELECTION_SHORTCUTS, ...SPACE_MOVE_SHORTCUTS];
var generation = startGeneration();
generation.defer(() => {
  console.info("[extended-tab-shortcuts] unloaded");
});
try {
  const tabSelection = createTabSelectionController(createBrowserTabSelectionPort());
  generation.defer(() => tabSelection.dispose());
  generation.defer(
    installCommands(
      [
        { id: POP_OUT_COMMAND_ID, run: toggleSelectedTabsIsolation },
        { id: EXTEND_SELECTION_NEXT_COMMAND_ID, run: tabSelection.next },
        { id: EXTEND_SELECTION_PREVIOUS_COMMAND_ID, run: tabSelection.previous },
        { id: CLEAR_SELECTION_COMMAND_ID, run: tabSelection.clear },
        {
          id: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
          run: () => moveSelectedTabsToSpace(1)
        },
        {
          id: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
          run: () => moveSelectedTabsToSpace(-1)
        }
      ],
      {
        report: (error) => console.error("[extended-tab-shortcuts] action failed", error)
      }
    )
  );
  await registerShortcuts(shortcuts);
  if (!generation.isLive()) {
    await unregisterShortcuts(shortcuts);
  } else {
    installSineUnloadCleanup(generation, () => unregisterShortcuts(shortcuts));
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
if (generation.isLive()) {
  console.info("[extended-tab-shortcuts] ready");
}
