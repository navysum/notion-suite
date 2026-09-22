/**
 * Bundles the test suite with the Obsidian API stubbed out, then hands the
 * result to Node's test runner -- once per time zone in TIME_ZONES.
 */
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, ".build");
mkdirSync(outDir, { recursive: true });

const suites = ["logic", "rollup", "formula", "widget", "guards", "roundtrip", "view", "interact", "rename", "relation", "filterBuilder", "propertyPanel", "csv", "recur", "guardgaps"];
const outFiles = suites.map((name) => path.join(outDir, `${name}.test.cjs`));

/**
 * Date bugs only show up away from UTC, and west and east of it fail
 * differently: a date-only value parsed as UTC midnight reads a day early in
 * the west, and a local midnight printed as UTC reads a day early in the east.
 * A suite run only in the developer's own zone passes one of those by luck.
 * The zones west and east of UTC both observe daylight saving, at different
 * dates. A TZ set in the environment runs too, so the zone you reproduced a
 * failure in is always covered.
 */
const TIME_ZONES = ["UTC", "America/New_York", "Europe/Berlin"];
const zones = [...new Set([process.env.TZ, ...TIME_ZONES].filter(Boolean))];

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

const failed = [];
for (const tz of zones) {
	console.log(`\n# Running the suite with TZ=${tz}\n`);
	// An unknown zone silently falls back to UTC, which would pass by luck.
	const probe = spawnSync(
		process.execPath,
		["-p", "Intl.DateTimeFormat().resolvedOptions().timeZone"],
		{ encoding: "utf8", env: { ...process.env, TZ: tz } }
	);
	const resolved = probe.stdout.trim();
	const utc = ["UTC", "Etc/UTC", "GMT", "Etc/GMT"];
	if (resolved === "undefined" || (utc.includes(resolved) && !utc.includes(tz))) {
		console.error(`TZ=${tz} was not honoured (resolved to ${resolved})`);
		failed.push(tz);
		continue;
	}
	const result = spawnSync(process.execPath, ["--test", ...outFiles], {
		stdio: "inherit",
		env: { ...process.env, TZ: tz },
	});
	if (result.status !== 0) failed.push(tz);
}

if (failed.length > 0) {
	console.error(`\nTests failed with TZ=${failed.join(", TZ=")}`);
	process.exit(1);
}
console.log(`\nTests passed with TZ=${zones.join(", TZ=")}`);
