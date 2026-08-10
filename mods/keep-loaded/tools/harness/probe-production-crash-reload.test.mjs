import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = await readFile(
  new URL("./probe-production-crash-reload.mjs", import.meta.url),
  "utf8",
);
const probe = source.match(/const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/)?.[1];

describe("production crash-reload probe contract", () => {
  it("keeps its embedded privileged script syntactically valid", () => {
    expect(probe).toBeTypeOf("string");
    expect(() => new Function(probe)).not.toThrow();
  });

  it.each([
    ["budget recovery", "budget-recovery-queued"],
    ["queued close invalidation", "closed-recovery-canceled"],
    ["external unload reconciliation", "external-unload-trailing"],
  ])("requires a causal owner transition for %s", (_label, marker) => {
    expect(probe).toContain(marker);
  });

  it("uses the shared signal-safe shutdown boundary", () => {
    expect(source).toContain("installShutdownSignals");
    expect(source).toContain("await shutdown()");
    expect(source).toContain("removeShutdownSignals()");
  });
});
