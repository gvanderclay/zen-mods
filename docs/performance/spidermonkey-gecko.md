# SpiderMonkey and Gecko performance guide

Status: reviewed against the runtime stamp below on 2026-08-09

This is the performance reference for this repository. Read it before changing code
primarily for speed, memory use, startup cost, or bundle size. It is not a list of
JavaScript superstitions. It records what the actual engine and browser optimize, what
this repository has measured or can measure, which experiments remain worthwhile, and
which tempting rewrites should be rejected unless new evidence appears.

Quick routes:

- Start an optimization with [Optimization order](#optimization-order), then choose a
  lane in [Measurement protocol](#measurement-protocol).
- Check a syntax/data-structure idea in
  [JavaScript language and representation guidance](#javascript-language-and-representation-guidance).
- Investigate browser UI under [Gecko and browser-chrome costs](#gecko-and-browser-chrome-costs).
- Investigate retention under
  [Allocation, garbage collection, and memory ownership](#allocation-garbage-collection-and-memory-ownership).
- Review the explicit [WebAssembly decision](#webassembly-decision).
- Find the approved implementation route in [Project-specific route](#project-specific-route).
- Finish with the [optimization checkpoint checklist](#checklist-for-every-optimization-checkpoint).

For one optimization checkpoint: choose the evidence lane first, record a clean parent
without changing the workload, then change production code and compare it through the
same benchmark plus the applicable exact-product correctness gate. The executable
sequence is in [Record and compare a rolling baseline](#record-and-compare-a-rolling-baseline).

## Scope and evidence

These mods are not ordinary web-page scripts. Sine imports them into Firefox/Zen's
privileged browser window, in the parent process, where they share the main thread with
input, browser UI, XUL popup work, style, layout, and painting. Their pure policy
functions still run in SpiderMonkey, but their most expensive operations can be native
browser calls rather than JavaScript instructions.

The guide uses five evidence classes. Important claims below carry one of these labels
where the distinction changes what may be concluded:

- **Exact build** — verified against the stamped installed Zen/Gecko/Sine or Firefox's
  matching release source.
- **Engine contract** — documented by current SpiderMonkey, Gecko, Web standards, or
  exact source, but not necessarily measured in these mods.
- **Repository measurement** — observed by the checked-in benchmark or live-XUL
  harness on the stamped machine.
- **Hypothesis** — plausible enough to benchmark, but not a reason to ship a rewrite.
- **Decision** — the current repository policy; it may be revisited when its stated
  trigger occurs.

Do not turn a current-engine implementation detail into a correctness dependency.
Private Zen and Firefox APIs still require the product-specific exact-source checks in
each mod's `AGENTS.md`.

## Runtime stamp

| Layer | Reviewed runtime |
|---|---|
| Zen | 1.21.12b, build `20260807120242` |
| Gecko/Firefox | 153.0.3, source tag `FIREFOX_153_0_3_RELEASE` |
| Zen source stamp | `6096aaed30dc8da4229a3d6a0b58379726223ae6` |
| Sine | 2.3.3.0 |
| Production build | esbuild 0.28.1, target `firefox153`, ESM, tree shaking enabled |
| Policy benchmark runtime | Node 24.6.0, V8 13.6.233.10, Vitest 4.1.10/Tinybench |
| Benchmark machine | Apple M4 Max, arm64, 16 logical CPUs, macOS 26.5.2 (Darwin 25.5.0) |

**Exact build:** the exact Firefox tag points to commit
[`0c39e928`](https://github.com/mozilla-firefox/firefox/tree/0c39e9282688363f5028d0541c17784f7fa5117c).
Node benchmarks execute V8, not SpiderMonkey. They establish algorithmic direction and
detect large regressions; they cannot prove a SpiderMonkey syntax-level win.

## Optimization order

Use this order unless a profile points somewhere else:

1. Preserve correctness, teardown, and ownership. Fast stale work is still a bug.
2. Remove browser work: tab inventories, SessionStore operations, WebIDL/XPCOM calls,
   DOM reads/writes, layout, popup reconstruction, preference writes, and reloads.
3. Improve algorithms and data flow: remove complete passes, repeated sorting,
   repeated parsing, unnecessary move-plan materialization, and quadratic behavior.
4. Reduce measured allocation or representation cost inside a proven hot path.
5. Compare language-level alternatives in exact SpiderMonkey when the choice might be
   engine-sensitive.
6. Consider minification, workers, WebAssembly, or a new dependency only as an
   explicit experiment with startup, steady-state, memory, and maintenance evidence.

This order is not anti-micro-optimization. It directs the beautifully unnecessary
micro-optimizations toward places where they survive contact with the real runtime.

## SpiderMonkey's execution model

### Parsing and tiering

SpiderMonkey lazily parses/delazifies functions and compiles hot scripts through four
execution tiers: the C++ interpreter, Baseline Interpreter, Baseline Compiler, then
optimizing Ion/Warp code. **Exact build:** Firefox 153 uses default warm-up triggers of
10, 100, and 1,500 respectively, but script size, argument/local counts, nested-loop
OSR, and entry conditions can raise or shift the effective transition; loop headers
can tier up through on-stack replacement.
See [SpiderMonkey's overview](https://firefox-source-docs.mozilla.org/js/),
[How SpiderMonkey Optimizes](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html),
the exact [Firefox 153 JIT options](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/JitOptions.cpp#L210-L251),
and its
[Ion threshold adjustment](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/IonOptimizationLevels.cpp).

That model splits this repository's code into two practical populations:

- A context-menu calculation, installation path, or Sine reload may execute only once
  or a few times. It can remain interpreted or Baseline-compiled.
- A benchmark's batched inner loop deliberately becomes hot and may reach Ion. It is a
  good place to compare algorithms, but it can exaggerate optimizations available only
  after substantial warm-up.

**Exact build:** SpiderMonkey has an in-memory JitHints system that can lower warm-up
thresholds on a later load. Exact Gecko 153 deliberately enables it only in content processes and
disables it in the parent process to avoid browser-UI jank. These mods therefore get
normal tiering but no cross-load JitHints acceleration. See the exact
[`XPCJSContext.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/xpconnect/src/XPCJSContext.cpp#L885-L927).
Sine also cache-busts module URLs during reload, producing new script identities.

Under exact default settings, ordinary on-demand Baseline compilation can occur on the
main thread while Ion compilation remains off-thread. A threshold-crossing sample can
therefore include compilation cost. See the exact
[Baseline decision](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/BaselineJIT.cpp#L210-L228)
and
[compile fallback](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/BaselineJIT.cpp#L394-L459),
plus the exact
[off-thread JIT preferences](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/modules/libpref/init/StaticPrefList.yaml).

**Decision:** never choose a one-shot browser-chrome implementation solely because it
wins after thousands of Node or SpiderMonkey-shell iterations. Pair the microbenchmark
with exact-Zen first-use and warmed measurements when the change is engine-sensitive.
For a controlled syntax-level engine study, deliberately separate first call and
approximate trigger regions around 10, 100, and 1,500 warmups only when production
could realistically get that hot. Treat them as laboratory bands, not promises about
the exact tier executing any production call.

### CacheIR, shapes, and types

**Engine contract:** outside the C++ interpreter, SpiderMonkey specializes common
operations with CacheIR. It guards observed types, object shapes, prototypes, and built-in behavior, then uses
those observations in Baseline and Ion. A failed speculative assumption falls back or
bails out safely. The engine also uses fuses to invalidate optimized assumptions when
built-in/prototype behavior changes. See
[How SpiderMonkey Optimizes](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html)
and the exact [CacheIR definition](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/CacheIR.h#L25-L97).

An object's shape describes its class, realm, prototype, property structure, and slot
layout. Objects with the same structure share immutable shapes, saving memory and
supporting fast JIT guards. Removing a non-final property, changing non-final property
attributes, or accumulating many properties can move an object into unshared dictionary
mode. See exact Firefox 153
[`Shape.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/Shape.h#L30-L115).

Project rules:

- Construct the same kind of fact with the same fields in the same order.
- Prefer discriminated unions when variants genuinely have different valid state.
  They improve correctness and still give each variant a stable shape.
- Do not add and delete optional properties repeatedly to recycle an object.
- Do not pool short-lived fact records. Pooling lengthens lifetimes, complicates
  ownership, and can cause data to be tenured.
- Do not perform a shape-driven rewrite without an exact profile. Modern SpiderMonkey
  has polymorphic and megamorphic inline-cache strategies; "more than one shape means
  deoptimized" is false.

Mozilla's own shape work has produced large microbenchmark gains with no detectable
Speedometer movement, a useful warning against extrapolation. See
[Making Teleporting Smarter](https://spidermonkey.dev/blog/2025/02/19/Making-Teleporting-Smarter.html).

### Ion already performs classic compiler optimizations

Hot code can receive scalar replacement of non-escaping objects, global value
numbering, loop-invariant code motion, dead-code elimination, branch pruning, range
analysis, bounds-check elimination, and cache-local block ordering. See the
[MIR optimization inventory](https://firefox-source-docs.mozilla.org/js/MIR-optimizations/index.html).

Consequences:

- Do not manually cache a trivial pure expression merely because it appears inside a
  hot loop; show that it survives and costs time first.
- Keep benchmark results observable so dead-code elimination cannot erase the work.
- An optimization that only Ion can perform may not help a one-shot popup path.
- Removing an entire pass or native call remains valuable at every tier.

## JavaScript language and representation guidance

### Arrays and iteration

SpiderMonkey stores ordinary indexed elements densely when possible. Packed arrays can
be accessed faster than arrays containing holes; sufficiently sparse or unusual indexed
properties use slower representations. Exact details are documented in
[`NativeObject.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/NativeObject.h#L113-L195).

Use these rules:

- Build dense arrays with `push`, literals, `map`, or known complete indices. Avoid
  deleting elements, assigning far beyond `length`, or creating holes in a hot array.
- `for`, `for...of`, `map`, `filter`, and `reduce` are not ranked universally. Choose
  the clearest form until a profile identifies the traversal or intermediate array.
- Fuse chained operations when it removes a material traversal/allocation in a proven
  path. Do not mechanically replace every array method with a loop.
- Preserve input order instead of sorting it again when an earlier stage already
  established the required order.
- Use a one-pass minimum/maximum selection instead of sorting when only one winner is
  needed. This is an algorithmic improvement, not engine trivia.

SpiderMonkey explicitly optimizes queue-style `Array.prototype.shift()` by advancing
the dense-elements pointer. Subject to representation changes, this can defer moving
storage for up to 2,047 shifts; growth, non-extensibility, copy-on-write state, and
other transitions can force a different path earlier.
It also has inlinable fast paths for common array operations including `join`, `pop`,
`shift`, `push`, and `slice`. See
[`NativeObject.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/NativeObject.h#L177-L252)
and
[`InlinableNatives.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/InlinableNatives.h#L28-L51).
Firefox's self-hosted `every`, `some`, `forEach`, `map`, `filter`, and find variants are
also marked to permit aggressive hot-function/callback inlining. See
[`Array.js`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/Array.js#L6-L193).

**Rejected folklore:** "`shift()` is always O(n)," "callbacks are always slow," and
"manual loops always beat built-ins." Benchmark the actual data size and tier.

### Sorting and collation

Firefox 153 uses insertion sort for very small arrays and stable merge sort for larger
ones. It recognizes the common numeric comparator forms `return x - y` and
`return y - x`, converts values once, and uses specialized comparators. See exact
[`Sorting.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/Sorting.h#L31-L56)
and
[`Array.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/Array.cpp#L1872-L2101).

Repository rules:

- Do not sort to pick one item.
- Do not re-sort a bucket whose encounter order already has the required invariant.
- Sorting dozens of UI rows is reasonable; eliminate redundant sorts before replacing
  the algorithm.
- Retain stable deterministic tie-breakers so performance work does not change behavior.

**Exact build:** `String.prototype.localeCompare()` has an important exact-engine
exception. Firefox caches a default collator only when `options` is `undefined` and
`locales` is either `undefined` or a string. Passing an options object, as the Sidebar
currently does for numeric/base comparison, creates a new
`Intl.Collator` for every comparator call. See
[`String.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/String.cpp#L1475-L1515)
and
[`Collator.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/intl/Collator.cpp#L389-L406).

**Decision:** the Sidebar pure-presentation-planning checkpoint should construct one
product-local collator and reuse its
bound comparison. This removes an expensive native object construction from every
sort comparison while keeping the exact locale behavior.

### `Map` and `Set`

SpiderMonkey's `Map` and `Set` use an ordered data array plus hash buckets for expected
constant-time lookup while preserving insertion order. The first inserted entry
allocates their combined buffer; deletes leave tombstones until resize/compaction. String
keys can reuse atom hashes. Common constructors, lookup, update, delete, and size
operations have JIT fast paths. See
[`OrderedHashTableObject.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/OrderedHashTableObject.h#L7-L105),
[`MapObject.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/MapObject.cpp#L37-L105),
[`StringType.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/StringType.h#L82-L199),
and
[`InlinableNatives.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/InlinableNatives.h#L83-L102).

Project rules:

- Keep using `Map` for identity grouping, lane lookup, node association, and keyed work.
- Keep using `Set` for membership and deduplication.
- Do not replace them with plain objects, parallel arrays, or nested linear searches
  based on generic folklore.
- Avoid clone-on-read when ownership already guarantees a fresh private Set, but do not
  expose mutable stored state merely to save one small copy.
- When a Map/Set is session-owned and contains DOM nodes, clear or release the entire
  session deterministically on close; GC tuning is not a teardown strategy.

### Strings and regular expressions

SpiderMonkey represents strings as Latin-1 or two-byte data and uses inline short
strings, dependent substrings, atoms, extensible buffers, and lazy rope concatenations.
Ropes specifically avoid repeated O(n-squared) copies and flatten only when linear data
is required. See exact Firefox 153
[`StringType.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/StringType.h#L82-L199).

Project rules:

- Template strings and `+` concatenation are fine for a handful of labels. "Always use
  `array.join`" is false.
- Normalize a search key once when the same row is queried repeatedly. Do not memoize a
  one-shot lowercase conversion globally.
- Parse stable preference text once per observed change when later work reads it often.
- Prefer exact string/Set matching for the small Keep Loaded allowlist. A trie, combined
  regular expression, or memoization layer adds more work and state at current sizes.
- Avoid repeatedly forcing a large rope to linear form inside a loop, but establish
  that behavior with a profile before rewriting concatenation.

SpiderMonkey has native/JIT paths for many string and RegExp operations, including
`includes`, `indexOf`, prefix/suffix checks, case conversion, trim, split, and regexp
search/match. A non-atom regexp using the native regexp engine starts interpreted and
can tier to native code after ten uses or eagerly for inputs over 1,000 characters.
Simple atom patterns can use direct string matching instead, and the per-zone weak
source/flags cache can reuse compiled state only while that state remains alive. See
[`InlinableNatives.h`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/InlinableNatives.h#L123-L179)
and
[`RegExpObject.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/RegExpObject.cpp#L691-L721).
Hoisting a global/sticky expression also introduces mutable `lastIndex`; there is no
current regex hotspot worth such a rewrite.

### Functions, closures, and functional style

The repository's architecture—pure decision functions around an imperative browser
shell—fits the engine and the problem. Ion can inline hot functions and eliminate some
non-escaping allocations; Baseline's inline caches still optimize stable calls and
properties. The source should express ownership and policy clearly before it attempts
to look like compiler output.

Use these rules:

- Keep pure cores, discriminated unions, injected ports, and immutable public results.
- Inside a measured large loop, a local mutable builder that returns an immutable result
  is a clean functional compromise when it removes intermediate collections.
- Hoist a callback/comparator only when it avoids repeated construction or carries an
  expensive reusable object, such as the shared collator.
- Do not introduce a functional-programming runtime, transducer library, state manager,
  or effect system. It would not remove the product-specific Sine/Zen ownership rules.
- Do not reject a readable `map`/`filter` chain for small UI arrays unless structural
  counts or profiles identify it. Do combine passes already approved in Keep Loaded and
  Tab Deduplicator where the same hundreds of facts are traversed repeatedly.

**Decision — runtime-library survey:** no runtime dependency currently earns its cost.
The representative options and the mismatch are explicit:

| Category | Representative options | Why not now |
|---|---|---|
| Promise queue/rate limiter | [`p-queue`](https://github.com/sindresorhus/p-queue), [`Bottleneck`](https://github.com/SGrondin/bottleneck) | Supply FIFO, concurrency, priority, or rate limiting—not keyed coalescing, per-tab dequeue revalidation, generation tokens, or application-global preference rollback |
| Statecharts/actors | [`XState`](https://stately.ai/docs/xstate) | Makes complex transitions explicit, but still needs product-specific Sine generations, window registration, native transactions, and browser-resource ownership; current state machines fit small discriminated unions |
| Typed effects/functional runtime | [`Effect`](https://effect.website/docs/), [`fp-ts`](https://github.com/gcanti/fp-ts) | Adds a runtime or pervasive combinator vocabulary around APIs that still require local adapters and deterministic teardown |
| Reactive streams | [`RxJS`](https://rxjs.dev/) | Useful for large composable event graphs, but does not satisfy synchronous native-menu timing and obscures the small number of explicitly owned listeners/observers here |
| Declarative UI | [`Lit`](https://lit.dev/docs/), [`Preact`](https://preactjs.com/guide/v10/getting-started/) | Adds rendering/runtime conventions that cannot safely replace live XUL menu nodes and are disproportionate for the current small retained panels |

Keep these categories available for a future workload that actually matches them. For
the approved work, use small pure reducers and discriminated unions around
product-local imperative owners. Reassess shared UI only after the Keep Loaded UI audit
proves a cohesive second consumer.

Each closure is a function object with an environment; Ion can recover some
non-escaping lambdas, while event listeners necessarily escape and need stable teardown
identity. Destructuring, rest, and ordinary object/array spread have specialized paths
in common cases. Keep the syntax; avoid copying a growing collection inside a hot loop,
not the language feature itself. Exact references:
[lambda bytecode](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/Opcodes.h#L1609-L1627),
[scalar replacement](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/jit/ScalarReplacement.cpp#L155-L223),
and
[object copy fast path](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/vm/NativeObject.cpp#L2948-L3025).

### Numbers, typed arrays, and binary data

Ordinary JavaScript numbers are the right representation for tab counts, timestamps,
indices, and preference intervals. SpiderMonkey performs range analysis and can lower
safe arithmetic to integers. Bitwise coercion, `Math.imul`, typed arrays, or BigInt are
not free upgrades.

Use typed arrays only when data is genuinely a dense homogeneous numeric/binary buffer,
when a native API requires one, or when a benchmark proves an important locality win.
None of the current policy models fits that description. Do not encode tab facts into
parallel numeric buffers merely to make the code look lower-level. Do not add `|0` or
`~~` integer tricks; they change overflow/large-number semantics and duplicate engine
analysis.

### Async functions, promises, generators, and scheduling

Async abstractions are semantic scheduling boundaries, not CPU optimizations. An async
function creates a Promise; `await` normally creates Promise reaction machinery, and
generator/async suspension copies stack state. Replacing real `await` expressions with
`.then()` does not eliminate that work. Do avoid marking a synchronous callback `async`
for no reason. See exact
[`Promise.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/builtin/Promise.cpp#L6790-L6932).

A Promise continuation or MutationObserver runs at a microtask checkpoint after the
current stack; `requestAnimationFrame` runs at a rendering opportunity before
style/layout. Recursively queued microtasks can delay input and rendering. See the
[HTML event-loop model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops),
[DOM MutationObserver algorithm](https://dom.spec.whatwg.org/#mutation-observers), and
[Firefox front-end guidance](https://firefox-source-docs.mozilla.org/performance/bestpractices.html).

Project rules:

- Initial native-menu presentation remains synchronous. A Promise, MutationObserver,
  timer, or RAF is too late for Cocoa's menu snapshot.
- MutationObserver is appropriate for action nodes that genuinely arrive later.
- RAF is appropriate for post-popup focus or batched visual writes, but every frame
  needs explicit ownership, replacement, cancellation, and stale-delivery guards.
- Do not insert `await Promise.resolve()` to make a long parent-process task "async";
  microtasks do not yield to input or rendering.
- Firefox supports `requestIdleCallback()` and
  `Services.tm.idleDispatchToMainThread()` for chunkable, non-deadline work. There is no
  current candidate: popup presentation, wake transactions, destructive commands, and
  freshness deadlines cannot be postponed to an idle opportunity. Any future use must
  retain explicit cancellation and stale-generation ownership.

### Worker decision

**Decision:** do not move a current mod path to a worker. `ChromeWorker` can execute
privileged pure computation away from the parent main thread, but it cannot own the
live XUL/DOM nodes, browser commands, preferences, SessionStore operations, or
synchronous native-menu presentation that dominate these mods. Moving the small pure
policies alone would add worker startup, structured-clone or transfer work, asynchronous
request/result semantics, error routing, cancellation, Sine reload ownership, and a
second teardown boundary without current profile evidence of a sustained CPU task.

Reopen worker offload only when a profile finds a sustained pure and serializable job
that does not have to finish synchronously, and only after an exact-Zen A/B records
startup, clone/transfer, steady-state CPU, parent-main-thread gaps, cancellation,
errors, reload, window close, and final worker termination. Firefox's own
[front-end guidance](https://firefox-source-docs.mozilla.org/browser/FrontendCodeReviewBestPractices.html)
recommends workers or idle scheduling for genuinely CPU- or disk-intensive work that
does not need to happen immediately; that condition is the gate, not a general promise
that offloading is faster.

## Allocation, garbage collection, and memory ownership

**Engine contract:** SpiderMonkey uses precise, generational, incremental, partly
concurrent, parallel, and compacting garbage collection. New objects, strings, and BigInts normally enter a fast
nursery; surviving values move to tenured storage. Minor collection cost is tied more
closely to promoted survivors than to objects that die young. Allocation sites with
very high survival can be pretenured automatically. See the
[GC overview](https://firefox-source-docs.mozilla.org/js/gc.html) and
[pretenuring documentation](https://firefox-source-docs.mozilla.org/js/how-we-optimize.html#pretenuring).

Therefore:

- Small per-popup fact objects that die with the popup are healthy nursery workloads.
- Reduce allocation when measurements show volume, promotion, or pause cost—not merely
  because an object exists.
- Do not pool facts or retain previous plans; that can turn cheap young garbage into
  long-lived state.
- Deterministically release listeners, observers, frames, timers, sockets, nodes, and
  window references. Garbage collection cannot infer application ownership.
- Do not use `WeakRef` or `FinalizationRegistry` for required cleanup. Finalization is
  nondeterministic.
- Do not force GC in production. Forced GC changes the workload and can create worse
  jank than the allocations it tries to hide.

Firefox DOM objects participate in both JavaScript GC and C++ cycle collection. A
retained browser window or DOM node can keep a much larger native/JS graph alive than a
plain fact record. Use
[about:memory](https://firefox-source-docs.mozilla.org/performance/memory/about_colon_memory.html),
[GC/CC logs](https://firefox-source-docs.mozilla.org/performance/memory/gc_and_cc_logs.html),
and the
[profiler memory tools](https://firefox-source-docs.mozilla.org/tools/profiler/memory.html)
for suspected retention.

## Gecko and browser-chrome costs

### Parent-process main thread

Firefox front-end JavaScript shares the parent-process main thread with user input and
painting. A tiny amount of work at a bad time can matter more than a much larger
background calculation. Firefox's own guidance is to profile, avoid synchronous
layout, batch DOM writes, and move genuinely heavy pure work off-thread. See
[front-end performance best practices](https://firefox-source-docs.mozilla.org/performance/bestpractices.html).

For these mods, the default cost model is:

`browser/session operation > DOM/XUL/native boundary > full data pass or sort > small JS allocation > syntax choice`

That is a priority heuristic, not a theorem. A profile may overturn it.

### WebIDL, XPCOM, and DOM

DOM properties and methods cross generated WebIDL JS/C++ bindings. Gecko can hoist or
common-subexpression-eliminate bindings explicitly annotated pure/constant, but an
arbitrary private XUL/Zen property should not be assumed free. See
[WebIDL binding optimization annotations](https://firefox-source-docs.mozilla.org/dom/webIdlBindings/index.html).

Rules:

- Snapshot each needed native property once per logical calculation and carry a plain
  fact through pure policy.
- Separate DOM reads, pure planning, then DOM writes. Do not interleave geometry reads
  after writes.
- Avoid `getBoundingClientRect`, `getComputedStyle`, `client*`, or scroll geometry in a
  synchronous popup path unless a profile and layout-flush test justify it.
- Batch node insertion/reparenting. A `DocumentFragment` or variadic `append` can avoid
  repeated connected-tree work when semantics permit.
- Keep live node identity at the platform boundary. Core policy should not retain DOM.

### XUL and native context menus

**Exact build:** on exact Gecko 153 macOS, `nsMenuX` dispatches `popupshowing` and then
synchronously updates/walks the resulting XUL tree for the native menu. Hidden and structural changes
mark the native representation for rebuilding. See exact
[`nsMenuX.mm`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/widget/cocoa/nsMenuX.mm#L1030-L1193).

Consequences:

- CSS-only hiding cannot implement native macOS context-menu customization.
- Move live nodes rather than cloning them; this preserves command listeners, IDs,
  custom-element state, submenus, disabled/checked state, and extension routing.
- Finish initial presentation before the `popupshowing` dispatch returns.
- Avoid redundant detach/reinsert passes because connected XUL custom elements and
  native observers can perform lifecycle work.
- **Hypothesis/design choice:** Linux and Windows may render differently. Preserving
  live nodes and completing initial presentation synchronously is the conservative
  implementation, but it is not a compatibility claim until each platform receives a
  real smoke test.

### Style, layout, focus, and editor rendering

RAF runs before the natural style/layout flush, so it is a good boundary for visual
writes and a poor place for layout queries. If privileged code truly needs geometry,
Firefox recommends `promiseDocumentFlushed()` for reads and a later RAF for writes.
Focus and `scrollIntoView()` can also trigger observable browser work.

**Hypothesis:** the Sidebar editor has roughly fifty rows. Rebuilding all rows on every
query is a larger plausible editor cost than lowercase normalization, but it remains a hypothesis.
Do not add keyed incremental DOM or a reactive renderer until an exact-Zen editor
profile shows row reconstruction is material.

### Preferences, SessionStore, and system modules

Firefox preferences are a shared native service with observers, persistence, and some
IPC/startup cost. Exact Firefox suppresses observer/dirty/persistence work when the
native value is unchanged; a caller-side guard still avoids serialization and a
JS/XPCOM/native call, and matters when two serialized representations differ. See the
[libpref design](https://firefox-source-docs.mozilla.org/modules/libpref/index.html)
and exact
[`Preferences.cpp`](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/modules/libpref/Preferences.cpp).

Rules:

- Cache parsed stable preferences behind their exact observers when a hot path reads
  them repeatedly.
- Read mutable cross-window preferences freshly when no observer owns a coherent cache.
- Skip same-value writes and make temporary global-pref transactions explicit.
- Do not add preferences for micro-tuning until a user-facing need exists; preference
  combinations are state-space and maintenance cost.
- Treat SessionStore restore, discard, reload, and tab movement as expensive native
  operations. Coalesce and serialize them for correctness before tuning JS around them.

`ChromeUtils.importESModule()` shares privileged system modules by URI. Raw DOM nodes
and uncontrolled window-owned objects stay window-local. An application-global owner
may explicitly register narrow delegates to live window controllers when the product
requires cross-window coordination, but every registration needs token-owned identity,
deterministic unregister, stale-generation rejection, and execution back in the owning
window. Sine imports each mod into each matching browser window, while prefs and system
services remain shared.

### Sine reloads

Sine 2.3.3 uses cache-busted dynamic imports and does not make `rebuildMods()` a full
new-generation readiness barrier. Observe a product-owned generation/DOM/log marker in
tests rather than trusting the returned Promise. Exact source:
[module loader](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/services/module_loader.mjs#L1-L50)
and
[manager](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/manager.sys.mjs#L19-L225).

Every unique module URL can retain a distinct module record for the window's lifetime.
Repeated development reloads can therefore grow module/code memory even when product
listeners and DOM are perfectly cleaned up. Memory experiments should compare against a
cache-bust-only control and focus on retained windows/nodes/resources, not raw code
growth alone. See the standard
[module map](https://html.spec.whatwg.org/multipage/webappapis.html#module-map)
and MDN's
[dynamic-import cache note](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import#module_namespace_object).

## WebAssembly decision

### Current decision: do not compile these mods or their policy cores to Wasm

SpiderMonkey has a fast-latency WebAssembly Baseline compiler and an optimizing Wasm
Ion backend that shares MIR/backend machinery with JavaScript. Wasm is a strong target
for large, sustained numeric, cryptographic, compression, media, parser, or byte-buffer
kernels. See [SpiderMonkey's Wasm tiers](https://firefox-source-docs.mozilla.org/js/)
and the [WebAssembly JavaScript interface](https://webassembly.github.io/spec/js-api/).
**Exact build:** Firefox 153 defaults to lazy Wasm tiering when baseline and Ion tiers,
platform support, and the compilation mode permit it: baseline code can begin running
while hot functions are optimized later. Cold compile/instantiate, early calls, tier
transition, and warmed throughput are therefore separate measurements, not one average.
See the exact
[Wasm preference](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/modules/libpref/init/StaticPrefList.yaml)
and
[compilation-mode selection](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/js/src/wasm/WasmCompile.cpp).

The current mods are the opposite workload:

- Inputs are browser objects, strings, URLs, labels, DOM nodes, Sets, Maps, and small
  arrays of heterogeneous facts.
- Outputs are browser commands, node movement, preference changes, SessionStore work,
  timers, focus, and labels.
- The normal inventory is tens or hundreds of tabs/actions, not millions of numeric
  elements.
- The most important operations cannot run inside Wasm; they must be imported back into
  JavaScript one call at a time or represented indirectly.
- A Wasm core would require encoding strings/objects into linear memory or wrapper
  handles, compiling/instantiating another module, and decoding results.
- This repository emits self-contained JavaScript for each manifest-declared entry.
  Most mods have one `.uc.mjs`; Keep Loaded also has one explicit `.sys.mjs` application
  owner. Wasm would still add a binary loading or inlining strategy plus another
  compiler/toolchain and source language.

The Wasm JS API exposes explicit modules, instances, imports/exports, and linear memory
through `ArrayBuffer`. `WebAssembly.compile(bytes)` and `instantiate(bytes)` are
asynchronous; `new WebAssembly.Module(bytes)` is the synchronous compilation path and
can block on long-running compilation. Streaming compilation consumes a correctly
typed `Response`, but that response need not come from a separately served asset. With
the current self-contained-script delivery contract, embedded bytes or a constructed
response are possible; they simply provide little streaming advantage and still add
bytes, decoding/loading, compilation, and another artifact strategy. See the
[Wasm JS API](https://webassembly.github.io/spec/js-api/#webassembly-namespace) and
[Wasm Web API](https://webassembly.github.io/spec/web-api/#streaming-modules).

Candidate toolchains were considered:

| Option | Benefit | Cost here | Decision |
|---|---|---|---|
| Rust + `wasm-bindgen` | Mature typed systems language and JS bindings | Rust toolchain, glue, binary asset, serialization of nested string/object facts | Do not adopt |
| AssemblyScript | TypeScript-like syntax and direct Wasm output | It is a different restricted language/runtime, not a switch that compiles this TypeScript unchanged | Do not adopt |
| Hand-authored WAT/Wasm | Maximum control and tiny numeric kernels | Highest maintenance cost and no current eligible kernel | Do not adopt |
| C/C++/Emscripten | Reuses native code and libraries | No native codebase to reuse; largest toolchain/glue mismatch | Do not adopt |

`wasm-bindgen` itself documents that arbitrary nested structures such as hash maps and
vectors often require serialization. See its
[arbitrary-data guide](https://wasm-bindgen.github.io/wasm-bindgen/reference/arbitrary-data-with-serde.html).

### Reconsideration trigger

Reopen Wasm only when all of these are true:

1. A profile identifies one pure kernel—not DOM, XPCOM, prefs, or SessionStore—as a
   material part of user-visible time or sustained background CPU.
2. Its data is naturally numeric/binary or can remain in a persistent linear buffer;
   it does not encode/decode a graph of JavaScript strings and objects per call.
3. Production-sized inputs are large enough to amortize module initialization and the
   JS/Wasm boundary.
4. A plain-JavaScript algorithm/data-flow improvement has already been attempted.
5. An exact-Zen A/B measures cold compile/instantiate, first call, warmed throughput,
   memory, bundle bytes, reload/unload, error diagnostics, and cross-platform install.
6. The result is meaningfully better end-to-end, not merely faster inside the kernel.

For the complexity of a second language and artifact type, use this admission and ship
bar:

- Reopen an experiment only when one eligible kernel is either (at least 20% of measured
  parent-main-thread CPU **and** at least 2 ms per real invocation) **or** accumulates at
  least 5 ms within one frame.
- Require at least a 2× warmed-kernel improvement and a 20% end-to-end median
  improvement with no p95 regression.
- Cold compile, instantiate, and marshal should stay under one 60 Hz frame (16.7 ms) or
  the cumulative execution time saved by the Wasm variant should repay that cold and
  boundary overhead within three normal invocations.

These are project admission gates, not universal Wasm laws. Change them only with a
profiled workload whose user value justifies a different tradeoff.

## Build and delivery

The shared esbuild configuration already matches the runtime: ESM, target
`firefox153`, UTF-8, tree shaking, and one exact in-memory output per manifest-declared
entry. The complete output set is graph-validated and staged before publication; each
destination replacement is atomic, and a failure before every destination is published
rolls the set back. The graph guard rejects test, benchmark, fixture, harness, tool, and
development-dependency reachability as well as external runtime imports.

Consequences:

- Modern syntax supported by Firefox 153 should remain modern; extra downlevel helpers
  are unnecessary.
- Benchmark and test code is not in production merely because it shares a workspace.
  The metafile guard checks source inputs and import edges even when tree shaking emits
  zero bytes from a forbidden module.
- Tree shaking works best with ESM and statically analyzable, side-effect-free exports.
  Keep production entries separate from tests rather than relying on clever conditions.
- Code splitting is a poor fit for these small, explicit local entries and would add
  chunk loading/order complexity to Sine reloads.
- Property-name mangling is unsafe around Firefox/Zen private APIs, DOM attributes,
  command IDs, prefs, reflection, and extension integration. Do not enable it.
- Minification remains the approved `R03.C01-D` A/B experiment. Measure bytes, build
  time, first import, live behavior, and usable stack traces; do not assume smaller
  source means faster browser execution.

esbuild documents target selection, tree shaking, minification, code splitting, and
the hazards of property mangling in its [API reference](https://esbuild.github.io/api/).

## Measurement protocol

### Pick the correct lane

| Question | Required evidence |
|---|---|
| Did an algorithm remove work independent of engine? | Existing Node/V8 policy benchmark plus structural counts |
| Is one JavaScript construct faster in SpiderMonkey? | Exact optimized SpiderMonkey shell or an exact-Zen isolated A/B |
| Did Sidebar popup/editor behavior improve? | `test:live-xul:record`, at least 30 samples, correctness assertions intact |
| Did Keep Loaded browser behavior improve? | Applicable task-specific Zen probe and Profiler evidence; add the approved multi-window harness lane before its controller work |
| Did Tab Deduplicator browser behavior improve? | Documented exact-Zen manual/profiler gate until its approved popup/document-swap harness checkpoints exist |
| Is the parent main thread less blocked? | Gecko Profiler parent-process main thread plus duration markers |
| Did memory retention improve? | Repeated lifecycle scenario, about:memory and GC/CC roots; cache-bust control |
| Did build delivery improve? | esbuild metafile, output bytes/hash, cold/warm build time, exact Sine load/reload |

**Repository measurement:** each root policy baseline currently lives in the ignored
pair `.benchmarks/<mod>.json` and `.benchmarks/<mod>.samples.json`. Sidebar alone
currently has the general 30-sample exact-Zen lifecycle/timing artifact at
`.benchmarks/live/sidebar-context-menu-customizer.json`; Keep Loaded's existing Zen
probes are task-specific, and Tab Deduplicator does not yet have an equivalent live
timing harness. Do not silently substitute a Node benchmark for either missing lane.

Keep the Node benchmarks. Vitest uses Tinybench and integrates with the repository's
test/config/reporting infrastructure. Do not replace it merely to chase timer precision.
Official
[Vitest benchmarking documentation](https://main.vitest.dev/guide/benchmarking.html)
confirms Tinybench is the built-in provider.

The current reporter preserves distributions, but Tinybench sorts its samples while
computing statistics, so those arrays do not preserve chronology. They cannot support
time-aligned pairing or drift analysis. If a small result is ambiguous, create a
separate exact-Zen ABBA/BAAB experiment that retains chronological blocks; do not infer
pairing from the existing JSON.

If repeated cross-engine syntax experiments become necessary, Mitata is a credible
test-only candidate because its official runner supports the SpiderMonkey shell,
parameter ranges, DCE controls, and optional counters. It still requires an exact,
optimized shell and does not model Gecko/XUL costs. Do not add it until that recurring
need exists. See [Mitata's official repository](https://github.com/evanwashere/mitata).

Other options were reviewed:

| Tool | Decision | Why |
|---|---|---|
| Custom exact-Zen ABBA recorder | Defer until an engine-sensitive result is ambiguous | Only route that combines the real privileged realm with chronological pairing |
| Mitata + exact SpiderMonkey shell | Future laboratory only | Useful DCE/GC/counter controls, but still not Sine/XUL/browser chrome |
| Benchmark.js | Reject | Older separate stack; does not solve engine or privileged-realm mismatch |
| Vitest Browser Mode | Reject for product evidence | Exercises page contexts, not `ChromeUtils`, XUL, native menus, or Sine lifecycle |
| Raptor/Browsertime | Reject for these micro-paths | Valuable page harness, but heavyweight and not a privileged-mod lifecycle harness |
| Node-native benchmark/timers | Reject as replacement | Still V8 and offers no product-realm improvement over the current stable runner |

### Record and compare a rolling baseline

Use this sequence for a production optimization:

1. If the workload, counters, fixtures, reporter, or benchmark configuration must
   change, land and approve that as a separate benchmark-only checkpoint first.
2. From the immediate production parent, require a clean worktree, record
   `git rev-parse HEAD`, and run the root command `pnpm run bench:record`. The root
   wrapper owns the participant set, environment identity, and artifact generation;
   do not record only one workspace.
3. Change production code while leaving the benchmark definition and parent identity
   assumptions fixed, then run `pnpm run bench:compare`.
4. Run the applicable exact-Zen live harness, task-specific probe, or documented manual
   correctness gate. For main-thread claims, capture the corresponding Gecko Profiler
   evidence as well.
5. Finish with `pnpm run bundle:report`, `pnpm run check`, and
   `pnpm exec lefthook run pre-push`.

If HEAD, runtime/machine identity, or a workload definition changes between record and
compare, discard that comparison and deliberately record the new parent. The ignored
artifact is evidence for the local checkpoint, not a portable universal score.

### Design a trustworthy A/B

1. State the user-visible or resource claim before writing the variant.
2. Record the clean immediate parent with unchanged workload definitions.
3. Assert fixture meaning outside the timed body.
4. Make the result observable so JIT dead-code elimination cannot remove the work.
5. Batch sub-microsecond functions until relative error is sane.
6. Separate cold import/first call from warmed steady state.
7. Keep execution serial and machine/environment identity fixed.
8. Inspect median, p95/p99, raw samples, outliers, and main-thread gaps—not only ops/s.
9. Add structural counts for passes, native reads, sorts, allocations, writes, or moves.
10. Run the exact product correctness harness after the timing comparison.
11. Discard a neutral/worse optimization unless it materially improves architecture or
    correctness independently.

The benchmark recorder currently records dirty state but does not fail recording when
the worktree is dirty, and it does not prove HEAD/cleanliness stayed unchanged through
the serial run. Until a separate tooling checkpoint closes that gap, manually require a
clean worktree and the same HEAD before and after every rolling baseline. Do not modify
the recorder inside a product optimization because doing so changes the benchmark
definition identity.

Do not force GC between each timing sample, benchmark debug/non-release builds as if
they were release, or compare baseline files after workload/config/runtime identity has
changed. Mozilla's
[benchmarking guidance](https://firefox-source-docs.mozilla.org/performance/Benchmarking.html)
explains release-build and timer caveats. Attaching a debugger can also change JIT and
inlining behavior, so use profiler-style observation for timing work.

### Profile instead of guessing

Use `about:profiling` with JavaScript stacks and the parent-process main thread. Add
temporary or harness-only `ChromeUtils.now()` duration markers around the suspected
operation; dynamic marker detail strings should not remain on every production hot
path. The official
[JavaScript instrumentation guide](https://firefox-source-docs.mozilla.org/tools/profiler/instrumenting-javascript.html)
documents `ChromeUtils.addProfilerMarker`.

Look for:

- script tier and time in JS versus C++/XPCOM;
- DOM events, style, reflow, paint, and native popup work;
- SessionStore, tabbrowser, preference, and IPC calls;
- MinorGC/MajorGC/CC and allocation markers;
- long parent-main-thread gaps rather than only total CPU.

The Gecko profiler is statistical; markers are deterministic landmarks. Use both. A
local optimized SpiderMonkey shell can expose JIT controls and newer benchmark mode,
but the installed Zen application does not currently ship a matching `js` or
`xpcshell` executable, and the shipped Zen binary remains the authority for product
behavior. Mozilla's
[SpiderMonkey build guide](https://firefox-source-docs.mozilla.org/js/build.html)
shows how to make an optimized shell. If that lane becomes recurring, build the exact
Zen Gecko revision as optimized/non-debug and use SpiderMonkey's
[strict benchmark mode](https://spidermonkey.dev/blog/2026/04/13/benchmark-mode.html)
instead of forcing eager JIT or disabling GC.

## Project-specific route

**Decision:** this section layers performance evidence onto the approved work; it does
not replace the controlling checkpoint plans. The descriptive names below are
self-contained for a fresh clone. When local planning notes are present, the detailed
continuations live in `notes/<mod>/PLAN.md` and `DECISIONS.md`, the cross-repository
route lives in `notes/zen-mods/PLAN.md`, and speculative shared code goes only into
`notes/REUSE-CANDIDATES.md` for later review. Those files are intentionally ignored and
are not required to understand this tracked reference.

### Keep Loaded

- **M11.C01–M12.C03 — lifecycle harness, immutable controller, and global work/recovery
  ownership:** architecture/correctness first. Multi-window ownership, immutable
  lifetimes, one application-global keyed coordinator, transactional pref ownership,
  and recovery state remove races and duplicated browser work. Do not contaminate
  these checkpoints with syntax tuning.
- **M13.C01 — release per-tab resources:** correctness and retention work; close,
  unpin, selection, failure, stop, and eligibility changes release every owned claim,
  watcher, queued key, and strong tab reference.
- **M13.C02 — schedule freshness serially:** both correctness and measured performance.
  It owns strict one-tab-at-a-time freshness, deadline semantics, and the approved
  one-pass cycle summary, using a rolling parent baseline.
- **M14.C01–C03 — multi-window status ownership:** correctness/architecture around one
  application widget, window-local views, stale generations, and the shipped bundle.
- **M15.C01 — cache stable runtime inputs:** observer-maintained parsed settings and
  stable-probe caches remove repeated parsing/native reads. Keep cache ownership
  explicit and invalidate on the real signal.
- **M15.C02 — reuse sweep and panel inventories:** reuse one tab inventory/inspection
  result and combine whole passes. This dominates callback-style differences.
- **M15.C03 — isolated hot paths:** cheap guards, same-value call suppression, lazy
  diagnostics, and measured WebSocket hot-path changes come last.
- Keep strict serial tab activation initially. Configurable concurrency is a later
  behavior feature, not a free performance switch.

### Sidebar Context Menu Customizer

- Before **M03.C03 — extract pure presentation planning** production edits, preserve
  the current C02 exact-Zen evidence with:

      pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul:record
      cp .benchmarks/live/sidebar-context-menu-customizer.json \
        .benchmarks/live/sidebar-context-menu-customizer-m03-c02-5c34556.json

  Then record a clean rolling policy baseline from C03's immediate parent as described
  above. This reference checkpoint changes no runtime code, so the runtime state remains
  the committed C02 implementation even if the documentation commit is the baseline
  HEAD.
- **M03.C03 — extract pure presentation planning:** one DOM snapshot, key derivation
  once, pure presentation plan, direct excluded ordering, and one shared collator. The
  collator is the strongest exact-engine language optimization found in this audit.
- **M03.C04 — own tab-menu presentation sessions:** one synchronous, explicitly owned
  `PresentationSession`; linear restore; deterministic observer/node release. This is
  more valuable than object-level tuning.
- **M03.C05 — optimize editor derivations:** count and normalize once per editor
  inventory. Keep full-row rebuilding until a live editor profile says otherwise.
- **M03.C06 — streamline stored menu preferences:** initialized-pref fast path, no
  same-value promotion write/clone, and no one-day compatibility branches.
- **M03.C07-D — measure lazy editor construction:** lazily construct editor DOM/styles
  only if exact-Zen startup/reload wins and first-open p95 stays acceptable.

The existing quadratic separator analysis remains explicitly rejected at current menu
sizes. Reopen it only if a live profile makes it material; do not sneak it into C03.

### Tab Deduplicator

- **M04.C01 — separate candidate analysis from grouping:** separate candidate analysis
  from optional move materialization so close paths do not build unused linked move plans.
- **M04.C02 — streamline keeper and lane planning:** preserve already sorted encounter
  order, choose the keeper in one pass, and remove production `laneOrders` used only by
  tests.
- **M04.C03/C04 — share one scoped popup analysis:** take one scoped snapshot/analysis
  per popup instead of independently rebuilding it for close and group actions.
  Revalidate destructive commands at use.
- **M04.C05-D — probe beforeunload document swaps:** exact-build harness work only.
  Do not add a document/generation-token production patch unless the controlled swap
  reproduces a real failure and a separate smallest-fix checkpoint is approved.
- Avoid plan caching across popup openings; tab/browser state can change at any time.
- Preserve native `beforeunload`, SessionStore, group, and recovery behavior even when a
  direct JS path looks cheaper.

Keep the nested Maps and linked-lane planner: they are the correct linear architecture,
align with SpiderMonkey's optimized collections, and preserve movement invariants.

### Repository/build

- **R02.C01 — extract proven Sine lifecycle primitives:** only after two local
  implementations prove identical unload registration and failure-isolated disposer
  draining. Product controllers and policies remain local.
- **R02.C02 — share proven browser-chrome UI primitives:** remains blocked until the
  Keep Loaded M16.C01-D status-UI audit proves a cohesive second consumer.
- **R03.C01-D — benchmark optional minification:** optional A/B after behavior work.
- **No current Wasm checkpoint:** reopen only through the trigger above.

## Rejected folklore and deferred experiments

Do not introduce these without new measured evidence:

- "Manual loops are always faster than array methods."
- "`Array.shift()` is always quadratic."
- "Object allocation is expensive, so pool everything."
- "More immutable code always means unacceptable GC."
- "Stable shapes require one giant object with every field."
- "`Map`/`Set` are slower than objects/arrays for real grouping."
- "String concatenation must always use `join`."
- "A microbenchmark that reaches Ion predicts first-open browser UI."
- "A Promise or microtask moves work off the main thread."
- "Wasm is faster than JavaScript by definition."
- "A smaller/minified bundle necessarily starts faster."
- "Weak references are a resource lifecycle."
- "Caching a live browser plan is safe because the menu usually does not change."
- "Cross-platform support requires cloning or CSS instead of moving live XUL nodes."
- "Incremental/keyed editor DOM must be faster for fifty rows." There is no current
  checkpoint; reopen only if a live editor profile shows material reconstruction cost
  and a separate implementation checkpoint is approved.

Deferred, measurement-first experiments:

- Sidebar lazy editor construction.
- Optional production minification.
- Configurable Keep Loaded concurrency after strict serial behavior ships.
- Mitata plus an exact optimized SpiderMonkey shell if cross-engine syntax A/B becomes
  recurring work.
- Worker or Wasm offload if a sustained pure kernel appears in a profile.

## Checklist for every optimization checkpoint

- [ ] Name the user-visible/resource claim and owning checkpoint.
- [ ] Classify the suspected cost: browser/native, algorithm, allocation, engine syntax,
      build, or memory retention.
- [ ] Check this guide and exact-version sources; record any version-dependent premise.
- [ ] Establish structural counters and the correct measurement lane.
- [ ] Record the clean rolling baseline before production edits.
- [ ] Keep benchmark definitions unchanged through compare.
- [ ] Preserve lifecycle, multi-window, native-command, and stale-state assertions.
- [ ] Inspect bundle graph/bytes and ensure test/benchmark code is absent.
- [ ] Run the owning workspace checks, exact live/manual gate where applicable,
      `pnpm run bundle:report`, `pnpm run check`, and the real pre-push hook.
- [ ] Report neutral or negative results and remove an unjustified variant.
- [ ] Add a one-line entry with enough future context to
      `notes/REUSE-CANDIDATES.md`, then return to the checkpoint.
- [ ] Stop uncommitted for approval.

## Refresh triggers

Re-audit the affected section when any of these changes:

- Zen/Gecko moves beyond the stamped release, especially JIT, Intl, XUL popup, DOM, GC,
  or SessionStore behavior.
- Sine changes module loading, per-window execution, unload registration, or bundle
  asset support.
- esbuild target/version/options, the manifest-declared output contract, or benchmark
  runtime changes.
- A new mod introduces large numeric/binary computation, a worker, Wasm, a reactive UI,
  a database, or sustained background processing.
- Profiles contradict this priority model.

When refreshing, preserve historical decisions in the appropriate ignored
`notes/<mod>/DECISIONS.md` ledger and update this document's status/runtime stamp. Do
not silently rewrite an engine-specific premise while an approved checkpoint still
depends on it.
