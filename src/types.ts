/**
 * Core data model.
 *
 * A "database" is just a folder of notes. Every note inside it is a row, and
 * every YAML frontmatter key on that note is a property value. The schema below
 * is the only thing the plugin stores itself -- it describes how to interpret
 * and edit those frontmatter keys, which keeps the vault plain-text and portable.
 */

export type PropertyType =
	| "text"
	| "number"
	| "select"
	| "multiselect"
	| "date"
	| "checkbox"
	| "url"
	| "email"
	| "phone"
	| "person"
	| "files"
	| "relation"
	| "rollup"
	| "formula"
	| "created"
	| "updated";

export const PROPERTY_TYPES: PropertyType[] = [
	"text",
	"number",
	"select",
	"multiselect",
	"date",
	"checkbox",
	"url",
	"email",
	"phone",
	"person",
	"files",
	"relation",
	"rollup",
	"formula",
	"created",
	"updated",
];

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
	text: "Text",
	number: "Number",
	select: "Select",
	multiselect: "Multi-select",
	date: "Date",
	checkbox: "Checkbox",
	url: "URL",
	email: "Email",
	phone: "Phone",
	person: "Person",
	files: "Files & media",
	relation: "Relation",
	rollup: "Rollup",
	formula: "Formula",
	created: "Created time",
	updated: "Last edited time",
};

/** Notion's select-option palette, mapped onto CSS custom properties. */
export type OptionColor =
	| "default"
	| "gray"
	| "brown"
	| "orange"
	| "yellow"
	| "green"
	| "blue"
	| "purple"
	| "pink"
	| "red";

export const OPTION_COLORS: OptionColor[] = [
	"default",
	"gray",
	"brown",
	"orange",
	"yellow",
	"green",
	"blue",
	"purple",
	"pink",
	"red",
];

export interface SelectOption {
	name: string;
	color: OptionColor;
}

/**
 * How a rollup collapses the values it gathered from related rows.
 * Mirrors the calculate menu Notion shows on a rollup property.
 */
export type RollupFunction =
	| "show_original"
	| "count_all"
	| "count_values"
	| "count_unique"
	| "count_empty"
	| "count_not_empty"
	| "percent_empty"
	| "percent_not_empty"
	| "sum"
	| "average"
	| "median"
	| "min"
	| "max"
	| "range"
	| "earliest"
	| "latest"
	| "date_range"
	| "checked"
	| "unchecked"
	| "percent_checked"
	| "percent_unchecked";

export const ROLLUP_FUNCTIONS: RollupFunction[] = [
	"show_original",
	"count_all",
	"count_values",
	"count_unique",
	"count_empty",
	"count_not_empty",
	"percent_empty",
	"percent_not_empty",
	"sum",
	"average",
	"median",
	"min",
	"max",
	"range",
	"earliest",
	"latest",
	"date_range",
	"checked",
	"unchecked",
	"percent_checked",
	"percent_unchecked",
];

export const ROLLUP_FUNCTION_LABELS: Record<RollupFunction, string> = {
	show_original: "Show original",
	count_all: "Count all",
	count_values: "Count values",
	count_unique: "Count unique values",
	count_empty: "Count empty",
	count_not_empty: "Count not empty",
	percent_empty: "Percent empty",
	percent_not_empty: "Percent not empty",
	sum: "Sum",
	average: "Average",
	median: "Median",
	min: "Min",
	max: "Max",
	range: "Range",
	earliest: "Earliest date",
	latest: "Latest date",
	date_range: "Date range (days)",
	checked: "Checked",
	unchecked: "Unchecked",
	percent_checked: "Percent checked",
	percent_unchecked: "Percent unchecked",
};

/** The property id a rollup uses to mean "the related note's title". */
export const ROLLUP_TITLE_KEY = "__name__";

export interface PropertyDef {
	/** The frontmatter key this property reads and writes. */
	id: string;
	name: string;
	type: PropertyType;
	options?: SelectOption[];
	/** For `relation`: the id of the database being pointed at. */
	relationDatabaseId?: string;
	/** For `rollup`: the relation property *on this database* to follow. */
	rollupRelation?: string;
	/** For `rollup`: the property in the related database to gather, or
	 *  `ROLLUP_TITLE_KEY` to gather the related notes' titles. */
	rollupProperty?: string;
	/** For `rollup`: how the gathered values are collapsed into one. */
	rollupFunction?: RollupFunction;
	/** For `formula`: a tiny expression evaluated per row. */
	formula?: string;
	numberFormat?: "plain" | "percent" | "currency";
	hidden?: boolean;
	width?: number;
}

export type FilterOperator =
	| "is"
	| "is_not"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "ends_with"
	| "is_empty"
	| "is_not_empty"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "before"
	| "after"
	| "on_or_before"
	| "on_or_after";

export interface FilterRule {
	property: string;
	operator: FilterOperator;
	value?: string | number | boolean;
}

export interface FilterGroup {
	conjunction: "and" | "or";
	rules: FilterRule[];
}

export interface SortRule {
	property: string;
	direction: "asc" | "desc";
}

export type ViewType = "table" | "board" | "gallery" | "list" | "calendar";

export interface ViewConfig {
	id: string;
	name: string;
	type: ViewType;
	databaseId: string;
	filter?: FilterGroup;
	sorts?: SortRule[];
	/** Board grouping / calendar date field. */
	groupBy?: string;
	dateProperty?: string;
	/** Property ids to show, in order. Empty means "all visible properties". */
	visibleProperties?: string[];
	coverProperty?: string;
	cardSize?: "small" | "medium" | "large";
	pageSize?: number;
}

export interface DatabaseSchema {
	id: string;
	name: string;
	/** Vault-relative folder holding one note per row. */
	folder: string;
	icon?: string;
	description?: string;
	properties: PropertyDef[];
	views: ViewConfig[];
	/** Frontmatter applied to every newly created row. */
	defaultTemplate?: Record<string, unknown>;
	createdAt: number;
}

/** A single row: the note plus its decoded property values. */
export interface DatabaseRow {
	path: string;
	name: string;
	values: Record<string, unknown>;
	ctime: number;
	mtime: number;
}

export type ChartKind = "bar" | "column" | "line" | "area" | "pie" | "donut" | "scatter";

export type Aggregation =
	| "count"
	| "sum"
	| "average"
	| "median"
	| "min"
	| "max"
	| "count_unique"
	| "percent_checked";

export interface ChartConfig {
	database: string;
	kind: ChartKind;
	/** Property whose values become the categories / x-axis. */
	groupBy: string;
	/** Property being aggregated. Omitted for `count`. */
	value?: string;
	aggregation: Aggregation;
	/** Optional second grouping, producing one series per value. */
	series?: string;
	filter?: FilterGroup;
	sort?: "label" | "value" | "value_desc" | "none";
	limit?: number;
	title?: string;
	height?: number;
	stacked?: boolean;
	showLegend?: boolean;
	showValues?: boolean;
}
