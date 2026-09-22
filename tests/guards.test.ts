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

/**
 * Bug class: a write that cannot be awaited, failing into nowhere.
 *
 * Click handlers return immediately, so every write the UI performs runs
 * detached. Twenty-two of them had no error handling at all: a read-only note, a
 * row deleted since the view drew it, or a vault mid-sync left the old value on
 * screen as though the click had never happened, with the only trace an
 * unhandled rejection in a console nobody had open.
 *
 * Detached work goes through `runWrite` or `runDetached`, both of which report.
 */
test("no detached work fails silently", () => {
	const offenders: string[] = [];
	for (const [file, text] of sources) {
		const lines = text.split("\n");
		lines.forEach((line, i) => {
			if (!/\bvoid\s+(\(async|[\w.]*\b(store|app|vault|fileManager)\b)/.test(line)) return;
			// A `.catch` within a few lines is handling it the long way round,
			// which is fine -- the point is that something handles it.
			const window = lines.slice(i, i + 12).join("\n");
			if (/\.catch\(/.test(window)) return;
			// Opening a file is Obsidian's own navigation, not our write.
			if (/openFile\(|openLinkText\(|revealLeaf\(|setViewState\(/.test(line)) return;
			offenders.push(`${file}:${i + 1}`);
		});
	}
	assert.deepEqual(
		offenders,
		[],
		`Route these through runWrite/runDetached so a failure is visible:\n${offenders.join("\n")}`
	);
});

/**
 * The README promises that nothing leaves the machine. A cover set to an
 * http(s) address broke that promise quietly -- opening the note told that
 * server your IP and the time. It is now a setting, off by default, and this
 * guard keeps any new request from slipping in unannounced.
 */
test("nothing reaches the network without a setting behind it", () => {
	const offenders: string[] = [];
	for (const [file, text] of sources) {
		text.split("\n").forEach((line, i) => {
			if (!/\b(fetch|XMLHttpRequest|requestUrl|WebSocket|EventSource)\s*\(/.test(line)) return;
			offenders.push(`${file}:${i + 1}`);
		});
	}
	assert.deepEqual(offenders, [], `Network calls: ${offenders.join(", ")}`);
});

/**
 * Bug class: a theme quietly restyling the plugin's own table.
 *
 * Reported from a real vault — every value in a row piled into the first
 * column, because the theme did the responsive trick of
 * `table, tr, td { display: block }` and our table inherited it. In a database
 * that is not a cosmetic difference: the table stops being readable at all.
 *
 * The fix is to declare the display roles rather than inherit them from the
 * user agent, and no unit test can see CSS, so this guards the declarations
 * themselves. It proves the rules are present, not that they render — that
 * stays in docs/SMOKE.md.
 */
test("the table declares its own layout, so a theme cannot collapse it", () => {
	const css = readFileSync(path.join(process.cwd(), "styles.css"), "utf8");
	const required = [
		".nfo-table {",
		"display: table;",
		"display: table-row-group;",
		"display: table-row;",
		"display: table-cell;",
	];
	const missing = required.filter((rule) => !css.includes(rule));
	assert.deepEqual(
		missing,
		[],
		`styles.css must keep these, or a theme can stack the cells: ${missing.join(", ")}`
	);
});
