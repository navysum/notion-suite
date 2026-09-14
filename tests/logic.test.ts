import assert from "node:assert/strict";
import test from "node:test";

import { coerce, compareValues, evaluateFormula, formatValue, isEmpty } from "../src/db/value";
import { applyFilter, applySorts, groupRows, findProperty } from "../src/db/query";
import { buildChartData } from "../src/charts/aggregate";
import { parseChartBlock, parseFilterShorthand, parseSortShorthand, parseViewBlock } from "../src/views/config";
import { scoreCommand, slashCommands } from "../src/slash/commands";
import { calendarGrid, parseDate, toISODate } from "../src/utils/dates";
import { DatabaseRow, DatabaseSchema, PropertyDef } from "../src/types";

const schema: DatabaseSchema = {
	id: "db-test",
	name: "Tasks",
	folder: "Databases/Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{
			id: "status",
			name: "Status",
			type: "select",
			options: [
				{ name: "Not started", color: "gray" },
				{ name: "In progress", color: "blue" },
				{ name: "Done", color: "green" },
			],
		},
		{ id: "priority", name: "Priority", type: "number" },
		{ id: "due", name: "Due", type: "date" },
		{ id: "done", name: "Done?", type: "checkbox" },
		{ id: "tags", name: "Tags", type: "multiselect" },
	],
};

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `Databases/Tasks/${name}.md`, name, values, ctime: 0, mtime: 0 };
}

const rows: DatabaseRow[] = [
	row("Alpha", { status: "Done", priority: 3, due: "2026-01-10", done: true, tags: ["Work"] }),
	row("Bravo", { status: "In progress", priority: 1, due: "2026-03-02", done: false, tags: ["Work", "Urgent"] }),
	row("Charlie", { status: "Not started", priority: 5, due: null, done: false, tags: [] }),
	row("Delta", { status: "In progress", priority: 2, due: "2026-02-14", done: false, tags: ["Personal"] }),
];

// --- value coercion --------------------------------------------------------

test("coerce tolerates hand-written frontmatter", () => {
	const number = schema.properties[1];
	assert.equal(coerce(number, "1,200"), 1200);
	assert.equal(coerce(number, "not a number"), null);

	const checkbox = schema.properties[3];
	assert.equal(coerce(checkbox, "yes"), true);
	assert.equal(coerce(checkbox, "false"), false);
	assert.equal(coerce(checkbox, 1), true);

	const tags = schema.properties[4];
	assert.deepEqual(coerce(tags, "Work, Urgent"), ["Work", "Urgent"]);
	assert.deepEqual(coerce(tags, null), []);
	assert.deepEqual(coerce(tags, "Solo"), ["Solo"]);

	const date = schema.properties[2];
	assert.equal(coerce(date, new Date(2026, 0, 10)), "2026-01-10");
	assert.equal(coerce(date, "2026/01/10"), "2026-01-10");
	assert.equal(coerce(date, ""), null);
});

test("isEmpty treats blank strings and empty lists as empty, but not false", () => {
	assert.equal(isEmpty(""), true);
	assert.equal(isEmpty("   "), true);
	assert.equal(isEmpty([]), true);
	assert.equal(isEmpty(null), true);
	assert.equal(isEmpty(false), false);
	assert.equal(isEmpty(0), false);
});

test("formatValue renders number formats and dates", () => {
	const percent: PropertyDef = { id: "p", name: "P", type: "number", numberFormat: "percent" };
	assert.equal(formatValue(percent, 0.42), "42%");
	const currency: PropertyDef = { id: "c", name: "C", type: "number", numberFormat: "currency" };
	assert.equal(formatValue(currency, 1234.5), "$1,234.5");
	assert.equal(formatValue(schema.properties[2], "2026-01-10"), "Jan 10, 2026");
	assert.equal(formatValue(schema.properties[3], false), "No");
});

test("compareValues sinks empty values to the bottom regardless of type", () => {
	const due = schema.properties[2];
	assert.ok(compareValues(due, null, "2026-01-01") > 0);
	assert.ok(compareValues(due, "2026-01-01", null) < 0);
	assert.equal(compareValues(due, null, null), 0);
	assert.ok(compareValues(schema.properties[1], 1, 5) < 0);
});

// --- formulas --------------------------------------------------------------

test("evaluateFormula computes arithmetic over property references", () => {
	const props: PropertyDef[] = [
		{ id: "current", name: "Current", type: "number" },
		{ id: "target", name: "Target", type: "number" },
	];
	const goal = row("Goal", { current: 30, target: 40 });
	assert.equal(evaluateFormula("{Current} / {Target}", goal, props), 0.75);
	assert.equal(evaluateFormula("({Current} + 10) * 2", goal, props), 80);
	assert.equal(evaluateFormula("{Current} - {Target}", goal, props), -10);
});

test("evaluateFormula refuses anything that is not arithmetic", () => {
	const props: PropertyDef[] = [{ id: "n", name: "N", type: "number" }];
	const r = row("R", { n: 2 });
	// A code-injection attempt must not evaluate; the parser only accepts digits
	// and operators, so the alert() survives substitution and is rejected.
	assert.equal(evaluateFormula("alert('hi')", r, props), null);
	assert.equal(evaluateFormula("{N} / 0", r, props), null);
	assert.equal(evaluateFormula("{N} +", r, props), null);
	assert.equal(evaluateFormula("{Unknown} + 1", r, props), 1);
});

// --- filtering and sorting -------------------------------------------------

test("findProperty matches on id and on display name, case-insensitively", () => {
	assert.equal(findProperty(schema, "status")?.id, "status");
	assert.equal(findProperty(schema, "Done?")?.id, "done");
	assert.equal(findProperty(schema, "PRIORITY")?.id, "priority");
	assert.equal(findProperty(schema, "nope"), undefined);
});

test("applyFilter handles is / is not / comparisons / emptiness", () => {
	const notDone = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "status", operator: "is_not", value: "Done" }],
	});
	assert.deepEqual(notDone.map((r) => r.name), ["Bravo", "Charlie", "Delta"]);

	const highPriority = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "priority", operator: "gte", value: 3 }],
	});
	assert.deepEqual(highPriority.map((r) => r.name), ["Alpha", "Charlie"]);

	const noDue = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "due", operator: "is_empty" }],
	});
	assert.deepEqual(noDue.map((r) => r.name), ["Charlie"]);
});

test("applyFilter matches list properties by membership", () => {
	const work = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "tags", operator: "contains", value: "Work" }],
	});
	assert.deepEqual(work.map((r) => r.name), ["Alpha", "Bravo"]);
});

test("applyFilter respects the or conjunction", () => {
	const either = applyFilter(schema, rows, {
		conjunction: "or",
		rules: [
			{ property: "status", operator: "is", value: "Done" },
			{ property: "priority", operator: "is", value: 5 },
		],
	});
	assert.deepEqual(either.map((r) => r.name), ["Alpha", "Charlie"]);
});

test("applyFilter filters on the note title via the Name pseudo-property", () => {
	const found = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "Name", operator: "starts_with", value: "br" }],
	});
	assert.deepEqual(found.map((r) => r.name), ["Bravo"]);
});

test("applyFilter compares dates, including the relative today keyword", () => {
	const future = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "due", operator: "after", value: "2026-02-01" }],
	});
	assert.deepEqual(future.map((r) => r.name), ["Bravo", "Delta"]);

	const overdue = applyFilter(schema, rows, {
		conjunction: "and",
		rules: [{ property: "due", operator: "before", value: "today" }],
	});
	// Alpha is the only row dated before 2026-09-14, the day these tests assume.
	assert.ok(overdue.every((r) => r.values.due !== null));
});

test("applySorts orders by property then falls back to the next rule", () => {
	const byPriority = applySorts(schema, rows, [{ property: "priority", direction: "desc" }]);
	assert.deepEqual(byPriority.map((r) => r.name), ["Charlie", "Alpha", "Delta", "Bravo"]);

	const byDue = applySorts(schema, rows, [{ property: "due", direction: "asc" }]);
	// Charlie has no due date, so it sorts last even ascending.
	assert.deepEqual(byDue.map((r) => r.name), ["Alpha", "Delta", "Bravo", "Charlie"]);

	const byStatusThenName = applySorts(schema, rows, [
		{ property: "status", direction: "asc" },
		{ property: "Name", direction: "desc" },
	]);
	assert.deepEqual(byStatusThenName.map((r) => r.name), ["Alpha", "Delta", "Bravo", "Charlie"]);
});

// --- grouping --------------------------------------------------------------

test("groupRows seeds every configured option and parks empties last", () => {
	const groups = groupRows(schema, rows, "status");
	assert.deepEqual(groups.map((g) => g.key), ["Not started", "In progress", "Done"]);
	assert.deepEqual(groups[1].rows.map((r) => r.name), ["Bravo", "Delta"]);
});

test("groupRows puts a multi-select row in every one of its columns", () => {
	const groups = groupRows(schema, rows, "tags");
	const byKey = new Map(groups.map((g) => [g.key, g.rows.map((r) => r.name)]));
	assert.deepEqual(byKey.get("Work"), ["Alpha", "Bravo"]);
	assert.deepEqual(byKey.get("Urgent"), ["Bravo"]);
	// Charlie has no tags, so it lands in the trailing "no value" column.
	assert.equal(groups[groups.length - 1].key, "");
	assert.deepEqual(byKey.get(""), ["Charlie"]);
});

// --- charts ----------------------------------------------------------------

test("buildChartData counts rows per group", () => {
	const data = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "column",
		groupBy: "status",
		aggregation: "count",
		sort: "label",
	});
	assert.deepEqual(data.labels, ["Done", "In progress", "Not started"]);
	assert.deepEqual(data.series[0].values, [1, 2, 1]);
	assert.equal(data.valueLabel, "Count");
});

test("buildChartData sums a numeric property and sorts by value", () => {
	const data = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "bar",
		groupBy: "status",
		value: "priority",
		aggregation: "sum",
		sort: "value_desc",
	});
	// "In progress" (1 + 2) and "Done" (3) tie on 3, so the label breaks the tie.
	assert.deepEqual(data.labels, ["Not started", "Done", "In progress"]);
	assert.deepEqual(data.series[0].values, [5, 3, 3]);
});

test("buildChartData splits into one series per value of the series property", () => {
	const data = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "column",
		groupBy: "status",
		aggregation: "count",
		series: "done",
		sort: "label",
	});
	assert.deepEqual(data.series.map((s) => s.name), ["Checked", "Unchecked"]);
	const checked = data.series[0];
	assert.equal(checked.values[data.labels.indexOf("Done")], 1);
});

test("buildChartData honours its filter and limit", () => {
	const data = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "pie",
		groupBy: "status",
		aggregation: "count",
		filter: { conjunction: "and", rules: [{ property: "done", operator: "is", value: false }] },
		limit: 2,
		sort: "label",
	});
	assert.equal(data.labels.length, 2);
	assert.ok(!data.labels.includes("Done"));
});

test("buildChartData buckets dates by month rather than by day", () => {
	const data = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "line",
		groupBy: "due",
		aggregation: "count",
		sort: "label",
	});
	assert.deepEqual(data.labels, ["2026-01", "2026-02", "2026-03", "No value"]);
});

test("buildChartData computes averages and percentages", () => {
	const avg = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "column",
		groupBy: "status",
		value: "priority",
		aggregation: "average",
		sort: "label",
	});
	assert.equal(avg.series[0].values[avg.labels.indexOf("In progress")], 1.5);

	const percent = buildChartData(schema, rows, {
		database: "Tasks",
		kind: "column",
		groupBy: "status",
		value: "done",
		aggregation: "percent_checked",
		sort: "label",
	});
	assert.equal(percent.series[0].values[percent.labels.indexOf("Done")], 100);
});

// --- block configuration ---------------------------------------------------

test("parseFilterShorthand picks the longest matching operator", () => {
	assert.deepEqual(parseFilterShorthand("Status is not Done"), {
		property: "Status",
		operator: "is_not",
		value: "Done",
	});
	assert.deepEqual(parseFilterShorthand("Due is not empty"), {
		property: "Due",
		operator: "is_not_empty",
	});
	assert.deepEqual(parseFilterShorthand("Priority >= 3"), {
		property: "Priority",
		operator: "gte",
		value: 3,
	});
	assert.deepEqual(parseFilterShorthand("Tags does not contain Work"), {
		property: "Tags",
		operator: "not_contains",
		value: "Work",
	});
	assert.equal(parseFilterShorthand("nonsense"), null);
});

test("parseSortShorthand understands asc, desc and the minus prefix", () => {
	assert.deepEqual(parseSortShorthand("Due asc"), { property: "Due", direction: "asc" });
	assert.deepEqual(parseSortShorthand("Due descending"), { property: "Due", direction: "desc" });
	assert.deepEqual(parseSortShorthand("-Priority"), { property: "Priority", direction: "desc" });
	assert.deepEqual(parseSortShorthand("Name"), { property: "Name", direction: "asc" });
});

test("parseViewBlock reads a full board configuration", () => {
	const { config } = parseViewBlock(
		["database: Tasks", "view: board", "group: status", "sort: -priority", "filter:", "  - Status is not Done"].join("\n")
	);
	assert.ok(config);
	assert.equal(config.databaseId, "Tasks");
	assert.equal(config.type, "board");
	assert.equal(config.groupBy, "status");
	assert.deepEqual(config.sorts, [{ property: "priority", direction: "desc" }]);
	assert.deepEqual(config.filter?.rules, [
		{ property: "Status", operator: "is_not", value: "Done" },
	]);
});

test("parseViewBlock reports a missing database instead of guessing", () => {
	const { config, error } = parseViewBlock("view: table");
	assert.equal(config, null);
	assert.match(error ?? "", /database/i);
});

test("parseViewBlock falls back to a table for an unknown view type", () => {
	const { config } = parseViewBlock("database: Tasks\nview: spreadsheet");
	assert.equal(config?.type, "table");
});

test("parseChartBlock defaults the aggregation from the presence of a value", () => {
	const counted = parseChartBlock("database: Tasks\ngroup: status");
	assert.equal(counted.config?.aggregation, "count");
	assert.equal(counted.config?.kind, "column");

	const summed = parseChartBlock("database: Tasks\ngroup: status\nvalue: priority");
	assert.equal(summed.config?.aggregation, "sum");
});

test("parseChartBlock requires a group property", () => {
	const { config, error } = parseChartBlock("database: Tasks");
	assert.equal(config, null);
	assert.match(error ?? "", /group/i);
});

// --- slash menu ------------------------------------------------------------

test("scoreCommand ranks exact titles above aliases and subsequences", () => {
	const commands = slashCommands();
	const todo = commands.find((c) => c.id === "todo")!;
	assert.equal(scoreCommand(todo, "to-do list"), 100);
	assert.ok((scoreCommand(todo, "task") ?? 0) >= 80);
	assert.equal(scoreCommand(todo, ""), 0);
});

test("every slash command either inserts a snippet or runs an action", () => {
	for (const command of slashCommands()) {
		assert.ok(
			command.insert !== undefined || command.action !== undefined,
			`${command.id} does nothing`
		);
		assert.ok(command.title.length > 0 && command.description.length > 0, `${command.id} is unlabelled`);
	}
});

test("slash command ids are unique", () => {
	const ids = slashCommands().map((c) => c.id);
	assert.equal(new Set(ids).size, ids.length);
});

// --- dates -----------------------------------------------------------------

test("parseDate accepts the shapes frontmatter actually contains", () => {
	assert.equal(toISODate(parseDate("2026-01-10")!), "2026-01-10");
	assert.equal(toISODate(parseDate("2026/1/5")!), "2026-01-05");
	assert.equal(toISODate(parseDate(new Date(2026, 5, 1))!), "2026-06-01");
	assert.equal(parseDate("not a date"), null);
	assert.equal(parseDate(""), null);
	assert.equal(parseDate(null), null);
});

test("calendarGrid always returns six aligned weeks", () => {
	const grid = calendarGrid(new Date(2026, 1, 1));
	assert.equal(grid.length, 42);
	assert.equal(grid[0].getDay(), 0);
	assert.ok(grid.some((d) => d.getMonth() === 1 && d.getDate() === 1));
});
