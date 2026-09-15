import {
	DatabaseRow,
	DatabaseSchema,
	FilterGroup,
	FilterRule,
	PropertyDef,
	SortRule,
} from "../types";
import { compareValues, isEmpty } from "./value";
import { parseDate } from "../utils/dates";
import { asKey } from "../utils/text";

export function findProperty(schema: DatabaseSchema, key: string): PropertyDef | undefined {
	const needle = key.trim().toLowerCase();
	return schema.properties.find(
		(p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle
	);
}

function matchesRule(schema: DatabaseSchema, row: DatabaseRow, rule: FilterRule): boolean {
	// `Name` is not a frontmatter key -- it is the note's own title.
	const isName = rule.property.trim().toLowerCase() === "name";
	const prop = findProperty(schema, rule.property);
	if (!prop && !isName) return true;

	const actual = isName ? row.name : row.values[prop!.id];
	const expected = rule.value;

	switch (rule.operator) {
		case "is_empty":
			return isEmpty(actual);
		case "is_not_empty":
			return !isEmpty(actual);
	}

	if (Array.isArray(actual)) {
		const list = actual.map(asKey);
		const needle = asKey(expected);
		switch (rule.operator) {
			case "contains":
			case "is":
				return list.includes(needle);
			case "not_contains":
			case "is_not":
				return !list.includes(needle);
			default:
				return true;
		}
	}

	switch (rule.operator) {
		case "is":
			return looseEquals(actual, expected);
		case "is_not":
			return !looseEquals(actual, expected);
		case "contains":
			return asKey(actual).includes(asKey(expected));
		case "not_contains":
			return !asKey(actual).includes(asKey(expected));
		case "starts_with":
			return asKey(actual).startsWith(asKey(expected));
		case "ends_with":
			return asKey(actual).endsWith(asKey(expected));
		case "gt":
			return Number(actual) > Number(expected);
		case "gte":
			return Number(actual) >= Number(expected);
		case "lt":
			return Number(actual) < Number(expected);
		case "lte":
			return Number(actual) <= Number(expected);
		case "before":
		case "after":
		case "on_or_before":
		case "on_or_after":
			return compareDates(actual, expected, rule.operator);
		default:
			return true;
	}
}

function looseEquals(actual: unknown, expected: unknown): boolean {
	if (typeof actual === "boolean") {
		const want = typeof expected === "boolean"
			? expected
			: ["true", "yes", "checked", "1"].includes(asKey(expected));
		return actual === want;
	}
	if (isEmpty(actual) && isEmpty(expected)) return true;
	return asKey(actual) === asKey(expected);
}

function compareDates(actual: unknown, expected: unknown, op: string): boolean {
	const a = parseDate(actual);
	// `today` is accepted wherever a literal date is, matching Notion's relative filters.
	const b = String(expected).toLowerCase() === "today" ? new Date() : parseDate(expected);
	if (!a || !b) return false;
	const at = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
	const bt = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
	switch (op) {
		case "before":
			return at < bt;
		case "after":
			return at > bt;
		case "on_or_before":
			return at <= bt;
		case "on_or_after":
			return at >= bt;
		default:
			return false;
	}
}

export function applyFilter(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	filter?: FilterGroup
): DatabaseRow[] {
	if (!filter || filter.rules.length === 0) return rows;
	return rows.filter((row) => {
		const results = filter.rules.map((rule) => matchesRule(schema, row, rule));
		return filter.conjunction === "or" ? results.some(Boolean) : results.every(Boolean);
	});
}

export function applySorts(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	sorts?: SortRule[]
): DatabaseRow[] {
	if (!sorts || sorts.length === 0) return rows;
	const sorted = [...rows];
	sorted.sort((a, b) => {
		for (const sort of sorts) {
			const isName = sort.property.trim().toLowerCase() === "name";
			const prop = findProperty(schema, sort.property);
			if (!prop && !isName) continue;
			const descriptor: PropertyDef = prop ?? { id: "name", name: "Name", type: "text" };
			const av = isName ? a.name : a.values[descriptor.id];
			const bv = isName ? b.name : b.values[descriptor.id];
			const cmp = compareValues(descriptor, av, bv);
			if (cmp !== 0) return sort.direction === "desc" ? -cmp : cmp;
		}
		return 0;
	});
	return sorted;
}

export interface RowGroup {
	key: string;
	label: string;
	rows: DatabaseRow[];
}

/**
 * Group rows for the board view. Multi-select rows legitimately belong to
 * several columns at once, so they are emitted into each of them.
 */
export function groupRows(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	groupBy: string
): RowGroup[] {
	const prop = findProperty(schema, groupBy);
	const buckets = new Map<string, DatabaseRow[]>();
	const push = (key: string, row: DatabaseRow) => {
		const existing = buckets.get(key);
		if (existing) existing.push(row);
		else buckets.set(key, [row]);
	};

	// Seed with the configured options so empty columns still render.
	if (prop?.options) {
		for (const option of prop.options) buckets.set(option.name, []);
	}

	for (const row of rows) {
		const value = prop ? row.values[prop.id] : undefined;
		if (Array.isArray(value)) {
			if (value.length === 0) push("", row);
			else for (const v of value) push(String(v), row);
		} else if (isEmpty(value)) {
			push("", row);
		} else if (typeof value === "boolean") {
			push(value ? "Checked" : "Unchecked", row);
		} else {
			push(String(value), row);
		}
	}

	const groups: RowGroup[] = [];
	for (const [key, groupRowsList] of buckets) {
		groups.push({ key, label: key === "" ? "No value" : key, rows: groupRowsList });
	}
	// Empty-value column last, mirroring Notion's board layout.
	groups.sort((a, b) => {
		if (a.key === "" ) return 1;
		if (b.key === "") return -1;
		return 0;
	});
	return groups;
}

export function queryRows(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	filter?: FilterGroup,
	sorts?: SortRule[],
	limit?: number
): DatabaseRow[] {
	let result = applyFilter(schema, rows, filter);
	result = applySorts(schema, result, sorts);
	if (limit && limit > 0) result = result.slice(0, limit);
	return result;
}
