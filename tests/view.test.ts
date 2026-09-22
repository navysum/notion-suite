/**
 * The plugin's views, rendered into a real DOM and driven the way a user drives
 * them. See tests/dom.ts for what this proves and what it does not.
 *
 * Every case here is either a bug that shipped or a smoke-checklist item that no
 * longer needs a human to click through it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, click, host, installDom, settle, texts, tick, type } from "./dom";

installDom();

import { renderDatabaseView } from "../src/views/renderer";
import { ViewContext } from "../src/views/context";
import { DatabaseStore } from "../src/db/store";
import { DatabaseRow, DatabaseSchema, ViewConfig } from "../src/types";

const schema: DatabaseSchema = {
	id: "db-view",
	name: "Tasks",
	folder: "Databases/Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{ id: "status", name: "Status", type: "select", options: [] },
		{ id: "due", name: "Due", type: "date" },
	],
};

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `Databases/Tasks/${name}.md`, name, values, file: null as never };
}

const rows: DatabaseRow[] = [
	row("Write the spec", { status: "Doing", due: "2026-03-10" }),
	row("Ship the thing", { status: "Done", due: "2026-03-20" }),
	row("Book a room", { status: "Todo", due: "2026-04-02" }),
];

/** A view rendered into a stable host, with a refresh that behaves like the real one. */
function mount(view: ViewConfig): { container: HTMLElement; refreshes: () => number } {
	const container = host();
	let refreshes = 0;
	const ctx = {
		app: { workspace: {} },
		store: {
			rows: () => rows,
			getFile: () => null,
			optionFor: () => undefined,
		} as unknown as DatabaseStore,
		schema,
		sourcePath: "Note.md",
		refresh: () => {
			refreshes++;
			renderDatabaseView(container, ctx, view);
		},
	} as unknown as ViewContext;

	renderDatabaseView(container, ctx, view);
	return { container, refreshes: () => refreshes };
}

const table: ViewConfig = { type: "table", db: "Tasks" };
const calendar: ViewConfig = { type: "calendar", db: "Tasks", dateProperty: "due" };

/**
 * Shipped twice: the search box was keyed on an element the refresh rebuilt, so
 * typing a letter destroyed the thing holding what you had typed.
 */
test("the search box keeps what you typed, and keeps narrowing", async () => {
	const { container } = mount(table);
	assert.equal(all(container, ".nfo-row-title").length, 3);

	type(container.querySelector(".nfo-search"), "the");
	await settle();
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Write the spec", "Ship the thing"]);
	assert.equal(container.querySelector<HTMLInputElement>(".nfo-search")?.value, "the");

	// A second keystroke has to narrow further, not start over.
	type(container.querySelector(".nfo-search"), "the s");
	await settle();
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Write the spec"]);
	assert.equal(container.querySelector<HTMLInputElement>(".nfo-search")?.value, "the s");
});

/**
 * Shipped: the month was keyed on the element the calendar drew into, which the
 * refresh replaced, so "next month" put you back where you started.
 */
test("calendar navigation actually advances, and Today comes back", () => {
	const { container } = mount(calendar);
	const title = () => container.querySelector(".nfo-calendar-title")?.textContent ?? "";
	const start = title();

	const next = () => click(all(container, ".nfo-calendar-nav-btn")[1]);
	next();
	const afterOne = title();
	assert.notEqual(afterOne, start, "next month did not move");

	next();
	next();
	assert.notEqual(title(), afterOne, "the month stopped advancing after the first press");

	click(container.querySelector(".nfo-calendar-today"));
	assert.equal(title(), start, "Today did not come back to this month");
});

/** The same state, on the way back: switching views must not lose the search. */
test("switching view type keeps the search", async () => {
	const { container } = mount(table);
	type(container.querySelector(".nfo-search"), "room");
	await settle();
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Book a room"]);
	assert.equal(container.querySelector<HTMLInputElement>(".nfo-search")?.value, "room");
});

/**
 * Shipped since the first release, found by screenshotting the real plugin: every
 * property in a row stacked into one column. `renderCell` put `.nfo-cell`
 * (`display: flex`) on whatever element it was handed, and in the table that is
 * the <td>. A flex <td> is no longer a table cell, so the column layout collapsed.
 */
test("a table cell stays a table cell, with its value in a child element", () => {
	const { container } = mount(table);
	const cells = all(container, ".nfo-td");
	assert.ok(cells.length > 0, "the table drew no cells");

	for (const td of cells) {
		assert.equal(
			td.classList.contains("nfo-cell"),
			false,
			"the <td> itself carries .nfo-cell, which makes it display: flex and breaks the table layout"
		);
	}

	// The value still renders, one .nfo-cell per property cell, inside the <td>.
	const valueCells = all(container, ".nfo-td .nfo-cell");
	assert.ok(valueCells.length > 0, "no cell contents were rendered");
	for (const cell of valueCells) {
		assert.equal(cell.tagName, "DIV", "the cell layout must live on an element renderCell creates");
	}
});

/* -------------------------------------------- state that outlives a refresh */

const subItems: DatabaseRow[] = [
	row("Launch", { status: "Doing" }),
	row("Draft copy", { status: "Todo", parent: "Launch" }),
	row("Proofread", { status: "Todo", parent: "Launch" }),
];

const treeSchema: DatabaseSchema = {
	...schema,
	parentProperty: "parent",
	properties: [...schema.properties, { id: "parent", name: "Parent", type: "text" }],
};

function mountTree(view: ViewConfig): HTMLElement {
	const container = host();
	const ctx = {
		app: { workspace: {} },
		store: {
			rows: () => subItems,
			getFile: () => null,
			optionFor: () => undefined,
		} as unknown as DatabaseStore,
		schema: treeSchema,
		sourcePath: "Note.md",
		refresh: () => renderDatabaseView(container, ctx, view),
	} as unknown as ViewContext;
	renderDatabaseView(container, ctx, view);
	return container;
}

/**
 * Shipped: collapsing a sub-item did not stick, because the cycle-recovery pass
 * re-appended the descendants it had just folded away. Then it had to survive a
 * refresh as well.
 */
test("a collapsed row stays collapsed across a refresh", async () => {
	const container = mountTree(table);
	assert.equal(texts(container, ".nfo-row-title").length, 3);

	click(container.querySelector(".nfo-row-twisty-active"));
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Launch"], "the sub-items did not fold away");

	// Anything at all that redraws the view must not unfold them.
	type(container.querySelector(".nfo-search"), "");
	await settle();
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Launch"], "the row sprang back open");

	click(container.querySelector(".nfo-row-twisty-active"));
	assert.equal(texts(container, ".nfo-row-title").length, 3, "it would not open again");
});

/** Ticked rows are the same kind of state, and were lost by the same bug. */
test("ticked rows stay ticked across a refresh", async () => {
	const container = mountTree(table);
	const boxes = () => all(container, ".nfo-row-select") as unknown as HTMLInputElement[];
	tick(boxes()[0]);
	assert.equal(boxes()[0].checked, true, "the tick did not register");

	type(container.querySelector(".nfo-search"), "");
	await settle();
	assert.equal(boxes()[0].checked, true, "the tick was cleared by a refresh");
});

/** The timeline keeps its window the same way the calendar keeps its month. */
test("timeline navigation advances and comes back", () => {
	const container = mount({ type: "timeline", db: "Tasks", dateProperty: "due" }).container;
	const title = () => container.querySelector(".nfo-timeline-title")?.textContent ?? "";
	const start = title();

	click(all(container, ".nfo-timeline-nav-btn")[1]);
	const moved = title();
	assert.notEqual(moved, start, "next did not move the window");

	click(all(container, ".nfo-timeline-nav-btn")[1]);
	assert.notEqual(title(), moved, "the window stopped moving after one press");

	click(container.querySelector(".nfo-timeline-today"));
	assert.equal(title(), start, "Today did not come back");
});

/* ------------------------------------------------------ holding rows back */

function manyRows(n: number): DatabaseRow[] {
	return Array.from({ length: n }, (_, i) => row(`Row ${i + 1}`, { status: "Todo" }));
}

function mountRows(rows: DatabaseRow[], view: ViewConfig = table): HTMLElement {
	const container = host();
	const ctx = {
		app: { workspace: {} },
		store: {
			rows: () => rows,
			getFile: () => null,
			optionFor: () => undefined,
		} as unknown as DatabaseStore,
		schema,
		sourcePath: "Note.md",
		refresh: () => renderDatabaseView(container, ctx, view),
	} as unknown as ViewContext;
	renderDatabaseView(container, ctx, view);
	return container;
}

/**
 * A view with no `limit:` used to draw every row it had, which on an imported
 * Notion workspace means thousands of table rows and a frozen app.
 */
test("a big database draws a page, not all of it", () => {
	const container = mountRows(manyRows(1000));
	assert.equal(all(container, ".nfo-row-title").length, 100);
});

/** A truncated view and a small database must not look the same. */
test("a held-back view says how many rows there really are", () => {
	const container = mountRows(manyRows(1000));
	const label = container.querySelector(".nfo-more-count")?.textContent ?? "";
	assert.match(label, /Showing 100 of 1,000/);
});

test("a small database says nothing and holds nothing back", () => {
	const container = mountRows(manyRows(12));
	assert.equal(all(container, ".nfo-row-title").length, 12);
	assert.equal(container.querySelector(".nfo-more-bar"), null);
});

test("show more adds a page; show all finishes the job", () => {
	const container = mountRows(manyRows(250));
	click(container.querySelector(".nfo-more-btn"));
	assert.equal(all(container, ".nfo-row-title").length, 200);

	click(container.querySelector(".nfo-more-all"));
	assert.equal(all(container, ".nfo-row-title").length, 250);
	assert.equal(container.querySelector(".nfo-more-bar"), null, "still offering more at the end");
});

/** A view's own `limit:` is the author's decision and must still win. */
test("an explicit limit is not overridden by the page size", () => {
	const container = mountRows(manyRows(1000), { type: "table", db: "Tasks", pageSize: 5 } as unknown as ViewConfig);
	assert.equal(all(container, ".nfo-row-title").length, 5);
	assert.equal(container.querySelector(".nfo-more-bar"), null);
});

/** Searching is a new question, so it starts again at page one. */
test("a new search resets how much is shown", async () => {
	const container = mountRows(manyRows(1000));
	click(container.querySelector(".nfo-more-all"));
	assert.equal(all(container, ".nfo-row-title").length, 1000);

	type(container.querySelector(".nfo-search"), "Row 1");
	await settle();
	assert.equal(all(container, ".nfo-row-title").length, 100);
	assert.match(container.querySelector(".nfo-more-count")?.textContent ?? "", /of 112/);
});

/* --------------------------------------------------------- grouped tables */

const grouped: ViewConfig = { type: "table", db: "Tasks", groupBy: "status" } as unknown as ViewConfig;

/**
 * Notion's table "Group by": foldable bands rather than six filtered views of
 * the same database.
 */
test("a grouped table draws a band per value, with counts", () => {
	const container = mountRows(rows, grouped);
	const labels = texts(container, ".nfo-group-bar");
	assert.equal(labels.length, 3, `expected three bands, got ${labels.join(" | ")}`);
	assert.ok(labels.some((l) => l.includes("Doing") && l.includes("1")));
});

test("every row still appears, under its own band", () => {
	const container = mountRows(rows, grouped);
	assert.equal(all(container, ".nfo-row-title").length, rows.length);
});

test("folding a band hides its rows and nothing else", () => {
	const container = mountRows(rows, grouped);
	const doing = all(container, ".nfo-group-bar").find((b) => b.textContent?.includes("Doing"));
	click(doing);

	const shown = texts(container, ".nfo-row-title");
	assert.ok(!shown.includes("Write the spec"), "the folded band's row is still showing");
	assert.equal(shown.length, rows.length - 1);
	// The band itself stays, so it can be unfolded again.
	assert.equal(all(container, ".nfo-group-bar").length, 3);
});

test("an ungrouped table draws no bands at all", () => {
	const container = mountRows(rows, table);
	assert.equal(all(container, ".nfo-group-bar").length, 0);
});

/** Grouping without totals would just be six headings. */
test("a band carries the column totals for its own rows", () => {
	const container = mountRows(rows, {
		type: "table",
		db: "Tasks",
		groupBy: "status",
		calculate: { due: "count_not_empty" },
	} as unknown as ViewConfig);

	const calcs = texts(container, ".nfo-group-calc");
	assert.equal(calcs.length, 3, `expected a total per band, got ${calcs.join(" | ")}`);
	assert.ok(calcs.every((c) => c.includes("Due")), calcs.join(" | "));
});

/* ------------------------------------------------- row icons, board totals */

/** Notion shows a page's icon everywhere that page appears. */
test("a row's own emoji shows next to its title", () => {
	const withIcons: DatabaseRow[] = [
		{ ...row("Ship it", { status: "Doing" }), icon: "🚀" },
		row("Plain one", { status: "Doing" }),
	];
	const container = mountRows(withIcons);
	assert.deepEqual(texts(container, ".nfo-row-icon"), ["🚀"]);
});

test("a board column carries the totals for its own cards", () => {
	const container = mountRows(rows, {
		type: "board",
		db: "Tasks",
		groupBy: "status",
		calculate: { due: "count_not_empty" },
	} as unknown as ViewConfig);

	const calcs = texts(container, ".nfo-board-calc");
	assert.ok(calcs.length >= 3, `expected a total per column, got ${calcs.join(" | ")}`);
	assert.ok(calcs.every((c) => c.includes("Due")), calcs.join(" | "));
});

test("a board with no calculations configured shows none", () => {
	const container = mountRows(rows, { type: "board", db: "Tasks", groupBy: "status" } as unknown as ViewConfig);
	assert.equal(all(container, ".nfo-board-calc").length, 0);
});
