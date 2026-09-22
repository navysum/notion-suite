/**
 * Money.
 *
 * Currency-formatted numbers were hard-coded to a dollar sign, which is wrong
 * for most of the people using this and silently wrong: a UK budget rendered as
 * `$1,500` looks like a working number rather than a bug.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { CURRENCIES, defaultCurrency, formatCurrency } from "../src/db/currency";
import { formatValue } from "../src/db/value";
import { formatCalculation } from "../src/db/calculate";
import { PropertyDef } from "../src/types";

const money = (currency?: string): PropertyDef => ({
	id: "amount",
	name: "Amount",
	type: "number",
	numberFormat: "currency",
	currency,
});

test("the symbol follows the currency, not the dollar", () => {
	assert.match(formatCurrency(1500, "GBP", "en-GB"), /£/);
	assert.match(formatCurrency(1500, "EUR", "de-DE"), /€/);
	assert.match(formatCurrency(1500, "INR", "en-IN"), /₹/);
	// Japanese renders the yen fullwidth; both are the yen sign.
	assert.match(formatCurrency(1500, "JPY", "ja-JP"), /[¥￥]/);
	assert.ok(!formatCurrency(1500, "GBP", "en-GB").includes("$"));
});

/** It is not only the symbol: placement and separators differ too. */
test("the whole convention follows the locale, not just the symbol", () => {
	const german = formatCurrency(1500.5, "EUR", "de-DE");
	// German puts the symbol last and swaps the separators.
	assert.ok(german.trimEnd().endsWith("€"), german);
	assert.ok(german.includes("1.500"), german);
});

test("a round amount shows no decimals, a fractional one keeps them", () => {
	assert.equal(formatCurrency(419, "USD", "en-US"), "$419");
	assert.equal(formatCurrency(419.5, "USD", "en-US"), "$419.50");
});

test("a currency with no minor unit never grows one", () => {
	for (const zeroDecimal of ["JPY", "KRW", "VND", "CLP"]) {
		assert.ok(
			!formatCurrency(1500, zeroDecimal, "en-GB").includes("."),
			`${zeroDecimal} showed decimals`
		);
		assert.ok(
			!formatCurrency(1500.75, zeroDecimal, "en-GB").includes("."),
			`${zeroDecimal} gained decimals on a fractional amount`
		);
	}
});

/** `$419.5` is not a price. Money shows no decimals or all of them. */
test("a fractional amount shows the full minor unit, not a single digit", () => {
	assert.equal(formatCurrency(419.5, "USD", "en-US"), "$419.50");
	assert.equal(formatCurrency(419.5, "GBP", "en-GB"), "£419.50");
	assert.equal(formatCurrency(1500.4, "EUR", "en-IE"), "€1,500.40");
});

test("an unknown code falls back rather than throwing inside a cell", () => {
	const out = formatCurrency(10, "NOTACURRENCY", "en-GB");
	assert.ok(out.length > 0);
	assert.ok(out.includes("10"));
});

test("the default is taken from the locale's region", () => {
	assert.equal(defaultCurrency("en-GB"), "GBP");
	assert.equal(defaultCurrency("de-DE"), "EUR");
	assert.equal(defaultCurrency("en-IN"), "INR");
	assert.equal(defaultCurrency("ja-JP"), "JPY");
	assert.equal(defaultCurrency("en-US"), "USD");
});

test("a locale with no region falls back to the dollar rather than nothing", () => {
	assert.equal(defaultCurrency("en"), "USD");
});

test("every offered currency actually formats", () => {
	for (const entry of CURRENCIES) {
		const out = formatCurrency(1234.5, entry.code, "en-GB");
		assert.ok(out.length > 0, `${entry.code} produced nothing`);
	}
});

/* ------------------------------------------------- where it has to show up */

test("a table cell formats in the property's currency", () => {
	assert.match(formatValue(money("GBP"), 1500), /£/);
	assert.match(formatValue(money("EUR"), 1500), /€/);
});

test("a property with no currency set still formats as money", () => {
	const out = formatValue(money(), 1500);
	assert.ok(/\d/.test(out), out);
	assert.notEqual(out, "1500");
});

/**
 * A sum of money is money; a count of rows is not. Only the aggregations that
 * stay in the property's own units should carry its symbol.
 */
test("a column total is money, but a count is a number", () => {
	assert.match(formatCalculation("sum", 2500, money("GBP")), /£/);
	assert.match(formatCalculation("average", 500, money("GBP")), /£/);
	assert.equal(formatCalculation("count_all", 5, money("GBP")), "5");
	assert.equal(formatCalculation("count_not_empty", 3, money("GBP")), "3");
});

test("a percentage stays a percentage whatever the property", () => {
	assert.equal(formatCalculation("percent_checked", 60, money("GBP")), "60%");
});

test("a total on a plain number property gains no symbol", () => {
	const plain: PropertyDef = { id: "n", name: "N", type: "number" };
	assert.equal(formatCalculation("sum", 2500, plain), "2500");
});
