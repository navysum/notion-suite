/**
 * Repeating rows.
 *
 * "Water the plants, every Tuesday" is a task you want back the moment you have
 * done it. The rule is written in the words someone would say, so the parser has
 * to cope with how people actually write it -- and, just as importantly, refuse
 * everything else, so a text property holding prose never starts creating rows.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { nextDateFor, nextOccurrence, parseRecurrence } from "../src/db/recur";

const on = (iso: string) => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d);
};
const iso = (d: Date) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

test("the plain words all parse", () => {
	assert.deepEqual(parseRecurrence("daily"), { unit: "day", every: 1 });
	assert.deepEqual(parseRecurrence("weekly"), { unit: "week", every: 1 });
	assert.deepEqual(parseRecurrence("monthly"), { unit: "month", every: 1 });
	assert.deepEqual(parseRecurrence("yearly"), { unit: "year", every: 1 });
});

test("fortnightly and quarterly are the intervals people mean by them", () => {
	assert.deepEqual(parseRecurrence("fortnightly"), { unit: "week", every: 2 });
	assert.deepEqual(parseRecurrence("quarterly"), { unit: "month", every: 3 });
});

test("a count can be a digit or a word", () => {
	assert.deepEqual(parseRecurrence("every 3 days"), { unit: "day", every: 3 });
	assert.deepEqual(parseRecurrence("every two weeks"), { unit: "week", every: 2 });
	assert.deepEqual(parseRecurrence("every other week"), { unit: "week", every: 2 });
});

test("a named day repeats weekly on that day", () => {
	assert.deepEqual(parseRecurrence("every Tuesday"), { unit: "week", every: 1, weekday: 2 });
	assert.deepEqual(parseRecurrence("mondays"), { unit: "week", every: 1, weekday: 1 });
});

test("weekdays means Monday to Friday", () => {
	assert.deepEqual(parseRecurrence("weekdays"), { unit: "day", every: 1, weekdaysOnly: true });
});

test("case and spacing do not matter", () => {
	assert.deepEqual(parseRecurrence("  EVERY   3   DAYS "), { unit: "day", every: 3 });
});

/** Anything else must be refused, or ordinary prose starts creating rows. */
test("prose is not a schedule", () => {
	for (const text of [
		"",
		"   ",
		"ask Bo about this",
		"every now and then",
		"every 0 days",
		"every -2 weeks",
		"sometime",
		"2026-03-14",
	]) {
		assert.equal(parseRecurrence(text), null, `"${text}" was read as a schedule`);
	}
});

/* -------------------------------------------------------------- the dates */

test("a weekly task moves a week, not to today", () => {
	const rule = parseRecurrence("weekly")!;
	assert.equal(iso(nextOccurrence(rule, on("2026-03-10"))), "2026-03-17");
});

/** Completing on the due date must move forward, never stay put. */
test("the next date is always strictly later", () => {
	for (const text of ["daily", "weekly", "monthly", "yearly", "every Tuesday", "weekdays"]) {
		const rule = parseRecurrence(text)!;
		const from = on("2026-03-10");
		assert.ok(
			nextOccurrence(rule, from).getTime() > from.getTime(),
			`${text} did not move forward`
		);
	}
});

test("every Tuesday lands on a Tuesday", () => {
	const rule = parseRecurrence("every Tuesday")!;
	// 2026-03-10 is a Tuesday; the next one is the 17th.
	assert.equal(iso(nextOccurrence(rule, on("2026-03-10"))), "2026-03-17");
	// From a Thursday, the next Tuesday is five days on.
	assert.equal(iso(nextOccurrence(rule, on("2026-03-12"))), "2026-03-17");
});

test("every other Tuesday skips a week, not a day", () => {
	const rule = { unit: "week" as const, every: 2, weekday: 2 };
	assert.equal(iso(nextOccurrence(rule, on("2026-03-10"))), "2026-03-24");
});

test("weekdays steps over the weekend", () => {
	const rule = parseRecurrence("weekdays")!;
	// Friday 2026-03-13 -> Monday 2026-03-16.
	assert.equal(iso(nextOccurrence(rule, on("2026-03-13"))), "2026-03-16");
	assert.equal(iso(nextOccurrence(rule, on("2026-03-16"))), "2026-03-17");
});

test("a monthly task keeps its day of the month", () => {
	const rule = parseRecurrence("monthly")!;
	assert.equal(iso(nextOccurrence(rule, on("2026-01-15"))), "2026-02-15");
});

/* ----------------------------------------------------- catching up, or not */

/**
 * A chore ticked off three days late is still due on its usual day, so the
 * next date counts from the row's own date rather than from today.
 */
test("finishing late keeps the original rhythm", () => {
	const rule = parseRecurrence("weekly")!;
	assert.equal(nextDateFor(rule, "2026-03-10", on("2026-03-13")), "2026-03-17");
});

/**
 * But catching up on a month of missed chores must not schedule the next one in
 * the past, or it would be overdue the moment it appeared.
 */
test("a long-abandoned task is scheduled ahead, not behind", () => {
	const rule = parseRecurrence("weekly")!;
	const next = nextDateFor(rule, "2026-01-06", on("2026-03-13"));
	assert.ok(next > "2026-03-13", `scheduled in the past: ${next}`);
	// Still on the original weekday: 6 Jan 2026 is a Tuesday, so is the answer.
	assert.equal(new Date(`${next}T12:00:00`).getDay(), 2);
});

test("a row with no date at all counts from today", () => {
	const rule = parseRecurrence("every 3 days")!;
	assert.equal(nextDateFor(rule, null, on("2026-03-10")), "2026-03-13");
});

/**
 * The date helpers' addMonths snaps to the 1st, which is what a calendar's
 * "next month" button wants and the opposite of what a monthly task wants.
 */
test("a month end clamps rather than overflowing into the next month", () => {
	const rule = parseRecurrence("monthly")!;
	assert.equal(iso(nextOccurrence(rule, on("2026-01-31"))), "2026-02-28");
	assert.equal(iso(nextOccurrence(rule, on("2028-01-31"))), "2028-02-29", "leap year");
	assert.equal(iso(nextOccurrence(rule, on("2026-03-31"))), "2026-04-30");
});

test("a yearly task on 29 February does not vanish", () => {
	const rule = parseRecurrence("yearly")!;
	const next = nextOccurrence(rule, on("2028-02-29"));
	assert.equal(next.getFullYear(), 2029);
	assert.ok(next.getMonth() === 2 || next.getDate() === 28, iso(next));
});

/* ------------------------------------------------------- creating the next */

/**
 * The store's side of it: ticking the trigger copies the row forward. These use
 * a stub store rather than a vault, so what is under test is the decision --
 * when to repeat, and what the new row carries -- not Obsidian's file writing.
 */
import { DatabaseStore } from "../src/db/store";
import { DatabaseRow, DatabaseSchema } from "../src/types";

const repeating: DatabaseSchema = {
	id: "db",
	name: "Chores",
	folder: "Chores",
	createdAt: 0,
	views: [],
	recurrence: { rule: "repeat", date: "due", trigger: "done" },
	properties: [
		{ id: "repeat", name: "Repeat", type: "text" },
		{ id: "due", name: "Due", type: "date" },
		{ id: "done", name: "Done", type: "checkbox" },
		{ id: "notes", name: "Notes", type: "text" },
		{ id: "ref", name: "Ref", type: "uniqueid" },
	],
};

function chore(values: Record<string, unknown>): DatabaseRow {
	return { path: "Chores/Water the plants.md", name: "Water the plants", values, file: null as never };
}

function storeFor(schema: DatabaseSchema, row: DatabaseRow) {
	const created: { name: string; seed: Record<string, unknown> }[] = [];
	const store = new DatabaseStore({} as never, async () => undefined);
	store.load([schema]);
	Object.assign(store, {
		rows: () => [row],
		createRow: async (_s: DatabaseSchema, name: string, seed: Record<string, unknown>) => {
			created.push({ name, seed });
			return null;
		},
	});
	return { store, created };
}

test("ticking a repeating row off creates the next one", async () => {
	const row = chore({ repeat: "weekly", due: "2026-03-10", done: true, notes: "balcony" });
	const { store, created } = storeFor(repeating, row);

	const next = await store.repeatIfDue(repeating, row.path, "done", true);

	assert.equal(created.length, 1);
	assert.equal(created[0].name, "Water the plants");
	assert.equal(next, created[0].seed.due);
});

test("the new row carries everything except the tick and the old date", async () => {
	const row = chore({ repeat: "weekly", due: "2026-03-10", done: true, notes: "balcony", ref: 7 });
	const { store, created } = storeFor(repeating, row);
	await store.repeatIfDue(repeating, row.path, "done", true);

	const seed = created[0].seed;
	assert.equal(seed.notes, "balcony", "the rest of the row was not carried over");
	assert.equal(seed.repeat, "weekly", "the rule itself has to come too, or it repeats once");
	assert.equal(seed.done, false, "the new row arrived already ticked off");
	assert.notEqual(seed.due, "2026-03-10", "the date did not move");
	assert.equal(seed.ref, undefined, "a unique id was copied instead of being issued fresh");
});

test("unticking creates nothing", async () => {
	const row = chore({ repeat: "weekly", due: "2026-03-10", done: false });
	const { store, created } = storeFor(repeating, row);

	assert.equal(await store.repeatIfDue(repeating, row.path, "done", false), null);
	assert.deepEqual(created, []);
});

test("a row with no rule is just a row", async () => {
	const row = chore({ due: "2026-03-10", done: true });
	const { store, created } = storeFor(repeating, row);

	assert.equal(await store.repeatIfDue(repeating, row.path, "done", true), null);
	assert.deepEqual(created, []);
});

/** Prose in the rule property must not quietly start creating rows. */
test("a rule nobody can read creates nothing", async () => {
	const row = chore({ repeat: "ask Bo about this", due: "2026-03-10", done: true });
	const { store, created } = storeFor(repeating, row);

	assert.equal(await store.repeatIfDue(repeating, row.path, "done", true), null);
	assert.deepEqual(created, []);
});

test("a database with no recurrence set up never repeats", async () => {
	const plain = { ...repeating, recurrence: undefined };
	const row = chore({ repeat: "weekly", due: "2026-03-10", done: true });
	const { store, created } = storeFor(plain, row);

	assert.equal(await store.repeatIfDue(plain, row.path, "done", true), null);
	assert.deepEqual(created, []);
});

test("ticking some other checkbox does not repeat the row", async () => {
	const row = chore({ repeat: "weekly", due: "2026-03-10", done: true });
	const { store, created } = storeFor(repeating, row);

	assert.equal(await store.repeatIfDue(repeating, row.path, "notes", true), null);
	assert.deepEqual(created, []);
});
