/**
 * The paths that only ran inside Obsidian: dialogs, panes and drag-and-drop.
 *
 * Four of the six bugs in the last audit lived here, found by reading rather
 * than by any check. See tests/dom.ts for what this proves and what it does not
 * -- in particular, the workspace below is a model of Obsidian's, so these tests
 * catch regressions in the plugin's own logic, not mistakes in the model.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, click, host, installDom } from "./dom";

installDom();

import { dismissModal, pressButton } from "obsidian";
import { deleteRowAndAsk, openRow, ViewContext } from "../src/views/context";
import { renderDatabaseView } from "../src/views/renderer";
import { DatabaseStore } from "../src/db/store";
import { DatabaseRow, DatabaseSchema, ViewConfig } from "../src/types";

/* ------------------------------------------------------------------ rows */

const schema: DatabaseSchema = {
	id: "db-interact",
	name: "Tasks",
	folder: "Databases/Tasks",
	createdAt: 0,
	parentProperty: "parent",
	views: [],
	properties: [
		{ id: "status", name: "Status", type: "select", options: [] },
		{ id: "parent", name: "Parent", type: "text" },
		{ id: "notes", name: "Notes", type: "text" },
	],
};

function row(name: string, values: Record<string, unknown> = {}): DatabaseRow {
	return { path: `Databases/Tasks/${name}.md`, name, values, file: null as never };
}

/** A parent with two sub-items, one of them a sub-sub-item. */
function family(): DatabaseRow[] {
	return [
		row("Launch", { status: "Doing", notes: "keep me" }),
		row("Draft copy", { status: "Todo", parent: "Launch" }),
		row("Proofread", { status: "Todo", parent: "Draft copy" }),
		row("Unrelated", { status: "Done" }),
	];
}

/** A store that records what was asked of it instead of touching a vault. */
function fakeStore(rows: DatabaseRow[]) {
	const deleted: string[] = [];
	const written: { path: string; property: string; value: unknown }[] = [];
	const store = {
		rows: () => rows,
		getFile: (path: string) => ({ path }),
		optionFor: () => undefined,
		deleteRow: async (path: string) => {
			deleted.push(path);
		},
		setValue: async (_schema: DatabaseSchema, path: string, property: string, value: unknown) => {
			written.push({ path, property, value });
		},
		updateDatabase: async () => undefined,
	} as unknown as DatabaseStore;
	return { store, deleted, written };
}

/* -------------------------------------------------------------- dialogs */

function deleteContext(rows: DatabaseRow[]) {
	const { store, deleted } = fakeStore(rows);
	const ctx = {
		app: {},
		store,
		schema,
		sourcePath: "Note.md",
		refresh: () => undefined,
	} as unknown as ViewContext;
	return { ctx, deleted };
}

/**
 * The first version of this dialog asked a three-way question through a
 * two-button confirm, so dismissing it would have deleted the parent. Closing a
 * dialog must never be an answer.
 */
test("dismissing the delete dialog deletes nothing at all", async () => {
	const { ctx, deleted } = deleteContext(family());
	const done = deleteRowAndAsk(ctx, "Databases/Tasks/Launch.md");
	dismissModal();
	await done;
	assert.deepEqual(deleted, []);
});

test("deleting only the parent leaves the sub-items alone", async () => {
	const { ctx, deleted } = deleteContext(family());
	const done = deleteRowAndAsk(ctx, "Databases/Tasks/Launch.md");
	pressButton("Delete only this row");
	await done;
	assert.deepEqual(deleted, ["Databases/Tasks/Launch.md"]);
});

/** "All" means the whole subtree, including the sub-item's own sub-item. */
test("deleting everything takes the sub-items and their sub-items", async () => {
	const { ctx, deleted } = deleteContext(family());
	const done = deleteRowAndAsk(ctx, "Databases/Tasks/Launch.md");
	pressButton("Delete all 3");
	await done;
	assert.deepEqual(deleted.sort(), [
		"Databases/Tasks/Draft copy.md",
		"Databases/Tasks/Launch.md",
		"Databases/Tasks/Proofread.md",
	]);
	assert.ok(!deleted.includes("Databases/Tasks/Unrelated.md"));
});

/** A row with nothing nested under it should not ask anything. */
test("deleting a row with no sub-items asks nothing", async () => {
	const { ctx, deleted } = deleteContext(family());
	await deleteRowAndAsk(ctx, "Databases/Tasks/Unrelated.md");
	assert.deepEqual(deleted, ["Databases/Tasks/Unrelated.md"]);
});

/* ---------------------------------------------------------------- panes */

interface FakeLeaf {
	root: string;
	opened: string[];
}

/** A workspace with a left sidebar, a right sidebar and a main editor. */
function fakeWorkspace(existing: FakeLeaf[]) {
	const leaves = [...existing];
	const rightSplit = { name: "right" };
	const created: { how: string; leaf: FakeLeaf }[] = [];
	const workspace = {
		rightSplit,
		getLeavesOfType: () => leaves.map((leaf) => ({ ...leafApi(leaf) })),
		getLeaf: (how: unknown) => {
			const leaf: FakeLeaf = { root: how === "split" ? "right" : "main", opened: [] };
			leaves.push(leaf);
			created.push({ how: String(how), leaf });
			return leafApi(leaf);
		},
	};
	function leafApi(leaf: FakeLeaf) {
		return {
			getRoot: () => (leaf.root === "right" ? rightSplit : { name: leaf.root }),
			openFile: async (file: { path: string }) => {
				leaf.opened.push(file.path);
			},
			_leaf: leaf,
		};
	}
	return { workspace, leaves, created };
}

function paneContext(workspace: unknown) {
	const { store } = fakeStore(family());
	return {
		app: { workspace },
		store,
		schema,
		sourcePath: "Note.md",
		refresh: () => undefined,
	} as unknown as ViewContext;
}

/**
 * Shipped: "reuse a pane outside the main editor" also describes the left
 * sidebar, so glancing at a row could replace whatever was pinned there.
 */
test("a side peek never takes over the left sidebar", async () => {
	const pinned: FakeLeaf = { root: "left", opened: ["Pinned note.md"] };
	const { workspace, created } = fakeWorkspace([pinned]);
	openRow(paneContext(workspace), "Databases/Tasks/Launch.md");
	await Promise.resolve();

	assert.deepEqual(pinned.opened, ["Pinned note.md"], "the pinned note was replaced");
	assert.equal(created.length, 1, "a new pane should have been opened instead");
});

test("a side peek reuses the pane it already opened", async () => {
	const peek: FakeLeaf = { root: "right", opened: ["Old row.md"] };
	const { workspace, created } = fakeWorkspace([peek]);
	openRow(paneContext(workspace), "Databases/Tasks/Launch.md");
	await Promise.resolve();

	assert.deepEqual(created, [], "a second pane was opened instead of reusing the first");
	assert.deepEqual(peek.opened, ["Old row.md", "Databases/Tasks/Launch.md"]);
});

test("ctrl-clicking a row opens a tab rather than a side peek", async () => {
	const { workspace, created } = fakeWorkspace([]);
	const event = new MouseEvent("click", { ctrlKey: true });
	openRow(paneContext(workspace), "Databases/Tasks/Launch.md", event);
	await Promise.resolve();

	assert.deepEqual(
		created.map((c) => c.how),
		["tab"]
	);
});

/* ----------------------------------------------------------- board drag */

/** The clipboard a drag carries. happy-dom has no DataTransfer of its own. */
function dataTransfer() {
	const store = new Map<string, string>();
	return {
		effectAllowed: "",
		dropEffect: "",
		setData: (key: string, value: string) => store.set(key, value),
		getData: (key: string) => store.get(key) ?? "",
	};
}

function dragEvent(kind: string, transfer: ReturnType<typeof dataTransfer>): Event {
	const event = new Event(kind, { bubbles: true, cancelable: true });
	Object.defineProperty(event, "dataTransfer", { value: transfer });
	return event;
}

const board: ViewConfig = { type: "board", db: "Tasks", groupBy: "status" };

/**
 * Shipped: a card dragged between columns had its other values rewritten, so a
 * multi-select card lost everything but the column it landed in. A move writes
 * the grouping property and nothing else.
 */
test("dragging a card between columns writes only the column it landed in", async () => {
	const rows = family();
	const { store, written } = fakeStore(rows);
	const container = host();
	const ctx = {
		app: { workspace: fakeWorkspace([]).workspace },
		store,
		schema,
		sourcePath: "Note.md",
		refresh: () => undefined,
	} as unknown as ViewContext;
	renderDatabaseView(container, ctx, board);

	const card = all(container, ".nfo-card").find((el) => el.textContent?.includes("Launch"));
	assert.ok(card, "no card to drag");

	const transfer = dataTransfer();
	card.dispatchEvent(dragEvent("dragstart", transfer));
	assert.equal(transfer.getData("text/nfo-row"), "Databases/Tasks/Launch.md");

	// Drop on the body of a different column.
	const columns = all(container, ".nfo-board-column");
	const target = columns.find((col) => col.textContent?.startsWith("Done"));
	assert.ok(target, "no Done column to drop into");
	target.querySelector(".nfo-board-cards")?.dispatchEvent(dragEvent("drop", transfer));
	await Promise.resolve();
	await Promise.resolve();

	assert.deepEqual(
		written.map((w) => w.property),
		["status"],
		`a drop should write the grouping property alone, not ${JSON.stringify(written)}`
	);
	assert.equal(written[0].value, "Done");
	assert.equal(written[0].path, "Databases/Tasks/Launch.md");
});

/* ---------------------------------------------------------- bulk delete */

const bulkTable: ViewConfig = { type: "table", db: "Tasks" } as unknown as ViewConfig;

function mountBulk(rows: DatabaseRow[]) {
	const { store, deleted } = fakeStore(rows);
	const container = host();
	const ctx = {
		app: { workspace: fakeWorkspace([]).workspace },
		store,
		schema,
		sourcePath: "Note.md",
		refresh: () => renderDatabaseView(container, ctx, bulkTable),
	} as unknown as ViewContext;
	renderDatabaseView(container, ctx, bulkTable);
	return { container, deleted };
}

function tickRow(container: HTMLElement, name: string): void {
	const rows = all(container, ".nfo-tr");
	const row = rows.find((el) => el.textContent?.includes(name)) ?? null;
	const box = row?.querySelector(".nfo-row-select");
	if (!box) throw new Error(`no tick box for "${name}"`);
	(box as HTMLInputElement).checked = true;
	box.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Deleting one row has always asked. Deleting eighty used to empty the
 * selection on the spot, with no dialog at all.
 */
test("bulk delete asks before deleting anything", async () => {
	const { container, deleted } = mountBulk(family());
	tickRow(container, "Unrelated");

	click(container.querySelector(".nfo-bulk-danger"));
	await Promise.resolve();

	assert.deepEqual(deleted, [], "rows went before the question was answered");
	dismissModal();
	await Promise.resolve();
	assert.deepEqual(deleted, [], "dismissing the dialog still deleted them");
});

test("confirming a bulk delete deletes exactly what was ticked", async () => {
	const { container, deleted } = mountBulk(family());
	tickRow(container, "Unrelated");

	click(container.querySelector(".nfo-bulk-danger"));
	await Promise.resolve();
	pressButton("Delete 1 row");
	for (let i = 0; i < 6; i++) await Promise.resolve();

	assert.deepEqual(deleted, ["Databases/Tasks/Unrelated.md"]);
});

/** The bulk path used to orphan sub-items silently; now it counts them. */
test("bulk delete offers to take unticked sub-items too", async () => {
	const { container, deleted } = mountBulk(family());
	tickRow(container, "Launch");

	click(container.querySelector(".nfo-bulk-danger"));
	await Promise.resolve();
	pressButton("Delete all 3");
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assert.deepEqual(deleted.sort(), [
		"Databases/Tasks/Draft copy.md",
		"Databases/Tasks/Launch.md",
		"Databases/Tasks/Proofread.md",
	]);
});

test("bulk delete can leave the sub-items behind", async () => {
	const { container, deleted } = mountBulk(family());
	tickRow(container, "Launch");

	click(container.querySelector(".nfo-bulk-danger"));
	await Promise.resolve();
	pressButton("Delete the 1 ticked");
	for (let i = 0; i < 6; i++) await Promise.resolve();

	assert.deepEqual(deleted, ["Databases/Tasks/Launch.md"]);
});
