/**
 * Anything this plugin renders to text and reads back has to survive the trip.
 *
 * The filter editor nearly shipped two bugs of exactly this kind. The first put
 * a nested filter across several lines with a leading connective, so re-parsing
 * turned `and (...)` into a rule about a property called "and". The second read
 * the editor's textarea one line at a time with the flat-rule parser, so the
 * single-line form `(A or B) and C` came back as one nonsense rule about a
 * property called "(A". In both cases merely opening the settings dialog and
 * pressing Save silently changed which rows the view matched.
 *
 * So: every shape goes out through filterToText and comes back through both
 * readers -- the settings textarea and the code block -- and has to match the
 * rows it started with.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { filterToText, parseFilterLines, parseViewBlock } from "../src/views/config";
import { applyFilter } from "../src/db/query";
import { DatabaseRow, DatabaseSchema, FilterGroup } from "../src/types";

const schema: DatabaseSchema = {
	id: "db-roundtrip",
	name: "Tasks",
	folder: "Databases/Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{ id: "status", name: "Status", type: "select", options: [] },
		{ id: "priority", name: "Priority", type: "number" },
		{ id: "owner", name: "Owner", type: "text" },
		{ id: "done", name: "Done", type: "checkbox" },
	],
};

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `${name}.md`, name, values, file: null as never };
}

const rows: DatabaseRow[] = [
	row("a", { status: "Done", priority: 3, owner: "Ada", done: true }),
	row("b", { status: "Doing", priority: 1, owner: "Bo", done: false }),
	row("c", { status: "Todo", priority: 5, owner: "Ada", done: false }),
	row("d", { status: "Done", priority: 5, owner: "Cy", done: true }),
	row("e", { status: "Doing", priority: 3, owner: "", done: false }),
];

const SHAPES: Record<string, FilterGroup> = {
	"a single rule": {
		conjunction: "and",
		rules: [{ property: "Status", operator: "is", value: "Done" }],
	},
	"a flat AND": {
		conjunction: "and",
		rules: [
			{ property: "Status", operator: "is", value: "Done" },
			{ property: "Priority", operator: "gte", value: 3 },
		],
	},
	"a flat OR": {
		conjunction: "or",
		rules: [
			{ property: "Status", operator: "is", value: "Doing" },
			{ property: "Priority", operator: "gt", value: 4 },
		],
	},
	"an OR nested inside an AND": {
		conjunction: "and",
		rules: [
			{ property: "Priority", operator: "gte", value: 3 },
			{
				conjunction: "or",
				rules: [
					{ property: "Status", operator: "is", value: "Done" },
					{ property: "Owner", operator: "is", value: "Ada" },
				],
			},
		],
	},
	"two nested groups": {
		conjunction: "and",
		rules: [
			{
				conjunction: "or",
				rules: [
					{ property: "Status", operator: "is", value: "Done" },
					{ property: "Status", operator: "is", value: "Doing" },
				],
			},
			{
				conjunction: "or",
				rules: [
					{ property: "Priority", operator: "gt", value: 2 },
					{ property: "Owner", operator: "is", value: "Bo" },
				],
			},
		],
	},
	"an emptiness test beside a group": {
		conjunction: "and",
		rules: [
			{ property: "Owner", operator: "is_not_empty" },
			{
				conjunction: "or",
				rules: [
					{ property: "Priority", operator: "lt", value: 2 },
					{ property: "Status", operator: "is_not", value: "Done" },
				],
			},
		],
	},
};

function matched(filter: FilterGroup | undefined): string[] {
	return applyFilter(schema, rows, filter).map((r) => r.name);
}

for (const [label, filter] of Object.entries(SHAPES)) {
	const expected = matched(filter);

	test(`${label} survives the settings textarea`, () => {
		const text = filterToText(filter);
		const parsed = parseFilterLines(text);
		assert.ok(parsed, `${label} came back empty from: ${JSON.stringify(text)}`);
		assert.deepEqual(matched(parsed), expected, `via textarea: ${JSON.stringify(text)}`);
	});

	test(`${label} survives the code block`, () => {
		const lines = filterToText(filter)
			.split("\n")
			.map((line) => `  - ${line}`)
			.join("\n");
		const block = parseViewBlock(`db: Tasks\nfilter:\n${lines}`);
		assert.equal(block.error, undefined);
		assert.deepEqual(matched(block.config?.filter), expected, `via block:\n${lines}`);
	});
}

/**
 * The shapes above all match something. A filter that matches nothing is the
 * more dangerous regression: "came back empty" and "came back as a filter that
 * excludes everything" look the same from a row count alone, so check that a
 * round trip cannot quietly turn one into the other.
 */
test("a filter that matches nothing stays a filter that matches nothing", () => {
	const filter: FilterGroup = {
		conjunction: "and",
		rules: [
			{ property: "Status", operator: "is", value: "Done" },
			{ property: "Status", operator: "is", value: "Doing" },
		],
	};
	const parsed = parseFilterLines(filterToText(filter));
	assert.deepEqual(matched(parsed), []);
	assert.notEqual(parsed, undefined);
});
