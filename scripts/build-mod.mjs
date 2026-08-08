import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { build, context } from "esbuild";

const workingDirectory = process.cwd();
const manifestPath = resolve(workingDirectory, "theme.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const outputs = Object.keys(manifest.scripts ?? {});

if (outputs.length !== 1 || !outputs[0]?.endsWith(".uc.mjs")) {
  throw new Error(`${manifestPath} must declare exactly one .uc.mjs entry in scripts`);
}

const output = resolve(workingDirectory, outputs[0]);
const outputFromWorkspace = relative(workingDirectory, output);
if (isAbsolute(outputFromWorkspace) || outputFromWorkspace.startsWith("..")) {
  throw new Error(`script output must stay inside its mod directory: ${outputs[0]}`);
}

const options = {
  absWorkingDir: workingDirectory,
  entryPoints: ["src/main.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  target: "firefox153",
  platform: "browser",
  charset: "utf8",
  banner: { js: "// Generated from src/ by build.mjs — do not edit." },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
