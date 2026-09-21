/**
 * CSV export.
 *
 * A database that cannot leave is a database you are locked into, which is the
 * thing this plugin exists to avoid.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { csvField, csvFileName, rowsToCsv } from "../src/db/csv";
import { DatabaseRow, PropertyDef } from "../src/types";

const properties: PropertyDef[] = [
	{ id: "status", name: "Status", type: "select", options: [] },
	{ id: "hours", name: "Hours", type: "number" },
	{ id: "tags", name: "Tags", type: "multiselect", options: [] },
	{ id: "done", name: "Done", type: "checkbox" },
];

function row(name: string, values: Record<string, unknown>): DatabaseRow {
	return { path: `${name}.md`, name, values, file: null as never };
}

test("a header row names the title column and every property", () => {
	const csv = rowsToCsv([], properties);
	assert.equal(csv.trim(), "Name,Status,Hours,Tags,Done");
});

test("each row becomes a line, in the order the properties were given", () => {
	const csv = rowsToCsv(
		[row("Ship it", { status: "Doing", hours: 3, tags: ["a", "b"], done: false })],
		properties
	);
	const [, line] = csv.trim().split("\n");
	assert.equal(line, 'Ship it,Doing,3,"a, b",No');
});

test("a comma, a quote or a newline is quoted and escaped", () => {
	assert.equal(csvField("plain"), "plain");
	assert.equal(csvField("a,b"), '"a,b"');
	assert.equal(csvField('say "hi"'), '"say ""hi"""');
	assert.equal(csvField("two\nlines"), '"two\nlines"');
});

/**
 * Excel and Sheets execute a cell that starts with =, +, - or @. A task called
 * "=SUM(A1:A9)" would run on open, which is how a spreadsheet becomes an
 * injection vector. A leading tab keeps the text and stops it being a formula.
 */
test("a value that a spreadsheet would run as a formula is defused", () => {
	for (const dangerous of ["=SUM(A1:A9)", "+1+1", "-2+3", "@import"]) {
		const field = csvField(dangerous);
		assert.ok(field.startsWith('"\t'), `${dangerous} was left executable: ${field}`);
		assert.ok(field.includes(dangerous), "the original text was lost");
	}
});

test("the file ends with a newline", () => {
	assert.ok(rowsToCsv([row("a", {})], []).endsWith("\n"));
});

test("the file name carries the database and the date", () => {
	assert.equal(csvFileName("Tasks", new Date(2026, 2, 14)), "Tasks 2026-03-14.csv");
});

test("a database name that is not a legal file name is cleaned up", () => {
	assert.equal(csvFileName('Work: "everything"/2026', new Date(2026, 0, 2)), "Work everything2026 2026-01-02.csv");
});

test("an empty database still exports a usable file", () => {
	assert.equal(rowsToCsv([], properties).split("\n").length, 2);
});
