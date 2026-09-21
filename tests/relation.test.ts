/**
 * The relation picker.
 *
 * It used to be a context menu of the first fifty rows, with no search and no
 * sign that it had stopped early -- so on a database of three hundred tasks the
 * last two hundred and fifty could not be linked to at all, and nothing said so.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, installDom, texts } from "./dom";

installDom();

import { currentModal, pressButton, typeInto } from "obsidian";
import { RelationPickerModal } from "../src/ui/relationModal";
import { DatabaseRow, DatabaseSchema } from "../src/types";

const related: DatabaseSchema = {
	id: "db",
	name: "Tasks",
	folder: "Tasks",
	createdAt: 0,
	views: [],
	properties: [],
};

function rows(n: number): DatabaseRow[] {
	return Array.from({ length: n }, (_, i) => ({
		path: `Tasks/Task ${i + 1}.md`,
		name: `Task ${i + 1}`,
		values: {},
		file: null as never,
	}));
}

function open(count: number, current: string[] = []) {
	let result: string[] | null = null;
	const modal = new RelationPickerModal(
		{} as never,
		related,
		rows(count),
		current,
		(names) => {
			result = names;
		}
	);
	modal.open();
	const body = currentModal().contentEl;
	return { modal, body, picked: () => result };
}

test("every row is offered, not the first fifty", () => {
	const { body } = open(300);
	assert.equal(all(body, ".nfo-relation-item").length, 300);
});

test("the list says how much of the database it is showing", () => {
	const { body } = open(300);
	assert.match(body.querySelector(".nfo-relation-count")?.textContent ?? "", /300 of 300 shown/);
});

test("searching narrows the list", () => {
	const { body } = open(300);
	typeInto("Task 29");
	// Task 29, and Task 290-299.
	assert.equal(all(body, ".nfo-relation-item").length, 11);
	assert.match(body.querySelector(".nfo-relation-count")?.textContent ?? "", /11 of 300 shown/);
});

test("a search that matches nothing says so", () => {
	const { body } = open(30);
	typeInto("nothing like this");
	assert.equal(all(body, ".nfo-relation-item").length, 0);
	assert.equal(body.querySelector(".nfo-relation-empty")?.textContent, "Nothing matches.");
});

test("ticking a row links it, and closing keeps the choice", () => {
	const { body, picked } = open(10);
	const item = all(body, ".nfo-relation-item").find((el) => el.textContent?.includes("Task 4"));
	item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	pressButton("Done");

	assert.deepEqual(picked(), ["Task 4"]);
});

test("what is already linked comes back ticked, and to the top", () => {
	const { body } = open(50, ["Task 30"]);
	const names = texts(body, ".nfo-relation-name");
	assert.equal(names[0], "Task 30", "the linked row was not brought to the front");
	const first = all(body, ".nfo-relation-item")[0].querySelector("input") as HTMLInputElement;
	assert.equal(first.checked, true);
});

/** Values are stored as wikilinks by some users; those must read as linked. */
test("a wikilink counts as already linked", () => {
	const { body } = open(10, ["[[Task 2]]"]);
	const item = all(body, ".nfo-relation-item").find((el) => el.textContent?.includes("Task 2"));
	assert.equal((item?.querySelector("input") as HTMLInputElement).checked, true);
});

test("unticking removes the link", () => {
	const { body, picked } = open(10, ["Task 2", "Task 3"]);
	const item = all(body, ".nfo-relation-item").find((el) => el.textContent?.includes("Task 2"));
	item?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	pressButton("Done");

	assert.deepEqual(picked(), ["Task 3"]);
});

test("an empty database explains itself rather than showing a blank box", () => {
	const { body } = open(0);
	assert.equal(body.querySelector(".nfo-relation-empty")?.textContent, "This database has no rows yet.");
});
