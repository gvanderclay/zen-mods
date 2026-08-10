import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeepLoadedController } from "./controller.ts";
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
  sessionReady: Promise.resolve() as Promise<void>,
  setDocShellActive: vi.fn(),
  setFlag: vi.fn(),
  setMarker: vi.fn(),
  socketProbes: vi.fn(),
  socketRecordFor: vi.fn(),
  spaceNameFor: vi.fn(),
  spacesReady: Promise.resolve() as Promise<void>,
  stopWatchingSockets: vi.fn(),
  tabLabel: vi.fn(),
  tabs: [] as BrowserTab[],
  titleListener: null as null | ((tab: BrowserTab) => void),
  watchSockets: vi.fn(),
  whenSessionRestored: vi.fn(),
  whenSpacesReady: vi.fn(),
  writeLabelFromPage: vi.fn(),
  onCrash: null as null | ((tab: BrowserTab, kind: "crashed") => void),
  onDiscard: null as null | ((tab: BrowserTab) => void),
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
  setDocShellActive: platform.setDocShellActive,
  setFlag: platform.setFlag,
  setMarker: platform.setMarker,
  spaceNameFor: platform.spaceNameFor,
  tabLabel: platform.tabLabel,
  whenSessionRestored: platform.whenSessionRestored,
  whenSpacesReady: platform.whenSpacesReady,
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
  watchSockets: platform.watchSockets,
}));

vi.mock("./platform/system.ts", () => ({
  networkFacts: platform.networkFacts,
  observeTopic: platform.observeTopic,
}));

interface FakeTab {
  active: boolean;
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
  readonly tasks = new Map<
    number,
    { callback: () => void; canceled: boolean; delayMs: number }
  >();

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.tasks.set(id, { callback, canceled: false, delayMs });
    return id;
  };

  readonly clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (task) {
      task.canceled = true;
    }
  };

  force(id: number): void {
    this.tasks.get(id)?.callback();
  }

  forceAll(): void {
    // Snapshot first: a broken stale callback that re-arms must make the assertion
    // fail, not turn the test helper itself into an endless timer drain.
    for (const id of [...this.tasks.keys()]) {
      this.force(id);
    }
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

const preferenceHarness = (
  overrides: Partial<{
    freshenHold: string;
    freshen: string;
    lazyPinned: boolean;
    match: string;
    onDemand: boolean;
  }> = {},
) => {
  let onDemand = overrides.onDemand ?? true;
  const writes: boolean[] = [];
  const observers = new Map<ObservedPreference, () => void>();
  const port: PreferencesPort = {
    readMatch: () => overrides.match ?? "",
    readCrashAttempts: () => "3",
    readCrashWindow: () => "60",
    readFreshenSeconds: () => overrides.freshen ?? "0",
    readFreshenHoldSeconds: () => overrides.freshenHold ?? "5",
    readDebug: () => false,
    readLazyPinnedWanted: () => overrides.lazyPinned ?? true,
    readOnDemand: () => onDemand,
    writeOnDemand: value => {
      onDemand = value;
      writes.push(value);
    },
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
  return { observers, onDemand: () => onDemand, port, writes };
};

const createHarness = async (options: Parameters<typeof preferenceHarness>[0] = {}) => {
  vi.resetModules();
  const { createKeepLoadedRuntime } = await import("./runtime.ts");
  const timers = new ManualTimers();
  const preferences = preferenceHarness(options);
  const controller = new KeepLoadedController({
    timers,
    preferences: preferences.port,
  });
  const pulseClaims = new WeakMap<
    BrowserTab,
    { heldSince: number | null; lastPulseAt: number | null }
  >();
  const runtime = createKeepLoadedRuntime({
    owner: controller,
    preferences: preferences.port,
    pulseClaims,
  });
  return { controller, preferences, pulseClaims, runtime, timers };
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
  platform.titleListener = null;
  platform.onCrash = null;
  platform.onDiscard = null;

  platform.browserProbes.mockReturnValue([]);
  platform.crashFactsFor.mockImplementation((tab: BrowserTab, kind: "crashed") => ({
    connected: true,
    crashedPage: false,
    kind,
    pending: asFake(tab).pending,
    remote: false,
    url: asFake(tab).facts.url,
  }));
  platform.factsFor.mockImplementation((tab: BrowserTab) => ({
    ...asFake(tab).facts,
    pending: asFake(tab).pending,
  }));
  platform.isDocShellActive.mockImplementation((tab: BrowserTab) => asFake(tab).active);
  platform.isLabelManaged.mockReturnValue(false);
  platform.isPending.mockImplementation((tab: BrowserTab) => asFake(tab).pending);
  platform.isRenamed.mockReturnValue(false);
  platform.networkFacts.mockReturnValue({
    linkKnown: true,
    linkUp: true,
    offline: false,
  });
  platform.observeSigns.mockImplementation(
    (
      _isLive: () => boolean,
      onCrash: (tab: BrowserTab, kind: "crashed") => void,
      onDiscard: (tab: BrowserTab) => void,
    ) => {
      platform.onCrash = onCrash;
      platform.onDiscard = onDiscard;
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
  platform.installKeepMenuItem.mockReturnValue(vi.fn());
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
    asFake(tab).pending = false;
    timers.forceAll();
    await settle(12);

    expect(platform.resetToLazy).toHaveBeenCalledTimes(1);
    expect(platform.insertBrowser).toHaveBeenCalledTimes(1);
    expect(platform.recordSign).not.toHaveBeenCalled();
    expect(preferences.onDemand()).toBe(true);
    expect(preferences.writes).toEqual([false, true]);
  });

  it("makes a forced canceled pulse unable to mutate or rearm", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();

    expect(platform.setDocShellActive).toHaveBeenCalledWith(tab, true);
    expect(timers.tasks.size).toBeGreaterThan(0);
    controller.stop();
    expect(platform.setDocShellActive).toHaveBeenLastCalledWith(tab, false);

    platform.setDocShellActive.mockClear();
    const timerCount = timers.tasks.size;
    timers.forceAll();
    await settle();

    expect(platform.setDocShellActive).not.toHaveBeenCalled();
    expect(timers.tasks).toHaveLength(timerCount);
    expect(controller.pendingTimers).toBe(0);
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
    expect(disposePanel).toHaveBeenCalledWith("window");
  });

  it("disposes the application widget on a Sine generation unload", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const disposePanel = platform.installStatusPanel.mock.results[0]?.value;

    controller.stop("sine-unload");

    expect(disposePanel).toHaveBeenCalledOnce();
    expect(disposePanel).toHaveBeenCalledWith("application");
  });

  it("does not destroy another window's widget after a local startup failure", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const disposePanel = platform.installStatusPanel.mock.results[0]?.value;

    controller.stop("startup-failure");

    expect(disposePanel).toHaveBeenCalledOnce();
    expect(disposePanel).toHaveBeenCalledWith("window");
  });
});
