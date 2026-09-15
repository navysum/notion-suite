import { PropertyDef, DatabaseRow } from "../types";
import { formatDate, parseDate, toISODate } from "../utils/dates";
import { runFormula } from "./formula";
import { formatUniqueId } from "./store";
import { asText } from "../utils/text";

/**
 * Coerce a raw frontmatter value into the shape the property type expects.
 * Frontmatter is hand-editable, so every reader has to tolerate the "wrong"
 * type turning up (a string where a list belongs, "yes" for a checkbox, etc).
 */
export function coerce(prop: PropertyDef, raw: unknown): unknown {
	switch (prop.type) {
		case "uniqueid":
		case "number": {
			if (typeof raw === "number") return raw;
			if (typeof raw === "string") {
				const n = Number(raw.replace(/[,$%\s]/g, ""));
				return isNaN(n) ? null : n;
			}
			return null;
		}
		case "checkbox": {
			if (typeof raw === "boolean") return raw;
			if (typeof raw === "string") return ["true", "yes", "x", "1", "done"].includes(raw.toLowerCase());
			if (typeof raw === "number") return raw !== 0;
			return false;
		}
		case "multiselect":
		case "files":
		case "person":
		case "relation": {
			if (Array.isArray(raw)) return raw.map((v) => String(v)).filter((v) => v.length > 0);
			if (typeof raw === "string") {
				return raw
					.split(",")
					.map((v) => v.trim())
					.filter((v) => v.length > 0);
			}
			if (raw === null || raw === undefined) return [];
			return [asText(raw)];
		}
		case "date": {
			const d = parseDate(raw);
			return d ? toISODate(d) : null;
		}
		default: {
			if (raw === null || raw === undefined) return null;
			if (Array.isArray(raw)) return raw.join(", ");
			return typeof raw === "string" ? raw : asText(raw);
		}
	}
}

export function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "string") return value.trim().length === 0;
	return false;
}

/** Human-readable rendering, used by table cells, cards and chart labels. */
export function formatValue(prop: PropertyDef, value: unknown): string {
	if (isEmpty(value) && prop.type !== "checkbox") return "";
	switch (prop.type) {
		case "number": {
			const n = Number(value);
			if (isNaN(n)) return "";
			if (prop.numberFormat === "percent") return `${round(n * 100)}%`;
			if (prop.numberFormat === "currency") return `$${round(n).toLocaleString()}`;
			return String(round(n));
		}
		case "checkbox":
			return value ? "Yes" : "No";
		case "date":
		case "created":
		case "updated":
			return formatDate(value);
		case "multiselect":
		case "files":
		case "person":
		case "relation":
			return (value as string[]).join(", ");
		case "rollup":
			return formatRollup(prop, value);
		case "uniqueid":
			return formatUniqueId(prop, value);
		default:
			return String(value);
	}
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * A rollup's result type depends on its function, not on the property: a sum is
 * a number, "show original" is a list, and an earliest date is a date string.
 */
function formatRollup(prop: PropertyDef, value: unknown): string {
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "number") {
		const how = prop.rollupFunction ?? "";
		if (how.startsWith("percent_")) return `${round(value)}%`;
		if (how === "date_range") return `${round(value)} days`;
		if (prop.numberFormat === "currency") return `$${round(value).toLocaleString()}`;
		return String(round(value));
	}
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
	return String(value);
}

/** Sort comparator shared by every view and by chart ordering. */
export function compareValues(prop: PropertyDef, a: unknown, b: unknown): number {
	const aEmpty = isEmpty(a);
	const bEmpty = isEmpty(b);
	// Empties always sink to the bottom, whichever direction is being sorted.
	if (aEmpty && bEmpty) return 0;
	if (aEmpty) return 1;
	if (bEmpty) return -1;

	switch (prop.type) {
		case "number":
		case "uniqueid":
			return Number(a) - Number(b);
		case "checkbox":
			return (a ? 1 : 0) - (b ? 1 : 0);
		case "date":
		case "created":
		case "updated": {
			const da = parseDate(a);
			const db = parseDate(b);
			if (!da || !db) return 0;
			return da.getTime() - db.getTime();
		}
		case "rollup": {
			// Most rollups produce numbers; the rest sort as text.
			if (typeof a === "number" && typeof b === "number") return a - b;
			if (Array.isArray(a) && Array.isArray(b)) {
				return a.join(", ").localeCompare(b.join(", "), undefined, { sensitivity: "base" });
			}
			return String(a).localeCompare(String(b), undefined, {
				numeric: true,
				sensitivity: "base",
			});
		}
		default:
			return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
	}
}

/**
 * Evaluate a formula property for one row.
 *
 * The language itself lives in `db/formula.ts`; this stays as the entry point
 * every caller already uses.
 */
export function evaluateFormula(
	expression: string,
	row: DatabaseRow,
	properties: PropertyDef[]
): number | string | boolean | null {
	return runFormula(expression, row, properties);
}
