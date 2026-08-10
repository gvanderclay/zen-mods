/** One process-wide carrier shared by every cache-busted window fixture import. */

const applicationId = Cc["@mozilla.org/uuid-generator;1"]
  .getService(Ci.nsIUUIDGenerator)
  .generateUUID()
  .toString();
let nextSequence = 1;
let nextWindow = 1;
let nextGeneration = 1;
let idsByWindow = new WeakMap();
const active = new Map();
const gates = new Map();
const heldReadiness = new Set();
const trace = [];
let sharedValue = null;

const emit = (type, fields = {}) => {
  const event = { ...fields, seq: nextSequence, type };
  nextSequence += 1;
  trace.push(event);
  return event;
};

const identifyWindow = targetWindow => {
  let id = idsByWindow.get(targetWindow);
  if (!id) {
    id = `window-${nextWindow}`;
    nextWindow += 1;
    idsByWindow.set(targetWindow, id);
    emit("window-identified", { windowId: id });
  }
  return id;
};

const gateKey = (generation, label) => `${generation}:${label}`;

const pause = (instance, label, type = "continuation-paused") => {
  const key = gateKey(instance.generation, label);
  if (gates.has(key)) throw new Error(`gate already exists: ${key}`);
  let release;
  const promise = new Promise(resolve => {
    release = resolve;
  });
  gates.set(key, {
    generation: instance.generation,
    label,
    release,
    windowId: instance.windowId,
  });
  emit(type, {
    generation: instance.generation,
    label,
    windowId: instance.windowId,
  });
  return promise;
};

const carrier = {
  applicationId,

  begin(targetWindow) {
    const windowId = identifyWindow(targetWindow);
    const generation = nextGeneration;
    nextGeneration += 1;
    if (active.has(windowId)) {
      emit("overlapping-import", {
        generation,
        previousGeneration: active.get(windowId).generation,
        windowId,
      });
    }
    const instance = { generation, windowId };
    active.set(windowId, { generation, ready: false, registered: false });
    emit("import", instance);
    return instance;
  },

  markRegistered(instance) {
    const current = active.get(instance.windowId);
    if (current?.generation === instance.generation) current.registered = true;
    emit("unload-registered", instance);
  },

  holdNextReadiness(windowId) {
    heldReadiness.add(windowId);
    emit("readiness-armed", { windowId });
  },

  readiness(instance) {
    if (!heldReadiness.delete(instance.windowId)) return null;
    return pause(instance, "readiness", "readiness-paused");
  },

  markReady(instance) {
    const current = active.get(instance.windowId);
    if (current?.generation === instance.generation) current.ready = true;
    emit("ready", instance);
  },

  pauseContinuation(instance, label) {
    return pause(instance, label);
  },

  release(generation, label) {
    const key = gateKey(generation, label);
    const gate = gates.get(key);
    if (!gate) return false;
    gates.delete(key);
    emit("gate-released", {
      generation,
      label,
      windowId: gate.windowId,
    });
    gate.release();
    return true;
  },

  stop(instance) {
    const current = active.get(instance.windowId);
    const owned = current?.generation === instance.generation;
    if (owned) active.delete(instance.windowId);
    emit("stop", { ...instance, owned });
  },

  event(type, instance, fields = {}) {
    return emit(type, { ...instance, ...fields });
  },

  writeShared(instance, value) {
    sharedValue = value;
    emit("shared-write", { ...instance, value });
  },

  readShared() {
    return sharedValue;
  },

  snapshot() {
    return {
      active: [...active].map(([windowId, value]) => ({ windowId, ...value })),
      carrierLoads: 1,
      heldReadiness: [...heldReadiness],
      pendingGates: [...gates.values()].map(gate => ({
        generation: gate.generation,
        label: gate.label,
        windowId: gate.windowId,
      })),
      sharedValue,
      trace: trace.map(event => ({ ...event })),
    };
  },

  reset() {
    if (active.size > 0 || gates.size > 0 || heldReadiness.size > 0) {
      throw new Error("cannot reset a carrier with active instances or gates");
    }
    idsByWindow = new WeakMap();
    trace.length = 0;
    sharedValue = null;
    nextSequence = 1;
    nextWindow = 1;
    nextGeneration = 1;
  },
};

export default carrier;
