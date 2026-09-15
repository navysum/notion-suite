/**
 * Bundles the test suite with the Obsidian API stubbed out, then hands the
 * result to Node's test runner.
 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, ".build");
mkdirSync(outDir, { recursive: true });

const suites = ["logic", "rollup", "formula", "widget", "guards", "roundtrip"];
const outFiles = suites.map((name) => path.join(outDir, `${name}.test.cjs`));

await esbuild.build({
	entryPoints: suites.map((name) => path.join(here, `${name}.test.ts`)),
	outdir: outDir,
	outExtension: { ".js": ".cjs" },
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node18",
	external: ["node:test", "node:assert/strict"],
	alias: { obsidian: path.join(here, "obsidian-stub.ts") },
	logLevel: "warning",
});

const result = spawnSync(process.execPath, ["--test", ...outFiles], { stdio: "inherit" });
process.exit(result.status ?? 1);
