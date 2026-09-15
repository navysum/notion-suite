/**
 * The plugin's views, rendered into a real DOM and driven the way a user drives
 * them. See tests/dom.ts for what this proves and what it does not.
 *
 * Every case here is either a bug that shipped or a smoke-checklist item that no
 * longer needs a human to click through it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, click, host, installDom, texts, tick, type } from "./dom";

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
test("the search box keeps what you typed, and keeps narrowing", () => {
	const { container } = mount(table);
	assert.equal(all(container, ".nfo-row-title").length, 3);

	type(container.querySelector(".nfo-search"), "the");
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Write the spec", "Ship the thing"]);
	assert.equal(container.querySelector<HTMLInputElement>(".nfo-search")?.value, "the");

	// A second keystroke has to narrow further, not start over.
	type(container.querySelector(".nfo-search"), "the s");
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
test("switching view type keeps the search", () => {
	const { container } = mount(table);
	type(container.querySelector(".nfo-search"), "room");
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Book a room"]);
	assert.equal(container.querySelector<HTMLInputElement>(".nfo-search")?.value, "room");
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
test("a collapsed row stays collapsed across a refresh", () => {
	const container = mountTree(table);
	assert.equal(texts(container, ".nfo-row-title").length, 3);

	click(container.querySelector(".nfo-row-twisty-active"));
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Launch"], "the sub-items did not fold away");

	// Anything at all that redraws the view must not unfold them.
	type(container.querySelector(".nfo-search"), "");
	assert.deepEqual(texts(container, ".nfo-row-title"), ["Launch"], "the row sprang back open");

	click(container.querySelector(".nfo-row-twisty-active"));
	assert.equal(texts(container, ".nfo-row-title").length, 3, "it would not open again");
});

/** Ticked rows are the same kind of state, and were lost by the same bug. */
test("ticked rows stay ticked across a refresh", () => {
	const container = mountTree(table);
	const boxes = () => all(container, ".nfo-row-select") as unknown as HTMLInputElement[];
	tick(boxes()[0]);
	assert.equal(boxes()[0].checked, true, "the tick did not register");

	type(container.querySelector(".nfo-search"), "");
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
