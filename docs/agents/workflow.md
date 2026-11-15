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

## Timing-dependent failures

A live probe that fails only some runs usually has a race between mod code and Zen's asynchronous startup or teardown, not a flaky harness. Find the order of events instead of rerunning:

1. Reproduce with `pnpm run live:repeat <package> <script> --until-fail --max 20`. It stops at the first failure and keeps each attempt's log, fresh artifact and failure signature under `.benchmarks/live/repeat/`.
2. Read the captured failure before the next run. Write a unit test that forces the losing event order and fails on the current code, then fix the code so it waits on the platform's own readiness signal.
3. Accept with `pnpm run live:repeat <package> <script> --streak 10` and no source change during the streak. Ten passes is a smoke gate; the deterministic test is the proof of the fix.

A worker that has spent 15 minutes, 10 full runs or two distinct failure signatures without that deterministic test stops and hands back the failure signature, its current hypothesis, what it has ruled out and the next experiment that would tell the hypotheses apart. More runs rarely add information the captured failure lacks.

## Push

The pre-push hook runs `ZEN_VERIFY_DIST_BASE=HEAD pnpm run check` in the checkout you push from, so push from a checkout that holds only committed work. When the main checkout has uncommitted changes, push from `git worktree add --detach ../zen-mods__worktrees/<name> <commit>` after `pnpm install --frozen-lockfile` there. Remove it afterwards with `git worktree remove <path>` and leave the `zen-mods__worktrees` directory in place.

SSH keys live in 1Password, which cannot sign while the user is away. Test SSH once with `ssh -o BatchMode=yes -o ConnectTimeout=8 -T git@github.com` and a 20-second tool timeout: a `Hi <username>!` greeting means SSH works. If it hangs or reports "communication with agent failed", push an approved commit over HTTPS with the GitHub CLI's login, set for that one command only:

```text
git -c credential.helper= -c "credential.helper=!gh auth git-credential" push https://github.com/gvanderclay/zen-mods.git <commit>:main
git ls-remote https://github.com/gvanderclay/zen-mods.git refs/heads/main
git update-ref refs/remotes/origin/main <sha from ls-remote>
```

Pushing to a URL leaves `origin/main` stale, so set it from `ls-remote` rather than fetching from the URL: the user's global `fetch.prune` deletes the tracking ref instead.

## Handoff and commit

Report the outcome first: changed files, checks run, exact live evidence, and any known limitation. Include manual steps when the diff cannot prove behavior. Stop with the checkpoint uncommitted until the user approves. After approval, stage only the checkpoint files and use the mod-required `zen-<id>(M##.C##): ...` prefix. Do not rewrite accepted decision-ledger records; append a superseding record instead.
