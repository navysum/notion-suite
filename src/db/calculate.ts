import { DatabaseRow, PropertyDef, RollupFunction, ROLLUP_FUNCTION_LABELS } from "../types";
import { collapse } from "./rollup";
import { asText } from "../utils/text";
import { formatCurrency } from "./currency";

/**
 * Column footers — the "Calculate" row under a table.
 *
 * This is the same aggregation a rollup performs, applied down a column
 * instead of across a relation, so it delegates to `collapse` rather than
 * growing a second implementation that could drift from it.
 */

/** Calculations worth offering for a given property type. */
export function calculationsFor(prop: PropertyDef): RollupFunction[] {
	const universal: RollupFunction[] = [
		"count_all",
		"count_values",
		"count_unique",
		"count_empty",
		"count_not_empty",
		"percent_empty",
		"percent_not_empty",
	];

	switch (prop.type) {
		case "number":
		case "formula":
		case "rollup":
			return [...universal, "sum", "average", "median", "min", "max", "range"];
		case "date":
		case "created":
		case "updated":
			return [...universal, "earliest", "latest", "date_range"];
		case "checkbox":
			return [...universal, "checked", "unchecked", "percent_checked", "percent_unchecked"];
		default:
			return universal;
	}
}

/**
 * Run one column's calculation over the rows a view is currently showing.
 *
 * Deliberately takes the filtered rows, not every row in the database: a
 * footer that ignored the view's filter would contradict the numbers above it.
 */
export function calculateColumn(
	rows: DatabaseRow[],
	prop: PropertyDef,
	how: RollupFunction
): unknown {
	const values: unknown[] = [];
	for (const row of rows) {
		const value = row.values[prop.id];
		// A list property contributes each of its values, matching how the
		// same aggregation behaves when a rollup gathers one.
		if (Array.isArray(value)) {
			const items = value as unknown[];
			if (items.length === 0) values.push(null);
			else values.push(...items);
		} else {
			values.push(value);
		}
	}
	return collapse(values, rows.length, how);
}

/** Short label shown in the footer cell, e.g. "Sum" or "Percent checked". */
export function calculationLabel(how: RollupFunction): string {
	return ROLLUP_FUNCTION_LABELS[how];
}

/**
 * Aggregations whose result is still in the property's own units, so a currency
 * property's sum is money but its count is just a number.
 */
const KEEPS_UNITS: RollupFunction[] = ["sum", "average", "median", "min", "max", "range"];

/** Render a calculation result as text. */
export function formatCalculation(
	how: RollupFunction,
	value: unknown,
	prop?: PropertyDef
): string {
	if (value === null || value === undefined) return "—";
	if (Array.isArray(value)) return String(value.length);
	if (typeof value === "number") {
		const rounded = Math.round(value * 100) / 100;
		if (how.startsWith("percent_")) return `${rounded}%`;
		if (how === "date_range") return `${rounded} days`;
		// A sum of money is money. Counts are not, so only the aggregations that
		// stay in the property's own units carry its currency.
		if (prop?.numberFormat === "currency" && KEEPS_UNITS.includes(how)) {
			return formatCurrency(rounded, prop.currency);
		}
		return String(rounded);
	}
	return asText(value);
}
