# Sine Lifecycle

Small lifecycle primitives for privileged Sine mods running in Zen Browser.

The package owns only three proven seams:

- `disposable-scope` — terminal, failure-isolated LIFO cleanup.
- `generation-scope` — cleanup plus abortable waits and owned timers.
- `sine-window` — Sine hot-unload and native window-close binding.

Each capability is an explicit ESM subpath. There is no root barrel, and the package
declares `sideEffects: false`, so a mod only bundles the capability it imports.

## Compatibility

Version 0.1 targets the repository's current platform: Zen/Firefox 153, Sine 2.3.3,
ES2023, and native `DisposableStack`. It does not include a legacy polyfill or a
CommonJS build.

## Disposable scope

```ts
import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";

const scope = new DisposableScope({
  onDisposeError: error => console.error("cleanup failed", error),
});

scope.defer(() => removeListener());
scope.defer(() => clearResource());
scope.stop();
```

`stop()` becomes terminal before cleanup begins, drains in LIFO order, contains
cleanup failures, and returns `false` after the first call. A resource deferred after
stop is disposed immediately.

## Generation scope

```ts
import { GenerationScope } from "@zen-mods/sine-lifecycle/generation-scope";

const scope = new GenerationScope({
  timers: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: handle => window.clearTimeout(handle),
  },
});

const result = await scope.wait(loadState());
if (result.kind === "stopped") return;

scope.schedule(1_000, () => refresh(result.value));
```

Every continuation must still check the returned result or `scope.isLive()`. Stopping
the scope settles owned waits, cancels timers, aborts its signal, then drains cleanup.

## Sine window binding

```ts
import { bindSineWindowLifecycle } from "@zen-mods/sine-lifecycle/sine-window";

bindSineWindowLifecycle(window, {
  defer: disposer => scope.defer(disposer),
  stop: reason => controller.stop(reason),
});
```

The native non-capturing, once-only `unload` listener is required because Sine 2.3.3's
hot-unload callback does not cover normal browser-window close. The owner must make
`stop` terminal and idempotent. The adapter returns whether Sine's hook was available
so each mod can use its own logging policy.

For a small mod, implement `SineWindowGenerationState` with `DisposableScope`, keep
that state under the mod's own window namespace, then pass it to the binding. The
library deliberately does not choose the namespace, replacement policy, logging, or
startup-failure behavior for the consumer.

## Package status

This workspace dogfoods the package before its first public release. The manifest
remains private until the packed-consumer, bundle-isolation, mod, and exact Zen/Sine
lifecycle gates pass and publication is separately approved.
