/**
 * Building a filter by clicking.
 *
 * Every other setting became a dropdown long ago; filters stayed a textarea of
 * English sentences, so the setting people touch most was the one that asked
 * them to remember a syntax.
 *
 * The typed form is still the storage format, so the property that matters is a
 * round trip: what the rows produce must parse back, and a filter written by
 * hand must open in the rows.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { all, click, host, installDom, texts } from "./dom";

installDom();

import { FilterBuilder, SortBuilder } from "../src/ui/filterBuilder";
import { applyFilter, applySorts } from "../src/db/query";
import { parseFilterLines } from "../src/views/config";
import { DatabaseRow, DatabaseSchema } from "../src/types";

const schema: DatabaseSchema = {
	id: "db",
	name: "Tasks",
	folder: "Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{
			id: "status",
			name: "Status",
			type: "select",
			options: [{ name: "Todo", color: "gray" }, { name: "Doing", color: "blue" }, { name: "Done", color: "green" }],
		},
		{ id: "priority", name: "Priority", type: "number" },
		{ id: "owner", name: "Owner", type: "text" },
		{ id: "done", name: "Done?", type: "checkbox" },
		{ id: "due", name: "Due", type: "date" },
	],
};

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `${name}.md`, name, values, file: null as never };
}

const rows = [
	row("a", { status: "Done", priority: 3, owner: "Ada", done: true, due: "2026-03-01" }),
	row("b", { status: "Doing", priority: 1, owner: "Bo", done: false, due: "2026-04-01" }),
	row("c", { status: "Todo", priority: 5, owner: "Ada", done: false, due: "2026-05-01" }),
];

function build(initial = "") {
	let text = initial;
	const el = host();
	new FilterBuilder(el, schema, initial, (next) => {
		text = next;
	});
	return { el, text: () => text, matched: () => applyFilter(schema, rows, parseFilterLines(text)).map((r) => r.name) };
}

const selects = (el: HTMLElement) => all(el, "select") as unknown as HTMLSelectElement[];
function choose(el: HTMLSelectElement, value: string): void {
	el.value = value;
	el.dispatchEvent(new Event("change", { bubbles: true }));
}

test("an empty filter offers a condition and matches everything", () => {
	const { el, matched } = build();
	assert.match(el.querySelector(".nfo-filter-empty")?.textContent ?? "", /every row is shown/i);
	assert.deepEqual(matched(), ["a", "b", "c"]);
});

test("adding a condition produces a filter that actually filters", () => {
	const { el, text, matched } = build();
	click(el.querySelector(".nfo-filter-add"));

	// Defaults to the first property and its first operator, with a real value.
	assert.equal(all(el, ".nfo-filter-row").length, 1);
	assert.equal(text(), "Status is Todo");
	assert.deepEqual(matched(), ["c"]);
});

test("changing the value changes which rows match", () => {
	const { el, matched } = build("Status is Todo");
	const value = selects(el).find((s) => s.className.includes("nfo-filter-value"))!;
	choose(value, "Done");
	assert.deepEqual(matched(), ["a"]);
});

/**
 * "starts with" means nothing on a checkbox. Switching property has to move the
 * operator somewhere valid rather than leave an impossible pairing behind.
 */
test("switching property moves the operator somewhere that makes sense", () => {
	const { el, text } = build("Owner starts with A");
	const prop = selects(el)[0];
	choose(prop, "Done?");

	assert.equal(text(), "Done? is true");
	const ops = texts(el, ".nfo-filter-op option");
	assert.deepEqual(ops, ["is"], "a checkbox should only offer 'is'");
});

test("the operators offered follow the property's type", () => {
	const { el } = build("Priority >= 3");
	const ops = texts(el, ".nfo-filter-op option");
	assert.ok(ops.includes("is at least"), `numbers should offer comparisons, got ${ops.join(", ")}`);
	assert.ok(!ops.includes("starts with"), "numbers should not offer text tests");
});

test("a select property offers its options rather than a free-text box", () => {
	const { el } = build("Status is Doing");
	const value = selects(el).find((s) => s.className.includes("nfo-filter-value"));
	assert.ok(value, "expected a dropdown for a select property");
	assert.deepEqual(texts(el, ".nfo-filter-value option"), ["Todo", "Doing", "Done"]);
	assert.equal(value.value, "Doing");
});

test("an emptiness test drops the value box, because there is nothing to compare", () => {
	const { el, text } = build("Owner is Ada");
	const op = selects(el).find((s) => s.className.includes("nfo-filter-op"))!;
	choose(op, "is_not_empty");

	assert.equal(el.querySelector(".nfo-filter-value"), null);
	assert.equal(text(), "Owner is not empty");
});

test("any and all both work, and say which is on", () => {
	const { el, matched } = build("Status is Done\nOwner is Bo");
	assert.deepEqual(matched(), [], "'all' should match nothing here");

	const any = all(el, ".nfo-filter-conj-btn").find((b) => b.textContent === "any")!;
	click(any);
	assert.deepEqual(matched(), ["a", "b"]);
});

test("removing a condition removes it from the filter", () => {
	const { el, text } = build("Status is Done\nOwner is Ada");
	click(all(el, ".nfo-filter-remove")[0]);
	assert.equal(text(), "Owner is Ada");
});

/** A hand-written filter has to open in the rows, not be thrown away. */
test("a filter written by hand opens as rows", () => {
	const { el } = build("Priority >= 3\nOwner is not Bo");
	assert.equal(all(el, ".nfo-filter-row").length, 2);
	const props = (all(el, ".nfo-filter-prop") as unknown as HTMLSelectElement[]).map((s) => s.value);
	assert.deepEqual(props, ["Priority", "Owner"]);
});

/**
 * Rows cannot express brackets. Flattening one silently would change which rows
 * a saved view matches, which is the exact bug this plugin has already shipped
 * twice, so a nested filter hands over to the text box intact.
 */
test("a bracketed filter is handed to the text box, not flattened", () => {
	const { el, text } = build("Priority >= 3 and (Status is Done or Owner is Ada)");
	assert.equal(all(el, ".nfo-filter-row").length, 0);
	assert.match(el.querySelector(".nfo-filter-nested")?.textContent ?? "", /brackets/);
	assert.equal((el.querySelector(".nfo-filter-text") as HTMLTextAreaElement).value, text() || "Priority >= 3 and (Status is Done or Owner is Ada)");
});

test("starting again from a bracketed filter gives you rows back", () => {
	const { el, text } = build("Priority >= 3 and (Status is Done or Owner is Ada)");
	click(el.querySelector(".nfo-filter-link"));
	assert.equal(text(), "");
	assert.ok(el.querySelector(".nfo-filter-add"), "expected the row builder back");
});

/* ------------------------------------------------------------------ sorts */

function buildSort(initial = "") {
	let text = initial;
	const el = host();
	new SortBuilder(el, schema, initial, (next) => {
		text = next;
	});
	return {
		el,
		text: () => text,
		order: () =>
			applySorts(
				schema,
				rows,
				text.split("\n").filter(Boolean).map((line) => {
					const [property, direction] = [line.replace(/ (asc|desc)$/, ""), line.endsWith("desc") ? "desc" : "asc"];
					return { property, direction: direction as "asc" | "desc" };
				})
			).map((r) => r.name),
	};
}

test("a sort can be added, reversed and removed", () => {
	const { el, text, order } = buildSort();
	click(el.querySelector(".nfo-filter-add"));
	assert.equal(text(), "Status asc");

	const dir = (all(el, ".nfo-filter-op") as unknown as HTMLSelectElement[])[0];
	choose(dir, "desc");
	assert.equal(text(), "Status desc");

	const prop = (all(el, ".nfo-filter-prop") as unknown as HTMLSelectElement[])[0];
	choose(prop, "Priority");
	assert.equal(text(), "Priority desc");
	assert.deepEqual(order(), ["c", "a", "b"]);

	click(el.querySelector(".nfo-filter-remove"));
	assert.equal(text(), "");
});

test("a second sort breaks ties rather than replacing the first", () => {
	const { el, text } = buildSort("Owner asc");
	click(el.querySelector(".nfo-filter-add"));
	assert.equal(text().split("\n").length, 2);
	assert.match(text(), /^Owner asc\n/);
});
