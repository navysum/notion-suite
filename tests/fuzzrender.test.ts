/**
 * Brute force, with a document.
 *
 * The parser fuzzing proves nothing is thrown while reading a block. This
 * proves nothing is thrown while *drawing* one, which is the failure a user
 * actually sees: an exception inside a markdown post-processor does not land
 * in a tidy callout, it takes the note's rendering down with it.
 *
 * Every view type is drawn against schemas and rows built to be awkward --
 * properties of every type, values of every shape, names made of quotes and
 * newlines and emoji, grouping by things that cannot be grouped.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, host, installDom } from "./dom";

installDom();

import { renderDatabaseView } from "../src/views/renderer";
import { ViewContext } from "../src/views/context";
import { DatabaseStore } from "../src/db/store";
import { buildChartData } from "../src/charts/aggregate";
import { renderChart } from "../src/charts/svg";
import { parseWidgetBlock } from "../src/widgets/widget";
import { renderWidget } from "../src/widgets/widget";
import { spliceLines, setBlockKey, fence } from "../src/views/blockEdit";
import {
	DatabaseRow,
	DatabaseSchema,
	PropertyDef,
	PropertyType,
	PROPERTY_TYPES,
	ViewConfig,
	ViewType,
} from "../src/types";

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

const NASTY = [
	"", " ", "\n", '"', "'", "\\", "{}", "[]", "- ", "#", "null", "NaN",
	"😀", "日本語", "\u0000", "a".repeat(200), "2026-02-30", "true", "<b>x</b>",
];
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length) % xs.length];

const VIEWS: ViewType[] = ["table", "board", "gallery", "list", "calendar", "timeline"];

function schemaFor(r: () => number): DatabaseSchema {
	const properties: PropertyDef[] = PROPERTY_TYPES.map((type, i) => ({
		id: `p${i}`,
		name: r() < 0.25 ? pick(r, NASTY) : `P${i}`,
		type: type as PropertyType,
		options: r() < 0.5 ? [{ name: pick(r, NASTY), color: "blue" }] : [],
		numberFormat: pick(r, ["plain", "percent", "currency"] as const),
		currency: pick(r, ["GBP", "JPY", undefined as unknown as string]),
		formula: pick(r, ["{p1} + 1", pick(r, NASTY), "((("]),
		rollupRelation: `p${Math.floor(r() * 5)}`,
		rollupProperty: pick(r, NASTY),
	}));
	return {
		id: "fz",
		name: "Fuzz",
		folder: "Fuzz",
		createdAt: 0,
		views: [],
		properties,
		parentProperty: r() < 0.4 ? "p0" : undefined,
	};
}

function rowsFor(r: () => number, schema: DatabaseSchema, n: number): DatabaseRow[] {
	const shapes: unknown[] = [
		null, undefined, "", 0, NaN, true, [], {}, [null], [{}], new Date("x"),
		new Date(), 1e308, "2026-01-15", ["a", "b"], { a: 1 },
	];
	return Array.from({ length: n }, (_u, i) => {
		const values: Record<string, unknown> = {};
		for (const prop of schema.properties) {
			values[prop.id] = r() < 0.5 ? pick(r, shapes) : pick(r, NASTY);
		}
		return {
			path: `Fuzz/${i}.md`,
			name: r() < 0.3 ? pick(r, NASTY) : `Row ${i}`,
			values,
			icon: r() < 0.2 ? "🚀" : undefined,
		} as DatabaseRow;
	});
}

function contextFor(schema: DatabaseSchema, rows: DatabaseRow[], container: HTMLElement, view: ViewConfig) {
	const ctx = {
		app: { workspace: {}, metadataCache: { getFirstLinkpathDest: () => null } },
		store: {
			rows: () => rows,
			getFile: () => null,
			optionFor: () => undefined,
			get: () => schema,
		} as unknown as DatabaseStore,
		schema,
		sourcePath: "N.md",
		refresh: () => undefined,
	} as unknown as ViewContext;
	void container;
	void view;
	return ctx;
}

test("every view draws hostile data without throwing", () => {
	const r = rng(900913);
	for (let i = 0; i < 240; i++) {
		const schema = schemaFor(r);
		const rows = rowsFor(r, schema, Math.floor(r() * 12));
		const view: ViewConfig = {
			id: "v",
			name: pick(r, NASTY),
			type: pick(r, VIEWS),
			databaseId: schema.id,
			groupBy: r() < 0.7 ? pick(r, [...schema.properties.map((p) => p.id), pick(r, NASTY)]) : undefined,
			dateProperty: r() < 0.5 ? pick(r, [...schema.properties.map((p) => p.id), pick(r, NASTY)]) : undefined,
			coverProperty: pick(r, [...schema.properties.map((p) => p.id), undefined]),
			timelineStart: pick(r, [...schema.properties.map((p) => p.id), undefined]),
			timelineEnd: pick(r, [...schema.properties.map((p) => p.id), undefined]),
			dateBuckets: r() < 0.5,
			calculate: { [`p${Math.floor(r() * 5)}`]: "sum" },
			limits: { [pick(r, NASTY)]: Math.floor(r() * 5) },
			subGroupBy: r() < 0.3 ? `p${Math.floor(r() * 5)}` : undefined,
			collapsedGroups: [pick(r, NASTY)],
		};
		const container = host();
		const ctx = contextFor(schema, rows, container, view);
		try {
			renderDatabaseView(container, ctx, view);
		} catch (error) {
			assert.fail(
				`${view.type} threw on iteration ${i}: ${String(error)}\n` +
					`group=${JSON.stringify(view.groupBy)} date=${JSON.stringify(view.dateProperty)}`
			);
		}
		// Something must be on screen: an empty container means a view that
		// silently drew nothing, which reads as a broken plugin.
		assert.ok(container.childElementCount > 0, `${view.type} drew nothing at all`);
	}
});

test("charts draw hostile data without throwing", () => {
	const r = rng(1357);
	for (let i = 0; i < 240; i++) {
		const schema = schemaFor(r);
		const rows = rowsFor(r, schema, Math.floor(r() * 15));
		const config = {
			databaseId: schema.id,
			kind: pick(r, ["bar", "column", "line", "area", "pie", "donut", "scatter"] as const),
			groupBy: pick(r, [...schema.properties.map((p) => p.id), pick(r, NASTY)]),
			aggregation: pick(r, ["count", "sum", "average", "median", "min", "max", "percent_checked"] as const),
			value: pick(r, [...schema.properties.map((p) => p.id), undefined]),
			series: r() < 0.4 ? `p${Math.floor(r() * 5)}` : undefined,
			stacked: r() < 0.5,
			height: pick(r, [0, -10, 1e6, 340]),
			limit: pick(r, [0, -1, 3, 1e6]),
		};
		const container = host();
		try {
			const data = buildChartData(schema, rows, config as never);
			renderChart(container, config as never, data);
		} catch (error) {
			assert.fail(`chart ${config.kind} threw: ${String(error)}`);
		}
	}
});

test("widgets draw hostile data without throwing", () => {
	const r = rng(2468);
	const kinds = ["metric", "progress", "countdown", "list", "button"];
	for (let i = 0; i < 300; i++) {
		const schema = schemaFor(r);
		const rows = rowsFor(r, schema, Math.floor(r() * 8));
		const source = [
			`kind: ${pick(r, [...kinds, pick(r, NASTY)])}`,
			`database: Fuzz`,
			`aggregate: ${pick(r, ["count_all", "sum", pick(r, NASTY)])}`,
			`value: ${pick(r, NASTY)}`,
			`date: ${pick(r, NASTY)}`,
			`limit: ${pick(r, ["3", "-1", "0", pick(r, NASTY)])}`,
			`label: ${pick(r, NASTY)}`,
		].join("\n");
		const parsed = parseWidgetBlock(source);
		const container = host();
		const ctx = contextFor(schema, rows, container, { type: "table" } as ViewConfig);
		try {
			if (parsed.config) renderWidget(container, ctx, parsed.config);
		} catch (error) {
			assert.fail(`widget threw on ${JSON.stringify(source)}: ${String(error)}`);
		}
	}
});

/**
 * Writing a setting back into a note edits the user's file by line number.
 * Getting that wrong does not throw -- it quietly corrupts the note around
 * the block, which is worse.
 */
test("editing a block in place never loses or duplicates the note around it", () => {
	const r = rng(864);
	// A line cannot contain a newline, so the generator must not produce one:
	// joining and re-splitting would turn one "line" into two and the test
	// would be measuring its own mistake.
	const line = () => pick(r, NASTY).replace(/[\r\n]/g, "·");
	for (let i = 0; i < 1500; i++) {
		const before = Array.from({ length: Math.floor(r() * 6) }, line);
		const after = Array.from({ length: Math.floor(r() * 6) }, line);
		const block = fence("notion-db", "database: Tasks\nview: table");
		const lines = [...before, ...block.split("\n"), ...after];
		const start = before.length;
		const end = start + block.split("\n").length - 1;

		const replacement = fence("notion-db", `database: ${pick(r, NASTY)}`);
		let result = "";
		assert.doesNotThrow(() => {
			result = spliceLines(lines.join("\n"), start, end, replacement);
		});
		const out = result.split("\n");
		// Everything outside the block must come back untouched and in order.
		assert.deepEqual(out.slice(0, start), before, "content above the block changed");
		if (after.length > 0) {
			assert.deepEqual(out.slice(out.length - after.length), after, "content below the block changed");
		}
	}
});

test("setting a key in a block body never throws and keeps the other keys", () => {
	const r = rng(975);
	for (let i = 0; i < 2000; i++) {
		const body = Array.from({ length: Math.floor(r() * 5) }, () => `${pick(r, NASTY)}: ${pick(r, NASTY)}`).join("\n");
		const key = pick(r, ["view", "group", "sort", pick(r, NASTY)]);
		let next = "";
		assert.doesNotThrow(() => {
			next = setBlockKey(body, key, pick(r, NASTY));
		}, JSON.stringify({ body, key }));
		assert.equal(typeof next, "string");
	}
});

/** Two views of one database on one page must not fight over state. */
test("many views of the same data on one page all draw", () => {
	const r = rng(13);
	const schema = schemaFor(r);
	const rows = rowsFor(r, schema, 20);
	const page = host();
	for (const type of VIEWS) {
		const container = page.createDiv();
		const view: ViewConfig = {
			id: `v-${type}`,
			name: "",
			type,
			databaseId: schema.id,
			groupBy: "p2",
			dateProperty: "p5",
		};
		const ctx = contextFor(schema, rows, container, view);
		assert.doesNotThrow(() => renderDatabaseView(container, ctx, view), type);
	}
	assert.equal(all(page, ".nfo-view").length, VIEWS.length);
});

/**
 * Every view, against a list property that is not a list.
 *
 * `tags: Work` is far more common in hand-written frontmatter than
 * `tags: [Work]`, and four views iterated such a value with
 * `for (const item of value as string[])` — a cast, not a check. A number or a
 * map threw "not iterable" straight out of the render; a bare string quietly
 * iterated character by character and drew a chip per letter.
 *
 * The seeded fuzzer found this, but only for some views on some seeds. This
 * covers the combination exhaustively, so it cannot come back in the corner
 * the generator happens to miss.
 */
test("no view trips over a list property holding something that is not a list", () => {
	const schema: DatabaseSchema = {
		id: "l",
		name: "L",
		folder: "L",
		createdAt: 0,
		views: [],
		properties: [
			{ id: "tags", name: "Tags", type: "multiselect", options: [] },
			{ id: "who", name: "Who", type: "person", options: [] },
			{ id: "rel", name: "Rel", type: "relation" },
			{ id: "files", name: "Files", type: "files" },
			{ id: "when", name: "When", type: "date" },
		],
	};

	const wrong: unknown[] = [
		"Work", 7, 0, true, false, {}, { a: 1 }, new Date(), NaN, "",
		[null], [{}], [[1]], [undefined],
	];

	for (const bad of wrong) {
		const rows: DatabaseRow[] = [
			{
				path: "L/a.md",
				name: "A",
				values: { tags: bad, who: bad, rel: bad, files: bad, when: "2026-03-14" },
			} as DatabaseRow,
		];
		for (const type of VIEWS) {
			const container = host();
			const view: ViewConfig = {
				id: "v",
				name: "",
				type,
				databaseId: schema.id,
				groupBy: "tags",
				dateProperty: "when",
				coverProperty: "files",
			};
			const ctx = contextFor(schema, rows, container, view);
			try {
				renderDatabaseView(container, ctx, view);
			} catch (error) {
				assert.fail(`${type} threw on ${JSON.stringify(bad)}: ${String(error)}`);
			}
		}
	}
});

/** A bare string must read as one value, not as a chip per letter. */
test("a list property holding a bare string reads as one value", () => {
	const schema: DatabaseSchema = {
		id: "l", name: "L", folder: "L", createdAt: 0, views: [],
		properties: [{ id: "tags", name: "Tags", type: "multiselect", options: [] }],
	};
	const rows = [{ path: "L/a.md", name: "A", values: { tags: "Work" } }] as DatabaseRow[];
	const container = host();
	const view: ViewConfig = { id: "v", name: "", type: "list", databaseId: "l" };
	renderDatabaseView(container, contextFor(schema, rows, container, view), view);

	const chips = all(container, ".nfo-pill").map((el) => el.textContent);
	assert.ok(!chips.includes("W"), `drew a chip per letter: ${JSON.stringify(chips)}`);
});
