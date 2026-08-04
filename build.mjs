import { build, context } from "esbuild";

// Sine cache-busts only the entry module it imports, so every import has to be
// bundled into that one file or a stale copy survives the reload.
const options = {
  entryPoints: ["src/main.ts"],
  outfile: "dist/keep-loaded.uc.mjs",
  bundle: true,
  format: "esm",
  target: "firefox153",
  platform: "browser",
  charset: "utf8",
  // Not minified on purpose: dist/ is committed, so it has to stay reviewable.
  banner: { js: "// Generated from src/ by build.mjs — do not edit." },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
