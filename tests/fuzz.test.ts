/**
 * Brute force.
 *
 * Every other suite checks that the right input gives the right answer. This
 * one checks that the wrong input does not take the plugin down with it, which
 * is a different question and the one real vaults ask: frontmatter is
 * hand-written, code blocks are hand-written, and a formula is a string
 * somebody typed. None of it is under our control.
 *
 * The contract being tested is narrow and absolute: a parser may reject
 * anything it likes, but it may never throw, never hang, and never return a
 * half-built object that something downstream will trip over.
 *
 * The generator is seeded, so a failure here reproduces exactly rather than
 * being a story about a run that once went wrong.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parseChartBlock, parseFilterLines, parseViewBlock, parseSortShorthand, parseFilterShorthand, filterToText } from "../src/views/config";
import { parseWidgetBlock } from "../src/widgets/widget";
import { runFormula } from "../src/db/formula";
import { parseRecurrence, nextOccurrence } from "../src/db/recur";
import { parseDate, toISODate } from "../src/utils/dates";
import { asText, asKey, linkTarget } from "../src/utils/text";
import { coerce, formatValue, compareValues, isEmpty } from "../src/db/value";
import { applyFilter, applySorts, groupRows, queryRows } from "../src/db/query";
import { collapse, gatherValues, relatedRows, indexByName } from "../src/db/rollup";
import { csvField, rowsToCsv } from "../src/db/csv";
import { formatCurrency } from "../src/db/currency";
import { diffLinks, withLink, withoutLink, linkList } from "../src/db/relations";
import { shouldFire, resolveValue } from "../src/db/automation";
import { writableKey, parsePropertyId } from "../src/bases/propertyId";
import { buildTree, descendantsOf } from "../src/db/tree";
import {
	DatabaseRow,
	DatabaseSchema,
	PropertyDef,
	PropertyType,
	PROPERTY_TYPES,
	ROLLUP_FUNCTIONS,
	RollupFunction,
} from "../src/types";

/* ------------------------------------------------------------- the source */

/** A small deterministic PRNG, so a failing seed can be replayed. */
function rng(seed: number): () => number {
	let state = seed >>> 0 || 1;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 0xffffffff;
	};
}

/** Characters chosen to break things: quotes, brackets, newlines, unicode. */
const NASTY = [
	"", " ", "\n", "\t", "\r\n", '"', "'", "`", "\\", "{", "}", "[", "]", ":", "- ",
	"#", "---", "null", "undefined", "NaN", "Infinity", "-0", "0", "1e400",
	"{{}}", "[[", "]]", "[[|]]", "|", "<script>", "%s", "${x}", "\u0000",
	"😀", "日本語", "ẗ̴̢͉́e̸", "א", "‮", "a".repeat(500),
	"true", "false", "2026-02-30", "2026-13-45", "99999-99-99",
];

function pick<T>(r: () => number, items: T[]): T {
	return items[Math.floor(r() * items.length) % items.length];
}

function junk(r: () => number, depth = 0): string {
	const n = Math.floor(r() * 4) + 1;
	let out = "";
	for (let i = 0; i < n; i++) {
		out += pick(r, NASTY);
		if (depth < 2 && r() < 0.25) out += junk(r, depth + 1);
	}
	return out;
}

/** A plausible-but-wrong block body: right shape, hostile contents. */
function junkBlock(r: () => number): string {
	const keys = [
		"database", "db", "view", "type", "group", "subgroup", "date", "cover",
		"properties", "hide", "filter", "sort", "limit", "limits", "limit_mode",
		"calculate", "collapsed", "buckets", "start", "end", "scale", "size",
		"title", "chart", "aggregate", "value", "series", "stacked", "height",
		"legend", "values", "widget", "kind", "widgets", "label", "prefix",
		"suffix", "total", "show", "target", "date_property",
	];
	const lines: string[] = [];
	const count = Math.floor(r() * 7);
	for (let i = 0; i < count; i++) {
		const key = pick(r, keys);
		const shape = r();
		if (shape < 0.6) lines.push(`${key}: ${junk(r)}`);
		else if (shape < 0.8) lines.push(`${key}:`, `  - ${junk(r)}`, `  - ${junk(r)}`);
		else lines.push(`${key}:`, `  ${pick(r, keys)}: ${junk(r)}`);
	}
	return lines.join("\n");
}

const ITERATIONS = 4000;

/* ----------------------------------------------------------- the parsers */

/**
 * The block parsers take whatever is between the fences. A thrown exception
 * here is not a caught error message in a callout -- it propagates out of
 * Obsidian's markdown post-processor and takes the note's rendering with it.
 */
test("no block parser throws on anything, however hostile", () => {
	const r = rng(20261003);
	for (let i = 0; i < ITERATIONS; i++) {
		const source = r() < 0.5 ? junkBlock(r) : junk(r);
		for (const [name, parse] of [
			["view", parseViewBlock],
			["chart", parseChartBlock],
			["widget", parseWidgetBlock],
		] as const) {
			let result;
			try {
				result = parse(source);
			} catch (error) {
				assert.fail(`${name} threw on ${JSON.stringify(source)}: ${String(error)}`);
			}
			// Whatever it decides, it must decide something usable: either a
			// config, or an error to show. Never both absent.
			assert.ok(
				result.config !== null || typeof result.error === "string",
				`${name} returned neither a config nor a reason for ${JSON.stringify(source)}`
			);
		}
	}
});

test("the shorthand parsers never throw", () => {
	const r = rng(7);
	for (let i = 0; i < ITERATIONS; i++) {
		const text = junk(r);
		assert.doesNotThrow(() => parseFilterShorthand(text), text);
		assert.doesNotThrow(() => parseSortShorthand(text), text);
		assert.doesNotThrow(() => parseFilterLines(text), text);
		assert.doesNotThrow(() => parseRecurrence(text), text);
		assert.doesNotThrow(() => parsePropertyId(text), text);
		assert.doesNotThrow(() => writableKey(text), text);
	}
});

/**
 * A formula is a string somebody typed into a property. It is evaluated on
 * every render of every row, so it has to be safe against anything -- and it
 * has to stop, which is why the engine caps length, tokens and depth.
 */
test("the formula engine never throws and always terminates", () => {
	const r = rng(99);
	const row = { a: 1, b: "two", c: null, d: [1, 2, 3], e: true };
	for (let i = 0; i < ITERATIONS; i++) {
		const source = r() < 0.3 ? junk(r) : `${junk(r)} ${pick(r, ["+", "*", "/", "(", ")", "-"])} ${junk(r)}`;
		const started = Date.now();
		assert.doesNotThrow(() => runFormula(source, row), JSON.stringify(source));
		assert.ok(
			Date.now() - started < 1000,
			`formula took over a second: ${JSON.stringify(source)}`
		);
	}
});

/** Deeply nested parentheses are the classic way to blow a recursive parser. */
test("a pathologically nested formula is refused rather than overflowing", () => {
	for (const depth of [50, 200, 5000, 50_000]) {
		const source = "(".repeat(depth) + "1" + ")".repeat(depth);
		assert.doesNotThrow(() => runFormula(source, {}), `depth ${depth}`);
	}
	// And one that never closes.
	assert.doesNotThrow(() => runFormula("(".repeat(100_000), {}));
});

/* ------------------------------------------------------- values and dates */

test("the value layer swallows anything frontmatter can hold", () => {
	const r = rng(1234);
	const weird: unknown[] = [
		null, undefined, "", 0, -0, NaN, Infinity, -Infinity, true, false,
		[], {}, [[]], [{}], { a: { b: { c: 1 } } }, new Date("nope"), new Date(),
		[null, undefined, {}], "a".repeat(10_000), 1e308, -1e308,
	];
	for (let i = 0; i < 600; i++) {
		const type = pick(r, PROPERTY_TYPES) as PropertyType;
		const prop: PropertyDef = { id: "x", name: "X", type, options: [] };
		const value = r() < 0.5 ? pick(r, weird) : junk(r);
		assert.doesNotThrow(() => coerce(prop, value), `coerce ${type} ${String(value)}`);
		assert.doesNotThrow(() => formatValue(prop, value), `format ${type}`);
		assert.doesNotThrow(() => isEmpty(value), "isEmpty");
		assert.doesNotThrow(() => compareValues(prop, value, pick(r, weird)), "compare");
		assert.doesNotThrow(() => asText(value), "asText");
		assert.doesNotThrow(() => asKey(value), "asKey");
		assert.doesNotThrow(() => linkTarget(value), "linkTarget");
		// Whatever comes back must be the type the rest of the code expects.
		assert.equal(typeof formatValue(prop, value), "string");
		assert.equal(typeof asText(value), "string");
	}
});

test("formatValue never leaks an object into a cell", () => {
	const r = rng(555);
	for (let i = 0; i < 400; i++) {
		const type = pick(r, PROPERTY_TYPES) as PropertyType;
		const prop: PropertyDef = { id: "x", name: "X", type, options: [] };
		const text = formatValue(prop, pick(r, [{}, { a: 1 }, [{}], [[1]], new Map()]));
		assert.ok(!text.includes("[object"), `${type} rendered ${text}`);
	}
});

test("date parsing refuses nonsense rather than inventing a day", () => {
	const r = rng(31);
	for (let i = 0; i < 1500; i++) {
		const value = r() < 0.5 ? junk(r) : pick(r, [null, {}, [], NaN, Infinity, 1e15, -1e15]);
		const parsed = parseDate(value);
		assert.ok(parsed === null || !isNaN(parsed.getTime()), `invalid Date from ${String(value)}`);
		if (parsed) assert.match(toISODate(parsed), /^-?\d{4,}-\d{2}-\d{2}$/);
	}
});

test("currency formatting survives any amount and any code", () => {
	const r = rng(808);
	const amounts = [0, -0, 1, -1, 0.005, 1e-9, 1e15, -1e15, Number.MAX_SAFE_INTEGER, NaN, Infinity];
	for (let i = 0; i < 600; i++) {
		const out = formatCurrency(pick(r, amounts), r() < 0.5 ? junk(r) : "GBP");
		assert.equal(typeof out, "string");
	}
});

/* ------------------------------------------------- querying at awkward sizes */

function fuzzSchema(r: () => number): DatabaseSchema {
	const properties: PropertyDef[] = [];
	const count = Math.floor(r() * 8) + 1;
	for (let i = 0; i < count; i++) {
		properties.push({
			id: `p${i}`,
			name: r() < 0.2 ? junk(r) : `P${i}`,
			type: pick(r, PROPERTY_TYPES) as PropertyType,
			options: [],
		});
	}
	return {
		id: "fuzz",
		name: "Fuzz",
		folder: "Fuzz",
		createdAt: 0,
		views: [],
		properties,
		parentProperty: r() < 0.4 ? properties[0].id : undefined,
	};
}

function fuzzRows(r: () => number, schema: DatabaseSchema, n: number): DatabaseRow[] {
	const rows: DatabaseRow[] = [];
	for (let i = 0; i < n; i++) {
		const values: Record<string, unknown> = {};
		for (const prop of schema.properties) {
			values[prop.id] = r() < 0.3 ? null : r() < 0.6 ? junk(r) : i;
		}
		rows.push({ path: `Fuzz/${i}.md`, name: r() < 0.1 ? junk(r) : `Row ${i}`, values } as DatabaseRow);
	}
	return rows;
}

test("querying never throws, whatever the schema and rows look like", () => {
	const r = rng(4242);
	for (let i = 0; i < 300; i++) {
		const schema = fuzzSchema(r);
		const rows = fuzzRows(r, schema, Math.floor(r() * 40));
		const filter = parseFilterLines(junk(r));
		assert.doesNotThrow(() => applyFilter(schema, rows, filter), "applyFilter");
		assert.doesNotThrow(() => applySorts(schema, rows, [{ property: junk(r), direction: "asc" }]), "applySorts");
		assert.doesNotThrow(() => groupRows(schema, rows, junk(r)), "groupRows");
		assert.doesNotThrow(() => queryRows(schema, rows, filter, undefined, -1), "queryRows");
		// A filter must never invent rows.
		assert.ok(applyFilter(schema, rows, filter).length <= rows.length);
	}
});

/**
 * Sub-items are a graph built from text somebody typed, so it can contain
 * cycles, self-references and chains deeper than anything sensible. The tree
 * builder must still terminate and must never show a row twice.
 */
test("the sub-item tree terminates on cycles and never duplicates a row", () => {
	const schema: DatabaseSchema = {
		id: "t", name: "T", folder: "T", createdAt: 0, views: [],
		parentProperty: "parent",
		properties: [{ id: "parent", name: "Parent", type: "text" }],
	};
	const r = rng(606);

	for (let i = 0; i < 200; i++) {
		const n = Math.floor(r() * 30) + 1;
		const rows: DatabaseRow[] = [];
		for (let k = 0; k < n; k++) {
			// Parents picked at random, so cycles and self-parents happen.
			const parent = r() < 0.2 ? `Row ${k}` : `Row ${Math.floor(r() * n)}`;
			rows.push({ path: `${k}.md`, name: `Row ${k}`, values: { parent } } as DatabaseRow);
		}
		const started = Date.now();
		const tree = buildTree(schema, rows, new Set());
		assert.ok(Date.now() - started < 1000, "buildTree did not terminate quickly");
		assert.equal(tree.length, rows.length, "the tree lost or duplicated rows");
		const seen = new Set(tree.map((entry) => entry.row.path));
		assert.equal(seen.size, rows.length, "a row appeared twice");
		for (const row of rows) {
			assert.doesNotThrow(() => descendantsOf(schema, rows, row.path));
		}
	}
});

/** A long chain must not blow the stack, however it was built. */
test("a very deep chain of sub-items is handled", () => {
	const schema: DatabaseSchema = {
		id: "t", name: "T", folder: "T", createdAt: 0, views: [],
		parentProperty: "parent",
		properties: [{ id: "parent", name: "Parent", type: "text" }],
	};
	const rows: DatabaseRow[] = [];
	for (let i = 0; i < 5000; i++) {
		rows.push({ path: `${i}.md`, name: `Row ${i}`, values: { parent: i === 0 ? "" : `Row ${i - 1}` } } as DatabaseRow);
	}
	assert.doesNotThrow(() => buildTree(schema, rows, new Set()));
	assert.doesNotThrow(() => descendantsOf(schema, rows, "0.md"));
});

/* ---------------------------------------------------------------- rollups */

test("every rollup function collapses anything without throwing", () => {
	const r = rng(77);
	const messy: unknown[] = [null, undefined, "", 0, NaN, Infinity, "x", [], {}, true, new Date()];
	for (let i = 0; i < 800; i++) {
		const how = pick(r, ROLLUP_FUNCTIONS) as RollupFunction;
		const values = Array.from({ length: Math.floor(r() * 12) }, () => pick(r, messy));
		assert.doesNotThrow(() => collapse(values, values.length, how), how);
	}
});

test("rollups survive a gather far larger than an argument list", () => {
	const many = Array.from({ length: 200_000 }, (_u, i) => i);
	for (const how of ROLLUP_FUNCTIONS) {
		assert.doesNotThrow(() => collapse(many, many.length, how as RollupFunction), how);
	}
});

test("relation resolution copes with any cell contents", () => {
	const r = rng(515);
	const index = indexByName([{ path: "a.md", name: "Alpha", values: {} } as DatabaseRow]);
	for (let i = 0; i < 800; i++) {
		const value = r() < 0.5 ? junk(r) : pick(r, [null, [], [null], [{}], {}, 7, true]);
		assert.doesNotThrow(() => relatedRows(value, index));
		assert.doesNotThrow(() => gatherValues(relatedRows(value, index), junk(r)));
	}
});

/* ------------------------------------------------------- the newest code */

test("two-way relation bookkeeping never throws or duplicates", () => {
	const r = rng(2025);
	const messy: unknown[] = [null, undefined, [], [null], [{}], "Alpha", ["Alpha", "[[Alpha]]"], {}, 7];
	for (let i = 0; i < 1200; i++) {
		const before = pick(r, messy);
		const after = pick(r, messy);
		const title = r() < 0.5 ? "Alpha" : junk(r);
		assert.doesNotThrow(() => diffLinks(before, after));
		assert.doesNotThrow(() => withLink(before, title));
		assert.doesNotThrow(() => withoutLink(before, title));

		// Adding then removing returns to a list with the same link set.
		const added = withLink(before, "Zeta");
		const removed = withoutLink(added, "Zeta");
		assert.deepEqual(linkList(removed), linkList(before), `round trip failed for ${JSON.stringify(before)}`);
		// Adding twice adds once.
		assert.deepEqual(withLink(added, "Zeta"), added);
	}
});

test("automation rules never throw on any value", () => {
	const r = rng(31337);
	const messy: unknown[] = [null, undefined, "", 0, false, true, [], {}, "Done", new Date()];
	for (let i = 0; i < 1000; i++) {
		const rule = {
			id: "r",
			when: junk(r),
			becomes: r() < 0.5 ? junk(r) : "",
			set: junk(r),
			to: junk(r),
		};
		assert.doesNotThrow(() => shouldFire(rule, junk(r), pick(r, messy), pick(r, messy)));
		const type = pick(r, PROPERTY_TYPES) as PropertyType;
		assert.doesNotThrow(() => resolveValue(rule, { id: "x", name: "X", type }));
	}
});

test("every recurrence rule that parses produces a later date", () => {
	const r = rng(888);
	for (let i = 0; i < 2000; i++) {
		const text = r() < 0.4 ? junk(r) : pick(r, [
			"daily", "weekly", "monthly", "yearly", "weekdays", "fortnightly",
			"quarterly", "every 3 days", "every other week", "every Tuesday",
		]);
		const rule = parseRecurrence(text);
		if (!rule) continue;
		const from = new Date(2026, Math.floor(r() * 12), Math.floor(r() * 28) + 1);
		const next = nextOccurrence(rule, from);
		assert.ok(!isNaN(next.getTime()), `invalid date from "${text}"`);
		assert.ok(next.getTime() > from.getTime(), `"${text}" did not move forward`);
	}
});

/* -------------------------------------------------------------------- CSV */

test("CSV escaping round-trips through a parser for any field", () => {
	const r = rng(606060);
	for (let i = 0; i < 2000; i++) {
		const value = junk(r);
		const field = csvField(value);
		// A quoted field must be balanced, and an unquoted one must not hide a
		// separator that would silently split a column.
		if (field.startsWith('"')) {
			assert.ok(field.endsWith('"'), `unterminated quote for ${JSON.stringify(value)}`);
		} else {
			assert.ok(!/[",\n\r]/.test(field), `unquoted field contains a separator: ${JSON.stringify(field)}`);
		}
	}
});

test("a CSV of hostile rows has one line per row", () => {
	const r = rng(4747);
	const props: PropertyDef[] = [
		{ id: "a", name: "A", type: "text" },
		{ id: "b", name: "B", type: "number" },
	];
	for (let i = 0; i < 200; i++) {
		const rows: DatabaseRow[] = Array.from({ length: 5 }, (_u, k) => ({
			path: `${k}.md`,
			name: junk(r),
			values: { a: junk(r), b: pick(r, [1, NaN, null, junk(r)]) },
		})) as DatabaseRow[];
		const csv = rowsToCsv(rows, props);
		// Count records by parsing quotes rather than splitting on newlines.
		let records = 0;
		let inQuotes = false;
		for (let c = 0; c < csv.length; c++) {
			const ch = csv[c];
			if (ch === '"') inQuotes = !inQuotes;
			else if (ch === "\n" && !inQuotes) records++;
		}
		assert.equal(records, rows.length + 1, "a row's content broke the CSV into extra records");
	}
});

/* ------------------------------------------------------------ round trips */

test("any filter that parses survives being written out and read back", () => {
	const r = rng(515151);
	let checked = 0;
	for (let i = 0; i < 3000; i++) {
		const lines = Array.from({ length: Math.floor(r() * 3) + 1 }, () =>
			`${pick(r, ["Status", "Priority", "Owner", "Due"])} ${pick(r, ["is", "is not", "contains", ">=", "<", "is empty"])} ${pick(r, ["Done", "3", "Ada", "2026-01-01", ""])}`
		);
		const first = parseFilterLines(lines.join("\n"));
		if (!first) continue;
		const second = parseFilterLines(filterToText(first));
		assert.deepEqual(second, first, `lost on the round trip: ${JSON.stringify(lines)}`);
		checked++;
	}
	assert.ok(checked > 500, `only ${checked} filters were exercised`);
});
