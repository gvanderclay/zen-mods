import { describe, expect, it } from "vitest";
import { type CrashFacts, crashDiagnosis } from "./crash.ts";

const facts = (over: Partial<CrashFacts> = {}): CrashFacts => ({
  url: "https://mail.google.com/",
  kind: "crashed",
  pending: true,
  remote: false,
  connected: true,
  crashedPage: false,
  ...over,
});

describe("crashDiagnosis", () => {
  it("names the tab and says the content process crashed", () => {
    expect(crashDiagnosis(facts()).message).toBe(
      "https://mail.google.com/: content process crashed",
    );
  });

  it("calls a build-id mismatch what it is, and says a restart is the only fix", () => {
    const diagnosis = crashDiagnosis(facts({ kind: "restart-required" }));
    expect(diagnosis.message).toBe(
      "https://mail.google.com/: content process aborted on a build-id mismatch — Zen was updated in place, so restart Zen to bring this tab back",
    );
  });

  it("never claims a mismatch is recoverable, whatever state the tab is in", () => {
    const diagnosis = crashDiagnosis(facts({ kind: "restart-required", remote: true }));
    expect(diagnosis.recoverable).toBe(false);
    expect(diagnosis.lines).toContain("recovery: not possible until Zen restarts");
  });

  it("reports the state a recovery would have to work from", () => {
    const diagnosis = crashDiagnosis(
      facts({ pending: true, remote: false, connected: true }),
    );
    expect(diagnosis.lines).toContain("state: pending, non-remote, browser connected");
  });

  it("describes the opposite state just as plainly", () => {
    const diagnosis = crashDiagnosis(
      facts({ pending: false, remote: true, connected: false }),
    );
    expect(diagnosis.lines).toContain("state: not pending, remote, browser detached");
  });

  it("says a discard is blocked while the browser is non-remote, and why", () => {
    const diagnosis = crashDiagnosis(facts({ remote: false }));
    expect(diagnosis.recoverable).toBe(true);
    expect(diagnosis.lines).toContain(
      "recovery: discard is blocked by _mayDiscardBrowser while non-remote, so it needs a remoteness flip first",
    );
  });

  it("says a discard is available once the browser is remote again", () => {
    const diagnosis = crashDiagnosis(facts({ remote: true }));
    expect(diagnosis.lines).toContain("recovery: discard is available");
  });

  it("reports that the user was shown a crash page, since a background crash should not", () => {
    expect(crashDiagnosis(facts({ crashedPage: true })).lines).toContain(
      "crash page: shown, so this was not handled as a background crash",
    );
    expect(crashDiagnosis(facts({ crashedPage: false })).lines).toContain(
      "crash page: not shown",
    );
  });

  it("reports an unknown url without pretending to have one", () => {
    expect(crashDiagnosis(facts({ url: "" })).message).toBe(
      "a kept tab: content process crashed",
    );
  });
});
