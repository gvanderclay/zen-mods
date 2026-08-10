/**
 * A deterministic, browser-free model of the Sine lifecycle Keep Loaded depends on.
 * It deliberately models ownership and ordering, not Firefox DOM behavior. Mutation
 * callbacks and unload cleanup are synchronous because that is the production
 * controller contract this fixture is meant to verify.
 */

const DEFAULT_WINDOW_IDS = ["a", "b"];

const nonEmptyName = (value, what) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${what} must be a non-empty string`);
  }
  return value;
};

const finiteNonNegative = (value, what) => {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${what} must be a finite non-negative number`);
  }
  return value;
};

export const createLifecycleModel = ({ now = 0 } = {}) => {
  let clockNow = finiteNonNegative(now, "now");
  let listenerSequence = 0;
  let timerSequence = 0;
  let waitSequence = 0;
  let nextTimerId = 1;
  let activeMutation = null;

  const gates = new Map();
  const gateRecords = new WeakMap();
  const listeners = new Map();
  const activeTimers = new Map();
  const timerRecords = new Map();
  const waits = new Map();
  const targetRecords = new WeakMap();
  const generationRecords = new WeakMap();
  const currentByWindow = new Map();
  const ordinalsByWindow = new Map();
  const windowRecords = new WeakMap();
  const mutations = [];
  const violations = [];

  const recordViolation = (owner, value) => {
    violations.push({ owner, value });
    return value;
  };

  const isCurrent = owner =>
    owner.phase === "current" && currentByWindow.get(owner.window.id) === owner;

  const canMutateDuringLifecycle = owner =>
    (owner.phase === "current" || owner.phase === "stopping") &&
    currentByWindow.get(owner.window.id) === owner;

  const gate = name => {
    nonEmptyName(name, "gate name");
    if (gates.has(name)) {
      throw new Error(`gate already exists: ${name}`);
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    // A deliberately rejected gate with no waiter must not become an unrelated process
    // warning. Owner-tagged waits still receive the rejection through their own promise.
    void promise.catch(() => {});
    const record = {
      name,
      promise,
      resolvePromise,
      rejectPromise,
      status: "pending",
      waiterCount: 0,
      reached: false,
    };
    const fixture = Object.freeze({
      name,
      get status() {
        return record.status;
      },
      get waiterCount() {
        return record.waiterCount;
      },
      get reached() {
        return record.reached;
      },
      release(value) {
        if (record.status !== "pending") {
          return false;
        }
        record.status = "released";
        record.resolvePromise(value);
        return true;
      },
      reject(error) {
        if (record.status !== "pending") {
          return false;
        }
        record.status = "rejected";
        record.rejectPromise(error);
        return true;
      },
    });
    record.fixture = fixture;
    gateRecords.set(fixture, record);
    gates.set(name, fixture);
    return fixture;
  };

  const staleCallback = (owner, source, target, label) => {
    if (isCurrent(owner)) {
      return;
    }
    recordViolation(owner, {
      category: "stale-callback",
      actor: owner.token.id,
      target,
      source,
      label,
    });
  };

  const deliverCallback = (owner, source, target, label, callback, event) => {
    staleCallback(owner, source, target, label);
    callback(event);
  };

  const createListenerTarget = name => {
    nonEmptyName(name, "listener target name");
    let target;
    const targetRecord = { name };
    target = Object.freeze({
      name,
      dispatch(type, event = { type, target }) {
        nonEmptyName(type, "event type");
        const matches = [...listeners.values()]
          .filter(listener => listener.target === targetRecord && listener.type === type)
          .sort((left, right) => left.sequence - right.sequence);
        for (const listener of matches) {
          if (listeners.has(listener.id)) {
            deliverCallback(
              listener.owner,
              "listener",
              listener.owner.window.id,
              `${targetRecord.name}:${type}`,
              listener.callback,
              event,
            );
          }
        }
      },
      listenerCount(type) {
        return [...listeners.values()].filter(
          listener =>
            listener.target === targetRecord && (!type || listener.type === type),
        ).length;
      },
    });
    targetRecords.set(target, targetRecord);
    return target;
  };

  const lifecycleEvent = (windowRecord, type, generation) => {
    windowRecord.lifecycle.push({
      order: windowRecord.lifecycle.length + 1,
      type,
      generation,
    });
  };

  const harnessContractError = (owner, target, label, detail) => {
    recordViolation(owner, {
      category: "harness-contract",
      actor: owner.token.id,
      target,
      label,
      detail,
    });
    return new Error(`harness contract: ${detail}`);
  };

  const guardedMutation = (domain, operation) => {
    if (!activeMutation) {
      throw new Error(
        `${domain.id} state is read-only outside its generation mutation boundary`,
      );
    }
    const { owner, target, label } = activeMutation;
    if (!canMutateDuringLifecycle(owner)) {
      recordViolation(owner, {
        category: "stale-continuation",
        actor: owner.token.id,
        target: domain.id,
        label,
      });
      throw new Error(
        `stale continuation from ${owner.token.id} tried to ${operation} ${domain.id}: ${label}`,
      );
    }
    if (target === domain) {
      return;
    }
    const category =
      domain.kind === "window" ? "wrong-window-mutation" : "wrong-application-mutation";
    recordViolation(owner, {
      category,
      actor: owner.token.id,
      target: domain.id,
      label,
    });
    const description =
      domain.kind === "window" ? "wrong-window mutation" : "wrong application mutation";
    throw new Error(
      `${description} by ${owner.token.id} targeted ${domain.id}: ${label}`,
    );
  };

  const contractForActiveMutation = detail => {
    if (!activeMutation) {
      throw new Error(`harness contract: ${detail}`);
    }
    const { owner, target, label } = activeMutation;
    throw harnessContractError(owner, target.id, label, detail);
  };

  const arrayIndex = key => /^(0|[1-9]\d*)$/.test(key) && Number(key) < 4_294_967_295;

  const cloneDeterministic = (value, ancestors = new WeakSet()) => {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        return value;
      }
      return contractForActiveMutation("state numbers must be finite");
    }
    if (typeof value !== "object") {
      return contractForActiveMutation(
        "state values must be finite primitives, plain objects and arrays",
      );
    }
    if (ancestors.has(value)) {
      return contractForActiveMutation("state values cannot contain cycles");
    }

    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      return contractForActiveMutation(
        "state values must be finite primitives, plain objects and arrays",
      );
    }
    ancestors.add(value);
    const clone = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") {
        continue;
      }
      if (
        typeof key !== "string" ||
        (array && !arrayIndex(key)) ||
        (!array && key === "__proto__")
      ) {
        ancestors.delete(value);
        return contractForActiveMutation(
          "state objects may contain only ordinary string keys and array indexes",
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        ancestors.delete(value);
        return contractForActiveMutation(
          "state objects may contain only enumerable data properties",
        );
      }
      Reflect.set(clone, key, cloneDeterministic(descriptor.value, ancestors));
    }
    if (array) {
      clone.length = value.length;
    }
    ancestors.delete(value);
    return clone;
  };

  const validateMutationKey = (target, key) => {
    const allowed =
      typeof key === "string" &&
      (Array.isArray(target) ? key === "length" || arrayIndex(key) : key !== "__proto__");
    if (!allowed) {
      return contractForActiveMutation(
        "state objects may contain only ordinary string keys and array indexes",
      );
    }
  };

  const createGuardedDomain = (kind, id) => {
    const data = Object.create(null);
    const proxies = new WeakMap();
    const domain = { kind, id, data, view: null };
    const wrap = value => {
      if (value === null || typeof value !== "object") {
        return value;
      }
      const existing = proxies.get(value);
      if (existing) {
        return existing;
      }
      const view = new Proxy(value, {
        get(target, key, receiver) {
          if (
            key === "__proto__" ||
            (key === "constructor" && !Object.hasOwn(target, key))
          ) {
            return undefined;
          }
          const value = Reflect.get(target, key, receiver);
          if (!Object.hasOwn(target, key)) {
            if (typeof value === "function") {
              // Arrays need their inherited methods, but returning Array.prototype's
              // mutable function objects would let callers modify process-global state.
              // A prototype-less bound wrapper preserves method behavior while
              // containing direct writes and cutting off Function.prototype as well.
              const method = value.bind(receiver);
              Object.setPrototypeOf(method, null);
              return method;
            }
            if (value !== null && typeof value === "object") {
              return contractForActiveMutation(
                "guarded state cannot expose inherited mutable objects",
              );
            }
          }
          return wrap(value);
        },
        getPrototypeOf() {
          return null;
        },
        getOwnPropertyDescriptor(target, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
          return descriptor && "value" in descriptor
            ? { ...descriptor, value: wrap(descriptor.value) }
            : descriptor;
        },
        set(target, key, next) {
          guardedMutation(domain, "write");
          validateMutationKey(target, key);
          return Reflect.set(target, key, cloneDeterministic(next));
        },
        deleteProperty(target, key) {
          guardedMutation(domain, "delete from");
          validateMutationKey(target, key);
          return Reflect.deleteProperty(target, key);
        },
        defineProperty(target, key, descriptor) {
          guardedMutation(domain, "define a property on");
          validateMutationKey(target, key);
          if (
            !("value" in descriptor) ||
            descriptor.enumerable !== true ||
            descriptor.configurable !== true ||
            descriptor.writable !== true
          ) {
            return contractForActiveMutation(
              "state objects may contain only enumerable data properties",
            );
          }
          return Reflect.defineProperty(target, key, {
            ...descriptor,
            value: cloneDeterministic(descriptor.value),
          });
        },
        setPrototypeOf() {
          return contractForActiveMutation("state object prototypes cannot change");
        },
        preventExtensions() {
          return contractForActiveMutation("state objects must remain extensible");
        },
      });
      proxies.set(value, view);
      return view;
    };
    domain.view = wrap(data);
    return domain;
  };

  const restoreDomain = (domain, snapshot) => {
    for (const key of Reflect.ownKeys(domain.data)) {
      Reflect.deleteProperty(domain.data, key);
    }
    for (const key of Reflect.ownKeys(snapshot)) {
      Reflect.set(domain.data, key, snapshot[key]);
    }
  };

  const createWindow = id => {
    const domain = createGuardedDomain("window", id);
    const record = { id, domain, lifecycle: [] };
    const fixture = Object.freeze({
      id,
      state: domain.view,
      events: createListenerTarget(`window-${id}-events`),
      ready: gate(`window-${id}-ready`),
      get lifecycle() {
        return record.lifecycle.map(event => ({ ...event }));
      },
    });
    record.fixture = fixture;
    windowRecords.set(fixture, record);
    return fixture;
  };

  const applicationDomain = createGuardedDomain("application", "application");
  const application = Object.freeze({
    carrier: applicationDomain.view,
    events: createListenerTarget("application-events"),
    ready: gate("application-ready"),
  });

  const windowsById = new Map(DEFAULT_WINDOW_IDS.map(id => [id, createWindow(id)]));

  const resolveWindow = value => {
    const windowFixture =
      typeof value === "string" ? windowsById.get(value) : windowsById.get(value?.id);
    if (!windowFixture || (typeof value !== "string" && value !== windowFixture)) {
      throw new Error(`unknown lifecycle window: ${String(value?.id ?? value)}`);
    }
    return windowFixture;
  };

  const resolveGeneration = generation => {
    const record = generationRecords.get(generation);
    if (!record) {
      throw new Error("unknown lifecycle generation");
    }
    return record;
  };

  const requireCurrent = (owner, resource, action) => {
    if (isCurrent(owner)) {
      return;
    }
    recordViolation(owner, {
      category: "stale-registration",
      actor: owner.token.id,
      target: owner.window.id,
      resource,
      label: action,
    });
    throw new Error(`${owner.token.id} is stopped and cannot ${action}`);
  };

  const listen = (owner, target, type, callback) => {
    requireCurrent(owner, "listener", "register a listener");
    const targetRecord = targetRecords.get(target);
    if (!targetRecord) {
      throw new Error("listener target belongs to another lifecycle model");
    }
    nonEmptyName(type, "event type");
    if (typeof callback !== "function") {
      throw new TypeError("listener must be a function");
    }

    const id = ++listenerSequence;
    listeners.set(id, {
      id,
      owner,
      target: targetRecord,
      type,
      callback,
      sequence: id,
    });
    let removed = false;
    return () => {
      if (removed) {
        return false;
      }
      removed = true;
      return listeners.delete(id);
    };
  };

  const setTimer = (owner, callback, delay) => {
    requireCurrent(owner, "timer", "schedule a timer");
    if (typeof callback !== "function") {
      throw new TypeError("timer callback must be a function");
    }
    finiteNonNegative(delay, "timer delay");
    const handle = Object.freeze({ id: nextTimerId });
    nextTimerId += 1;
    timerSequence += 1;
    const timer = {
      handle,
      owner,
      callback,
      delay,
      dueAt: clockNow + delay,
      sequence: timerSequence,
      status: "pending",
    };
    activeTimers.set(handle, timer);
    timerRecords.set(handle, timer);
    return handle;
  };

  const clearTimer = (owner, handle) => {
    const timer = timerRecords.get(handle);
    if (!timer) {
      return false;
    }
    if (timer.owner !== owner) {
      recordViolation(owner, {
        category: "wrong-resource-owner",
        actor: owner.token.id,
        target: timer.owner.token.id,
        resource: "timer",
        label: `clear timer ${handle.id}`,
      });
      throw new Error(
        `${owner.token.id} cannot clear timer ${handle.id} owned by ${timer.owner.token.id}`,
      );
    }
    if (timer.status !== "pending") {
      return false;
    }
    activeTimers.delete(handle);
    timer.status = "canceled";
    return true;
  };

  const nextTimer = () =>
    [...activeTimers.values()].sort(
      (left, right) => left.dueAt - right.dueAt || left.sequence - right.sequence,
    )[0] ?? null;

  const runTimer = (timer, forced) => {
    if (timer.status === "pending") {
      activeTimers.delete(timer.handle);
    } else if (!(forced && timer.status === "canceled")) {
      return false;
    }
    timer.status = forced ? "forced" : "fired";
    clockNow = Math.max(clockNow, timer.dueAt);
    deliverCallback(
      timer.owner,
      "timer",
      timer.owner.window.id,
      `timer ${timer.handle.id}`,
      timer.callback,
    );
    return true;
  };

  const advanceTo = target => {
    finiteNonNegative(target, "clock target");
    if (target < clockNow) {
      throw new Error(`clock cannot move backwards from ${clockNow} to ${target}`);
    }
    for (;;) {
      const timer = nextTimer();
      if (!timer || timer.dueAt > target) {
        break;
      }
      runTimer(timer, false);
    }
    clockNow = target;
    return clockNow;
  };

  const clock = Object.freeze({
    get now() {
      return clockNow;
    },
    has(handle) {
      return activeTimers.has(handle);
    },
    force(handle) {
      const timer = timerRecords.get(handle);
      return timer ? runTimer(timer, true) : false;
    },
    runNext() {
      const timer = nextTimer();
      return timer ? runTimer(timer, false) : false;
    },
    advanceBy(delta) {
      finiteNonNegative(delta, "clock delta");
      return advanceTo(clockNow + delta);
    },
    advanceTo,
  });

  const waitAt = (owner, gateFixture) => {
    requireCurrent(owner, "wait", "wait at a gate");
    const gateRecord = gateRecords.get(gateFixture);
    if (!gateRecord) {
      throw new Error("gate belongs to another lifecycle model");
    }
    waitSequence += 1;
    const wait = {
      id: waitSequence,
      owner,
      gate: gateRecord,
      sequence: waitSequence,
    };
    waits.set(wait.id, wait);
    gateRecord.reached = true;
    gateRecord.waiterCount += 1;

    const settleWait = () => {
      if (waits.delete(wait.id)) {
        gateRecord.waiterCount -= 1;
      }
    };
    return gateRecord.promise.then(
      value => {
        settleWait();
        return value;
      },
      error => {
        settleWait();
        throw error;
      },
    );
  };

  const requireMutationOwner = (owner, target, label) => {
    if (canMutateDuringLifecycle(owner)) {
      return;
    }
    recordViolation(owner, {
      category: "stale-continuation",
      actor: owner.token.id,
      target,
      label,
    });
    throw new Error(
      `stale continuation from ${owner.token.id} tried to mutate ${target}: ${label}`,
    );
  };

  const isThenable = value =>
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof value.then === "function";

  const performMutation = (owner, domain, label, apply) => {
    nonEmptyName(label, "mutation label");
    if (typeof apply !== "function") {
      throw new TypeError("state mutation must be a function");
    }
    requireMutationOwner(owner, domain.id, label);

    let snapshot;
    const previousMutation = activeMutation;
    activeMutation = { owner, target: domain, label };
    try {
      snapshot = cloneDeterministic(domain.data);
      const result = apply(domain.view);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => {});
        throw harnessContractError(
          owner,
          domain.id,
          label,
          "mutation callbacks must be synchronous",
        );
      }
      mutations.push({ actor: owner.token.id, target: domain.id, label });
      return result;
    } catch (error) {
      if (snapshot) {
        restoreDomain(domain, snapshot);
      }
      throw error;
    } finally {
      activeMutation = previousMutation;
    }
  };

  const mutateWindow = (owner, targetValue, label, apply) => {
    const target = resolveWindow(targetValue);
    requireMutationOwner(owner, target.id, label);
    if (target !== owner.window) {
      recordViolation(owner, {
        category: "wrong-window-mutation",
        actor: owner.token.id,
        target: target.id,
        label,
      });
      throw new Error(
        `wrong-window mutation by ${owner.token.id} targeted window ${target.id}: ${label}`,
      );
    }
    return performMutation(owner, windowRecords.get(target).domain, label, apply);
  };

  const mutateApplication = (owner, label, apply) =>
    performMutation(owner, applicationDomain, label, apply);

  const load = windowValue => {
    const windowFixture = resolveWindow(windowValue);
    const windowRecord = windowRecords.get(windowFixture);
    const current = currentByWindow.get(windowFixture.id);
    if (current) {
      lifecycleEvent(windowRecord, "rejected-load", current.token.id);
      recordViolation(current, {
        category: "lifecycle-order",
        actor: current.token.id,
        target: windowFixture.id,
        label: "load before stop",
      });
      throw new Error(
        `must stop ${current.token.id} before loading another generation in window ${windowFixture.id}`,
      );
    }

    const ordinal = (ordinalsByWindow.get(windowFixture.id) ?? 0) + 1;
    ordinalsByWindow.set(windowFixture.id, ordinal);
    const token = Object.freeze({
      id: `${windowFixture.id}@${ordinal}`,
      windowId: windowFixture.id,
      ordinal,
    });
    const owner = {
      token,
      window: windowFixture,
      phase: "current",
      unload: null,
      stopProblems: [],
    };
    const generation = Object.freeze({
      token,
      window: windowFixture,
      applicationCarrier: application.carrier,
      isCurrent: () => isCurrent(owner),
      onUnload(callback) {
        requireCurrent(owner, "unload", "register unload cleanup");
        if (typeof callback !== "function") {
          throw new TypeError("unload cleanup must be a function");
        }
        if (owner.unload) {
          throw new Error(`${owner.token.id} already has unload cleanup`);
        }
        owner.unload = callback;
      },
      wait: gateFixture => waitAt(owner, gateFixture),
      listen: (target, type, callback) => listen(owner, target, type, callback),
      setTimeout: (callback, delay) => setTimer(owner, callback, delay),
      clearTimeout: handle => clearTimer(owner, handle),
      mutateWindow: (target, label, apply) => mutateWindow(owner, target, label, apply),
      mutateApplication: (label, apply) => mutateApplication(owner, label, apply),
    });
    generationRecords.set(generation, owner);
    currentByWindow.set(windowFixture.id, owner);
    lifecycleEvent(windowRecord, "load", token.id);
    return generation;
  };

  const stop = generation => {
    const owner = resolveGeneration(generation);
    if (owner.phase === "stopped") {
      return false;
    }
    if (!isCurrent(owner)) {
      throw new Error(`${owner.token.id} is not the current generation`);
    }
    owner.phase = "stopping";
    let cleanupContractRecorded = false;
    try {
      const cleanup = owner.unload?.();
      if (isThenable(cleanup)) {
        // The controller's stop contract is synchronous. Observe a rejected cleanup so
        // the deliberate contract failure cannot also become an unhandled rejection.
        void Promise.resolve(cleanup).catch(() => {});
        cleanupContractRecorded = true;
        throw harnessContractError(
          owner,
          owner.window.id,
          "unload cleanup",
          "synchronous unload cleanup is required",
        );
      }
    } catch (error) {
      if (!cleanupContractRecorded) {
        recordViolation(owner, {
          category: "teardown-error",
          actor: owner.token.id,
          target: owner.window.id,
          label: "unload cleanup",
          detail: String(error?.message ?? error),
        });
      }
      throw error;
    } finally {
      owner.stopProblems = [
        ...[...listeners.values()]
          .filter(listener => listener.owner === owner)
          .sort((left, right) => left.sequence - right.sequence)
          .map(listener => ({
            category: "leaked-listener",
            owner: owner.token.id,
            target: listener.target.name,
            type: listener.type,
            sequence: listener.sequence,
          })),
        ...[...activeTimers.values()]
          .filter(timer => timer.owner === owner)
          .sort(
            (left, right) => left.dueAt - right.dueAt || left.sequence - right.sequence,
          )
          .map(timer => ({
            category: "leaked-timer",
            id: timer.handle.id,
            owner: owner.token.id,
            delay: timer.delay,
            dueAt: timer.dueAt,
            sequence: timer.sequence,
          })),
      ];
      if (currentByWindow.get(owner.window.id) === owner) {
        currentByWindow.delete(owner.window.id);
      }
      owner.phase = "stopped";
      lifecycleEvent(windowRecords.get(owner.window), "stop", owner.token.id);
    }
    return true;
  };

  const audit = generation => {
    const owner = resolveGeneration(generation);
    const ownedListeners = [...listeners.values()]
      .filter(listener => listener.owner === owner)
      .sort((left, right) => left.sequence - right.sequence)
      .map(listener => ({
        owner: owner.token.id,
        target: listener.target.name,
        type: listener.type,
        sequence: listener.sequence,
      }));
    const ownedTimers = [...activeTimers.values()]
      .filter(timer => timer.owner === owner)
      .sort((left, right) => left.dueAt - right.dueAt || left.sequence - right.sequence)
      .map(timer => ({
        id: timer.handle.id,
        owner: owner.token.id,
        delay: timer.delay,
        dueAt: timer.dueAt,
        sequence: timer.sequence,
      }));
    const ownedWaits = [...waits.values()]
      .filter(wait => wait.owner === owner)
      .sort((left, right) => left.sequence - right.sequence)
      .map(wait => ({
        owner: owner.token.id,
        gate: wait.gate.name,
        sequence: wait.sequence,
      }));
    const ownedViolations = violations
      .filter(violation => violation.owner === owner)
      .map(violation => ({ ...violation.value }));
    const liveResourceProblems = [
      ...ownedListeners.map(listener => ({ category: "leaked-listener", ...listener })),
      ...ownedTimers.map(timer => ({ category: "leaked-timer", ...timer })),
    ];
    const problems = [
      ...(owner.phase === "stopped" ? owner.stopProblems : liveResourceProblems),
      ...ownedWaits.map(wait => ({ category: "pending-wait", ...wait })),
      ...ownedViolations,
    ];
    return {
      generation: owner.token.id,
      phase: owner.phase,
      current: isCurrent(owner),
      clean: problems.length === 0,
      listeners: ownedListeners,
      timers: ownedTimers,
      waits: ownedWaits,
      mutations: mutations.filter(mutation => mutation.actor === owner.token.id),
      violations: ownedViolations,
      lifecycle: owner.window.lifecycle,
      problems,
    };
  };

  const assertClean = generation => {
    const report = audit(generation);
    if (report.clean) {
      return report;
    }
    const details = report.problems.map(problem => {
      switch (problem.category) {
        case "leaked-listener":
          return `leaked listener ${problem.target}:${problem.type}`;
        case "leaked-timer":
          return `leaked timer ${problem.id} due at ${problem.dueAt}`;
        case "pending-wait":
          return `pending wait at ${problem.gate}`;
        case "stale-callback":
          return `stale callback ${problem.source} ${problem.actor}->${problem.target}: ${problem.label}`;
        case "stale-continuation":
          return `stale continuation ${problem.actor}->${problem.target}: ${problem.label}`;
        case "wrong-window-mutation":
          return `wrong-window mutation ${problem.actor}->${problem.target}: ${problem.label}`;
        case "wrong-application-mutation":
          return `wrong application mutation ${problem.actor}: ${problem.label}`;
        case "wrong-resource-owner":
          return `wrong ${problem.resource} owner ${problem.actor}->${problem.target}`;
        case "stale-registration":
          return `stale ${problem.resource} registration by ${problem.actor}`;
        case "lifecycle-order":
          return `invalid lifecycle order for ${problem.actor}: ${problem.label}`;
        case "harness-contract":
          return `harness contract violation by ${problem.actor}: ${problem.detail}`;
        case "teardown-error":
          return `teardown error from ${problem.actor}: ${problem.detail}`;
        default:
          return `unknown lifecycle problem: ${problem.category}`;
      }
    });
    throw new Error(`${report.generation} lifecycle audit failed: ${details.join("; ")}`);
  };

  return Object.freeze({
    application,
    clock,
    gate,
    window: id => resolveWindow(id),
    load,
    stop,
    audit,
    assertClean,
  });
};
