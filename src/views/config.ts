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
} from "../types";

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
	if (Array.isArray(value)) return value.map((v) => String(v));
	if (typeof value === "string") {
		return value
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	return [];
}

function parseFilters(raw: unknown): FilterGroup | undefined {
	if (!raw) return undefined;

	// Object form: `filter: {any: [...]}` or `{all: [...]}`.
	if (!Array.isArray(raw) && typeof raw === "object") {
		const obj = raw as Record<string, unknown>;
		const any = obj.any ?? obj.or;
		const all = obj.all ?? obj.and;
		const conjunction: "and" | "or" = any ? "or" : "and";
		const rules = toStringArray(any ?? all)
			.map(parseFilterShorthand)
			.filter((r): r is FilterRule => r !== null);
		return rules.length > 0 ? { conjunction, rules } : undefined;
	}

	const rules = toStringArray(raw)
		.map(parseFilterShorthand)
		.filter((r): r is FilterRule => r !== null);
	return rules.length > 0 ? { conjunction: "and", rules } : undefined;
}

const VIEW_TYPES: ViewType[] = ["table", "board", "gallery", "list", "calendar"];

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

	const requested = String(raw.view ?? raw.type ?? "table").toLowerCase();
	const type = (VIEW_TYPES.includes(requested as ViewType) ? requested : "table") as ViewType;

	const sorts = toStringArray(raw.sort ?? raw.sorts)
		.map(parseSortShorthand)
		.filter((s): s is SortRule => s !== null);

	const config: ViewConfig = {
		id: `inline-${type}`,
		name: String(raw.title ?? raw.name ?? ""),
		type,
		databaseId: String(database),
		groupBy: raw.group ? String(raw.group) : raw.groupBy ? String(raw.groupBy) : undefined,
		dateProperty: raw.date ? String(raw.date) : undefined,
		coverProperty: raw.cover ? String(raw.cover) : undefined,
		visibleProperties: toStringArray(raw.properties ?? raw.props ?? raw.columns),
		filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
		sorts: sorts.length > 0 ? sorts : undefined,
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

	const requestedKind = String(raw.chart ?? raw.kind ?? raw.type ?? "column").toLowerCase();
	const kind = (CHART_KINDS.includes(requestedKind as ChartKind)
		? requestedKind
		: "column") as ChartKind;

	const requestedAgg = String(raw.aggregate ?? raw.aggregation ?? (raw.value ? "sum" : "count"))
		.toLowerCase()
		.replace(/\s+/g, "_");
	const aggregation = (AGGREGATIONS.includes(requestedAgg as Aggregation)
		? requestedAgg
		: "count") as Aggregation;

	const sortRaw = String(raw.sort ?? "value_desc").toLowerCase();
	const sort = (["label", "value", "value_desc", "none"].includes(sortRaw)
		? sortRaw
		: "value_desc") as ChartConfig["sort"];

	return {
		config: {
			database: String(database),
			kind,
			groupBy: String(groupBy),
			value: raw.value ? String(raw.value) : undefined,
			aggregation,
			series: raw.series ? String(raw.series) : undefined,
			filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
			sort,
			limit: raw.limit !== undefined ? Number(raw.limit) : undefined,
			title: raw.title ? String(raw.title) : undefined,
			height: raw.height !== undefined ? Number(raw.height) : undefined,
			stacked: raw.stacked === true,
			showLegend: raw.legend !== false,
			showValues: raw.values !== false,
		},
	};
}
