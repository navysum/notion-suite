import { Aggregation, ChartConfig, DatabaseRow, DatabaseSchema, PropertyDef } from "../types";
import { applyFilter, findProperty } from "../db/query";
import { formatValue, isEmpty } from "../db/value";

export interface ChartSeries {
	name: string;
	values: number[];
}

export interface ChartData {
	labels: string[];
	series: ChartSeries[];
	valueLabel: string;
}

/** Read the group key(s) for a row. Multi-select rows count once per value. */
function groupKeys(prop: PropertyDef | undefined, row: DatabaseRow): string[] {
	if (!prop) return [row.name];
	const value = row.values[prop.id];
	if (Array.isArray(value)) return value.length === 0 ? ["No value"] : value.map(String);
	if (isEmpty(value)) return ["No value"];
	if (typeof value === "boolean") return [value ? "Checked" : "Unchecked"];
	if (["date", "created", "updated"].includes(prop.type)) {
		// Raw dates make for useless axes; bucket by month instead.
		return [String(value).slice(0, 7)];
	}
	return [String(value)];
}

function aggregate(numbers: number[], rowCount: number, how: Aggregation): number {
	switch (how) {
		case "count":
			return rowCount;
		case "count_unique":
			return new Set(numbers).size;
		case "sum":
			return numbers.reduce((a, b) => a + b, 0);
		case "average":
			return numbers.length === 0 ? 0 : numbers.reduce((a, b) => a + b, 0) / numbers.length;
		case "median": {
			if (numbers.length === 0) return 0;
			const sorted = [...numbers].sort((a, b) => a - b);
			const mid = Math.floor(sorted.length / 2);
			return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
		}
		case "min":
			return numbers.length === 0 ? 0 : Math.min(...numbers);
		case "max":
			return numbers.length === 0 ? 0 : Math.max(...numbers);
		case "percent_checked":
			return rowCount === 0 ? 0 : (numbers.filter((n) => n !== 0).length / rowCount) * 100;
		default:
			return rowCount;
	}
}

function numericValue(prop: PropertyDef | undefined, row: DatabaseRow): number | null {
	if (!prop) return null;
	const value = row.values[prop.id];
	if (typeof value === "boolean") return value ? 1 : 0;
	const n = Number(value);
	return isNaN(n) ? null : n;
}

/** Collapse rows into the label/series matrix an SVG chart can draw directly. */
export function buildChartData(
	schema: DatabaseSchema,
	allRows: DatabaseRow[],
	config: ChartConfig
): ChartData {
	const rows = applyFilter(schema, allRows, config.filter);
	const groupProp = findProperty(schema, config.groupBy);
	const seriesProp = config.series ? findProperty(schema, config.series) : undefined;
	const valueProp = config.value ? findProperty(schema, config.value) : undefined;

	// bucket[seriesName][label] -> the numbers feeding the aggregation
	const buckets = new Map<string, Map<string, { numbers: number[]; count: number }>>();
	const labelSet = new Set<string>();

	for (const row of rows) {
		const seriesNames = seriesProp ? groupKeys(seriesProp, row) : ["value"];
		const labels = groupKeys(groupProp, row);
		const n = numericValue(valueProp, row);

		for (const seriesName of seriesNames) {
			let byLabel = buckets.get(seriesName);
			if (!byLabel) {
				byLabel = new Map();
				buckets.set(seriesName, byLabel);
			}
			for (const label of labels) {
				labelSet.add(label);
				const cell = byLabel.get(label) ?? { numbers: [], count: 0 };
				cell.count += 1;
				if (n !== null) cell.numbers.push(n);
				byLabel.set(label, cell);
			}
		}
	}

	let labels = [...labelSet];

	// Ordering. Dates and numbers read wrong when sorted by magnitude, so those
	// keep their natural order unless the block asks otherwise.
	const naturallyOrdered =
		groupProp && ["date", "created", "updated", "number"].includes(groupProp.type);
	const sortMode = config.sort ?? (naturallyOrdered ? "label" : "value_desc");

	const totalFor = (label: string): number => {
		let total = 0;
		for (const byLabel of buckets.values()) {
			const cell = byLabel.get(label);
			if (cell) total += aggregate(cell.numbers, cell.count, config.aggregation);
		}
		return total;
	};

	// Ties break on the label so a chart's bar order does not shift when rows are
	// renamed, added or removed -- row order must never leak into the output.
	const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
	if (sortMode === "label") {
		labels.sort(byLabel);
	} else if (sortMode === "value") {
		labels.sort((a, b) => totalFor(a) - totalFor(b) || byLabel(a, b));
	} else if (sortMode === "value_desc") {
		labels.sort((a, b) => totalFor(b) - totalFor(a) || byLabel(a, b));
	}

	// "No value" is noise at the front of an axis; park it at the end.
	labels = [...labels.filter((l) => l !== "No value"), ...labels.filter((l) => l === "No value")];
	if (config.limit && config.limit > 0) labels = labels.slice(0, config.limit);

	const series: ChartSeries[] = [];
	for (const [name, byLabel] of buckets) {
		series.push({
			name,
			values: labels.map((label) => {
				const cell = byLabel.get(label);
				return cell ? round(aggregate(cell.numbers, cell.count, config.aggregation)) : 0;
			}),
		});
	}
	series.sort((a, b) => a.name.localeCompare(b.name));

	return { labels, series, valueLabel: describeValue(config, valueProp) };
}

function describeValue(config: ChartConfig, valueProp: PropertyDef | undefined): string {
	const name = valueProp?.name ?? "rows";
	switch (config.aggregation) {
		case "count":
			return "Count";
		case "count_unique":
			return `Unique ${name}`;
		case "percent_checked":
			return `% checked`;
		case "sum":
			return `Sum of ${name}`;
		case "average":
			return `Average ${name}`;
		case "median":
			return `Median ${name}`;
		case "min":
			return `Min ${name}`;
		case "max":
			return `Max ${name}`;
		default:
			return name;
	}
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Format a numeric value for axis ticks and data labels. */
export function formatNumber(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `${round(n / 1_000_000)}M`;
	if (Math.abs(n) >= 1_000) return `${round(n / 1_000)}k`;
	return String(round(n));
}

export { formatValue };
