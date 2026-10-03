/**
 * "When Status becomes Done, set Completed to today."
 *
 * The thing worth testing is when a rule fires: on the *change*, not on the
 * state. Setting Status to Done when it already said Done is not an event, and
 * treating it as one would restamp a completion date every time somebody
 * re-picked the same option from the menu.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Automation, firedBy, resolveValue, shouldFire } from "../src/db/automation";
import { today } from "../src/utils/dates";
import { PropertyDef } from "../src/types";

const rule = (over: Partial<Automation> = {}): Automation => ({
	id: "r",
	when: "status",
	becomes: "Done",
	set: "completed",
	to: "today",
	...over,
});

test("a rule fires when its property reaches the value it watches", () => {
	assert.equal(shouldFire(rule(), "status", "Doing", "Done"), true);
});

/** The whole point: a value that did not change is not an event. */
test("re-picking the same value fires nothing", () => {
	assert.equal(shouldFire(rule(), "status", "Done", "Done"), false);
});

test("a different value does not fire it", () => {
	assert.equal(shouldFire(rule(), "status", "Done", "Doing"), false);
});

test("a different property does not fire it", () => {
	assert.equal(shouldFire(rule(), "priority", "Low", "Done"), false);
});

test("a rule with no value watches for any change", () => {
	const any = rule({ becomes: "" });
	assert.equal(shouldFire(any, "status", "Doing", "Done"), true);
	assert.equal(shouldFire(any, "status", "Done", "Blocked"), true);
	assert.equal(shouldFire(any, "status", "Done", "Done"), false, "still not a change");
});

test("a parked rule fires nothing", () => {
	assert.equal(shouldFire(rule({ enabled: false }), "status", "Doing", "Done"), false);
});

test("matching ignores case, the way the rest of the plugin does", () => {
	assert.equal(shouldFire(rule({ becomes: "done" }), "status", "Doing", "Done"), true);
});

test("setting a value for the first time counts as a change", () => {
	assert.equal(shouldFire(rule(), "status", undefined, "Done"), true);
	assert.equal(shouldFire(rule({ becomes: "" }), "status", null, "Doing"), true);
});

/* ------------------------------------------------------ what it writes */

const prop = (type: PropertyDef["type"]): PropertyDef => ({ id: "x", name: "X", type });

test("today is resolved when the rule runs, not when it was written", () => {
	assert.equal(resolveValue(rule({ to: "today" }), prop("date")), today());
	assert.equal(resolveValue(rule({ to: "NOW" }), prop("date")), today());
});

test("an empty target clears the property", () => {
	assert.equal(resolveValue(rule({ to: "" }), prop("text")), null);
	assert.equal(resolveValue(rule({ to: "   " }), prop("text")), null);
});

test("the value is coerced to the property it is being written to", () => {
	assert.equal(resolveValue(rule({ to: "true" }), prop("checkbox")), true);
	assert.equal(resolveValue(rule({ to: "unchecked" }), prop("checkbox")), false);
	assert.equal(resolveValue(rule({ to: "42" }), prop("number")), 42);
	assert.deepEqual(resolveValue(rule({ to: "a, b" }), prop("multiselect")), ["a", "b"]);
	assert.equal(resolveValue(rule({ to: "Shipped" }), prop("select")), "Shipped");
});

test("a number that is not a number clears rather than writing nonsense", () => {
	assert.equal(resolveValue(rule({ to: "lots" }), prop("number")), null);
});

/* --------------------------------------------------------- several rules */

test("every rule watching the same change fires, in the order written", () => {
	const rules = [
		rule({ id: "a", set: "completed" }),
		rule({ id: "b", set: "archived", to: "true" }),
		rule({ id: "c", when: "priority" }),
	];
	const fired = firedBy(rules, "status", "Doing", "Done");
	assert.deepEqual(fired.map((r) => r.id), ["a", "b"]);
});

test("a database with no rules does nothing", () => {
	assert.deepEqual(firedBy(undefined, "status", "Doing", "Done"), []);
	assert.deepEqual(firedBy([], "status", "Doing", "Done"), []);
});
