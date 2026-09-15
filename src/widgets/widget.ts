import { parseYaml } from "obsidian";
import { FilterGroup, FilterRule, RollupFunction, ROLLUP_FUNCTIONS, SortRule } from "../types";
import { parseFilterShorthand, parseSortShorthand } from "../views/config";
import { parseDate, toISODate } from "../utils/dates";
import { ViewContext } from "../views/context";
import { renderWidgetCard } from "./render";

/**
 * Dashboard widgets: the small, single-purpose readouts that sit above a
 * database rather than inside it -- a headline number, a progress bar, a
 * countdown, a short list, or a button that files a new row.
 *
 * Everything here is pure: a ```notion-widget block becomes a `WidgetConfig`,
 * or an error string explaining what to fix. Nothing throws, because a block
 * being half-typed is the normal state while somebody is writing one.
 */

export type WidgetKind = "metric" | "progress" | "countdown" | "list" | "button";

export const WIDGET_KINDS: WidgetKind[] = ["metric", "progress", "countdown", "list", "button"];

interface WidgetBase {
	kind: WidgetKind;
	/** Caption under (or above) the widget's figure. */
	label?: string;
}

export interface MetricWidget extends WidgetBase {
	kind: "metric";
	database: string;
	/** Property being aggregated. Omitted for the counting aggregates. */
	value?: string;
	aggregate: RollupFunction;
	filter?: FilterGroup;
	prefix?: string;
	suffix?: string;
}

export interface ProgressWidget extends WidgetBase {
	kind: "progress";
	database: string;
	/** What counts as done. */
	filter?: FilterGroup;
	/** The denominator. Absent means "every row". */
	totalFilter?: FilterGroup;
}

export interface CountdownWidget extends WidgetBase {
	kind: "countdown";
	/** An ISO date literal, when the target is not read from a database. */
	date?: string;
	database?: string;
	dateProperty?: string;
	filter?: FilterGroup;
}

export interface ListWidget extends WidgetBase {
	kind: "list";
	database: string;
	filter?: FilterGroup;
	sorts?: SortRule[];
	limit: number;
	/** Property shown beside each row's title. */
	show?: string;
}

export interface ButtonWidget extends WidgetBase {
	kind: "button";
	database: string;
	label: string;
	/** Title given to the new note. */
	rowName?: string;
	/** Property name -> value, applied to the row this button creates. */
	set: Record<string, unknown>;
}

export type Widget = MetricWidget | ProgressWidget | CountdownWidget | ListWidget | ButtonWidget;

export interface WidgetConfig {
	/** One entry for a plain block; several for the `widgets:` list form. */
	widgets: Widget[];
}

export interface ParsedWidgetBlock {
	config: WidgetConfig | null;
	error?: string;
}

// --- small readers ---------------------------------------------------------

/**
 * Render a YAML scalar as text without reaching for `String(unknown)`, which
 * happily stringifies objects into "[object Object]".
 */
function textOf(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (value instanceof Date) return toISODate(value);
	if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(", ");
	return "";
}

function optionalText(value: unknown): string | undefined {
	const text = textOf(value);
	return text.length > 0 ? text : undefined;
}

function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(textOf).filter(Boolean);
	const text = textOf(value);
	if (!text) return [];
	return text
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * Plain-English filters, the same shorthand `notion-db` and `notion-chart`
 * blocks take: a single line, a list of lines, or `{any: [...]}`.
 */
function parseFilters(raw: unknown): FilterGroup | undefined {
	if (raw === undefined || raw === null || raw === "") return undefined;

	if (isRecord(raw)) {
		const any = raw.any ?? raw.or;
		const all = raw.all ?? raw.and;
		const conjunction: "and" | "or" = any ? "or" : "and";
		const rules = toStringArray(any ?? all)
			.map(parseFilterShorthand)
			.filter((rule): rule is FilterRule => rule !== null);
		return rules.length > 0 ? { conjunction, rules } : undefined;
	}

	const rules = toStringArray(raw)
		.map(parseFilterShorthand)
		.filter((rule): rule is FilterRule => rule !== null);
	return rules.length > 0 ? { conjunction: "and", rules } : undefined;
}

function parseSorts(raw: unknown): SortRule[] | undefined {
	const sorts = toStringArray(raw)
		.map(parseSortShorthand)
		.filter((sort): sort is SortRule => sort !== null);
	return sorts.length > 0 ? sorts : undefined;
}

function readDatabase(raw: Record<string, unknown>): string {
	return textOf(raw.database ?? raw.db ?? raw.source);
}

// --- pure computation ------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Midnight local time, so day maths never depends on the time of day. */
function startOfDay(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Whole days from `now` to `target`: positive in the future, negative in the
 * past, zero today. Both ends are flattened to midnight first, so "tomorrow"
 * is 1 day away at 23:59 just as it is at 00:01.
 */
export function countdownDays(target: Date, now: Date = new Date()): number {
	return Math.round((startOfDay(target) - startOfDay(now)) / DAY_MS);
}

/**
 * The date a countdown should point at: the soonest one that has not passed,
 * or -- when every candidate is behind us -- the most recent of them, so the
 * widget reads "3 days ago" rather than going blank.
 */
export function pickCountdownDate(dates: Date[], now: Date = new Date()): Date | null {
	if (dates.length === 0) return null;
	const todayStamp = startOfDay(now);
	const upcoming = dates.filter((date) => startOfDay(date) >= todayStamp);
	const pool = upcoming.length > 0 ? upcoming : dates;
	const pick = upcoming.length > 0
		? Math.min(...pool.map((date) => date.getTime()))
		: Math.max(...pool.map((date) => date.getTime()));
	return new Date(pick);
}

/** Percentage complete, clamped, with a zero denominator reading as 0%. */
export function progressPercent(done: number, total: number): number {
	if (!isFinite(done) || !isFinite(total) || total <= 0) return 0;
	return round(Math.max(0, Math.min(100, (done / total) * 100)));
}

/** Present whatever `collapse` returned as the widget's headline figure. */
export function formatFigure(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (typeof value === "number") {
		if (!isFinite(value)) return "—";
		return round(value).toLocaleString();
	}
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(", ") || "—";
	const text = textOf(value);
	return text.length > 0 ? text : "—";
}

/** Aggregates whose result is a percentage, so the figure wants a `%`. */
export function isPercentAggregate(how: RollupFunction): boolean {
	return how.startsWith("percent_");
}

// --- config parsing --------------------------------------------------------

function parseMetric(raw: Record<string, unknown>): ParsedWidgetBlock {
	const database = readDatabase(raw);
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database this metric counts." };
	}

	const requested = textOf(raw.aggregate ?? raw.aggregation ?? raw.calculate)
		.toLowerCase()
		.replace(/\s+/g, "_");
	if (requested && !ROLLUP_FUNCTIONS.includes(requested as RollupFunction)) {
		return {
			config: null,
			error: `Unknown \`aggregate: ${requested}\`. Try one of: ${ROLLUP_FUNCTIONS.join(", ")}.`,
		};
	}
	const aggregate = (requested || "count_all") as RollupFunction;

	const widget: MetricWidget = {
		kind: "metric",
		database,
		value: optionalText(raw.value ?? raw.property),
		aggregate,
		filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
		label: optionalText(raw.label ?? raw.title ?? raw.name),
		prefix: optionalText(raw.prefix),
		suffix: optionalText(raw.suffix),
	};
	return { config: { widgets: [widget] } };
}

function parseProgress(raw: Record<string, unknown>): ParsedWidgetBlock {
	const database = readDatabase(raw);
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database this bar measures." };
	}

	const filter = parseFilters(raw.filter ?? raw.done ?? raw.where);
	if (!filter) {
		return {
			config: null,
			error:
				"Missing `filter:` — say what counts as done, for example `filter: Status is Done`.",
		};
	}

	const widget: ProgressWidget = {
		kind: "progress",
		database,
		filter,
		totalFilter: parseFilters(raw.total_filter ?? raw.totalFilter ?? raw.total),
		label: optionalText(raw.label ?? raw.title ?? raw.name),
	};
	return { config: { widgets: [widget] } };
}

function parseCountdown(raw: Record<string, unknown>): ParsedWidgetBlock {
	const database = readDatabase(raw);
	const dateProperty = optionalText(raw.date_property ?? raw.dateProperty ?? raw.property);
	const literal = optionalText(raw.date ?? raw.target);

	if (!literal && !database) {
		return {
			config: null,
			error:
				"A countdown needs either `date: 2026-01-01` or `database:` plus `date_property:`.",
		};
	}
	if (!literal && database && !dateProperty) {
		return {
			config: null,
			error: "Missing `date_property:` — name the date property to count down to.",
		};
	}
	if (literal && !database && !parseDate(literal)) {
		return {
			config: null,
			error: `Could not read \`date: ${literal}\` as a date. Use \`YYYY-MM-DD\`.`,
		};
	}

	const widget: CountdownWidget = {
		kind: "countdown",
		date: literal && !database ? toISODate(parseDate(literal) as Date) : undefined,
		database: database || undefined,
		dateProperty: database ? dateProperty : undefined,
		filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
		label: optionalText(raw.label ?? raw.title ?? raw.name),
	};
	return { config: { widgets: [widget] } };
}

function parseList(raw: Record<string, unknown>): ParsedWidgetBlock {
	const database = readDatabase(raw);
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database to list rows from." };
	}

	let limit = 5;
	if (raw.limit !== undefined && raw.limit !== null && raw.limit !== "") {
		const parsed = Number(textOf(raw.limit));
		if (!isFinite(parsed) || parsed <= 0) {
			return {
				config: null,
				error: `\`limit: ${textOf(raw.limit)}\` should be a whole number above zero.`,
			};
		}
		limit = Math.floor(parsed);
	}

	const widget: ListWidget = {
		kind: "list",
		database,
		filter: parseFilters(raw.filter ?? raw.filters ?? raw.where),
		sorts: parseSorts(raw.sort ?? raw.sorts),
		limit,
		show: optionalText(raw.show ?? raw.property),
		label: optionalText(raw.label ?? raw.title ?? raw.name),
	};
	return { config: { widgets: [widget] } };
}

function parseButton(raw: Record<string, unknown>): ParsedWidgetBlock {
	const database = readDatabase(raw);
	if (!database) {
		return { config: null, error: "Missing `database:` — name the database this button adds to." };
	}

	const rawSet = raw.set ?? raw.with ?? raw.values;
	if (rawSet !== undefined && !isRecord(rawSet)) {
		return {
			config: null,
			error: "`set:` should be a list of `Property: value` lines, indented under `set:`.",
		};
	}

	const set: Record<string, unknown> = {};
	if (isRecord(rawSet)) {
		for (const [key, value] of Object.entries(rawSet)) {
			const name = key.trim();
			if (name) set[name] = value;
		}
	}

	const widget: ButtonWidget = {
		kind: "button",
		database,
		label: optionalText(raw.label ?? raw.title) ?? "New item",
		rowName: optionalText(raw.name ?? raw.row_name ?? raw.rowName),
		set,
	};
	return { config: { widgets: [widget] } };
}

/** Parse one widget object (a block body, or one entry of `widgets:`). */
export function buildWidget(raw: unknown): ParsedWidgetBlock {
	if (!isRecord(raw)) {
		return { config: null, error: "Expected `key: value` lines describing a widget." };
	}

	const requested = textOf(raw.widget ?? raw.kind ?? raw.type).toLowerCase();
	if (!requested) {
		return {
			config: null,
			error: `Missing \`widget:\` — one of ${WIDGET_KINDS.join(", ")}.`,
		};
	}
	if (!WIDGET_KINDS.includes(requested as WidgetKind)) {
		return {
			config: null,
			error: `Unknown widget \`${requested}\`. Try one of: ${WIDGET_KINDS.join(", ")}.`,
		};
	}

	switch (requested as WidgetKind) {
		case "metric":
			return parseMetric(raw);
		case "progress":
			return parseProgress(raw);
		case "countdown":
			return parseCountdown(raw);
		case "list":
			return parseList(raw);
		default:
			return parseButton(raw);
	}
}

/**
 * Turn a parsed block body into a configuration. Accepts both shapes: a single
 * widget's keys at the top level, or a `widgets:` list of them.
 */
export function buildWidgetConfig(raw: unknown): ParsedWidgetBlock {
	if (!isRecord(raw)) {
		return { config: null, error: "Expected `key: value` lines inside this block." };
	}

	const many = raw.widgets;
	if (many === undefined) return buildWidget(raw);

	if (!Array.isArray(many)) {
		return {
			config: null,
			error: "`widgets:` should be a list — one `- widget: ...` entry per card.",
		};
	}
	if (many.length === 0) {
		return { config: null, error: "`widgets:` is empty — add at least one `- widget: ...` entry." };
	}

	const widgets: Widget[] = [];
	for (let i = 0; i < many.length; i++) {
		const parsed = buildWidget(many[i]);
		if (!parsed.config) {
			return { config: null, error: `Widget ${i + 1}: ${parsed.error ?? "could not be read."}` };
		}
		widgets.push(...parsed.config.widgets);
	}
	return { config: { widgets } };
}

/** Turn the body of a ```notion-widget block into one or more widgets. */
export function parseWidgetBlock(source: string): ParsedWidgetBlock {
	let raw: unknown;
	try {
		raw = parseYaml(source) ?? {};
	} catch (e) {
		return { config: null, error: `Could not read this block as YAML: ${(e as Error).message}` };
	}
	return buildWidgetConfig(raw);
}

/** Draw a parsed block. One card per widget, laid out as a responsive row. */
export function renderWidget(
	container: HTMLElement,
	ctx: ViewContext,
	config: WidgetConfig
): void {
	container.empty();
	container.addClass("nfo-widgets");

	const row = container.createDiv({ cls: "nfo-widget-row" });
	if (config.widgets.length === 1) row.addClass("nfo-widget-row-single");

	for (const widget of config.widgets) renderWidgetCard(row, ctx, widget);
}
