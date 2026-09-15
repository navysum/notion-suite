/**
 * Guards against the mistakes this codebase has actually made.
 *
 * Every check here exists because the same bug shipped, or nearly shipped, more
 * than once. They are deliberately mechanical: a convention nobody can forget is
 * worth more than a convention everybody agrees with. CI runs this suite before
 * any release is published, so a reintroduction cannot reach a user.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir = SRC): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (entry.endsWith(".ts")) out.push(full);
	}
	return out.sort();
}

const files = sourceFiles();
const sources = new Map(files.map((file) => [path.relative(SRC, file), readFileSync(file, "utf8")]));

/**
 * Bug class: per-view state keyed on an element the render path rebuilds, so the
 * state is discarded by the refresh it exists to survive.
 *
 * Shipped three times -- calendar month navigation, the "add option" prompt, and
 * the full-page database's search box, collapsed sub-items and row selection.
 * There is now exactly one element-keyed map, in viewState.ts; every renderer
 * below it is handed state it cannot mis-key.
 */
test("element-keyed state lives only in viewState.ts", () => {
	const offenders: string[] = [];
	for (const [file, text] of sources) {
		if (file === path.join("views", "viewState.ts")) continue;
		if (/new\s+(Weak)?Map<\s*HTML\w*Element/.test(text)) offenders.push(file);
	}
	assert.deepEqual(
		offenders,
		[],
		`These files key state on an element. Put the field on SurfaceState in src/views/viewState.ts instead: ${offenders.join(", ")}`
	);
});

/**
 * The same bug class from the other side: a renderer that takes an element only
 * to hang state on it is a renderer that can be handed the wrong one. State
 * arrives as a typed SurfaceState parameter, not as an element.
 */
test("no renderer takes a 'stateHost' element", () => {
	const offenders = [...sources]
		.filter(([, text]) => /stateHost/.test(text))
		.map(([file]) => file);
	assert.deepEqual(offenders, [], `Pass SurfaceState, not an element: ${offenders.join(", ")}`);
});

/**
 * Bug class: a capability written, tested in isolation and never wired up --
 * renameRow, descendantsOf, isNumericRollup and clearChildren all sat unused
 * while the feature they were written for silently did the wrong thing (or
 * nothing). An export nothing imports is either dead code or a missing wire.
 */
test("no export is written and then never used", () => {
	const declaration = /export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_]\w*)/g;
	const testDir = path.join(process.cwd(), "tests");
	const allText = [
		...sources.values(),
		...readdirSync(testDir)
			.filter((f) => f.endsWith(".ts"))
			.map((f) => readFileSync(path.join(testDir, f), "utf8")),
	].join("\n");

	const dead: string[] = [];
	for (const [file, text] of sources) {
		// main.ts is the plugin's entry point: Obsidian imports it, not us.
		if (file === "main.ts") continue;
		for (const match of text.matchAll(declaration)) {
			const name = match[1];
			// One occurrence is the declaration itself and nothing else.
			const uses = allText.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
			if (uses <= 1) dead.push(`${file}: ${name}`);
		}
	}
	assert.deepEqual(
		dead,
		[],
		`Written but never called -- wire it up or delete it:\n${dead.join("\n")}`
	);
});

/**
 * The directory's review rejects plugins that evaluate strings. The formula
 * engine is a hand-written parser for exactly this reason, and must stay one.
 */
test("nothing evaluates a string as code", () => {
	const offenders = [...sources]
		.filter(([, text]) => /\beval\s*\(|new\s+Function\s*\(/.test(text))
		.map(([file]) => file);
	assert.deepEqual(offenders, [], `No eval: ${offenders.join(", ")}`);
});

/**
 * Bug class: logic reimplemented next to the original, then drifting from it.
 * A second copy of the rollup collapse brought back the empty-list bug that
 * made "percent not empty" read 100%. Aggregation has one implementation.
 */
test("rollup aggregation is not reimplemented", () => {
	const allowed = new Set([path.join("db", "rollup.ts")]);
	const offenders: string[] = [];
	for (const [file, text] of sources) {
		if (allowed.has(file)) continue;
		if (/function\s+(collapse|gatherValues)\b/.test(text)) offenders.push(file);
	}
	assert.deepEqual(
		offenders,
		[],
		`Call collapse()/gatherValues() from db/rollup.ts rather than reimplementing them: ${offenders.join(", ")}`
	);
});
