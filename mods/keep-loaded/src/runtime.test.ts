import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeepLoadedApplicationOwner } from "./application-coordinator.ts";
import { KeepLoadedController } from "./controller.ts";
import type { CrashFacts, CrashKind } from "./core/crash.ts";
import { PulseClaims } from "./core/pulse-claims.ts";
import type { ObservedPreference, PreferencesPort } from "./platform/prefs.ts";

const platform = vi.hoisted(() => ({
  browserProbes: vi.fn(),
  crashFactsFor: vi.fn(),
  factsFor: vi.fn(),
  insertBrowser: vi.fn(),
  installKeepMenuItem: vi.fn(),
  installStatusPanel: vi.fn(),
  isDocShellActive: vi.fn(),
  isLabelManaged: vi.fn(),
  isPending: vi.fn(),
  isRenamed: vi.fn(),
  log: vi.fn(),
  markUndiscardable: vi.fn(),
  menuActions: null as null | { toggle(tab: BrowserTab): void },
  networkFacts: vi.fn(),
  observeSigns: vi.fn(),
  observeTitleChanges: vi.fn(),
  observeTopic: vi.fn(),
  pageTitle: vi.fn(),
  panelActions: null as null | { onWake(view: Element): void },
  pinnedTabs: vi.fn(),
  readSign: vi.fn(),
  recordSign: vi.fn(),
  renderPanelAction: vi.fn(),
  renderPanelLines: vi.fn(),
  renderPanelReport: vi.fn(),
  resetToLazy: vi.fn(),
  rollbackWakeCandidate: vi.fn(),
  sessionReady: Promise.resolve() as Promise<void>,
  setDocShellActive: vi.fn(),
  setFlag: vi.fn(),
  setMarker: vi.fn(),
  socketProbes: vi.fn(),
  socketRecordFor: vi.fn(),
  spaceNameFor: vi.fn(),
  spacesReady: Promise.resolve() as Promise<void>,
  stopWatchingSockets: vi.fn(),
  stopWatchingSocket: vi.fn(),
  tabLabel: vi.fn(),
  tabs: [] as BrowserTab[],
  titleListener: null as null | ((tab: BrowserTab) => void),
  watchSockets: vi.fn(),
  whenSessionRestored: vi.fn(),
  whenSpacesReady: vi.fn(),
  wakeCandidateState: vi.fn(),
  writeLabelFromPage: vi.fn(),
  onCrash: null as
    | null
    | ((tab: BrowserTab, kind: "crashed" | "restart-required") => void),
  onDiscard: null as null | ((tab: BrowserTab) => void),
  onRecoveryInvalidated: null as null | ((tab: BrowserTab) => void),
  onTabSelected: null as null | ((tab: BrowserTab) => void),
}));

vi.mock("./platform/browser.ts", () => ({
  browserProbes: platform.browserProbes,
  crashFactsFor: platform.crashFactsFor,
  factsFor: platform.factsFor,
  insertBrowser: platform.insertBrowser,
  isDocShellActive: platform.isDocShellActive,
  isLabelManaged: platform.isLabelManaged,
  isPending: platform.isPending,
  isRenamed: platform.isRenamed,
  markUndiscardable: platform.markUndiscardable,
  observeTitleChanges: platform.observeTitleChanges,
  pageTitle: platform.pageTitle,
  pinnedTabs: platform.pinnedTabs,
  resetToLazy: platform.resetToLazy,
  rollbackWakeCandidate: platform.rollbackWakeCandidate,
  setDocShellActive: platform.setDocShellActive,
  setFlag: platform.setFlag,
  setMarker: platform.setMarker,
  spaceNameFor: platform.spaceNameFor,
  tabLabel: platform.tabLabel,
  whenSessionRestored: platform.whenSessionRestored,
  whenSpacesReady: platform.whenSpacesReady,
  wakeCandidateState: platform.wakeCandidateState,
  writeLabelFromPage: platform.writeLabelFromPage,
}));

vi.mock("./platform/liveness.ts", () => ({
  observeSigns: platform.observeSigns,
  recordSign: platform.recordSign,
  signFor: platform.readSign,
}));

vi.mock("./platform/log.ts", () => ({ log: platform.log }));

vi.mock("./platform/menu.ts", () => ({
  installKeepMenuItem: platform.installKeepMenuItem,
}));

vi.mock("./platform/panel.ts", () => ({
  installStatusPanel: platform.installStatusPanel,
  renderPanelAction: platform.renderPanelAction,
  renderPanelLines: platform.renderPanelLines,
  renderPanelReport: platform.renderPanelReport,
}));

vi.mock("./platform/prefs.ts", () => ({ preferences: {} }));

vi.mock("./platform/sockets.ts", () => ({
  socketProbes: platform.socketProbes,
  socketRecordFor: platform.socketRecordFor,
  stopWatchingSockets: platform.stopWatchingSockets,
  stopWatchingSocket: platform.stopWatchingSocket,
  watchSockets: platform.watchSockets,
}));

vi.mock("./platform/system.ts", () => ({
  networkFacts: platform.networkFacts,
  observeTopic: platform.observeTopic,
}));

interface FakeTab {
  active: boolean;
  inserted: boolean;
  isConnected: boolean;
  facts: {
    flagged: boolean;
    space: string;
    url: string;
  };
  label: string;
  pending: boolean;
  pinned: boolean;
  selected: boolean;
  title: string;
}

class ManualTimers {
  #nextId = 1;
  #now = 0;
  readonly tasks = new Map<
    number,
    { callback: () => void; canceled: boolean; delayMs: number; dueAt: number }
  >();

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.tasks.set(id, {
      callback,
      canceled: false,
      delayMs,
      dueAt: this.#now + delayMs,
    });
    return id;
  };

  readonly now = () => this.#now;

  readonly clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (task) {
      task.canceled = true;
    }
  };

  force(id: number): void {
    const task = this.tasks.get(id);
    if (task) {
      this.#now = Math.max(this.#now, task.dueAt);
      task.callback();
    }
  }

  forceAll(): void {
    // Snapshot first: a broken stale callback that re-arms must make the assertion
    // fail, not turn the test helper itself into an endless timer drain.
    for (const id of [...this.tasks.keys()]) {
      this.force(id);
    }
  }

  forceLatest(): void {
    const latest = [...this.tasks]
      .filter(([, task]) => !task.canceled)
      .sort(([left], [right]) => right - left)[0];
    if (!latest) {
      throw new Error("no live timer to force");
    }
    this.force(latest[0]);
  }
}

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const settle = async (turns = 8) => {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
};

const waitFor = async (condition: () => boolean, label: string) => {
  for (let turn = 0; turn < 40; turn += 1) {
    if (condition()) {
      return;
    }
    await settle(2);
  }
  throw new Error(`timed out waiting for ${label}`);
};

const fakeTab = (overrides: Partial<FakeTab> = {}) => {
  const tab: FakeTab = {
    active: false,
    inserted: false,
    isConnected: true,
    facts: {
      flagged: true,
      space: "space-a",
      url: "https://mail.example.test/",
    },
    label: "Mail",
    pending: false,
    pinned: true,
    selected: false,
    title: "Mail (1)",
    ...overrides,
  };
  return tab as unknown as BrowserTab;
};

const asFake = (tab: BrowserTab) => tab as unknown as FakeTab;

const crashEvidence = (
  tab: BrowserTab,
  kind: CrashKind = "crashed",
  overrides: Partial<CrashFacts> = {},
): CrashFacts => ({
  connected: true,
  crashedPage: false,
  kind,
  pending: asFake(tab).pending,
  remote: false,
  url: asFake(tab).facts.url,
  ...overrides,
});

const preferenceHarness = (
  overrides: Partial<{
    crashAttempts: string;
    crashWindow: string;
    freshenHold: string;
    freshen: string;
    lazyPinned: boolean;
    match: string;
    onDemand: boolean;
  }> = {},
) => {
  const values = {
    crashAttempts: overrides.crashAttempts ?? "3",
    crashWindow: overrides.crashWindow ?? "60",
    freshenHold: overrides.freshenHold ?? "5",
    freshen: overrides.freshen ?? "0",
    lazyPinned: overrides.lazyPinned ?? true,
    match: overrides.match ?? "",
  };
  let onDemand = overrides.onDemand ?? true;
  const writes: boolean[] = [];
  const observers = new Map<ObservedPreference, () => void>();
  const readOnDemand = () => onDemand;
  const writeOnDemand = (value: boolean) => {
    onDemand = value;
    writes.push(value);
  };
  const port: PreferencesPort = {
    readMatch: () => values.match,
    readCrashAttempts: () => values.crashAttempts,
    readCrashWindow: () => values.crashWindow,
    readFreshenSeconds: () => values.freshen,
    readFreshenHoldSeconds: () => values.freshenHold,
    readDebug: () => false,
    readLazyPinnedWanted: () => values.lazyPinned,
    observe: (which, onChange) => {
      observers.set(which, onChange);
      return () => {
        if (observers.get(which) === onChange) {
          observers.delete(which);
        }
      };
    },
    probes: () => [],
  };
  return {
    observers,
    onDemand: () => onDemand,
    port,
    readOnDemand,
    values,
    writeOnDemand,
    writes,
  };
};

const createHarness = async (options: Parameters<typeof preferenceHarness>[0] = {}) => {
  vi.resetModules();
  const { createKeepLoadedRuntime } = await import("./runtime.ts");
  const timers = new ManualTimers();
  const preferences = preferenceHarness(options);
  const controller = new KeepLoadedController({
    timers,
  });
  const pulseClaims = new PulseClaims<BrowserTab>();
  const application = new KeepLoadedApplicationOwner<BrowserTab, CrashFacts>({
    applicationId: "runtime-test",
    preferences: {
      readOnDemand: preferences.readOnDemand,
      writeOnDemand: preferences.writeOnDemand,
    },
    timers,
  });
  const runtime = createKeepLoadedRuntime({
    application,
    owner: controller,
    preferences: preferences.port,
    pulseClaims,
  });
  return { application, controller, preferences, pulseClaims, runtime, timers };
};

const expectNoSweepMutation = () => {
  expect(platform.browserProbes).not.toHaveBeenCalled();
  expect(platform.insertBrowser).not.toHaveBeenCalled();
  expect(platform.markUndiscardable).not.toHaveBeenCalled();
  expect(platform.recordSign).not.toHaveBeenCalled();
  expect(platform.watchSockets).not.toHaveBeenCalled();
  expect(platform.writeLabelFromPage).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  platform.tabs = [];
  platform.sessionReady = Promise.resolve();
  platform.spacesReady = Promise.resolve();
  platform.panelActions = null;
  platform.menuActions = null;
  platform.titleListener = null;
  platform.onCrash = null;
  platform.onDiscard = null;
  platform.onRecoveryInvalidated = null;
  platform.onTabSelected = null;

  platform.browserProbes.mockReturnValue([]);
  platform.crashFactsFor.mockImplementation((tab: BrowserTab, kind: CrashKind) =>
    crashEvidence(tab, kind),
  );
  platform.factsFor.mockImplementation((tab: BrowserTab) => ({
    ...asFake(tab).facts,
    pending: asFake(tab).pending,
  }));
  platform.isDocShellActive.mockImplementation((tab: BrowserTab) => asFake(tab).active);
  platform.isLabelManaged.mockReturnValue(false);
  platform.isPending.mockImplementation((tab: BrowserTab) => asFake(tab).pending);
  platform.isRenamed.mockReturnValue(false);
  platform.insertBrowser.mockImplementation((tab: BrowserTab) => {
    asFake(tab).inserted = true;
  });
  platform.networkFacts.mockReturnValue({
    linkKnown: true,
    linkUp: true,
    offline: false,
  });
  platform.observeSigns.mockImplementation(
    (
      _isLive: () => boolean,
      onCrash: (tab: BrowserTab, kind: "crashed" | "restart-required") => void,
      onDiscard: (tab: BrowserTab) => void,
      onRecoveryInvalidated: (tab: BrowserTab) => void,
      onTabSelected: (tab: BrowserTab) => void,
    ) => {
      platform.onCrash = onCrash;
      platform.onDiscard = onDiscard;
      platform.onRecoveryInvalidated = onRecoveryInvalidated;
      platform.onTabSelected = onTabSelected;
      return vi.fn();
    },
  );
  platform.observeTitleChanges.mockImplementation(
    (listener: (tab: BrowserTab) => void) => {
      platform.titleListener = listener;
      return vi.fn();
    },
  );
  platform.observeTopic.mockReturnValue(vi.fn());
  platform.pageTitle.mockImplementation((tab: BrowserTab) => asFake(tab).title);
  platform.pinnedTabs.mockImplementation(() => platform.tabs);
  platform.readSign.mockReturnValue(null);
  platform.resetToLazy.mockReturnValue(true);
  platform.rollbackWakeCandidate.mockImplementation((tab: BrowserTab) => {
    asFake(tab).inserted = false;
    return true;
  });
  platform.setDocShellActive.mockImplementation((tab: BrowserTab, active: boolean) => {
    asFake(tab).active = active;
    return true;
  });
  platform.socketProbes.mockReturnValue([]);
  platform.socketRecordFor.mockImplementation(
    (_tab: BrowserTab, space: string, url: string) => ({
      framesIn: 0,
      framesOut: 0,
      lastFrameAt: null,
      open: 0,
      space,
      url,
      watching: false,
    }),
  );
  platform.spaceNameFor.mockReturnValue("Space A");
  platform.tabLabel.mockImplementation((tab: BrowserTab) => asFake(tab).label);
  platform.whenSessionRestored.mockImplementation(() => platform.sessionReady);
  platform.whenSpacesReady.mockImplementation(() => platform.spacesReady);
  platform.wakeCandidateState.mockImplementation((tab: BrowserTab) => {
    const fake = asFake(tab);
    if (!fake.pending) {
      return "started";
    }
    return fake.inserted ? "inserted-pending" : "lazy";
  });
  platform.writeLabelFromPage.mockImplementation((tab: BrowserTab) => {
    asFake(tab).label = asFake(tab).title;
    return true;
  });
  platform.installStatusPanel.mockImplementation(
    (actions: { onWake(view: Element): void }) => {
      platform.panelActions = actions;
      return vi.fn();
    },
  );
  platform.installKeepMenuItem.mockImplementation(
    (
      _isLive: () => boolean,
      _state: (tab: BrowserTab) => unknown,
      toggle: (tab: BrowserTab) => void,
    ) => {
      platform.menuActions = { toggle };
      return vi.fn();
    },
  );
});

describe("createKeepLoadedRuntime generation boundaries", () => {
  it("does no sweep work when stopped at paused session readiness", async () => {
    const session = deferred();
    platform.sessionReady = session.promise;
    const { controller, preferences, runtime } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => platform.whenSessionRestored.mock.calls.length === 1,
      "session readiness wait",
    );
    controller.stop();
    await started;

    session.resolve();
    await settle();

    expect(platform.whenSpacesReady).not.toHaveBeenCalled();
    expect(preferences.writes).toEqual([]);
    expectNoSweepMutation();
  });

  it("does not let a stale unload callback revive a stopped generation", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, controller, runtime } = await createHarness();
    await runtime.start();
    const staleDiscard = platform.onDiscard;

    controller.stop("replacement");
    staleDiscard?.(tab);
    await settle();

    expect(application.snapshot()).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      registrationCount: 0,
    });
  });

  it("does no sweep work when stopped at paused spaces readiness", async () => {
    const spaces = deferred();
    platform.spacesReady = spaces.promise;
    const { controller, preferences, runtime } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => platform.whenSpacesReady.mock.calls.length === 1,
      "spaces readiness wait",
    );
    controller.stop();
    await started;

    spaces.resolve();
    await settle();

    expect(preferences.writes).toEqual([]);
    expectNoSweepMutation();
  });

  it("stops an actual wake poll before post-wake work and restores the pref once", async () => {
    const tab = fakeTab({ pending: true });
    platform.tabs = [tab];
    const { controller, preferences, runtime, timers } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => platform.insertBrowser.mock.calls.length === 1 && timers.tasks.size > 0,
      "pending-tab wake poll",
    );
    expect(preferences.onDemand()).toBe(false);
    expect(preferences.writes).toEqual([false]);

    controller.stop();
    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
    asFake(tab).pending = false;
    timers.forceAll();
    await started;
    await settle();

    expect(platform.insertBrowser).toHaveBeenCalledTimes(1);
    expect(platform.recordSign).not.toHaveBeenCalled();
    expect(platform.watchSockets).not.toHaveBeenCalled();
    expect(platform.socketRecordFor).not.toHaveBeenCalled();
    expect(platform.writeLabelFromPage).not.toHaveBeenCalled();
    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
  });

  it("rolls a real runtime timeout back, retries once, and leaves no pending owner", async () => {
    const tab = fakeTab({ pending: true });
    platform.tabs = [tab];
    const { preferences, runtime, timers } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => platform.insertBrowser.mock.calls.length === 1,
      "first wake insertion",
    );
    for (let poll = 0; poll < 200; poll += 1) {
      timers.forceLatest();
    }
    await settle();

    expect(platform.rollbackWakeCandidate).toHaveBeenCalledTimes(1);
    expect(asFake(tab).inserted).toBe(false);
    expect(preferences.onDemand()).toBe(false);
    expect(runtime.application().snapshot).toMatchObject({
      activeCount: 1,
      wakeAttempt: 1,
      wakePhase: "retrying",
    });

    timers.forceLatest();
    expect(platform.insertBrowser).toHaveBeenCalledTimes(2);
    asFake(tab).pending = false;
    timers.forceLatest();
    await started;
    await settle();

    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
    expect(runtime.application().snapshot).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      wakeCandidates: 0,
      wakePhase: "idle",
    });
  });

  it("updates the final persistent target synchronously while a wake is held", async () => {
    const tab = fakeTab({ pending: true });
    platform.tabs = [tab];
    const { preferences, runtime, timers } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => platform.insertBrowser.mock.calls.length === 1,
      "held setting wake",
    );
    preferences.values.lazyPinned = false;
    preferences.observers.get("lazy-pinned")?.();

    expect(preferences.onDemand()).toBe(false);
    expect(preferences.writes).toEqual([false]);
    expect(runtime.application().snapshot.desiredOnDemand).toBe(false);

    asFake(tab).pending = false;
    timers.forceLatest();
    await started;
    await settle();

    expect(preferences.onDemand()).toBe(false);
    expect(preferences.writes).toEqual([false]);
  });

  it("guards actual crash recovery when stopped inside its wake poll", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, preferences, runtime, timers } = await createHarness();
    await runtime.start();
    platform.recordSign.mockClear();
    platform.insertBrowser.mockClear();
    preferences.writes.length = 0;

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(
      () =>
        platform.resetToLazy.mock.calls.length === 1 &&
        platform.insertBrowser.mock.calls.length === 1 &&
        preferences.onDemand() === false,
      "crash recovery wake poll",
    );

    controller.stop();
    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
    asFake(tab).pending = false;
    timers.forceAll();
    await settle(12);

    expect(platform.resetToLazy).toHaveBeenCalledTimes(1);
    expect(platform.insertBrowser).toHaveBeenCalledTimes(1);
    expect(platform.recordSign).not.toHaveBeenCalled();
    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
  });

  it("retries a timed-out crash wake without charging the recovery delegate twice", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { runtime, timers } = await createHarness({ crashAttempts: "1" });
    await runtime.start();
    platform.insertBrowser.mockClear();
    platform.resetToLazy.mockClear();
    platform.rollbackWakeCandidate.mockClear();

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(
      () => platform.insertBrowser.mock.calls.length === 1,
      "first crash insertion",
    );
    for (let poll = 0; poll < 200; poll += 1) {
      timers.forceLatest();
    }
    timers.forceLatest();

    expect(platform.resetToLazy).toHaveBeenCalledTimes(1);
    expect(platform.rollbackWakeCandidate).toHaveBeenCalledTimes(1);
    expect(platform.insertBrowser).toHaveBeenCalledTimes(2);

    asFake(tab).pending = false;
    timers.forceLatest();
    await settle(16);

    expect(platform.resetToLazy).toHaveBeenCalledTimes(1);
    expect(runtime.application().snapshot).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
    });
  });

  it("keeps an exhausted crash budget across later crash notifications", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { runtime, preferences, timers } = await createHarness({ crashAttempts: "1" });
    await runtime.start();
    platform.resetToLazy.mockClear();
    platform.insertBrowser.mockClear();

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => platform.resetToLazy.mock.calls.length === 1, "first recovery");
    asFake(tab).pending = false;
    timers.forceAll();
    await settle(16);

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await settle(12);

    expect(platform.resetToLazy).toHaveBeenCalledTimes(1);
    expect(platform.insertBrowser).toHaveBeenCalledTimes(1);
    expect(platform.log).toHaveBeenCalledWith(
      expect.stringContaining("already recovered 1 time(s)"),
    );
    expect(preferences.onDemand()).toBe(true);
  });

  it("does not charge a crash attempt when cancellation wins before recovery mutation", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, controller, runtime } = await createHarness();
    await runtime.start();

    const gate = deferred();
    const blocker = application.register({
      isLive: () => true,
      recover: async () => gate.promise,
      reportError: () => {},
      sweep: () => {},
    });
    const blockerTab = fakeTab();
    const held = blocker.requestRecovery(blockerTab, crashEvidence(blockerTab)).done;
    await waitFor(
      () => application.snapshot().activeKind === "recovery",
      "recovery blocker",
    );

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => application.snapshot().keyRecords === 2, "queued crash recovery");
    controller.stop("replacement");

    const replacement = application.register({
      isLive: () => true,
      recover: () => {},
      reportError: () => {},
      sweep: () => {},
    });
    expect(replacement.recentRecoveryAttempts(tab, Date.now(), 60 * 60_000)).toEqual([]);

    gate.resolve();
    await held;
    blocker.dispose();
    replacement.dispose();
  });

  it("suppresses only the discard synchronously owned by the current recovery", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, runtime, timers } = await createHarness();
    await runtime.start();
    const initialSessionReads = platform.whenSessionRestored.mock.calls.length;

    platform.resetToLazy.mockImplementation(() => {
      platform.onDiscard?.(tab);
      return true;
    });
    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(
      () => platform.resetToLazy.mock.calls.length === 1,
      "owned recovery discard",
    );
    expect(platform.whenSessionRestored.mock.calls.length).toBe(initialSessionReads);

    asFake(tab).pending = false;
    timers.forceAll();
    await settle(16);
    expect(application.snapshot()).toMatchObject({ activeCount: 0, keyRecords: 0 });
  });

  it("queues an external unload while recovery is active instead of hiding it", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, controller, runtime } = await createHarness();
    await runtime.start();

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(
      () =>
        platform.insertBrowser.mock.calls.length === 1 &&
        application.snapshot().activeKind === "recovery",
      "active recovery insertion",
    );
    platform.onDiscard?.(tab);
    expect(application.snapshot()).toMatchObject({ activeCount: 1, readyCount: 1 });

    controller.stop("replacement");
  });

  it("queues an external unload while a sweep is active", async () => {
    const session = deferred();
    platform.sessionReady = session.promise;
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, controller, runtime } = await createHarness();
    const started = runtime.start();
    await waitFor(
      () => application.snapshot().activeKind === "sweep",
      "active sweep before external unload",
    );

    platform.onDiscard?.(tab);
    expect(application.snapshot()).toMatchObject({ activeCount: 1, trailingCount: 1 });

    controller.stop("replacement");
    session.resolve();
    await started;
  });

  it("makes a forced canceled pulse unable to mutate or rearm", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, pulseClaims, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();

    expect(platform.setDocShellActive).toHaveBeenCalledWith(tab, true);
    expect(timers.tasks.size).toBeGreaterThan(0);
    controller.stop();
    expect(platform.setDocShellActive).toHaveBeenLastCalledWith(tab, false);
    expect(pulseClaims.activeCount(controller)).toBe(0);

    platform.setDocShellActive.mockClear();
    const timerCount = timers.tasks.size;
    timers.forceAll();
    await settle();

    expect(platform.setDocShellActive).not.toHaveBeenCalled();
    expect(timers.tasks).toHaveLength(timerCount);
    expect(controller.pendingTimers).toBe(0);
  });

  it("holds at most one mod-owned tab while a pulse cycle walks its inventory", async () => {
    const first = fakeTab();
    const second = fakeTab();
    platform.tabs = [first, second];
    const { controller, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });

    await runtime.start();
    expect(platform.setDocShellActive).toHaveBeenCalledWith(first, true);
    expect(platform.setDocShellActive).not.toHaveBeenCalledWith(second, true);

    timers.forceLatest();
    await settle();
    expect(platform.setDocShellActive).toHaveBeenCalledWith(first, false);
    expect(platform.setDocShellActive).toHaveBeenCalledWith(second, true);

    timers.forceLatest();
    await settle();
    expect(platform.setDocShellActive).toHaveBeenCalledWith(second, false);
    controller.stop();
  });

  it("does not advance to another tab after freshening is turned off mid-cycle", async () => {
    const first = fakeTab();
    const second = fakeTab();
    platform.tabs = [first, second];
    const { controller, preferences, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });

    await runtime.start();
    preferences.values.freshen = "0";
    preferences.observers.get("freshen")?.();
    await settle();

    expect(
      platform.setDocShellActive.mock.calls.some(
        ([candidate, value]) => candidate === first && value === false,
      ),
    ).toBe(true);
    expect(
      platform.setDocShellActive.mock.calls.some(
        ([candidate, value]) => candidate === second && value === true,
      ),
    ).toBe(false);
    controller.stop();
  });

  it("forgets a selected pulse claim without deactivating the user-owned docshell", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.setDocShellActive.mockClear();
    asFake(tab).selected = true;
    platform.onTabSelected?.(tab);

    expect(platform.setDocShellActive).not.toHaveBeenCalledWith(tab, false);
    expect(platform.stopWatchingSocket).toHaveBeenCalledWith(tab);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it.each(["close", "unpin"] as const)(
    "releases the pulse claim and socket watcher immediately on %s",
    async kind => {
      const tab = fakeTab();
      platform.tabs = [tab];
      const { controller, pulseClaims, runtime } = await createHarness({
        freshen: "10",
        freshenHold: "5",
      });
      await runtime.start();
      expect(pulseClaims.activeCount(controller)).toBe(1);

      platform.setDocShellActive.mockClear();
      if (kind === "unpin") {
        asFake(tab).pinned = false;
      } else {
        asFake(tab).isConnected = false;
      }
      platform.onRecoveryInvalidated?.(tab);

      expect(platform.stopWatchingSocket).toHaveBeenCalledWith(tab);
      if (kind === "unpin") {
        expect(platform.setDocShellActive).toHaveBeenCalledWith(tab, false);
      } else {
        expect(platform.setDocShellActive).not.toHaveBeenCalledWith(tab, false);
      }
      expect(pulseClaims.activeCount(controller)).toBe(0);
      expect(pulseClaims.get(tab)).toEqual({ heldSince: null, lastPulseAt: null });
      controller.stop();
    },
  );

  it("drops an allowlist-released claim before the follow-up sweep", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, preferences, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.setDocShellActive.mockClear();
    asFake(tab).facts.flagged = false;
    preferences.values.match = "https://other.example.test/";
    preferences.observers.get("match")?.();

    expect(platform.stopWatchingSocket).toHaveBeenCalledWith(tab);
    expect(platform.setDocShellActive).toHaveBeenCalledWith(tab, false);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("forgets an externally deactivated claim without writing false again", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, pulseClaims, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.setDocShellActive.mockClear();
    asFake(tab).active = false;
    timers.forceLatest();
    await settle();

    expect(platform.setDocShellActive).not.toHaveBeenCalledWith(tab, false);
    expect(platform.stopWatchingSocket).toHaveBeenCalledWith(tab);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("releases the active pulse immediately when freshening is turned off", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, preferences, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.setDocShellActive.mockClear();
    preferences.values.freshen = "0";
    preferences.observers.get("freshen")?.();

    expect(platform.setDocShellActive).toHaveBeenCalledWith(tab, false);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    expect(platform.stopWatchingSocket).not.toHaveBeenCalledWith(tab);
    controller.stop();
  });

  it("does not refill a panel when its command sweep finishes after stop", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const commandSession = deferred();
    platform.sessionReady = commandSession.promise;
    platform.renderPanelAction.mockClear();
    platform.renderPanelReport.mockClear();
    platform.browserProbes.mockClear();
    const view = {} as Element;

    platform.panelActions?.onWake(view);
    await waitFor(
      () => platform.whenSessionRestored.mock.calls.length >= 2,
      "panel command sweep readiness",
    );
    expect(platform.renderPanelReport).toHaveBeenCalledTimes(1);
    expect(platform.renderPanelAction).toHaveBeenCalledTimes(1);

    controller.stop();
    commandSession.resolve();
    await settle(12);

    expect(platform.browserProbes).not.toHaveBeenCalled();
    expect(platform.renderPanelReport).toHaveBeenCalledTimes(1);
    expect(platform.renderPanelAction).toHaveBeenCalledTimes(1);
  });

  it("disposes only the closing window's panel view on native unload", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const disposePanel = platform.installStatusPanel.mock.results[0]?.value;

    controller.stop("window-unload");

    expect(disposePanel).toHaveBeenCalledOnce();
    expect(disposePanel).toHaveBeenCalledWith();
  });

  it("disposes the application widget on a Sine generation unload", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const disposePanel = platform.installStatusPanel.mock.results[0]?.value;

    controller.stop("sine-unload");

    expect(disposePanel).toHaveBeenCalledOnce();
    expect(disposePanel).toHaveBeenCalledWith();
  });

  it("releases the panel through application ownership after a local startup failure", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const disposePanel = platform.installStatusPanel.mock.results[0]?.value;

    controller.stop("startup-failure");

    expect(disposePanel).toHaveBeenCalledOnce();
    expect(disposePanel).toHaveBeenCalledWith();
  });

  it("disposes the owner registration if widget installation throws", async () => {
    platform.installStatusPanel.mockImplementationOnce(() => {
      throw new Error("widget installation failed");
    });
    const { application, runtime } = await createHarness();

    await expect(runtime.start()).rejects.toThrow("widget installation failed");

    expect(application.snapshot()).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      registrationCount: 0,
    });
  });

  it("coalesces repeated live triggers into one trailing application sweep", async () => {
    const session = deferred();
    platform.sessionReady = session.promise;
    const { application, preferences, runtime } = await createHarness();
    const started = runtime.start();

    await waitFor(
      () => application.snapshot().activeKind === "sweep",
      "active startup sweep",
    );
    const requests = Array.from({ length: 100 }, () => runtime.runSweep());
    preferences.observers.get("match")?.();
    platform.panelActions?.onWake({} as Element);

    expect(application.snapshot()).toMatchObject({
      activeCount: 1,
      keyRecords: 1,
      sweepRecords: 1,
      trailingCount: 1,
    });

    session.resolve();
    await Promise.all([started, ...requests]);
    await waitFor(
      () => application.snapshot().activeCount === 0,
      "coalesced sweeps to drain",
    );

    expect(platform.whenSessionRestored).toHaveBeenCalledTimes(2);
  });

  it.each(["close", "unpin"] as const)(
    "cancels a queued recovery immediately on tab %s",
    async invalidation => {
      const tab = fakeTab();
      platform.tabs = [tab];
      const { application, runtime } = await createHarness();
      await runtime.start();
      platform.insertBrowser.mockClear();
      platform.resetToLazy.mockClear();

      const gate = deferred();
      const blocker = application.register({
        isLive: () => true,
        recover: async () => gate.promise,
        reportError: () => {},
        sweep: () => {},
      });
      const blockerTab = fakeTab();
      const held = blocker.requestRecovery(blockerTab, crashEvidence(blockerTab)).done;
      await waitFor(
        () => application.snapshot().activeKind === "recovery",
        "held recovery before crash",
      );
      asFake(tab).pending = true;
      platform.onCrash?.(tab, "crashed");
      await waitFor(() => application.snapshot().keyRecords === 2, "queued tab recovery");

      if (invalidation === "unpin") {
        asFake(tab).pinned = false;
      }
      platform.onRecoveryInvalidated?.(tab);
      expect(application.snapshot()).toMatchObject({ keyRecords: 1, readyCount: 0 });

      gate.resolve();
      await held;
      blocker.dispose();
      await waitFor(() => application.snapshot().keyRecords === 0, "close cancellation");
      expect(platform.resetToLazy).not.toHaveBeenCalled();
      expect(platform.insertBrowser).not.toHaveBeenCalled();
    },
  );

  it("cancels a queued recovery when the context menu releases its allowlist key", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, runtime } = await createHarness();
    await runtime.start();
    platform.insertBrowser.mockClear();
    platform.resetToLazy.mockClear();

    const gate = deferred();
    const blockerTab = fakeTab();
    const blocker = application.register({
      isLive: () => true,
      recover: async () => gate.promise,
      reportError: () => {},
      sweep: () => {},
    });
    const held = blocker.requestRecovery(blockerTab, crashEvidence(blockerTab)).done;
    await waitFor(
      () => application.snapshot().activeKind === "recovery",
      "held recovery before release",
    );
    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => application.snapshot().readyCount === 1, "queued tab recovery");

    platform.menuActions?.toggle(tab);
    asFake(tab).facts.flagged = false;
    gate.resolve();
    await held;
    blocker.dispose();
    await waitFor(() => application.snapshot().keyRecords === 0, "allowlist release");

    expect(platform.resetToLazy).not.toHaveBeenCalled();
    expect(platform.insertBrowser).not.toHaveBeenCalled();
  });

  it("rechecks live membership before reading policy or spending a queued recovery", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, preferences, runtime } = await createHarness();
    await runtime.start();
    preferences.writes.length = 0;

    const gate = deferred();
    const blockerTab = fakeTab();
    const blocker = application.register({
      isLive: () => true,
      recover: async () => gate.promise,
      reportError: () => {},
      sweep: () => {},
    });
    const held = blocker.requestRecovery(blockerTab, crashEvidence(blockerTab)).done;
    await waitFor(
      () => application.snapshot().activeKind === "recovery",
      "held recovery before membership change",
    );
    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => application.snapshot().readyCount === 1, "queued tab recovery");
    platform.factsFor.mockClear();
    platform.resetToLazy.mockClear();
    platform.insertBrowser.mockClear();

    platform.tabs = [];
    gate.resolve();
    await held;
    blocker.dispose();
    await waitFor(() => application.snapshot().keyRecords === 0, "membership recheck");

    expect(platform.factsFor).not.toHaveBeenCalled();
    expect(platform.resetToLazy).not.toHaveBeenCalled();
    expect(platform.insertBrowser).not.toHaveBeenCalled();
    expect(preferences.writes).toEqual([]);
  });

  it("revalidates successful intervening work before spending a recovery", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, preferences, runtime } = await createHarness();
    await runtime.start();
    platform.insertBrowser.mockClear();
    platform.resetToLazy.mockClear();
    preferences.writes.length = 0;

    const gate = deferred();
    platform.sessionReady = gate.promise;
    const heldSweep = runtime.runSweep();
    await waitFor(
      () => application.snapshot().activeKind === "sweep",
      "held sweep before recovery",
    );
    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => application.snapshot().readyCount === 1, "queued crash recovery");

    asFake(tab).pending = false;
    gate.resolve();
    await heldSweep;
    await waitFor(() => application.snapshot().keyRecords === 0, "revalidated recovery");

    expect(platform.resetToLazy).not.toHaveBeenCalled();
    expect(platform.insertBrowser).not.toHaveBeenCalled();
    expect(preferences.writes).toEqual([]);
  });

  it("uses the newest crash evidence and current recovery settings at dequeue", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { application, preferences, runtime } = await createHarness();
    await runtime.start();
    platform.resetToLazy.mockClear();

    const gate = deferred();
    const blocker = application.register({
      isLive: () => true,
      recover: async () => gate.promise,
      reportError: () => {},
      sweep: () => {},
    });
    const blockerTab = fakeTab();
    const held = blocker.requestRecovery(blockerTab, crashEvidence(blockerTab)).done;
    await waitFor(
      () => application.snapshot().activeKind === "recovery",
      "held recovery before duplicate crash",
    );
    asFake(tab).pending = true;
    platform.crashFactsFor
      .mockReturnValueOnce(crashEvidence(tab, "crashed", { url: "https://first.test/" }))
      .mockReturnValueOnce(
        crashEvidence(tab, "restart-required", { url: "https://newest.test/" }),
      );
    platform.onCrash?.(tab, "crashed");
    platform.onCrash?.(tab, "restart-required");
    preferences.values.crashAttempts = "0";

    gate.resolve();
    await held;
    blocker.dispose();
    await waitFor(
      () => application.snapshot().keyRecords === 0,
      "latest-evidence recovery",
    );

    expect(platform.crashFactsFor).toHaveBeenCalledTimes(2);
    expect(platform.crashFactsFor).toHaveBeenLastCalledWith(tab, "restart-required");
    expect(platform.resetToLazy).not.toHaveBeenCalled();
    expect(platform.log).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/newest\.test\/.*crash recovery is turned off/),
    );
  });
});
