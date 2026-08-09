import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    benchmark: {
      includeSamples: true,
      reporters: [
        "default",
        fileURLToPath(new URL("./scripts/benchmark-reporter.mjs", import.meta.url)),
      ],
    },
    environment: "node",
  },
});
