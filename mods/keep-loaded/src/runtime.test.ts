import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ApplicationOwnerApi,
  KeepLoadedApplicationOwner,
  type WorkResult,
} from "./application-coordinator.ts";
import { KeepLoadedController } from "./controller.ts";
import type { CrashFacts, CrashKind } from "./core/crash.ts";
import { parsePulseSettings } from "./core/freshness.ts";
import { parseMatchList } from "./core/match.ts";
import { PulseClaims } from "./core/pulse-claims.ts";
import { parseAttempts, parseWindowMs } from "./core/recovery.ts";
import type { ObservedPreference, PreferencesPort } from "./platform/prefs.ts";

const platform = vi.hoisted(() => ({
  browserProbes: vi.fn(),
  crashFactsFor: vi.fn(),
  docShellState: vi.fn(),
  factsFor: vi.fn(),
  insertBrowser: vi.fn(),
  installKeepMenuItem: vi.fn(),
  installStatusPanel: vi.fn(),
  isDocShellActive: vi.fn(),
  isLabelManaged: vi.fn(),
  isPending: vi.fn(),
  isRenamed: vi.fn(),
  log: vi.fn(),
  logLazy: vi.fn(),
  markUndiscardable: vi.fn(),
  menuActions: null as null | { toggle(tab: BrowserTab): void },
  networkFacts: vi.fn(),
  observeSigns: vi.fn(),
  observeTitleChanges: vi.fn(),
  observeTopic: vi.fn(),
  pageTitle: vi.fn(),
  panelActions: null as null | {
    onReset?(view: Element): void;
    onViewShowing?(view: Element): void;
    onWake(view: Element): void;
    onWidgetError?(error: unknown): void;
  },
  panelView: null as Element | null,
  panelDisposers: [] as Array<ReturnType<typeof vi.fn>>,
  pinnedTabs: vi.fn(),
  readSign: vi.fn(),
  recordSign: vi.fn(),
  renderPanelPresentation: vi.fn(),
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
  isPending: platform.isPending,
  markUndiscardable: platform.markUndiscardable,
  pinnedTabs: platform.pinnedTabs,
  resetToLazy: platform.resetToLazy,
  rollbackWakeCandidate: platform.rollbackWakeCandidate,
  setFlag: platform.setFlag,
  setMarker: platform.setMarker,
  spaceNameFor: platform.spaceNameFor,
  whenSessionRestored: platform.whenSessionRestored,
  whenSpacesReady: platform.whenSpacesReady,
  wakeCandidateState: platform.wakeCandidateState,
}));

vi.mock("./platform/docshell.ts", () => ({
  docShellState: platform.docShellState,
  isDocShellActive: platform.isDocShellActive,
  setDocShellActive: platform.setDocShellActive,
}));

vi.mock("./platform/label.ts", () => ({
  isLabelManaged: platform.isLabelManaged,
  isRenamed: platform.isRenamed,
  observeTitleChanges: platform.observeTitleChanges,
  pageTitle: platform.pageTitle,
  tabLabel: platform.tabLabel,
  writeLabelFromPage: platform.writeLabelFromPage,
}));

vi.mock("./platform/liveness.ts", () => ({
  observeSigns: platform.observeSigns,
  recordSign: platform.recordSign,
  signFor: platform.readSign,
}));

vi.mock("./platform/log.ts", () => ({
  log: platform.log,
  logLazy: platform.logLazy,
}));

vi.mock("./platform/menu.ts", () => ({
  installKeepMenuItem: platform.installKeepMenuItem,
}));

vi.mock("./platform/panel.ts", () => ({
  installStatusPanel: platform.installStatusPanel,
}));

vi.mock("./platform/panel-render.ts", () => ({
  renderPanelPresentation: platform.renderPanelPresentation,
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
    showStatusButton: boolean;
  }> = {},
) => {
  const values = {
    crashAttempts: overrides.crashAttempts ?? "3",
    crashWindow: overrides.crashWindow ?? "60",
    freshenHold: overrides.freshenHold ?? "5",
    freshen: overrides.freshen ?? "0",
    lazyPinned: overrides.lazyPinned ?? true,
    match: overrides.match ?? "",
    showStatusButton: overrides.showStatusButton ?? true,
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
    snapshot: () => ({
      match: parseMatchList(values.match),
      crashAttempts: parseAttempts(values.crashAttempts),
      crashWindowMs: parseWindowMs(values.crashWindow),
      freshen: parsePulseSettings(values.freshen, values.freshenHold),
      debug: false,
      lazyPinnedWanted: values.lazyPinned,
      showStatusButton: values.showStatusButton,
    }),
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
    now: timers.now,
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
  platform.panelDisposers = [];
  platform.panelView = {} as Element;
  platform.menuActions = null;
  platform.titleListener = null;
  platform.onCrash = null;
  platform.onDiscard = null;
  platform.onRecoveryInvalidated = null;
  platform.onTabSelected = null;

  platform.browserProbes.mockReturnValue([]);
  platform.logLazy.mockImplementation((detail: () => readonly unknown[] | null) => {
    const args = detail();
    if (args) {
      platform.log(...args);
    }
  });
  platform.crashFactsFor.mockImplementation((tab: BrowserTab, kind: CrashKind) =>
    crashEvidence(tab, kind),
  );
  platform.docShellState.mockImplementation((tab: BrowserTab) => {
    const fake = asFake(tab);
    if (!fake.isConnected) {
      return "gone";
    }
    return fake.active ? "active" : "inactive";
  });
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
  platform.recordSign.mockImplementation((_tab: BrowserTab, kind: string) => ({
    at: Date.now(),
    kind,
  }));
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
    (actions: {
      onViewReady?(view: Element): void;
      onViewShowing?(view: Element): void;
      onWake(view: Element): void;
      onReset?(view: Element): void;
      onWidgetError?(error: unknown): void;
    }) => {
      platform.panelActions = actions;
      actions.onViewReady?.(platform.panelView as Element);
      const dispose = vi.fn();
      platform.panelDisposers.push(dispose);
      return dispose;
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
  it("caches capabilities after readiness while tab facts stay dynamic", async () => {
    const session = deferred();
    const spaces = deferred();
    platform.sessionReady = session.promise;
    platform.spacesReady = spaces.promise;
    const tab = fakeTab();
    platform.tabs = [tab];
    platform.browserProbes.mockReturnValue([
      { name: "stable browser API", present: true, required: true },
    ]);

    const { controller, runtime } = await createHarness();
    const started = runtime.start();
    await waitFor(
      () => platform.whenSessionRestored.mock.calls.length === 1,
      "capability readiness",
    );
    expect(platform.browserProbes).not.toHaveBeenCalled();

    session.resolve();
    spaces.resolve();
    await started;
    expect(platform.browserProbes).toHaveBeenCalledOnce();
    expect(platform.socketProbes).toHaveBeenCalledOnce();

    platform.browserProbes.mockReturnValue([
      { name: "changed after readiness", present: false, required: true },
    ]);
    asFake(tab).facts.url = "https://changed.example.test/";
    platform.factsFor.mockClear();
    await runtime.runSweep();

    expect(platform.browserProbes).toHaveBeenCalledOnce();
    expect(platform.factsFor).toHaveBeenCalledWith(tab);
    controller.stop();
  });

  it.each(["pending", "renamed", "managed"] as const)(
    "rejects a %s title event before privileged fact collection",
    async guard => {
      const tab = fakeTab({ pending: guard === "pending" });
      const { controller, runtime } = await createHarness();
      await runtime.start();
      platform.factsFor.mockClear();
      platform.pageTitle.mockClear();
      platform.isRenamed.mockReturnValue(guard === "renamed");
      platform.isLabelManaged.mockReturnValue(guard === "managed");

      platform.titleListener?.(tab);

      expect(platform.factsFor).not.toHaveBeenCalled();
      expect(platform.pageTitle).not.toHaveBeenCalled();
      controller.stop();
    },
  );

  it("brings an eligible tab's label up to date from its title event", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, runtime } = await createHarness();
    await runtime.start();
    // The startup sweep already relabelled once; this asserts the event path, not it.
    platform.writeLabelFromPage.mockClear();
    asFake(tab).title = "Mail (2)";

    platform.titleListener?.(tab);

    expect(platform.writeLabelFromPage).toHaveBeenCalledWith(tab);
    expect(asFake(tab).label).toBe("Mail (2)");
    controller.stop();
  });

  it.each([20, 100, 500])(
    "uses one inspected inventory for a no-wake sweep of %i tabs",
    async size => {
      platform.tabs = Array.from({ length: size }, (_, index) =>
        fakeTab({
          facts: {
            flagged: true,
            space: `space-${index % 4}`,
            url: `https://example.test/tab/${index}`,
          },
        }),
      );
      const { controller, runtime } = await createHarness();

      await runtime.start();

      expect(platform.pinnedTabs).toHaveBeenCalledOnce();
      expect(platform.factsFor).toHaveBeenCalledTimes(size);
      expect(platform.readSign).toHaveBeenCalledTimes(size);
      expect(platform.socketRecordFor).toHaveBeenCalledTimes(size);
      expect(platform.setMarker).toHaveBeenCalledTimes(size);
      expect(platform.markUndiscardable).toHaveBeenCalledTimes(size);
      expect(platform.watchSockets).toHaveBeenCalledWith(
        platform.tabs,
        expect.any(Function),
      );
      controller.stop();
    },
  );

  it("takes one post-wake inventory and reuses its refreshed facts", async () => {
    const tab = fakeTab({ pending: true });
    platform.tabs = [tab];
    platform.insertBrowser.mockImplementation(candidate => {
      asFake(candidate).inserted = true;
      asFake(candidate).pending = false;
    });
    const { controller, runtime } = await createHarness();

    await runtime.start();

    expect(platform.pinnedTabs).toHaveBeenCalledTimes(2);
    expect(platform.factsFor).toHaveBeenCalledTimes(2);
    expect(platform.readSign).toHaveBeenCalledOnce();
    expect(platform.socketRecordFor).toHaveBeenCalledOnce();
    expect(platform.writeLabelFromPage).toHaveBeenCalledWith(tab);
    controller.stop();
  });

  it("builds panel rows and the sleeping count in one inspected pass", async () => {
    const awake = fakeTab({
      facts: {
        flagged: true,
        space: "space-a",
        url: "https://awake.example.test/",
      },
    });
    const sleeping = fakeTab({
      facts: {
        flagged: true,
        space: "space-b",
        url: "https://sleeping.example.test/",
      },
      pending: true,
    });
    const { controller, runtime } = await createHarness();
    await runtime.start();
    platform.tabs = [awake, sleeping];
    platform.pinnedTabs.mockClear();
    platform.factsFor.mockClear();
    platform.readSign.mockClear();
    platform.socketRecordFor.mockClear();
    platform.renderPanelPresentation.mockClear();

    runtime.fillPanel(platform.panelView as Element);

    expect(platform.pinnedTabs).toHaveBeenCalledOnce();
    expect(platform.factsFor).toHaveBeenCalledTimes(2);
    expect(platform.readSign).toHaveBeenCalledTimes(2);
    expect(platform.socketRecordFor).toHaveBeenCalledTimes(2);
    expect(platform.renderPanelPresentation).toHaveBeenCalledWith(
      platform.panelView,
      expect.objectContaining({
        action: expect.objectContaining({ label: expect.stringContaining("1 sleeping") }),
        content: expect.objectContaining({
          kind: "report",
          report: expect.objectContaining({ total: "2 kept tabs" }),
        }),
        kind: "ready",
      }),
    );
    controller.stop();
  });

  it("renders a complete unavailable state when the first panel inventory fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, runtime } = await createHarness();
    await runtime.start();
    platform.renderPanelPresentation.mockClear();
    platform.pinnedTabs.mockImplementation(() => {
      throw new Error("inventory failed");
    });

    runtime.fillPanel(platform.panelView as Element);

    expect(platform.renderPanelPresentation).toHaveBeenCalledOnce();
    expect(platform.renderPanelPresentation).toHaveBeenCalledWith(
      platform.panelView,
      expect.objectContaining({ kind: "unavailable" }),
    );
    expect(error).toHaveBeenCalledWith(
      "[keep-loaded] could not fill the status panel",
      expect.any(Error),
    );
    error.mockRestore();
    controller.stop();
  });

  it("replaces a ready presentation with unavailable and recovers on reopen", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, runtime } = await createHarness();
    await runtime.start();
    platform.renderPanelPresentation.mockClear();

    platform.panelActions?.onViewShowing?.(platform.panelView as Element);
    expect(platform.renderPanelPresentation).toHaveBeenLastCalledWith(
      platform.panelView,
      expect.objectContaining({ kind: "ready" }),
    );

    platform.pinnedTabs.mockImplementationOnce(() => {
      throw new Error("transient inventory failure");
    });
    platform.panelActions?.onViewShowing?.(platform.panelView as Element);
    expect(platform.renderPanelPresentation).toHaveBeenLastCalledWith(
      platform.panelView,
      expect.objectContaining({ kind: "unavailable" }),
    );

    platform.panelActions?.onViewShowing?.(platform.panelView as Element);
    expect(platform.renderPanelPresentation).toHaveBeenLastCalledWith(
      platform.panelView,
      expect.objectContaining({ kind: "ready" }),
    );
    expect(
      platform.renderPanelPresentation.mock.calls.map(([, state]) => state.kind),
    ).toEqual(["ready", "unavailable", "ready"]);
    error.mockRestore();
    controller.stop();
  });

  it("swaps one panel resource across live hidden, shown, and hidden settings", async () => {
    const { application, controller, preferences, runtime } = await createHarness({
      showStatusButton: false,
    });
    await runtime.start();

    expect(platform.installStatusPanel).not.toHaveBeenCalled();
    expect(application.snapshot()).toMatchObject({
      registrationCount: 1,
      statusWidgetLeases: 0,
    });
    expect(controller.isLive()).toBe(true);

    preferences.values.showStatusButton = true;
    preferences.observers.get("status-button")?.();
    expect(platform.installStatusPanel).toHaveBeenCalledOnce();
    expect(platform.panelDisposers).toHaveLength(1);

    preferences.values.showStatusButton = false;
    preferences.observers.get("status-button")?.();
    expect(platform.panelDisposers[0]).toHaveBeenCalledOnce();
    expect(controller.isLive()).toBe(true);
    expect(application.snapshot().registrationCount).toBe(1);

    preferences.values.showStatusButton = true;
    preferences.observers.get("status-button")?.();
    expect(platform.installStatusPanel).toHaveBeenCalledTimes(2);
    expect(platform.panelDisposers).toHaveLength(2);
    preferences.values.showStatusButton = false;
    preferences.observers.get("status-button")?.();
    expect(platform.panelDisposers[1]).toHaveBeenCalledOnce();

    controller.stop();
    expect(platform.panelDisposers[0]).toHaveBeenCalledOnce();
    expect(platform.panelDisposers[1]).toHaveBeenCalledOnce();
    expect(application.snapshot().registrationCount).toBe(0);
  });

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

  it("resets process crash history once and publishes exact session feedback", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, runtime, timers } = await createHarness();
    await runtime.start();

    asFake(tab).pending = true;
    platform.onCrash?.(tab, "crashed");
    await waitFor(() => platform.resetToLazy.mock.calls.length === 1, "crash charge");
    asFake(tab).pending = false;
    timers.forceAll();
    await waitFor(
      () => runtime.application().snapshot.activeCount === 0,
      "recovery completion",
    );
    expect(runtime.application().snapshot.recoveryAttempts).toBe(1);

    platform.renderPanelPresentation.mockClear();
    const view = platform.panelView as Element;
    platform.panelActions?.onReset?.(view);

    expect(runtime.application().snapshot.recoveryAttempts).toBe(0);
    expect(platform.renderPanelPresentation).toHaveBeenLastCalledWith(
      view,
      expect.objectContaining({
        feedback: "Crash recovery history reset for this Zen session",
        reset: expect.objectContaining({ visible: false }),
      }),
    );
    const rendersAfterReset = platform.renderPanelPresentation.mock.calls.length;
    platform.panelActions?.onReset?.(view);
    expect(platform.renderPanelPresentation).toHaveBeenCalledTimes(rendersAfterReset);
    controller.stop();
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
    expect(pulseClaims.get(tab)).toEqual({ heldSince: 0, lastPulseAt: 0 });
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

  it("continues past an unmatched pinned tab to pulse a later kept tab", async () => {
    const unmatched = fakeTab();
    asFake(unmatched).facts.url = "https://other.example/";
    asFake(unmatched).facts.flagged = false;
    const kept = fakeTab();
    platform.tabs = [unmatched, kept];
    const { controller, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
      match: "mail.example.test",
    });

    await runtime.start();

    expect(asFake(unmatched).active).toBe(false);
    expect(asFake(kept).active).toBe(true);
    expect(pulseClaims.activeCount(controller)).toBe(1);
    controller.stop();
  });

  it("keeps the held tab owned when an unrelated tab is selected", async () => {
    const held = fakeTab();
    const selected = fakeTab({ selected: true });
    platform.tabs = [held, selected];
    const { controller, pulseClaims, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });

    await runtime.start();
    expect(asFake(held).active).toBe(true);
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.onTabSelected?.(selected);
    await settle();

    expect(asFake(held).active).toBe(true);
    expect(pulseClaims.activeCount(controller)).toBe(1);

    timers.forceLatest();
    await settle();
    expect(asFake(held).active).toBe(false);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("releases the held tab when its context-menu policy is removed", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });

    await runtime.start();
    expect(asFake(tab).active).toBe(true);
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.menuActions?.toggle(tab);
    await settle();

    expect(asFake(tab).active).toBe(false);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("rechecks eligibility before activating the next snapshotted pulse tab", async () => {
    const first = fakeTab({
      facts: { flagged: false, space: "space-a", url: "https://mail.example.test/" },
    });
    const second = fakeTab({
      facts: { flagged: false, space: "space-a", url: "https://chat.example.test/" },
    });
    platform.tabs = [first, second];
    const { controller, preferences, runtime, timers } = await createHarness({
      freshen: "10",
      freshenHold: "5",
      match: "example.test",
    });

    await runtime.start();
    expect(asFake(first).active).toBe(true);
    expect(asFake(second).active).toBe(false);

    preferences.values.match = "https://mail.example.test/";
    preferences.observers.get("match")?.();
    timers.forceLatest();
    await settle();

    expect(asFake(second).active).toBe(false);
    expect(platform.setDocShellActive).not.toHaveBeenCalledWith(second, true);
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

  it("retains a connected active claim until native deactivation is verified", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, preferences, pulseClaims, runtime } = await createHarness({
      freshen: "10",
      freshenHold: "5",
    });
    await runtime.start();

    platform.setDocShellActive.mockImplementation(
      (candidate: BrowserTab, active: boolean) => {
        if (active) {
          asFake(candidate).active = true;
          return true;
        }
        return false;
      },
    );
    preferences.values.freshen = "0";
    preferences.observers.get("freshen")?.();

    expect(asFake(tab).active).toBe(true);
    expect(pulseClaims.activeCount(controller)).toBe(1);

    platform.setDocShellActive.mockImplementation(
      (candidate: BrowserTab, active: boolean) => {
        asFake(candidate).active = active;
        return true;
      },
    );
    preferences.observers.get("freshen")?.();

    expect(asFake(tab).active).toBe(false);
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("keeps an unreadable native claim owned across the next pulse cycle", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, preferences, pulseClaims, runtime, timers } = await createHarness(
      {
        freshen: "10",
        freshenHold: "5",
      },
    );
    await runtime.start();

    platform.docShellState.mockReturnValue("unknown");
    platform.setDocShellActive.mockImplementation(
      (_candidate: BrowserTab, active: boolean) => active,
    );
    timers.forceLatest();
    await settle();
    expect(pulseClaims.activeCount(controller)).toBe(1);

    preferences.observers.get("freshen")?.();
    await settle();
    expect(pulseClaims.activeCount(controller)).toBe(1);
    expect(platform.stopWatchingSocket).not.toHaveBeenCalledWith(tab);

    platform.docShellState.mockReturnValue("inactive");
    preferences.observers.get("freshen")?.();
    await settle();
    expect(pulseClaims.activeCount(controller)).toBe(0);
    controller.stop();
  });

  it("lets a replacement generation retry an unresolved old docshell claim", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const first = await createHarness({ freshen: "10", freshenHold: "5" });
    await first.runtime.start();
    platform.setDocShellActive.mockImplementation(
      (candidate: BrowserTab, active: boolean) => {
        if (active) {
          asFake(candidate).active = true;
          return true;
        }
        return false;
      },
    );

    first.controller.stop("replacement");
    expect(asFake(tab).active).toBe(true);
    expect(first.pulseClaims.allActive()).toHaveLength(1);

    first.preferences.values.freshen = "0";
    platform.setDocShellActive.mockImplementation(
      (candidate: BrowserTab, active: boolean) => {
        asFake(candidate).active = active;
        return true;
      },
    );
    vi.resetModules();
    const { createKeepLoadedRuntime } = await import("./runtime.ts");
    const replacementController = new KeepLoadedController({ timers: first.timers });
    const replacement = createKeepLoadedRuntime({
      application: first.application,
      owner: replacementController,
      preferences: first.preferences.port,
      pulseClaims: first.pulseClaims,
    });
    await replacement.start();

    expect(asFake(tab).active).toBe(false);
    expect(first.pulseClaims.allActive()).toEqual([]);
    replacementController.stop();
  });

  it("does not refill a panel when its command sweep finishes after stop", async () => {
    const { controller, runtime } = await createHarness();
    await runtime.start();
    const commandSession = deferred();
    platform.sessionReady = commandSession.promise;
    platform.renderPanelPresentation.mockClear();
    platform.browserProbes.mockClear();
    const view = platform.panelView as Element;

    platform.panelActions?.onWake(view);
    await waitFor(
      () => platform.whenSessionRestored.mock.calls.length >= 2,
      "panel command sweep readiness",
    );
    expect(platform.renderPanelPresentation).not.toHaveBeenCalled();

    controller.stop();
    commandSession.resolve();
    await settle(12);

    expect(platform.browserProbes).not.toHaveBeenCalled();
    expect(platform.renderPanelPresentation).not.toHaveBeenCalled();
  });

  it("keeps an old panel wake completion and fill out of a replacement generation", async () => {
    vi.resetModules();
    const { createKeepLoadedRuntime } = await import("./runtime.ts");
    const timers = new ManualTimers();
    const preferences = preferenceHarness();
    const pulseClaims = new PulseClaims<BrowserTab>();
    const delayedPanelReceipt = deferred<WorkResult>();
    const completedReceipt = () => ({
      done: Promise.resolve<WorkResult>("completed"),
    });
    const firstDispose = vi.fn(() => true);
    const secondDispose = vi.fn(() => true);
    let firstSweepCalls = 0;
    const firstRequestSweep = vi.fn(() => {
      firstSweepCalls += 1;
      return {
        done:
          firstSweepCalls === 1
            ? Promise.resolve<WorkResult>("completed")
            : delayedPanelReceipt.promise,
      };
    });
    const secondRequestSweep = vi.fn(completedReceipt);
    const registration = (
      id: string,
      requestSweep: () => { done: Promise<WorkResult> },
      dispose: () => boolean,
    ) => ({
      acquireStatusWidget: vi.fn(() => ({ release: vi.fn(() => true) })),
      cancelRecovery: vi.fn(() => false),
      chargeRecoveryAttempt: vi.fn(() => []),
      dispose,
      id,
      invalidateTab: vi.fn(() => false),
      isApplicationBusy: vi.fn(() => false),
      recentRecoveryAttempts: vi.fn(() => []),
      reconcileOnDemand: vi.fn(() => true),
      requestPulse: vi.fn(completedReceipt),
      requestRecovery: vi.fn(completedReceipt),
      requestSweep,
      setPulseSchedule: vi.fn(),
    });
    const registrations = [
      registration("g1", firstRequestSweep, firstDispose),
      registration("g2", secondRequestSweep, secondDispose),
    ];
    const ownerSnapshot = Object.freeze({ applicationId: "stale-panel-owner" });
    const application = {
      register: vi.fn(() => {
        const next = registrations.shift();
        if (!next) {
          throw new Error("unexpected replacement registration");
        }
        return next;
      }),
      snapshot: vi.fn(() => ownerSnapshot),
    } as unknown as ApplicationOwnerApi<BrowserTab, CrashFacts>;
    const firstController = new KeepLoadedController({ timers });
    const firstRuntime = createKeepLoadedRuntime({
      application,
      owner: firstController,
      preferences: preferences.port,
      pulseClaims,
    });
    await firstRuntime.start();
    const oldActions = platform.panelActions;
    const oldView = platform.panelView as Element;
    platform.renderPanelPresentation.mockClear();

    oldActions?.onWake(oldView);
    await waitFor(
      () => firstRequestSweep.mock.calls.length === 2,
      "old panel wake receipt",
    );
    expect(platform.renderPanelPresentation).not.toHaveBeenCalled();

    firstController.stop("replacement");
    vi.resetModules();
    const { createKeepLoadedRuntime: createReplacementRuntime } = await import(
      "./runtime.ts"
    );
    const replacementController = new KeepLoadedController({ timers });
    const replacementView = {} as Element;
    platform.panelView = replacementView;
    const replacement = createReplacementRuntime({
      application,
      owner: replacementController,
      preferences: preferences.port,
      pulseClaims,
    });
    await replacement.start();
    expect(secondRequestSweep).toHaveBeenCalledOnce();
    platform.renderPanelPresentation.mockClear();
    platform.browserProbes.mockClear();
    platform.insertBrowser.mockClear();
    platform.markUndiscardable.mockClear();
    platform.recordSign.mockClear();
    platform.watchSockets.mockClear();
    platform.writeLabelFromPage.mockClear();

    // This receipt belongs to the old panel command rather than controller.wait(),
    // so it remains pending through G1's stop. Releasing it now proves the actual
    // settlePanel continuation sees the terminal G1 controller, not G2.
    const beforeRetainedWake = application.snapshot();
    firstRuntime.fillPanel(replacementView);
    oldActions?.onWake(oldView);
    delayedPanelReceipt.resolve("completed");
    await settle(12);

    expect(platform.renderPanelPresentation).not.toHaveBeenCalled();
    expectNoSweepMutation();
    expect(application.snapshot()).toEqual(beforeRetainedWake);
    expect(firstRequestSweep).toHaveBeenCalledTimes(2);
    expect(secondRequestSweep).toHaveBeenCalledOnce();
    expect(firstDispose).toHaveBeenCalledOnce();

    replacement.fillPanel(oldView);
    expect(platform.renderPanelPresentation).not.toHaveBeenCalled();
    replacement.fillPanel(replacementView);
    expect(platform.renderPanelPresentation).toHaveBeenCalledOnce();

    replacementController.stop();
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

  it("tears down in reverse registration order across the split modules", async () => {
    const tab = fakeTab();
    platform.tabs = [tab];
    const { controller, runtime } = await createHarness();
    await runtime.start();
    // Startup calls must not be able to satisfy the assertion.
    platform.stopWatchingSockets.mockClear();
    platform.setMarker.mockClear();
    platform.log.mockClear();

    controller.stop();

    expect(platform.setMarker).toHaveBeenCalledWith(tab, false);
    const unloadedCall = platform.log.mock.calls.findIndex(
      ([line]) => line === "unloaded",
    );
    expect(unloadedCall).toBeGreaterThanOrEqual(0);
    // `?? -1` keeps a missing call failing the comparison instead of type-asserting.
    const sockets = platform.stopWatchingSockets.mock.invocationCallOrder[0] ?? -1;
    const marker = platform.setMarker.mock.invocationCallOrder[0] ?? -1;
    const unloaded = platform.log.mock.invocationCallOrder[unloadedCall] ?? -1;
    expect(sockets).toBeGreaterThan(0);
    expect(sockets).toBeLessThan(marker);
    expect(marker).toBeLessThan(unloaded);
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

  it("stops the exact generation when deferred widget creation fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { application, controller, runtime } = await createHarness();
    await runtime.start();

    platform.panelActions?.onWidgetError?.(new Error("deferred widget create failed"));

    expect(controller.stopReason).toBe("startup-failure");
    expect(application.snapshot().registrationCount).toBe(0);
    expect(error).toHaveBeenCalledWith(
      "[keep-loaded] status widget creation failed",
      expect.any(Error),
    );
    error.mockRestore();
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
    platform.panelActions?.onWake(platform.panelView as Element);

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
