/** Pure configuration, scheduling, and evidence validation for the M17 stress lanes. */

const frozenProfile = profile =>
  Object.freeze({
    ...profile,
    browserRounds: Object.freeze(
      profile.browserRounds.map(round => Object.freeze({ ...round })),
    ),
  });

export const STRESS_PROFILES = Object.freeze({
  quick: frozenProfile({
    browserRounds: [{ tabs: 25, windows: 2 }],
    minutes: null,
    modelEvents: 1_000,
    reloads: 5,
  }),
  standard: frozenProfile({
    browserRounds: [
      { tabs: 25, windows: 3 },
      { tabs: 100, windows: 3 },
      { tabs: 250, windows: 3 },
    ],
    minutes: null,
    modelEvents: 25_000,
    reloads: 25,
  }),
  soak: frozenProfile({
    browserRounds: [{ tabs: 100, windows: 3 }],
    minutes: 60,
    modelEvents: 50_000,
    reloads: 0,
  }),
});

const isStressProfile = value =>
  typeof value === "string" && Object.hasOwn(STRESS_PROFILES, value);

const positiveInteger = (label, value) => {
  if (!/^\d+$/.test(value ?? "")) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return parsed;
};

const unsignedSeed = value => {
  const parsed = positiveInteger("seed", value);
  if (parsed > 0xffff_ffff) {
    throw new TypeError("seed must fit in an unsigned 32-bit integer");
  }
  return parsed;
};

export const parseStressArguments = arguments_ => {
  let profile = "quick";
  let browser = true;
  let model = true;
  let events = null;
  let minutes = null;
  let replayEvent = null;
  let reloads = null;
  let seed = Date.now() >>> 0 || 1;
  let tabs = null;
  let windows = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const take = label => {
      const value = arguments_[++index];
      if (value === undefined) throw new TypeError(`${label} requires a value`);
      return value;
    };
    switch (argument) {
      case "--profile":
        profile = take("--profile");
        break;
      case "--seed":
        seed = unsignedSeed(take("--seed"));
        break;
      case "--events":
        events = positiveInteger("events", take("--events"));
        break;
      case "--minutes":
        minutes = positiveInteger("minutes", take("--minutes"));
        break;
      case "--replay-event":
        replayEvent = positiveInteger("replay event", take("--replay-event"));
        break;
      case "--reloads":
        reloads = positiveInteger("reloads", take("--reloads"));
        break;
      case "--tabs":
        tabs = positiveInteger("tabs", take("--tabs"));
        break;
      case "--windows":
        windows = positiveInteger("windows", take("--windows"));
        break;
      case "--model-only":
        browser = false;
        break;
      case "--browser-only":
        model = false;
        break;
      case "--help":
        return Object.freeze({ help: true });
      default:
        throw new TypeError(`unknown stress argument: ${argument}`);
    }
  }

  if (!isStressProfile(profile)) {
    throw new TypeError(`unknown stress profile: ${profile}`);
  }
  if (!browser && !model) {
    throw new TypeError("--model-only and --browser-only are mutually exclusive");
  }
  const selected = STRESS_PROFILES[profile];
  const resolvedEvents = events ?? selected.modelEvents;
  if (replayEvent !== null && replayEvent > resolvedEvents) {
    throw new TypeError("replay event cannot exceed the configured event count");
  }
  if (tabs !== null && tabs > 1_000) {
    throw new TypeError("tabs must not exceed the 1000-tab safety boundary");
  }
  if (windows !== null && windows > 8) {
    throw new TypeError("windows must not exceed the 8-window safety boundary");
  }
  const browserRounds =
    tabs !== null || windows !== null
      ? [
          {
            tabs: tabs ?? selected.browserRounds[0].tabs,
            windows: windows ?? selected.browserRounds[0].windows,
          },
        ]
      : selected.browserRounds.map(round => ({ ...round }));
  return Object.freeze({
    browser,
    browserRounds,
    events: resolvedEvents,
    help: false,
    minutes: minutes ?? selected.minutes,
    model,
    profile,
    reloads: reloads ?? selected.reloads,
    replayEvent,
    seed,
  });
};

export const resolveBrowserReloadCounts = configuration => {
  const rounds = configuration?.browserRounds;
  if (!Array.isArray(rounds) || rounds.length === 0) {
    throw new TypeError("stress configuration must include browser rounds");
  }
  const total =
    configuration.profile === "soak"
      ? Math.max(1, Math.ceil((configuration.minutes * 60) / 10))
      : configuration.reloads;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new TypeError("stress configuration has an invalid reload count");
  }
  return rounds.map(
    (_, index) =>
      Math.floor(total / rounds.length) + (index < total % rounds.length ? 1 : 0),
  );
};

const mulberry32 = seed => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const EVENT_KINDS = Object.freeze([
  "sweep",
  "recovery",
  "pulse",
  "cancel",
  "invalidate",
  "preference",
]);

/** Build the exact event list before execution so the artifact is independently replayable. */
export const buildStressSchedule = ({ count, seed, tabs }) => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new TypeError("stress event count must be positive");
  }
  if (!Number.isSafeInteger(tabs) || tabs <= 0) {
    throw new TypeError("stress tab count must be positive");
  }
  const random = mulberry32(seed);
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    kind: EVENT_KINDS[Math.floor(random() * EVENT_KINDS.length)],
    registration: Math.floor(random() * 3),
    revision: Math.floor(random() * 1_000_000),
    tab: Math.floor(random() * tabs),
    value: random() >= 0.5,
  }));
};

const finalOwnerDrained = owner =>
  owner?.activeCount === 0 &&
  owner?.drainingCount === 0 &&
  owner?.keyRecords === 0 &&
  owner?.registrationCount === 0 &&
  owner?.readyCount === 0 &&
  owner?.statusWidgetLeases === 0 &&
  owner?.trailingCount === 0 &&
  owner?.wakeCandidates === 0 &&
  owner?.wakePhase === "idle" &&
  owner?.wakeRetryScheduled === false;

const sameNumbers = (left, right) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const requiredProductionPaths = Object.freeze([
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
]);

const validFileEvidence = value =>
  Number.isSafeInteger(value?.bytes) &&
  value.bytes > 0 &&
  typeof value.sha256 === "string" &&
  /^[\da-f]{64}$/.test(value.sha256);

/** Reject incomplete, self-reported, or configuration-unbound stress artifacts. */
export const validateStressArtifact = artifact => {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  require(artifact && typeof artifact === "object", "artifact must be an object");
  if (!artifact || typeof artifact !== "object") {
    return Object.freeze({ failures, ok: false });
  }
  const { configuration, diagnostics, evidence, runner, stagedProduction, stamp } =
    artifact;
  const configurationProfileKnown = isStressProfile(configuration?.profile);
  const configurationRoundsValid =
    Array.isArray(configuration?.browserRounds) &&
    configuration.browserRounds.length > 0 &&
    configuration.browserRounds.every(
      round =>
        Number.isSafeInteger(round?.tabs) &&
        round.tabs > 0 &&
        Number.isSafeInteger(round?.windows) &&
        round.windows > 0,
    );
  require(configurationProfileKnown, "configuration profile is unknown");
  require(typeof configuration?.model === "boolean" &&
    typeof configuration?.browser === "boolean" &&
    (configuration.model ||
      configuration.browser), "configuration must request at least one stress lane");
  require(configurationRoundsValid, "configuration browser rounds are invalid");
  require(Number.isSafeInteger(configuration?.events) &&
    configuration.events > 0, "configuration event count is invalid");
  require(Number.isSafeInteger(configuration?.seed) &&
    configuration.seed > 0, "configuration seed is invalid");
  require(evidence && typeof evidence === "object", "evidence must be an object");
  if (!evidence || typeof evidence !== "object") return { failures, ok: false };
  require(evidence.fatal === null, `fatal stress error: ${String(evidence.fatal)}`);
  require(isStressProfile(evidence.profile), "evidence profile is unknown");
  require(evidence.profile === configuration?.profile, "evidence profile does not match");
  require(evidence.seed === configuration?.seed, "evidence seed does not match");
  require(Boolean(evidence.model) ===
    configuration?.model, "model lane presence does not match the configuration");
  require(Boolean(evidence.browser) ===
    configuration?.browser, "browser lane presence does not match the configuration");

  if (evidence.model) {
    const expectedEvents = configuration?.replayEvent ?? configuration?.events;
    const modelTabs = configuration?.profile === "quick" ? 64 : 512;
    require(Number.isSafeInteger(evidence.model.maxActive) &&
      evidence.model.maxActive >= 0 &&
      evidence.model.maxActive <=
        1, "model work overlapped or lacks an active-work peak");
    require(evidence.model.completedEvents === expectedEvents &&
      evidence.model.expectedEvents ===
        expectedEvents, "model event schedule is incomplete");
    require(Number.isSafeInteger(evidence.model.maxKeyRecords) &&
      evidence.model.maxKeyRecords >= 0 &&
      evidence.model.maxKeyRecords <=
        modelTabs + 2, "model key ownership exceeded its exact bound");
    require(evidence.model.preferenceDrift === false, "model preference drifted");
    require(evidence.model.errors?.length === 0, "model reported delegate errors");
    require(evidence.model.receipts?.failed === 0, "model work failed");
    require(Number.isSafeInteger(evidence.model.receipts?.completed) &&
      Number.isSafeInteger(evidence.model.receipts?.canceled) &&
      evidence.model.receipts.completed + evidence.model.receipts.canceled >
        0, "model receipts are missing");
    require(Array.isArray(evidence.model.schedulePrefixHashes) &&
      evidence.model.schedulePrefixHashes.length === configuration?.events &&
      evidence.model.schedulePrefixHash ===
        evidence.model.schedulePrefixHashes[expectedEvents - 1] &&
      evidence.model.scheduleHash ===
        evidence.model.schedulePrefixHash, "model replay prefix evidence is incomplete");
    require(finalOwnerDrained(evidence.model.finalOwner), "model owner did not drain");
  }
  if (evidence.browser) {
    let reloadCounts = [];
    if (configurationProfileKnown && configurationRoundsValid) {
      try {
        reloadCounts = resolveBrowserReloadCounts(configuration);
      } catch (error) {
        failures.push(`browser reload configuration is invalid: ${String(error)}`);
      }
    }
    const expectedEvents =
      (configuration?.browserRounds?.length ?? 0) +
      reloadCounts.reduce((total, count) => total + count, 0) +
      1;
    const expectedProtocol =
      runner?.ownerProtocol ?? evidence.model?.finalOwner?.protocol ?? null;
    require(Number.isSafeInteger(expectedProtocol) &&
      expectedProtocol > 0, "expected owner protocol is missing");
    require(Number.isSafeInteger(evidence.browser.maxActive) &&
      evidence.browser.maxActive >= 0 &&
      evidence.browser.maxActive <=
        1, "browser work overlapped or lacks an active-work peak");
    require(evidence.browser.completedEvents === expectedEvents &&
      evidence.browser.expectedEvents ===
        expectedEvents, "browser event schedule is incomplete");
    require(Number.isSafeInteger(evidence.browser.maxKeyRecords) &&
      evidence.browser.maxKeyRecords >= 0 &&
      evidence.browser.maxKeyRecords <=
        Math.max(...(configuration?.browserRounds ?? []).map(round => round.tabs)) +
          2, "browser key ownership exceeded its exact bound");
    require(evidence.browser.preferenceDrift === false, "browser preference drifted");
    require(evidence.browser.resourcesDrained ===
      true, "browser resources did not drain");
    require(Array.isArray(evidence.browser.rounds) &&
      evidence.browser.rounds.length === configuration?.browserRounds?.length &&
      evidence.browser.rounds.every((round, index) => {
        const expected = configuration.browserRounds[index];
        return (
          round.index === index + 1 &&
          round.tabs === expected.tabs &&
          round.windows === expected.windows &&
          round.lazyBeforeWake === expected.tabs &&
          round.fastRequests === expected.tabs &&
          round.expectedReloads === reloadCounts[index] &&
          round.reloads === reloadCounts[index]
        );
      }), "browser rounds do not match the requested lazy/network/reload configuration");
    require(evidence.browser.activeDisable?.beforeOwner?.activeCount === 1 &&
      evidence.browser.activeDisable.beforeOwner.wakePhase === "waiting" &&
      evidence.browser.activeDisable.beforeOwner.wakeCandidates >= 1 &&
      evidence.browser.activeDisable.beforeOwner.protocol === expectedProtocol &&
      evidence.browser.activeDisable.prefHeld === false &&
      evidence.browser.activeDisable.heldCandidates ===
        4, "active Sine disable did not begin with a held wake transaction");
    require(evidence.browser.controllers?.retained ===
      evidence.browser.controllers?.stopped &&
      evidence.browser.controllers?.pendingTimers === 0 &&
      evidence.browser.controllers?.pendingWaits ===
        0, "retired browser controllers retained resources");
    require(evidence.browser.controllers?.retained >
      0, "browser controller inventory is empty");
    require(evidence.browser.eventLoop?.samples > 0 &&
      Number.isFinite(evidence.browser.eventLoop?.maxDelayMs) &&
      evidence.browser.eventLoop.maxDelayMs >=
        0, "browser event-loop diagnostics are missing");
    require(Array.isArray(evidence.browser.processSamples) &&
      evidence.browser.processSamples.length >=
        (configuration?.browserRounds?.length ?? 0) + 2 &&
      evidence.browser.processSamples.every(
        sample => Number.isFinite(sample.residentBytes) && sample.residentBytes >= 0,
      ), "browser process-memory diagnostics are missing");
    require(Array.isArray(evidence.browser.reloadLatenciesMs) &&
      evidence.browser.reloadLatenciesMs.length ===
        reloadCounts.reduce((total, count) => total + count, 0) &&
      evidence.browser.reloadLatenciesMs.every(
        latency => Number.isFinite(latency) && latency >= 0,
      ), "browser reload latency evidence is incomplete");
    require(evidence.browser.finalOwner?.protocol === expectedProtocol &&
      finalOwnerDrained(evidence.browser.finalOwner), "browser owner did not drain");
    require(finalOwnerDrained(
      evidence.browser.activeDisable?.afterOwner,
    ), "active disable did not record the drained owner");

    const rawEvents = diagnostics?.httpFixture?.events;
    const totalTabs = (configuration?.browserRounds ?? []).reduce(
      (total, round) => total + round.tabs,
      0,
    );
    const expectedFastIds = Array.from({ length: totalTabs }, (_, index) => index + 1);
    const fastIds = Array.isArray(rawEvents)
      ? rawEvents
          .filter(event => event?.type === "fast-request")
          .map(event => event.id)
          .sort((left, right) => left - right)
      : [];
    const holdIds = Array.isArray(rawEvents)
      ? rawEvents.filter(event => event?.type === "hold-request").map(event => event.id)
      : [];
    const expectedHeldIds = new Set(
      Array.from({ length: 4 }, (_, index) => totalTabs + index + 1),
    );
    require(sameNumbers(
      fastIds,
      expectedFastIds,
    ), "raw HTTP evidence does not contain exactly one request per configured lazy tab");
    require(holdIds.length === 3 &&
      new Set(holdIds).size === 3 &&
      holdIds.every(id =>
        expectedHeldIds.has(id),
      ), "raw HTTP evidence does not prove the four-candidate held wake boundary");

    const stagedFiles = stagedProduction?.files;
    require(stagedProduction?.manifest?.value?.id === "keep-loaded" &&
      stagedProduction.manifest.value.supportsUnload === true &&
      validFileEvidence(
        stagedProduction.manifest,
      ), "staged manifest evidence is missing");
    require(requiredProductionPaths.every(path =>
      validFileEvidence(stagedFiles?.[path]),
    ) &&
      requiredProductionPaths.every(path =>
        stagedProduction?.relativePaths?.includes(path),
      ), "staged production asset hashes are missing");
    require(evidence.browser.platform?.buildId === stamp?.zen?.buildId &&
      evidence.browser.platform?.geckoVersion === stamp?.zen?.geckoVersion &&
      evidence.browser.platform?.zenVersion === stamp?.zen?.version &&
      evidence.browser.platform?.sineVersion ===
        stamp?.sine
          ?.version, "browser platform evidence does not match the staged launcher stamp");
    require(evidence.cleanup?.serverStopped === true, "fixture server did not stop");
    require(evidence.cleanup?.zenStopped === true, "throwaway Zen did not stop");
    require(evidence.cleanup?.profileRemoved === true, "throwaway profile was retained");
  }
  return Object.freeze({ failures, ok: failures.length === 0 });
};
