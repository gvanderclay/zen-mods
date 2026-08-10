# Development workflow

## Scope a checkpoint

Read the active mod plan and decision ledger, identify the smallest owned files, and state what is deliberately deferred. Preserve unrelated worktree changes. Do not widen a checkpoint merely because a neighboring improvement is interesting; record follow-up work in the plan instead.

## Implement safely

Prefer a red test for a new pure rule, then implement the smallest boundary change that makes it pass. Keep browser effects in adapters and make ownership explicit: who creates a resource, who removes it, what happens when removal throws, and which generation/token may continue after an `await`. For reload or teardown work, test forced late callbacks and reentrancy, not only normal event delivery.

Use `apply_patch` for hand edits. Run Biome/Markdownlint rather than manually standardizing formatting. When source changes affect a bundle, rebuild through the package script; never hand-edit generated output. If a private browser assumption matters, inspect the installed Zen/Firefox source and preserve the exact evidence in the local ledger.

## Validate in layers

1. Run the focused unit/typecheck tests for the changed module.
2. Run the mod gate and inspect `git diff --check`.
3. Rebuild and verify generated bundles and the build graph when source or manifest output changes.
4. Run the exact staged browser probe for any claim involving Sine, Zen, reload, multiple windows, close, or browser-chrome resources. Preserve raw evidence; do not replace a failed gate with a weaker synthetic test.
5. Run `pnpm run check` before handoff. For performance or memory work, also follow the SpiderMonkey/Gecko measurement document and report engine, build, workload, warmup, repetitions, and variance.

## Handoff and commit

Report the outcome first: changed files, checks run, exact live evidence, and any known limitation. Include manual steps when the diff cannot prove behavior. Stop with the checkpoint uncommitted until the user approves. After approval, stage only the checkpoint files and use the mod-required `zen-<id>(M##.C##): ...` prefix. Do not rewrite accepted decision-ledger records; append a superseding record instead.
