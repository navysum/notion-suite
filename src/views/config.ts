import { parseYaml } from "obsidian";
import {
	ChartConfig,
	ChartKind,
	FilterGroup,
	FilterOperator,
	FilterRule,
	SortRule,
	ViewConfig,
	ViewType,
	Aggregation,
	RollupFunction,
	ROLLUP_FUNCTIONS,
	FilterNode,
	MAX_FILTER_DEPTH,
	isFilterGroup,
} from "../types";
import { asKey, asText } from "../utils/text";

/**
 * Filter shorthand, longest phrase first so that "is not empty" is never
 * shredded into "is" + "not empty".
 */
const OPERATOR_PHRASES: Array<[string, FilterOperator]> = [
	["is not empty", "is_not_empty"],
	["is empty", "is_empty"],
	["does not contain", "not_contains"],
	["not contains", "not_contains"],
	["starts with", "starts_with"],
	["ends with", "ends_with"],
	["on or before", "on_or_before"],
	["on or after", "on_or_after"],
	["is not", "is_not"],
	["contains", "contains"],
	["before", "before"],
	["after", "after"],
	[">=", "gte"],
	["<=", "lte"],
	["!=", "is_not"],
	["is", "is"],
	[">", "gt"],
	["<", "lt"],
	["=", "is"],
];

const NO_VALUE_OPERATORS: FilterOperator[] = ["is_empty", "is_not_empty"];

/** Parse `Status is not Done` / `Priority >= 3` into a rule. */
export function parseFilterShorthand(input: string): FilterRule | null {
	const text = input.trim();
	if (!text) return null;

	for (const [phrase, operator] of OPERATOR_PHRASES) {
		// Word-ish operators need surrounding spaces; symbols do not.
		const isWord = /^[a-z ]+$/.test(phrase);
		const needle = isWord ? ` ${phrase} ` : phrase;
		const padded = isWord ? `${text} ` : text;
		const index = padded.toLowerCase().indexOf(needle);
		if (index <= 0) continue;

		const property = padded.slice(0, index).trim();
		const rest = padded.slice(index + needle.length).trim();
		if (!property) continue;
		if (NO_VALUE_OPERATORS.includes(operator)) return { property, operator };
		return { property, operator, value: castScalar(rest) };
	}
	return null;
}

function castScalar(raw: string): string | number | boolean {
	const text = raw.replace(/^["']|["']$/g, "").trim();
	if (text.toLowerCase() === "true" || text.toLowerCase() === "yes") return true;
	if (text.toLowerCase() === "false" || text.toLowerCase() === "no") return false;
	if (text !== "" && !isNaN(Number(text))) return Number(text);
	return text;
}

/** Parse `Due asc` / `-Priority` / `Name` into a sort rule. */
export function parseSortShorthand(input: string): SortRule | null {
	const text = input.trim();
	if (!text) return null;
	if (text.startsWith("-")) return { property: text.slice(1).trim(), direction: "desc" };
	const match = text.match(/^(.*?)\s+(asc|ascending|desc|descending)$/i);
	if (match) {
		return {
			property: match[1].trim(),
			direction: match[2].toLowerCase().startsWith("desc") ? "desc" : "asc",
		};
	}
	return { property: text, direction: "asc" };
}

function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return (value as unknown[]).map(asText).filter(Boolean);
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

/**
 * Parse one entry of a filter list.
 *
 * An entry is either a rule in plain English, a parenthesised expression, or
 * a nested `{any: [...]}` / `{all: [...]}` object. Depth is capped so a
 * pathological block cannot recurse without end.
 */
function parseFilterNode(raw: unknown, depth: number): FilterNode | null {
	if (depth > MAX_FILTER_DEPTH) return null;

	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		const obj = raw as Record<string, unknown>;
		const any = obj.any ?? obj.or;
		const all = obj.all ?? obj.and;
		const source = any ?? all;
		if (source === undefined) return null;
		const conjunction: "and" | "or" = any !== undefined ? "or" : "and";
		const rules = (Array.isArray(source) ? (source as unknown[]) : [source])
			.map((child) => parseFilterNode(child, depth + 1))
			.filter((node): node is FilterNode => node !== null);
		return rules.length > 0 ? { conjunction, rules } : null;
	}

	const text = asText(raw).trim();
	if (!text) return null;
	// `(A or B)` and `A and (B or C)` written inline.
	const inline = parseInlineGroup(text, depth);
	if (inline) return inline;
	return parseFilterShorthand(text);
}

/**
 * Parse an inline boolean expression such as `(Priority is High or Priority is
 * Urgent)`, splitting on the top-level connective only so that a nested group
 * is handed to the next level down intact.
 */
function parseInlineGroup(text: string, depth: number): FilterNode | null {
	if (depth > MAX_FILTER_DEPTH) return null;

	let body = text.trim();
	// Peel one fully-wrapping pair of brackets: "(A or B)" -> "A or B".
	while (body.startsWith("(") && matchingParen(body, 0) === body.length - 1) {
		body = body.slice(1, -1).trim();
	}

	for (const conjunction of ["or", "and"] as const) {
		const parts = splitTopLevel(body, conjunction);
		if (parts.length < 2) continue;
		const rules = parts
			.map((part) => parseFilterNode(part, depth + 1))
			.filter((node): node is FilterNode => node !== null);
		if (rules.length >= 2) return { conjunction, rules };
	}

	return body === text.trim() ? null : parseFilterShorthand(body);
}

/** Index of the bracket closing the one at `from`, or -1. */
function matchingParen(text: string, from: number): number {
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/** Split on a connective, ignoring occurrences inside brackets. */
function splitTopLevel(text: string, conjunction: "and" | "or"): string[] {
	const parts: string[] = [];
	const needle = ` ${conjunction} `;
	let depth = 0;
	let start = 0;
	const lower = text.toLowerCase();
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")") depth--;
		else if (depth === 0 && lower.startsWith(needle, i)) {
			parts.push(text.slice(start, i).trim());
			i += needle.length - 1;
			start = i + 1;
		}
	}
	parts.push(text.slice(start).trim());
	return parts.filter(Boolean);
}

/**
 * Parse the filter editor's textarea, one node per line.
 *
 * This shares `parseFilters` with the code-block path on purpose. The textarea
 * is filled by `filterToText`, which puts a nested filter on a single line as
 * `(A or B) and C`; parsing a line with `parseFilterShorthand` alone would read
 * that as a single rule named "(A" and silently change which rows match.
 */
export function parseFilterLines(text: string): FilterGroup | undefined {
	return parseFilters(
		text
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
	);
}

function parseFilters(raw: unknown): FilterGroup | undefined {
	if (!raw) return undefined;

	if (!Array.isArray(raw) && typeof raw === "object") {
		const node = parseFilterNode(raw, 0);
		if (!node) return undefined;
		return isFilterGroup(node) ? node : { conjunction: "and", rules: [node] };
	}

	const rules = (Array.isArray(raw) ? (raw as unknown[]) : [raw])
		.map((entry) => parseFilterNode(entry, 0))
		.filter((node): node is FilterNode => node !== null);
	if (rules.length === 0) return undefined;
	// One entry that is already a group is the filter; wrapping it in another
	// AND group would add a level that means nothing.
	if (rules.length === 1 && isFilterGroup(rules[0])) return rules[0];
	return { conjunction: "and", rules };
}

/** Inverse of `parseFilterShorthand`, for showing a saved filter in the editor. */
const OPERATOR_TEXT: Record<FilterOperator, string> = {
	is: "is",
	is_not: "is not",
	contains: "contains",
	not_contains: "does not contain",
	starts_with: "starts with",
	ends_with: "ends with",
	is_empty: "is empty",
	is_not_empty: "is not empty",
	gt: ">",
	gte: ">=",
	lt: "<",
	lte: "<=",
	before: "before",
	after: "after",
	on_or_before: "on or before",
	on_or_after: "on or after",
};

export function ruleToText(rule: FilterRule): string {
	const head = `${rule.property} ${OPERATOR_TEXT[rule.operator]}`;
	return rule.value === undefined ? head : `${head} ${rule.value}`;
}

/**
 * Render a filter tree as text.
 *
 * A flat AND group is one rule per line, which is what most filters are and
 * what the settings dialog shows. A nested group becomes a parenthesised
 * expression on one line, so it survives a round trip through the editor.
 */
export function filterToText(group: FilterGroup | undefined): string {
	if (!group) return "";
	if (group.rules.every((node) => !isFilterGroup(node)) && group.conjunction === "and") {
		return group.rules.map((node) => ruleToText(node as FilterRule)).join("\n");
	}
	// Anything else goes on ONE line. Splitting it across lines and prefixing
	// the connective would not parse back: each line is read as an independent
	// rule, so a leading "and (...)" becomes a nonsense rule and the filter
	// silently starts matching different rows.
	return group.rules.map(nodeToText).join(` ${group.conjunction} `);
}

function nodeToText(node: FilterNode): string {
	if (!isFilterGroup(node)) return ruleToText(node);
	const inner = node.rules.map(nodeToText).join(` ${node.conjunction} `);
	return `(${inner})`;
}

const VIEW_TYPES: ViewType[] = ["table", "board", "gallery", "list", "calendar", "timeline"];

/** Read `limits: {Doing: 3}` into a lookup. */
function parseLimits(raw: unknown): Record<string, number> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const n = Number(value);
		if (Number.isFinite(n) && n > 0) out[key] = n;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** Read `calculate: {hours: sum, done: percent_checked}` into a lookup. */
function parseCalculations(raw: unknown): Record<string, RollupFunction> | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, RollupFunction> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const how = asKey(value).replace(/\s+/g, "_");
		if (ROLLUP_FUNCTIONS.includes(how as RollupFunction)) out[key] = how as RollupFunction;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export interface ParsedViewBlock {
	config: ViewConfig | null;
	error?: string;
}

/** Turn the body of a ```notion-db block into a view configuration. */
export function parseViewBlock(source: string): ParsedViewBlock {
	let raw: Record<string, unknown>;
	try {
		raw = (parseYaml(source) as Record<string, unknown>) ?? {};
	} catch (e) {
		return { config: null, error: `Could not read this block as YAML: ${(e as Error).message}` };
	}
	if (typeof raw !== "object" || raw === null) {
		return { config: null, error: "Expected `key: value` lines inside this block." };
	}

	const database = raw.database ?? raw.db ?? raw.source;
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database this view should show." };
	}

	const requested = asKey(raw.view ?? raw.type) || "table";
	const type = (VIEW_TYPES.includes(requested as ViewType) ? requested : "table") as ViewType;

	const sorts = toStringArray(raw.sort ?? raw.sorts)
		.map(parseSortShorthand)
		.filter((s): s is SortRule => s !== null);

	const config: ViewConfig = {
		id: `inline-${type}`,
		name: asText(raw.title ?? raw.name),
		type,
		databaseId: asText(database),
		groupBy: asText(raw.group ?? raw.groupBy) || undefined,
		dateProperty: asText(raw.date) || undefined,
		coverProperty: asText(raw.cover) || undefined,
		visibleProperties: toStringArray(raw.properties ?? raw.props ?? raw.columns),
		filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
		sorts: sorts.length > 0 ? sorts : undefined,
		calculate: parseCalculations(raw.calculate),
		hiddenProperties: toStringArray(raw.hide ?? raw.hidden),
		subGroupBy: asText(raw.subgroup ?? raw.subGroupBy) || undefined,
		collapsedGroups: toStringArray(raw.collapsed),
		limits: parseLimits(raw.limits),
		limitMode: ["soft", "ask", "strict"].includes(asKey(raw.limit_mode))
			? (asKey(raw.limit_mode) as "soft" | "ask" | "strict")
			: undefined,
		dateBuckets: raw.buckets === true || asKey(raw.group_by) === "date",
		timelineStart: asText(raw.start ?? raw.timelineStart) || undefined,
		timelineEnd: asText(raw.end ?? raw.timelineEnd) || undefined,
		timelineScale: ["day", "week", "month"].includes(asKey(raw.scale))
			? (asKey(raw.scale) as "day" | "week" | "month")
			: undefined,
		cardSize: ["small", "medium", "large"].includes(String(raw.size))
			? (String(raw.size) as "small" | "medium" | "large")
			: undefined,
		pageSize: raw.limit !== undefined ? Number(raw.limit) : undefined,
	};

	return { config };
}

const CHART_KINDS: ChartKind[] = ["bar", "column", "line", "area", "pie", "donut", "scatter"];
const AGGREGATIONS: Aggregation[] = [
	"count",
	"sum",
	"average",
	"median",
	"min",
	"max",
	"count_unique",
	"percent_checked",
];

export interface ParsedChartBlock {
	config: ChartConfig | null;
	error?: string;
}

/** Turn the body of a ```notion-chart block into a chart configuration. */
export function parseChartBlock(source: string): ParsedChartBlock {
	let raw: Record<string, unknown>;
	try {
		raw = (parseYaml(source) as Record<string, unknown>) ?? {};
	} catch (e) {
		return { config: null, error: `Could not read this block as YAML: ${(e as Error).message}` };
	}
	if (typeof raw !== "object" || raw === null) {
		return { config: null, error: "Expected `key: value` lines inside this block." };
	}

	const database = raw.database ?? raw.db ?? raw.source;
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database to chart." };
	}

	const groupBy = raw.group ?? raw.groupBy ?? raw.x ?? raw.by;
	if (!groupBy) {
		return {
			config: null,
			error: "Missing `group:` — name the property whose values become the bars or slices.",
		};
	}

	const requestedKind = asKey(raw.chart ?? raw.kind ?? raw.type) || "column";
	const kind = (CHART_KINDS.includes(requestedKind as ChartKind)
		? requestedKind
		: "column") as ChartKind;

	const requestedAgg =
		asKey(raw.aggregate ?? raw.aggregation).replace(/\s+/g, "_") ||
		(raw.value ? "sum" : "count");
	const aggregation = (AGGREGATIONS.includes(requestedAgg as Aggregation)
		? requestedAgg
		: "count") as Aggregation;

	const sortRaw = asKey(raw.sort) || "value_desc";
	const sort = (["label", "value", "value_desc", "none"].includes(sortRaw)
		? sortRaw
		: "value_desc") as ChartConfig["sort"];

	return {
		config: {
			database: asText(database),
			kind,
			groupBy: asText(groupBy),
			value: asText(raw.value) || undefined,
			aggregation,
			series: asText(raw.series) || undefined,
			filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
			sort,
			limit: raw.limit !== undefined ? Number(raw.limit) : undefined,
			title: asText(raw.title) || undefined,
			height: raw.height !== undefined ? Number(raw.height) : undefined,
			stacked: raw.stacked === true,
			showLegend: raw.legend !== false,
			showValues: raw.values !== false,
		},
	};
}
