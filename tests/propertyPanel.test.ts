/**
 * A row's properties at the top of its own note.
 *
 * Opening a row used to be a one-way trip: the views are full of Notion-style
 * controls, and then you land in the note and edit `status: Doing` as raw YAML.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, host, installDom, texts } from "./dom";

installDom();

import { applyPropertyPanel } from "../src/ui/propertyPanel";
import { DatabaseStore } from "../src/db/store";
import { DatabaseRow, DatabaseSchema } from "../src/types";

const schema: DatabaseSchema = {
	id: "db",
	name: "Tasks",
	folder: "Work/Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{ id: "status", name: "Status", type: "select", options: [{ name: "Doing", color: "blue" }] },
		{ id: "due", name: "Due", type: "date" },
		{ id: "secret", name: "Secret", type: "text", hidden: true },
	],
};

const row: DatabaseRow = {
	path: "Work/Tasks/Ship it.md",
	name: "Ship it",
	values: { status: "Doing", due: "2026-03-14" },
	file: null as never,
};

function storeWith(schemas: DatabaseSchema[], rows: DatabaseRow[] = [row]): DatabaseStore {
	return {
		schemaForPath: (path: string) => {
			let best: DatabaseSchema | undefined;
			for (const s of schemas) {
				if (path === s.folder || path.startsWith(`${s.folder}/`)) {
					if (!best || s.folder.length > best.folder.length) best = s;
				}
			}
			return best;
		},
		rows: () => rows,
		optionFor: () => undefined,
		getFile: () => null,
	} as unknown as DatabaseStore;
}

/** A stand-in for the markdown view the panel injects itself into. */
function view(path: string | null) {
	const contentEl = host();
	contentEl.createDiv({ cls: "cm-sizer" });
	return {
		contentEl,
		file: path ? { path, basename: path.split("/").pop()!.replace(/\.md$/, "") } : null,
	} as never;
}

const on = { showPropertyPanel: true };

test("a note inside a database gets its properties", () => {
	const v = view("Work/Tasks/Ship it.md");
	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);

	assert.deepEqual(texts((v as never as { contentEl: HTMLElement }).contentEl, ".nfo-props-label"), [
		"Status",
		"Due",
	]);
});

test("a hidden property stays hidden here too", () => {
	const v = view("Work/Tasks/Ship it.md");
	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);
	const labels = texts((v as never as { contentEl: HTMLElement }).contentEl, ".nfo-props-label");
	assert.ok(!labels.includes("Secret"));
});

test("a note outside every database gets nothing", () => {
	const v = view("Journal/Monday.md");
	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);
	assert.equal((v as never as { contentEl: HTMLElement }).contentEl.querySelector(".nfo-props"), null);
});

/** With both Work and Work/Tasks defined, a task is a task — not a work item. */
test("the most specific database wins", () => {
	const outer: DatabaseSchema = {
		...schema,
		id: "outer",
		name: "Work",
		folder: "Work",
		properties: [{ id: "owner", name: "Owner", type: "text" }],
	};
	const v = view("Work/Tasks/Ship it.md");
	applyPropertyPanel({} as never, storeWith([outer, schema]), v, on, () => undefined);

	const labels = texts((v as never as { contentEl: HTMLElement }).contentEl, ".nfo-props-label");
	assert.deepEqual(labels, ["Status", "Due"], "the outer database claimed the note");
});

test("turning the panel off removes it rather than leaving a stale one", () => {
	const v = view("Work/Tasks/Ship it.md");
	const el = (v as never as { contentEl: HTMLElement }).contentEl;
	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);
	assert.ok(el.querySelector(".nfo-props"));

	applyPropertyPanel({} as never, storeWith([schema]), v, { showPropertyPanel: false }, () => undefined);
	assert.equal(el.querySelector(".nfo-props"), null);
});

/** Switching notes in one pane must not leave the previous note's panel. */
test("redrawing replaces the panel instead of stacking another", () => {
	const v = view("Work/Tasks/Ship it.md");
	const el = (v as never as { contentEl: HTMLElement }).contentEl;
	for (let i = 0; i < 3; i++) {
		applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);
	}
	assert.equal(all(el, ".nfo-props").length, 1);
});

test("the panel sits below the banner, not above it", () => {
	const v = view("Work/Tasks/Ship it.md");
	const el = (v as never as { contentEl: HTMLElement }).contentEl;
	const sizer = el.querySelector(".cm-sizer")!;
	sizer.createDiv({ cls: "nfo-banner" });

	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);

	const kids = [...sizer.children].map((c) => c.className);
	assert.deepEqual(kids.slice(0, 2), ["nfo-banner", "nfo-props"]);
});

test("a row the store does not know about gets nothing", () => {
	const v = view("Work/Tasks/Ghost.md");
	applyPropertyPanel({} as never, storeWith([schema]), v, on, () => undefined);
	assert.equal((v as never as { contentEl: HTMLElement }).contentEl.querySelector(".nfo-props"), null);
});
