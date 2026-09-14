import assert from "node:assert/strict";
import test from "node:test";

import { collapse, computeRollup, gatherValues, indexByName, relatedRows } from "../src/db/rollup";
import { RowResolver, ResolverSource } from "../src/db/resolve";
import { seedFrontmatter } from "../src/db/store";
import { formatValue, compareValues } from "../src/db/value";
import { DatabaseRow, DatabaseSchema, PropertyDef, ROLLUP_TITLE_KEY } from "../src/types";

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `${name}.md`, name, values, ctime: 0, mtime: 0 };
}

// --- gathering -------------------------------------------------------------

test("indexByName keeps the first row when two notes share a title", () => {
	const index = indexByName([row("Alpha", { n: 1 }), row("Alpha", { n: 2 })]);
	assert.equal(index.size, 1);
	assert.equal(index.get("alpha")?.values.n, 1);
});

test("relatedRows resolves plain titles, wikilinks and aliases", () => {
	const index = indexByName([row("Design spec", {}), row("Budget", {})]);
	assert.deepEqual(
		relatedRows(["Design spec", "[[Budget]]"], index).map((r) => r.name),
		["Design spec", "Budget"]
	);
	assert.deepEqual(relatedRows("[[Budget|the budget]]", index).map((r) => r.name), ["Budget"]);
	assert.deepEqual(relatedRows("[[Budget#Section]]", index).map((r) => r.name), ["Budget"]);
	// Case-insensitive, and unknown titles are simply skipped.
	assert.deepEqual(relatedRows(["BUDGET", "Nope"], index).map((r) => r.name), ["Budget"]);
	assert.deepEqual(relatedRows(null, index), []);
	assert.deepEqual(relatedRows([], index), []);
});

test("gatherValues flattens list properties and can gather titles", () => {
	const rows = [row("A", { tags: ["x", "y"], n: 1 }), row("B", { tags: ["y"], n: 2 })];
	assert.deepEqual(gatherValues(rows, "tags"), ["x", "y", "y"]);
	assert.deepEqual(gatherValues(rows, "n"), [1, 2]);
	assert.deepEqual(gatherValues(rows, ROLLUP_TITLE_KEY), ["A", "B"]);
	assert.deepEqual(gatherValues(rows, undefined), ["A", "B"]);
});

// --- collapsing ------------------------------------------------------------

test("collapse computes the numeric aggregations", () => {
	const values = [2, 4, 6, 8];
	assert.equal(collapse(values, 4, "sum"), 20);
	assert.equal(collapse(values, 4, "average"), 5);
	assert.equal(collapse(values, 4, "median"), 5);
	assert.equal(collapse(values, 4, "min"), 2);
	assert.equal(collapse(values, 4, "max"), 8);
	assert.equal(collapse(values, 4, "range"), 6);
});

test("collapse returns null for numeric aggregations with nothing to aggregate", () => {
	for (const how of ["sum", "average", "median", "min", "max", "range"] as const) {
		assert.equal(collapse([], 0, how), null, how);
		assert.equal(collapse([null, ""], 2, how), null, how);
	}
});

test("collapse distinguishes counting rows from counting values", () => {
	// Three related rows contributed five values between them.
	const values = ["a", "b", null, "b", ""];
	assert.equal(collapse(values, 3, "count_all"), 3);
	assert.equal(collapse(values, 3, "count_values"), 5);
	assert.equal(collapse(values, 3, "count_unique"), 2);
	assert.equal(collapse(values, 3, "count_empty"), 2);
	assert.equal(collapse(values, 3, "count_not_empty"), 3);
	assert.equal(collapse(values, 3, "percent_empty"), 40);
	assert.equal(collapse(values, 3, "percent_not_empty"), 60);
});

test("collapse handles checkbox aggregations, counting false as unchecked", () => {
	const values = [true, false, true, false];
	assert.equal(collapse(values, 4, "checked"), 2);
	assert.equal(collapse(values, 4, "unchecked"), 2);
	assert.equal(collapse(values, 4, "percent_checked"), 50);
	assert.equal(collapse(values, 4, "percent_unchecked"), 50);
});

test("collapse counts booleans as 1 and 0 when summing", () => {
	assert.equal(collapse([true, true, false], 3, "sum"), 2);
	assert.equal(collapse([true, false], 2, "average"), 0.5);
});

test("collapse computes date aggregations", () => {
	const values = ["2026-03-01", "2026-01-10", "2026-02-14"];
	assert.equal(collapse(values, 3, "earliest"), "2026-01-10");
	assert.equal(collapse(values, 3, "latest"), "2026-03-01");
	assert.equal(collapse(values, 3, "date_range"), 50);
	assert.equal(collapse(["nonsense"], 1, "earliest"), null);
});

test("collapse show_original lists the non-empty values", () => {
	assert.deepEqual(collapse(["a", null, "b"], 3, "show_original"), ["a", "b"]);
	assert.deepEqual(collapse([true, false], 2, "show_original"), ["Yes", "No"]);
});

// --- computeRollup end to end ----------------------------------------------

const rollupDef: PropertyDef = {
	id: "total",
	name: "Total",
	type: "rollup",
	rollupRelation: "tasks",
	rollupProperty: "hours",
	rollupFunction: "sum",
};

test("computeRollup follows a relation and aggregates", () => {
	const index = indexByName([
		row("Task A", { hours: 3 }),
		row("Task B", { hours: 4 }),
		row("Task C", { hours: 5 }),
	]);
	assert.equal(computeRollup(rollupDef, ["Task A", "Task C"], index), 8);
	assert.equal(computeRollup(rollupDef, [], index), null);
});

test("computeRollup returns null until it is fully configured", () => {
	const index = indexByName([row("Task A", { hours: 3 })]);
	assert.equal(computeRollup({ ...rollupDef, rollupRelation: undefined }, ["Task A"], index), null);
	assert.equal(computeRollup({ ...rollupDef, rollupFunction: undefined }, ["Task A"], index), null);
});

// --- resolver: rollups, formulas and cycles --------------------------------

const projects: DatabaseSchema = {
	id: "db-projects",
	name: "Projects",
	folder: "Projects",
	createdAt: 0,
	views: [],
	properties: [
		{ id: "tasks", name: "Tasks", type: "relation", relationDatabaseId: "db-tasks" },
		{
			id: "total_hours",
			name: "Total hours",
			type: "rollup",
			rollupRelation: "tasks",
			rollupProperty: "hours",
			rollupFunction: "sum",
		},
		{
			id: "done_pct",
			name: "Done %",
			type: "rollup",
			rollupRelation: "tasks",
			rollupProperty: "done",
			rollupFunction: "percent_checked",
		},
		{ id: "rate", name: "Rate", type: "number" },
		// A formula reading a rollup: the resolver must fill rollups in first.
		{ id: "cost", name: "Cost", type: "formula", formula: "{Total hours} * {Rate}" },
	],
};

const tasks: DatabaseSchema = {
	id: "db-tasks",
	name: "Tasks",
	folder: "Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{ id: "hours", name: "Hours", type: "number" },
		{ id: "done", name: "Done", type: "checkbox" },
	],
};

function sourceFor(
	schemas: DatabaseSchema[],
	rowsBySchema: Record<string, DatabaseRow[]>
): ResolverSource {
	return {
		schema: (id) => schemas.find((s) => s.id === id),
		// Fresh copies each call; the resolver writes derived values into them.
		baseRows: (schema) =>
			(rowsBySchema[schema.id] ?? []).map((r) => ({ ...r, values: { ...r.values } })),
	};
}

test("resolver fills rollups, then formulas that depend on them", () => {
	const resolver = new RowResolver(
		sourceFor([projects, tasks], {
			"db-projects": [row("Website", { tasks: ["Design", "Build"], rate: 100 })],
			"db-tasks": [
				row("Design", { hours: 3, done: true }),
				row("Build", { hours: 5, done: false }),
				row("Unrelated", { hours: 99, done: true }),
			],
		})
	);

	const [website] = resolver.rows(projects);
	assert.equal(website.values.total_hours, 8);
	assert.equal(website.values.done_pct, 50);
	// The formula saw the resolved rollup, not a null.
	assert.equal(website.values.cost, 800);
});

test("resolver yields null rollups when the relation points nowhere", () => {
	const orphaned: DatabaseSchema = {
		...projects,
		properties: projects.properties.map((p) =>
			p.id === "tasks" ? { ...p, relationDatabaseId: "db-missing" } : p
		),
	};
	const resolver = new RowResolver(
		sourceFor([orphaned], { "db-projects": [row("Website", { tasks: ["Design"], rate: 100 })] })
	);
	const [website] = resolver.rows(orphaned);
	assert.equal(website.values.total_hours, null);
	assert.equal(website.values.done_pct, null);
});

test("resolver terminates on a circular rollup instead of recursing forever", () => {
	// Projects rolls up Tasks, and Tasks rolls right back up into Projects.
	const cyclicTasks: DatabaseSchema = {
		...tasks,
		properties: [
			...tasks.properties,
			{ id: "project", name: "Project", type: "relation", relationDatabaseId: "db-projects" },
			{
				id: "project_hours",
				name: "Project hours",
				type: "rollup",
				rollupRelation: "project",
				rollupProperty: "total_hours",
				rollupFunction: "sum",
			},
		],
	};

	const resolver = new RowResolver(
		sourceFor([projects, cyclicTasks], {
			"db-projects": [row("Website", { tasks: ["Design", "Build"], rate: 100 })],
			"db-tasks": [
				row("Design", { hours: 3, done: true, project: ["Website"] }),
				row("Build", { hours: 5, done: false, project: ["Website"] }),
			],
		})
	);

	// The assertion that matters is that this returns at all.
	const [website] = resolver.rows(projects);
	assert.equal(website.values.total_hours, 8);

	// Read from the other side too: also terminates, one level deep.
	const fromTasks = resolver.rows(cyclicTasks);
	assert.equal(fromTasks.length, 2);
	assert.ok(fromTasks.every((r) => r.values.project_hours !== undefined));
});

test("resolver does not cache a partial result produced inside a cycle", () => {
	const cyclicTasks: DatabaseSchema = {
		...tasks,
		properties: [
			...tasks.properties,
			{ id: "project", name: "Project", type: "relation", relationDatabaseId: "db-projects" },
			{
				id: "project_hours",
				name: "Project hours",
				type: "rollup",
				rollupRelation: "project",
				rollupProperty: "total_hours",
				rollupFunction: "sum",
			},
		],
	};
	const resolver = new RowResolver(
		sourceFor([projects, cyclicTasks], {
			"db-projects": [row("Website", { tasks: ["Design"], rate: 100 })],
			"db-tasks": [row("Design", { hours: 3, done: true, project: ["Website"] })],
		})
	);

	// Resolving Projects internally resolves Tasks against *unresolved*
	// Projects rows. Asking for Tasks directly afterwards must recompute
	// rather than hand back that partial answer.
	resolver.rows(projects);
	const [design] = resolver.rows(cyclicTasks);
	assert.equal(design.values.project_hours, 3);
});

test("resolver caches ordinary, acyclic results", () => {
	let baseCalls = 0;
	const base = sourceFor([projects, tasks], {
		"db-projects": [row("Website", { tasks: ["Design"], rate: 100 })],
		"db-tasks": [row("Design", { hours: 3, done: true })],
	});
	const resolver = new RowResolver({
		schema: base.schema,
		baseRows: (schema) => {
			baseCalls++;
			return base.baseRows(schema);
		},
	});

	resolver.rows(projects);
	const callsAfterFirst = baseCalls;
	resolver.rows(projects);
	assert.equal(baseCalls, callsAfterFirst, "second read should come from cache");

	resolver.clear();
	resolver.rows(projects);
	assert.ok(baseCalls > callsAfterFirst, "clear() should force a recompute");
});

// --- regressions -----------------------------------------------------------

test("resolution stays linear when a rollup cycle is present", () => {
	// A chain of databases, each rolling up the next, with a back edge from the
	// last to the first. A cycle used to disable caching for every database in
	// the pass, so each rollup re-walked its target and cost grew as 2^depth.
	const build = (depth: number): DatabaseSchema[] =>
		Array.from({ length: depth }, (_unused, i) => ({
			id: `db${i}`,
			name: `DB${i}`,
			folder: `f${i}`,
			createdAt: 0,
			views: [],
			properties: [
				{
					id: "rel",
					name: "Rel",
					type: "relation",
					relationDatabaseId: i === depth - 1 ? "db0" : `db${i + 1}`,
				},
				{ id: "r1", name: "R1", type: "rollup", rollupRelation: "rel", rollupProperty: "n", rollupFunction: "sum" },
				{ id: "r2", name: "R2", type: "rollup", rollupRelation: "rel", rollupProperty: "n", rollupFunction: "max" },
				{ id: "n", name: "N", type: "number" },
			],
		})) as DatabaseSchema[];

	const measure = (depth: number): number => {
		const schemas = build(depth);
		let calls = 0;
		const resolver = new RowResolver({
			schema: (id) => schemas.find((s) => s.id === id),
			baseRows: (s) => {
				calls++;
				return [row("Row", { n: 1, rel: ["Row"] })];
			},
		});
		resolver.rows(schemas[0]);
		return calls;
	};

	// Linear in depth, with a small constant for the re-entry fallbacks.
	assert.ok(measure(4) <= 12, `depth 4 took ${measure(4)} base reads`);
	assert.ok(measure(12) <= 30, `depth 12 took ${measure(12)} base reads`);
});

test("a new row never has a derived value written into its frontmatter", () => {
	// A view filtered on a rollup, or a board grouped by one, seeds new rows
	// from that rule. Persisting it would plant a key that goes stale at once.
	const written = seedFrontmatter(projects, {
		total_hours: 8,
		cost: 800,
		rate: 100,
		tasks: ["Design"],
	});
	assert.equal(written.total_hours, undefined, "rollup must not be persisted");
	assert.equal(written.cost, undefined, "formula must not be persisted");
	assert.equal(written.rate, 100, "a real property is still seeded");
	assert.deepEqual(written.tasks, ["Design"]);
});

test("a new row starts editable properties at an explicit empty value", () => {
	const written = seedFrontmatter(tasks, {});
	assert.equal(written.done, false);
	assert.equal(written.hours, undefined);
});

test("a related row with an empty list counts as empty, not as absent", () => {
	// Dropping empty lists entirely removed the row from the denominator, so
	// "percent not empty" read 100% across mostly-blank rows.
	const rows = [row("A", { tags: ["x"] }), row("B", { tags: [] })];
	const values = gatherValues(rows, "tags");
	assert.equal(values.length, 2);
	assert.equal(collapse(values, 2, "count_empty"), 1);
	assert.equal(collapse(values, 2, "count_not_empty"), 1);
	assert.equal(collapse(values, 2, "percent_not_empty"), 50);
});

test("the same note listed twice in a relation counts once", () => {
	const index = indexByName([row("Task", { hours: 5 })]);
	assert.equal(relatedRows(["Task", "[[Task]]"], index).length, 1);
	assert.equal(computeRollup(rollupDef, ["Task", "Task"], index), 5);
});

test("date aggregations ignore plain numbers instead of reading them as epochs", () => {
	// A rollup pointed at a number property used to report a confident 1970.
	assert.equal(collapse([3, 7], 2, "earliest"), null);
	assert.equal(collapse([3, 7], 2, "latest"), null);
	assert.equal(collapse([3, 7], 2, "date_range"), null);
});

test("min, max and range survive a gather too large to spread as arguments", () => {
	// Math.min(...list) throws RangeError past roughly 125k arguments.
	const many = Array.from({ length: 200_000 }, (_unused, i) => i);
	assert.equal(collapse(many, many.length, "min"), 0);
	assert.equal(collapse(many, many.length, "max"), 199_999);
	assert.equal(collapse(many, many.length, "range"), 199_999);

	const dates = Array.from({ length: 200_000 }, (_unused, i) =>
		new Date(2020, 0, 1 + (i % 365)).toISOString().slice(0, 10)
	);
	assert.equal(collapse(dates, dates.length, "earliest"), "2020-01-01");
	assert.equal(collapse(dates, dates.length, "latest"), "2020-12-30");
});

// --- presentation ----------------------------------------------------------

test("formatValue renders each shape of rollup result", () => {
	const sum: PropertyDef = { ...rollupDef, rollupFunction: "sum" };
	assert.equal(formatValue(sum, 12.345), "12.35");

	const percent: PropertyDef = { ...rollupDef, rollupFunction: "percent_checked" };
	assert.equal(formatValue(percent, 50), "50%");

	const span: PropertyDef = { ...rollupDef, rollupFunction: "date_range" };
	assert.equal(formatValue(span, 50), "50 days");

	const earliest: PropertyDef = { ...rollupDef, rollupFunction: "earliest" };
	assert.equal(formatValue(earliest, "2026-01-10"), "Jan 10, 2026");

	const original: PropertyDef = { ...rollupDef, rollupFunction: "show_original" };
	assert.equal(formatValue(original, ["a", "b"]), "a, b");
});

test("compareValues sorts numeric rollups numerically, not as text", () => {
	const prop: PropertyDef = { ...rollupDef, rollupFunction: "sum" };
	assert.ok(compareValues(prop, 9, 10) < 0);
	assert.ok(compareValues(prop, 100, 20) > 0);
	// Empty rollups still sink.
	assert.ok(compareValues(prop, null, 1) > 0);
});
