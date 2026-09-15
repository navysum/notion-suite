import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFormula } from "../src/db/value";
import { MAX_FORMULA_DEPTH, MAX_FORMULA_LENGTH, runFormula } from "../src/db/formula";
import { DatabaseRow, PropertyDef } from "../src/types";

const props: PropertyDef[] = [
	{ id: "title", name: "Name", type: "text" },
	{ id: "current", name: "Current", type: "number" },
	{ id: "target", name: "Target", type: "number" },
	{ id: "done", name: "Done?", type: "checkbox" },
	{ id: "due", name: "Due", type: "date" },
	{ id: "tags", name: "Tags", type: "multiselect" },
	{ id: "notes", name: "Notes", type: "text" },
	{ id: "blank", name: "Blank", type: "text" },
];

function row(values: Record<string, unknown> = {}): DatabaseRow {
	return { path: "Databases/Tasks/R.md", name: "R", values, ctime: 0, mtime: 0 };
}

const r = row({
	title: "Ship it",
	current: 30,
	target: 40,
	done: true,
	due: "2026-03-05",
	tags: ["urgent", "design"],
	notes: "Hello World",
	blank: "",
});

/** Shorthand: evaluate against the standard row above. */
function f(expression: string, against: DatabaseRow = r) {
	return evaluateFormula(expression, against, props);
}

// --- the original arithmetic engine's behaviour, unchanged -----------------

test("arithmetic over property references still works", () => {
	assert.equal(f("{Current} / {Target}"), 0.75);
	assert.equal(f("({Current} + 10) * 2"), 80);
	assert.equal(f("{Current} - {Target}"), -10);
	assert.equal(f("1 + 2 * 3"), 7);
	assert.equal(f("(1 + 2) * 3"), 9);
	assert.equal(f("-{Current}"), -30);
	assert.equal(f("2 - -3"), 5);
	assert.equal(f("10 % 3"), 1);
	assert.equal(f("1 / 3"), 0.3333, "results are tidied to 4 decimals");
});

test("the historical failure modes still return null", () => {
	assert.equal(f("alert('hi')"), null, "unknown functions never run");
	assert.equal(f("{Current} / 0"), null);
	assert.equal(f("{Current} % 0"), null);
	assert.equal(f("{Current} +"), null);
	assert.equal(f("{Unknown} + 1"), 1, "a missing property counts as zero in arithmetic");
});

// --- property references ---------------------------------------------------

test("property references resolve by name, by id and case-insensitively", () => {
	assert.equal(f("{Current}"), 30);
	assert.equal(f("{current}"), 30, "id match");
	assert.equal(f("{CURRENT}"), 30, "case-insensitive name match");
	assert.equal(f("{ Current }"), 30, "surrounding whitespace is trimmed");
	assert.equal(f('prop("Current")'), 30);
	assert.equal(f('prop("current")'), 30);
	assert.equal(f("prop('Done?')"), true);
	assert.equal(f("{Done?}"), true, "names may contain punctuation");
});

test("names win over ids when the two collide", () => {
	const collide: PropertyDef[] = [
		{ id: "b", name: "a", type: "number" },
		{ id: "a", name: "b", type: "number" },
	];
	const values = row({ a: 1, b: 2 });
	// {a} is the *name* "a", which is the property stored under id "b" -> 2.
	assert.equal(evaluateFormula("{a}", values, collide), 2);
	assert.equal(evaluateFormula("{b}", values, collide), 1);
});

test("missing and empty properties behave like emptiness, not like errors", () => {
	assert.equal(f("{Nope}"), null);
	assert.equal(f('prop("Nope")'), null);
	assert.equal(f("empty({Nope})"), true);
	assert.equal(f("empty({Blank})"), true, "whitespace-only text is empty");
	assert.equal(f("notEmpty({Current})"), true);
	assert.equal(f("empty(0)"), false, "zero is a value, not emptiness");
	assert.equal(f("empty(false)"), false);
	assert.equal(f("empty({Tags})"), false);
	assert.equal(evaluateFormula("empty({Tags})", row({ tags: [] }), props), true);
});

test("property values are read defensively", () => {
	assert.equal(evaluateFormula("{Current} + 1", row({ current: NaN }), props), 1);
	assert.equal(evaluateFormula("{Current} + 1", row({ current: Infinity }), props), 1);
	assert.equal(evaluateFormula("format({Due})", row({ due: new Date(2026, 2, 5) }), props), "2026-03-05");
	assert.equal(evaluateFormula("format({Tags})", row({ tags: [1, null, "x"] }), props), "1, , x");
	assert.equal(evaluateFormula("{Current}", row({ current: { a: 1 } }), props), null);
	assert.equal(evaluateFormula("{Current}", row({}), props), null);
});

// --- literals and types ----------------------------------------------------

test("literals", () => {
	assert.equal(f("42"), 42);
	assert.equal(f("1.5"), 1.5);
	assert.equal(f(".5"), 0.5);
	assert.equal(f('"hi"'), "hi");
	assert.equal(f("'hi'"), "hi");
	assert.equal(f('"say \\"hi\\""'), 'say "hi"');
	assert.equal(f("'it\\'s'"), "it's");
	assert.equal(f('"a\\nb"'), "a\nb");
	assert.equal(f("true"), true);
	assert.equal(f("false"), false);
	assert.equal(f("TRUE"), true, "keywords are case-insensitive");
	assert.equal(f('""'), "");
});

test("string concatenation rides on +", () => {
	assert.equal(f('"a" + "b"'), "ab");
	assert.equal(f('{Name} + " (" + {Current} + ")"'), "Ship it (30)");
	assert.equal(f('"n=" + 1.5'), "n=1.5");
	assert.equal(f('"x" + true'), "xtrue");
	assert.equal(f('"x" + {Nope}'), "x", "an empty property concatenates as nothing");
	assert.equal(f('"x" + {Tags}'), "xurgent, design");
});

// --- operators and precedence ---------------------------------------------

test("precedence and associativity", () => {
	assert.equal(f("2 + 3 * 4 - 6 / 2"), 11);
	assert.equal(f("10 - 3 - 2"), 5, "left-associative");
	assert.equal(f("100 / 10 / 2"), 5);
	assert.equal(f("1 + 2 == 3"), true, "+ binds tighter than ==");
	assert.equal(f("1 < 2 == true"), true, "relational binds tighter than equality");
	assert.equal(f("true or false and false"), true, "and binds tighter than or");
	assert.equal(f("not true and true"), false, "not binds tighter than and");
	assert.equal(f("-2 * 3"), -6);
	assert.equal(f("not 1 > 0"), false, "unary not applies to 1, then 1>0... (not 1) is false");
	assert.equal(f("2 > 1 and 3 > 2"), true);
});

test("comparisons", () => {
	assert.equal(f("{Current} > {Target}"), false);
	assert.equal(f("{Current} < {Target}"), true);
	assert.equal(f("{Current} >= 30"), true);
	assert.equal(f("{Current} <= 29"), false);
	assert.equal(f("{Current} == 30"), true);
	assert.equal(f("{Current} != 30"), false);
	assert.equal(f('"abc" < "abd"'), true, "strings compare lexically");
	assert.equal(f('"2026-01-02" > "2026-01-01"'), true, "ISO dates sort lexically");
	assert.equal(f('"10" > "9"'), true, "numeric-looking strings compare numerically");
	assert.equal(f('30 == "30"'), true);
	assert.equal(f('"a" == "a"'), true);
	assert.equal(f('"a" == "b"'), false);
	assert.equal(f("true == true"), true);
	assert.equal(f("{Nope} == {Nope}"), true, "empty equals empty");
	assert.equal(f("{Nope} == 0"), false, "empty is not zero");
	assert.equal(f('{Tags} == {Tags}'), true, "lists compare element-wise");
	assert.equal(f('{Tags} == "urgent"'), false);
	assert.equal(f('"abc" > 1'), null, "an unorderable mix is an error, not a guess");
});

test("logical operators, both spellings, with short-circuiting", () => {
	assert.equal(f("true and false"), false);
	assert.equal(f("true && false"), false);
	assert.equal(f("false or true"), true);
	assert.equal(f("false || true"), true);
	assert.equal(f("not false"), true);
	assert.equal(f("!false"), true);
	assert.equal(f("!!true"), true);
	assert.equal(f("AND" === "AND" ? "true And true" : ""), true, "keyword case is ignored");
	assert.equal(f('false and ("x" * 1)'), false, "the dead branch never type-errors");
	assert.equal(f('true or ("x" * 1)'), true);
	assert.equal(f('true and ("x" * 1)'), null, "the live branch still errors");
	assert.equal(f("{Done?} and {Current} > 10"), true);
	assert.equal(f('not {Blank}'), true, "empty text is falsy");
	assert.equal(f("not 0"), true);
	assert.equal(f("not {Tags}"), false, "a non-empty list is truthy");
});

// --- functions -------------------------------------------------------------

test("if()", () => {
	assert.equal(f('if({Current} > {Target}, "over", "under")'), "under");
	assert.equal(f("if(true, 1, 2)"), 1);
	assert.equal(f("if({Done?}, {Current}, {Target})"), 30);
	assert.equal(f('if(false, 1 / 0, "safe")'), "safe", "the untaken branch is never evaluated");
	assert.equal(f('if({Blank}, "a", "b")'), "b");
	assert.equal(f("if(true, 1)"), null, "wrong arity");
	assert.equal(f("if(true, 1, 2, 3)"), null);
	assert.equal(f("if()"), null);
});

test("contains() over strings and lists", () => {
	assert.equal(f('contains({Notes}, "World")'), true);
	assert.equal(f('contains({Notes}, "world")'), false, "case-sensitive, like Notion");
	assert.equal(f('contains({Tags}, "urgent")'), true);
	assert.equal(f('contains({Tags}, "nope")'), false);
	assert.equal(f('contains({Nope}, "x")'), false);
	assert.equal(f('contains(12345, "34")'), true, "numbers are formatted first");
	assert.equal(f('contains("abc")'), null, "wrong arity");
});

test("length()", () => {
	assert.equal(f("length({Notes})"), 11);
	assert.equal(f("length({Tags})"), 2, "lists report item count");
	assert.equal(f("length({Nope})"), 0);
	assert.equal(f("length(12345)"), 5);
	assert.equal(f('length("")'), 0);
});

test("string functions", () => {
	assert.equal(f("lower({Notes})"), "hello world");
	assert.equal(f("upper({Notes})"), "HELLO WORLD");
	assert.equal(f("lower({Nope})"), "");
	assert.equal(f("slice({Notes}, 0, 5)"), "Hello");
	assert.equal(f("slice({Notes}, 6)"), "World");
	assert.equal(f("slice({Notes}, -5)"), "World", "negative indices count from the end");
	assert.equal(f("slice({Notes}, 99)"), "");
	assert.equal(f("slice({Notes}, 3, 1)"), "");
	assert.equal(f('replaceAll("a-b-c", "-", "+")'), "a+b+c");
	assert.equal(f('replaceAll("a.b.c", ".", "-")'), "a-b-c", "the needle is literal, not a regex");
	assert.equal(f('replaceAll("aaa", "", "-")'), "aaa", "an empty needle is a no-op");
	assert.equal(f('replaceAll({Notes}, "World", "there")'), "Hello there");
	assert.equal(f('replaceAll("a", "a")'), null, "wrong arity");
});

test("format() and toNumber()", () => {
	assert.equal(f("format(1.5)"), "1.5");
	assert.equal(f("format(true)"), "true");
	assert.equal(f("format({Tags})"), "urgent, design");
	assert.equal(f("format({Nope})"), "");
	assert.equal(f("format(0.1 + 0.2)"), "0.3", "floating-point noise is trimmed");
	assert.equal(f('toNumber("12")'), 12);
	assert.equal(f('toNumber("1,200")'), 1200);
	assert.equal(f('toNumber("50%")'), 50);
	assert.equal(f('toNumber("abc")'), null);
	assert.equal(f('toNumber("")'), null);
	assert.equal(f("toNumber(true)"), 1);
	assert.equal(f("toNumber(false)"), 0);
	assert.equal(f("toNumber({Nope})"), null);
	assert.equal(f("toNumber({Tags})"), null);
	assert.equal(f('toNumber("7") + 1'), 8);
});

test("numeric functions", () => {
	assert.equal(f("min(3, 1, 2)"), 1);
	assert.equal(f("max(3, 1, 2)"), 3);
	assert.equal(f("min({Current}, {Target})"), 30);
	assert.equal(f("max(-5)"), -5);
	assert.equal(f("min({Nope}, 4)"), 4, "empties are skipped");
	assert.equal(f("min({Nope})"), null, "nothing to compare");
	assert.equal(f("min()"), null, "wrong arity");
	assert.equal(f("abs(-3.5)"), 3.5);
	assert.equal(f("round(2.5)"), 3);
	assert.equal(f("round(-2.5)"), -2, "JS rounding: half away from zero towards +inf");
	assert.equal(f("floor(2.9)"), 2);
	assert.equal(f("ceil(2.1)"), 3);
	assert.equal(f("floor(-2.1)"), -3);
	assert.equal(f("abs()"), null);
	assert.equal(f('abs("x")'), null, "non-numeric input is an error");
	assert.equal(f("abs({Nope})"), null, "a missing value is not silently zero here");
});

// --- dates -----------------------------------------------------------------

test("today() and now()", () => {
	const today = f("today()");
	assert.match(String(today), /^\d{4}-\d{2}-\d{2}$/);
	const now = f("now()");
	assert.match(String(now), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
	assert.equal(f("dateBetween(today(), today(), 'days')"), 0);
	assert.equal(f("today(1)"), null, "wrong arity");
});

test("dateBetween is first argument minus second", () => {
	assert.equal(f('dateBetween("2026-03-10", "2026-03-05", "days")'), 5);
	assert.equal(f('dateBetween("2026-03-05", "2026-03-10", "days")'), -5, "the sign flips when swapped");
	assert.equal(f('dateBetween("2026-03-19", "2026-03-05", "weeks")'), 2);
	assert.equal(f('dateBetween("2026-03-18", "2026-03-05", "weeks")'), 1, "partial units truncate");
	assert.equal(f('dateBetween("2027-03-05", "2026-03-05", "years")'), 1);
	assert.equal(f('dateBetween("2027-03-04", "2026-03-05", "years")'), 0);
	assert.equal(f('dateBetween("2026-05-05", "2026-03-05", "months")'), 2);
	assert.equal(f('dateBetween("2026-05-04", "2026-03-05", "months")'), 1);
	assert.equal(f('dateBetween("2026-03-05", "2026-05-05", "months")'), -2);
	assert.equal(f('dateBetween("2026-03-05T12:00", "2026-03-05T09:30", "hours")'), 2);
	assert.equal(f('dateBetween("2026-03-05T12:00", "2026-03-05T09:30", "minutes")'), 150);
	assert.equal(f('dateBetween("2026-03-10", "2026-03-05", "day")'), 5, "singular units are accepted");
	assert.equal(f('dateBetween({Due}, "2026-03-01", "days")'), 4);
	assert.equal(f('dateBetween("2026-03-10", "2026-03-05", "fortnights")'), null);
	assert.equal(f('dateBetween("nope", "2026-03-05", "days")'), null);
	assert.equal(f('dateBetween({Nope}, "2026-03-05", "days")'), null);
	assert.equal(f('dateBetween("2026-03-10", "2026-03-05")'), null, "wrong arity");
});

test("dateAdd() and dateSubtract()", () => {
	assert.equal(f('dateAdd("2026-03-05", 3, "days")'), "2026-03-08");
	assert.equal(f('dateAdd("2026-03-05", 1, "weeks")'), "2026-03-12");
	assert.equal(f('dateAdd("2026-03-05", 1, "months")'), "2026-04-05");
	assert.equal(f('dateAdd("2026-12-31", 1, "days")'), "2027-01-01", "year rollover");
	assert.equal(f('dateSubtract("2026-03-05", 5, "days")'), "2026-02-28");
	assert.equal(f('dateSubtract("2026-03-05", 1, "years")'), "2025-03-05");
	assert.equal(f('dateAdd("2026-03-05", -1, "days")'), "2026-03-04", "negative amounts work");
	assert.equal(f('dateAdd("2026-03-05", 2, "hours")'), "2026-03-05T02:00:00", "hour maths keeps a time");
	assert.equal(f('dateAdd("2026-03-05T10:00", 1, "days")'), "2026-03-06T10:00:00", "a time on input is kept");
	assert.equal(f('dateBetween(dateAdd({Due}, 1, "days"), {Due}, "days")'), 1, "round-trips");
	assert.equal(f('dateAdd("2026-03-05", 1, "centuries")'), null);
	assert.equal(f('dateAdd("x", 1, "days")'), null);
	assert.equal(f('dateAdd("2026-03-05", "x", "days")'), null);
});

test("formatDate() tokens", () => {
	assert.equal(f('formatDate("2026-03-05", "YYYY-MM-DD")'), "2026-03-05");
	assert.equal(f('formatDate("2026-03-05", "DD/MM/YY")'), "05/03/26");
	assert.equal(f('formatDate("2026-03-05", "MMMM D, YYYY")'), "March 5, 2026");
	assert.equal(f('formatDate("2026-03-05", "MMM D")'), "Mar 5");
	assert.equal(f('formatDate("2026-03-05", "dddd")'), "Thursday");
	assert.equal(f('formatDate("2026-03-05", "ddd")'), "Thu");
	assert.equal(f('formatDate("2026-03-05T09:07:06", "HH:mm:ss")'), "09:07:06");
	assert.equal(f('formatDate("2026-03-05", "HH:mm:ss")'), "00:00:00");
	assert.equal(f('formatDate({Due}, "M/D")'), "3/5");
	assert.equal(f('formatDate("2026-03-05", "")'), "");
	assert.equal(f('formatDate("2026-03-05", "[on] dddd")'), "[on] Thursday", "unknown text passes through");
	assert.equal(f('formatDate({Nope}, "YYYY")'), null);
	assert.equal(f('formatDate("not a date", "YYYY")'), null);
	assert.equal(f('formatDate("2026-03-05")'), null, "wrong arity");
});

// --- errors, limits and hostile input --------------------------------------

test("syntax errors return null instead of throwing", () => {
	const broken = [
		"",
		"   ",
		"(",
		")",
		"()",
		"(1",
		"1)",
		"1 +",
		"+ 1",
		"* 2",
		"1 ++ 2",
		"1 2",
		"1 , 2",
		"{",
		"{Unclosed",
		"}",
		"{}",
		'"unterminated',
		"'unterminated",
		"1 = 2",
		"1 & 2",
		"1 | 2",
		"@",
		"#$^",
		"foo",
		"foo()",
		"foo(1, 2)",
		"if",
		"if(",
		"if(,)",
		"prop()",
		"prop({Current})",
		"prop(1)",
		'prop("a", "b")',
		"true true",
		"and",
		"not",
		"1 and",
		"upper(",
		"upper()",
		"upper(1, 2)",
		"..",
		"1..2",
		"--",
		"{Current} {Target}",
		'"a" "b"',
		"(((",
		")))",
		"if(true, 1, 2))",
		" ",
		"🙂",
	];
	for (const expression of broken) {
		assert.equal(f(expression), null, `expected null for ${JSON.stringify(expression)}`);
	}
});

test("type errors return null instead of throwing", () => {
	const bad = [
		'"abc" * 2',
		'"abc" - 1',
		"{Notes} / 2",
		"{Tags} * 2",
		"{Tags} - 1",
		'-"abc"',
		"1 / 0",
		"1 / ({Current} - 30)",
		'abs("x")',
		'round({Tags})',
		'formatDate(true, "YYYY")',
		'dateBetween(true, false, "days")',
		'slice("abc", "x")',
	];
	for (const expression of bad) {
		assert.equal(f(expression), null, `expected null for ${expression}`);
	}
});

test("non-string expressions are tolerated", () => {
	const anything = runFormula as unknown as (e: unknown, r: DatabaseRow, p: PropertyDef[]) => unknown;
	assert.equal(anything(null, r, props), null);
	assert.equal(anything(undefined, r, props), null);
	assert.equal(anything(42, r, props), null);
	assert.equal(anything({}, r, props), null);
});

test("a very long expression is rejected by the length cap", () => {
	const long = `1${" + 1".repeat(MAX_FORMULA_LENGTH)}`;
	assert.ok(long.length > MAX_FORMULA_LENGTH);
	assert.equal(f(long), null);
	// Just inside the cap it is only the token budget that stops it, still no throw.
	const nearly = `1${" + 1".repeat(200)}`;
	assert.ok(nearly.length < MAX_FORMULA_LENGTH);
	assert.equal(f(nearly), 201);
	const tokenHeavy = `1${"+1".repeat(600)}`;
	assert.ok(tokenHeavy.length < MAX_FORMULA_LENGTH);
	assert.equal(f(tokenHeavy), null, "the token budget catches what the length cap does not");
});

test("deep nesting is rejected by the depth cap rather than blowing the stack", () => {
	const shallow = `${"(".repeat(4)}1${")".repeat(4)}`;
	assert.equal(f(shallow), 1);
	const deep = `${"(".repeat(MAX_FORMULA_DEPTH)}1${")".repeat(MAX_FORMULA_DEPTH)}`;
	assert.equal(f(deep), null);
	const deepCalls = `${"upper(".repeat(MAX_FORMULA_DEPTH)}"x"${")".repeat(MAX_FORMULA_DEPTH)}`;
	assert.equal(f(deepCalls), null);
	const deepUnary = `${"-".repeat(MAX_FORMULA_DEPTH * 2)}1`;
	assert.equal(f(deepUnary), null);
	const deepNot = `${"not ".repeat(MAX_FORMULA_DEPTH * 2)}true`;
	assert.equal(f(deepNot), null);
});

test("no formula-shaped string, however hostile, throws", () => {
	const alphabet = ['{Current}', '"a"', "1", "+", "-", "*", "/", "(", ")", ",", "if", "and", "not", "==", "{", "}", "'"];
	let seed = 7;
	const next = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	for (let i = 0; i < 2000; i++) {
		let expression = "";
		const pieces = 1 + next(10);
		for (let p = 0; p < pieces; p++) expression += alphabet[next(alphabet.length)] + (next(2) ? " " : "");
		const result = f(expression);
		assert.ok(
			result === null || ["number", "string", "boolean"].includes(typeof result),
			`bad result type for ${expression}`
		);
	}
});

test("code-injection attempts evaluate to nothing", () => {
	const attacks = [
		"constructor",
		"this.constructor.constructor('return 1')()",
		"process.exit(1)",
		"require('fs')",
		"globalThis",
		"__proto__",
		'({}).__proto__',
		"eval('1+1')",
		"Function('return 1')()",
		"import('fs')",
		"`${1}`",
		"1;2",
	];
	for (const attack of attacks) {
		assert.equal(f(attack), null, `expected null for ${attack}`);
	}
	// A property named after a prototype member is still just a property.
	const odd: PropertyDef[] = [{ id: "toString", name: "toString", type: "number" }];
	assert.equal(evaluateFormula("{toString} + 1", row({ toString: 2 }), odd), 3);
	assert.equal(evaluateFormula("{constructor}", row({}), odd), null);
	assert.equal(evaluateFormula("{__proto__}", row({}), odd), null);
});

test("realistic formulas end to end", () => {
	assert.equal(f('if({Current} >= {Target}, "Done", format(round({Current} / {Target} * 100)) + "%")'), "75%");
	assert.equal(f('if(contains({Tags}, "urgent") and not {Done?}, "Escalate", "Fine")'), "Fine");
	assert.equal(f('upper(slice({Name}, 0, 4)) + "-" + formatDate({Due}, "YYYY")'), "SHIP-2026");
	assert.equal(f('if(empty({Due}), "No date", formatDate({Due}, "MMM D"))'), "Mar 5");
	assert.equal(f('max(0, {Target} - {Current}) + " to go"'), "10 to go");
});
