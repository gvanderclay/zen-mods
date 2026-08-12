/** Per-window fixture imported by Sine with a cache-busting query on every generation. */

// A static import from this non-system window module gets a window-local module map.
// ChromeUtils keeps the carrier in the shared system-module map instead.
const carrier = ChromeUtils.importESModule(
  "chrome://sine/content/keep-loaded-lifecycle-harness/fixtures/lifecycle-carrier.sys.mjs",
).default;

const API_KEY = "__zenKeepLoadedLifecycleHarness";
const instance = carrier.begin(window);
const moduleToken = Cc["@mozilla.org/uuid-generator;1"]
  .getService(Ci.nsIUUIDGenerator)
  .generateUUID()
  .toString();
const lifetime = { stopped: false };
let mutations = 0;
let ready = false;

const mutate = source => {
  mutations += 1;
  carrier.event("mutation", instance, {
    source,
    stopped: lifetime.stopped,
    targetWindowId: instance.windowId,
  });
};

const api = {
  applicationId: carrier.applicationId,
  generation: instance.generation,
  moduleToken,
  windowId: instance.windowId,
  get mutations() {
    return mutations;
  },
  get ready() {
    return ready;
  },
  get stopped() {
    return lifetime.stopped;
  },
  pauseContinuation(label) {
    const paused = carrier.pauseContinuation(instance, label);
    void paused.then(() => {
      carrier.event("continuation-resumed", instance, {
        label,
        stopped: lifetime.stopped,
      });
      if (lifetime.stopped) {
        carrier.event("continuation-skipped", instance, { label, stopped: true });
        return;
      }
      mutate(`continuation:${label}`);
    });
  },
  ping() {
    window.dispatchEvent(new Event("keep-loaded-lifecycle-ping"));
  },
  readShared() {
    return carrier.readShared();
  },
  writeShared(value) {
    carrier.writeShared(instance, value);
  },
};

window[API_KEY] = api;

const onPing = () => {
  if (lifetime.stopped) {
    carrier.event("listener-skipped", instance, { stopped: true });
    return;
  }
  mutate("listener");
};
window.addEventListener("keep-loaded-lifecycle-ping", onPing);

const timer = window.setTimeout(() => {
  if (lifetime.stopped) {
    carrier.event("timer-skipped", instance, { stopped: true });
    return;
  }
  mutate("timer");
}, 600_000);

const teardown = source => {
  carrier.event("teardown-call", instance, { source, stopped: lifetime.stopped });
  if (lifetime.stopped) return;
  lifetime.stopped = true;
  window.removeEventListener("keep-loaded-lifecycle-ping", onPing);
  window.removeEventListener("unload", onNativeUnload, false);
  window.clearTimeout(timer);
  if (window[API_KEY] === api) delete window[API_KEY];
  carrier.stop(instance);
};

const onNativeUnload = () => teardown("native-unload");
window.addEventListener("unload", onNativeUnload, {
  capture: false,
  once: true,
});

if (typeof window.addUnloadListener !== "function") {
  teardown("missing-sine-api");
  throw new Error("Sine did not expose addUnloadListener");
}
window.addUnloadListener(() => teardown("sine"));
carrier.markRegistered(instance);

const readiness = carrier.readiness(instance);
if (readiness) await readiness;
if (lifetime.stopped) {
  carrier.event("readiness-skipped", instance, { stopped: true });
} else {
  ready = true;
  carrier.markReady(instance);
}
