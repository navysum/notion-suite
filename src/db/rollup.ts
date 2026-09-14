import {
	DatabaseRow,
	DatabaseSchema,
	PropertyDef,
	RollupFunction,
	ROLLUP_TITLE_KEY,
} from "../types";
import { isEmpty } from "./value";
import { parseDate, toISODate } from "../utils/dates";

/**
 * Rollups: follow a relation, gather one property off every related row, then
 * collapse those values into a single number, date or list.
 *
 * The gathering and the collapsing are kept separate from the traversal (which
 * lives in `resolve.ts`) so this file stays pure and testable.
 */

/** Index a database's rows by title, for resolving relation values. */
export function indexByName(rows: DatabaseRow[]): Map<string, DatabaseRow> {
	const index = new Map<string, DatabaseRow>();
	for (const row of rows) {
		// First writer wins, so a duplicate title cannot silently shadow the
		// row that a relation was originally pointing at.
		const key = row.name.toLowerCase();
		if (!index.has(key)) index.set(key, row);
	}
	return index;
}

/**
 * Resolve a relation cell into the rows it points at.
 *
 * Relation values are stored as note titles, optionally written as wikilinks,
 * because that is what survives a vault sync and what a human would type.
 */
export function relatedRows(
	relationValue: unknown,
	index: Map<string, DatabaseRow>
): DatabaseRow[] {
	const names = Array.isArray(relationValue)
		? relationValue.map(String)
		: isEmpty(relationValue)
			? []
			: [String(relationValue)];

	const found: DatabaseRow[] = [];
	for (const raw of names) {
		// Accept `[[Note]]`, `[[Note|alias]]` and a bare title alike.
		const name = raw
			.replace(/^!?\[\[/, "")
			.replace(/\]\]$/, "")
			.split("|")[0]
			.split("#")[0]
			.trim();
		if (!name) continue;
		const row = index.get(name.toLowerCase());
		if (row) found.push(row);
	}
	return found;
}

/** Pull the rolled-up property off each related row, flattening list values. */
export function gatherValues(
	rows: DatabaseRow[],
	targetProperty: string | undefined
): unknown[] {
	const values: unknown[] = [];
	for (const row of rows) {
		if (!targetProperty || targetProperty === ROLLUP_TITLE_KEY) {
			values.push(row.name);
			continue;
		}
		const value = row.values[targetProperty];
		// A multi-select on the far side contributes each of its values, so
		// "count unique" over related tags counts tags rather than rows.
		if (Array.isArray(value)) values.push(...value);
		else values.push(value);
	}
	return values;
}

function numbers(values: unknown[]): number[] {
	const out: number[] = [];
	for (const value of values) {
		if (typeof value === "boolean") {
			out.push(value ? 1 : 0);
			continue;
		}
		if (isEmpty(value)) continue;
		const n = Number(value);
		if (!isNaN(n)) out.push(n);
	}
	return out;
}

function dates(values: unknown[]): Date[] {
	const out: Date[] = [];
	for (const value of values) {
		const date = parseDate(value);
		if (date) out.push(date);
	}
	return out;
}

function round(n: number): number {
	return Math.round(n * 10000) / 10000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Collapse gathered values into the rollup's result.
 *
 * `rowCount` is the number of related rows, which is deliberately not the same
 * as `values.length`: a multi-select on the far side yields several values per
 * row, and "count all" means rows.
 */
export function collapse(
	values: unknown[],
	rowCount: number,
	how: RollupFunction
): unknown {
	const nonEmpty = values.filter((v) => !isEmpty(v));
	const emptyCount = values.length - nonEmpty.length;

	switch (how) {
		case "show_original":
			return nonEmpty.map((v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)));

		case "count_all":
			return rowCount;
		case "count_values":
			return values.length;
		case "count_unique":
			return new Set(nonEmpty.map((v) => String(v))).size;
		case "count_empty":
			return emptyCount;
		case "count_not_empty":
			return nonEmpty.length;
		case "percent_empty":
			return values.length === 0 ? null : round((emptyCount / values.length) * 100);
		case "percent_not_empty":
			return values.length === 0 ? null : round((nonEmpty.length / values.length) * 100);

		case "sum": {
			const list = numbers(values);
			return list.length === 0 ? null : round(list.reduce((a, b) => a + b, 0));
		}
		case "average": {
			const list = numbers(values);
			return list.length === 0 ? null : round(list.reduce((a, b) => a + b, 0) / list.length);
		}
		case "median": {
			const list = numbers(values).sort((a, b) => a - b);
			if (list.length === 0) return null;
			const mid = Math.floor(list.length / 2);
			return round(list.length % 2 === 0 ? (list[mid - 1] + list[mid]) / 2 : list[mid]);
		}
		case "min": {
			const list = numbers(values);
			return list.length === 0 ? null : round(Math.min(...list));
		}
		case "max": {
			const list = numbers(values);
			return list.length === 0 ? null : round(Math.max(...list));
		}
		case "range": {
			const list = numbers(values);
			return list.length === 0 ? null : round(Math.max(...list) - Math.min(...list));
		}

		case "earliest": {
			const list = dates(values);
			if (list.length === 0) return null;
			return toISODate(new Date(Math.min(...list.map((d) => d.getTime()))));
		}
		case "latest": {
			const list = dates(values);
			if (list.length === 0) return null;
			return toISODate(new Date(Math.max(...list.map((d) => d.getTime()))));
		}
		case "date_range": {
			const list = dates(values).map((d) => d.getTime());
			if (list.length === 0) return null;
			return Math.round((Math.max(...list) - Math.min(...list)) / DAY_MS);
		}

		case "checked":
			return values.filter((v) => v === true).length;
		case "unchecked":
			return values.filter((v) => v === false).length;
		case "percent_checked": {
			if (values.length === 0) return null;
			return round((values.filter((v) => v === true).length / values.length) * 100);
		}
		case "percent_unchecked": {
			if (values.length === 0) return null;
			return round((values.filter((v) => v !== true).length / values.length) * 100);
		}

		default:
			return null;
	}
}

/** Whether a rollup's result should be treated as a number by sorts and charts. */
export function isNumericRollup(how: RollupFunction | undefined): boolean {
	if (!how) return false;
	return !["show_original", "earliest", "latest"].includes(how);
}

/**
 * Compute one rollup cell.
 * Returns null when the rollup is not fully configured, which renders as an
 * empty cell rather than an error -- a half-configured property is a normal
 * intermediate state while the user is setting one up.
 */
export function computeRollup(
	def: PropertyDef,
	relationValue: unknown,
	index: Map<string, DatabaseRow>
): unknown {
	if (!def.rollupRelation || !def.rollupFunction) return null;
	const rows = relatedRows(relationValue, index);
	const values = gatherValues(rows, def.rollupProperty);
	return collapse(values, rows.length, def.rollupFunction);
}

/** The relation property a rollup follows, if it is still present. */
export function rollupRelationProperty(
	schema: DatabaseSchema,
	def: PropertyDef
): PropertyDef | undefined {
	if (!def.rollupRelation) return undefined;
	return schema.properties.find(
		(p) => p.id === def.rollupRelation && p.type === "relation"
	);
}
