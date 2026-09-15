import { PropertyDef, DatabaseRow } from "../types";
import { formatDate, parseDate, toISODate } from "../utils/dates";
import { asText } from "../utils/text";

/**
 * Coerce a raw frontmatter value into the shape the property type expects.
 * Frontmatter is hand-editable, so every reader has to tolerate the "wrong"
 * type turning up (a string where a list belongs, "yes" for a checkbox, etc).
 */
export function coerce(prop: PropertyDef, raw: unknown): unknown {
	switch (prop.type) {
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
 * A deliberately small formula language: property references in `{Braces}`,
 * numbers, and the four arithmetic operators with parentheses. It covers the
 * common Notion formulas (totals, ratios, differences) without shipping an
 * expression interpreter that could evaluate arbitrary code.
 */
export function evaluateFormula(
	expression: string,
	row: DatabaseRow,
	properties: PropertyDef[]
): number | string | null {
	const substituted = expression.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
		const name = rawName.trim();
		const prop = properties.find((p) => p.name === name || p.id === name);
		if (!prop) return "0";
		const value = row.values[prop.id];
		if (prop.type === "checkbox") return value ? "1" : "0";
		const n = Number(value);
		return isNaN(n) ? "0" : String(n);
	});

	if (!/^[-+*/(). 0-9]+$/.test(substituted)) return null;
	try {
		const result = evaluateArithmetic(substituted);
		return result === null || !isFinite(result) ? null : Math.round(result * 10000) / 10000;
	} catch {
		return null;
	}
}

/** Recursive-descent arithmetic evaluator (no eval, no Function constructor). */
function evaluateArithmetic(input: string): number | null {
	let pos = 0;
	const src = input.replace(/\s+/g, "");

	function parseExpression(): number | null {
		let left = parseTerm();
		if (left === null) return null;
		while (pos < src.length && (src[pos] === "+" || src[pos] === "-")) {
			const op = src[pos++];
			const right = parseTerm();
			if (right === null) return null;
			left = op === "+" ? left + right : left - right;
		}
		return left;
	}

	function parseTerm(): number | null {
		let left = parseFactor();
		if (left === null) return null;
		while (pos < src.length && (src[pos] === "*" || src[pos] === "/")) {
			const op = src[pos++];
			const right = parseFactor();
			if (right === null) return null;
			if (op === "/" && right === 0) return null;
			left = op === "*" ? left * right : left / right;
		}
		return left;
	}

	function parseFactor(): number | null {
		if (src[pos] === "-") {
			pos++;
			const inner = parseFactor();
			return inner === null ? null : -inner;
		}
		if (src[pos] === "(") {
			pos++;
			const inner = parseExpression();
			if (src[pos] !== ")") return null;
			pos++;
			return inner;
		}
		const start = pos;
		while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
		if (start === pos) return null;
		const n = Number(src.slice(start, pos));
		return isNaN(n) ? null : n;
	}

	const value = parseExpression();
	return pos === src.length ? value : null;
}
