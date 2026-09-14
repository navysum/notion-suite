import { ChartConfig } from "../types";
import { ChartData, formatNumber } from "./aggregate";

const NS = "http://www.w3.org/2000/svg";

/**
 * Charts are drawn as inline SVG with no charting library, which keeps the
 * plugin dependency-free and lets every colour come from CSS custom properties
 * so charts follow the user's Obsidian theme (including light/dark switches).
 */
const PALETTE_SIZE = 8;

function seriesColor(index: number): string {
	return `var(--nfo-chart-${(index % PALETTE_SIZE) + 1})`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
	parent: Element,
	tag: K,
	attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
	const node = document.createElementNS(NS, tag);
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
	parent.appendChild(node);
	return node;
}

function text(
	parent: Element,
	content: string,
	x: number,
	y: number,
	cls: string,
	anchor: "start" | "middle" | "end" = "middle"
): SVGTextElement {
	const node = svgEl(parent, "text", { x, y, class: cls, "text-anchor": anchor });
	node.textContent = content;
	return node;
}

/** A rounded "nice" axis maximum, so gridlines land on readable numbers. */
function niceMax(value: number): number {
	if (value <= 0) return 1;
	const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
	const normalized = value / magnitude;
	const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	return step * magnitude;
}

const WIDTH = 760;

export function renderChart(container: HTMLElement, config: ChartConfig, data: ChartData): void {
	const height = config.height ?? 340;
	const wrapper = container.createDiv({ cls: "nfo-chart" });

	if (config.title) wrapper.createDiv({ cls: "nfo-chart-title", text: config.title });

	if (data.labels.length === 0 || data.series.length === 0) {
		wrapper.createDiv({ cls: "nfo-chart-empty", text: "No data matches this chart." });
		return;
	}

	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("viewBox", `0 0 ${WIDTH} ${height}`);
	svg.setAttribute("class", "nfo-chart-svg");
	svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
	wrapper.appendChild(svg);

	switch (config.kind) {
		case "pie":
		case "donut":
			drawPie(svg, config, data, height);
			break;
		case "bar":
			drawHorizontalBars(svg, config, data, height);
			break;
		case "line":
		case "area":
			drawLine(svg, config, data, height);
			break;
		case "scatter":
			drawScatter(svg, data, height);
			break;
		default:
			drawColumns(svg, config, data, height);
	}

	if (config.showLegend !== false) {
		// Pie and donut colour by label; the cartesian charts colour by series.
		if (config.kind === "pie" || config.kind === "donut") renderPieLegend(wrapper, data);
		else if (data.series.length > 1) drawLegend(wrapper, data);
	}
}

function drawLegend(wrapper: HTMLElement, data: ChartData): void {
	const legend = wrapper.createDiv({ cls: "nfo-chart-legend" });
	data.series.forEach((series, index) => {
		const item = legend.createDiv({ cls: "nfo-chart-legend-item" });
		const swatch = item.createSpan({ cls: "nfo-chart-swatch" });
		swatch.style.background = seriesColor(index);
		item.createSpan({ text: series.name });
	});
}

interface Plot {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}

function plotArea(height: number, leftGutter = 54, bottomGutter = 46): Plot {
	const left = leftGutter;
	const right = WIDTH - 16;
	const top = 16;
	const bottom = height - bottomGutter;
	return { left, right, top, bottom, width: right - left, height: bottom - top };
}

/** Horizontal gridlines plus the y-axis tick labels shared by the cartesian charts. */
function drawGrid(svg: SVGSVGElement, plot: Plot, max: number, ticks = 4): void {
	for (let i = 0; i <= ticks; i++) {
		const value = (max / ticks) * i;
		const y = plot.bottom - (plot.height / ticks) * i;
		svgEl(svg, "line", {
			x1: plot.left,
			y1: y,
			x2: plot.right,
			y2: y,
			class: "nfo-chart-grid",
		});
		text(svg, formatNumber(value), plot.left - 8, y + 4, "nfo-chart-tick", "end");
	}
}

/**
 * Long category labels are rotated rather than truncated, so a board full of
 * "In progress"-style values stays readable.
 */
function drawCategoryLabels(svg: SVGSVGElement, plot: Plot, labels: string[]): void {
	const slot = plot.width / labels.length;
	const rotate = slot < 60 || labels.some((l) => l.length > 10);
	labels.forEach((label, index) => {
		const x = plot.left + slot * index + slot / 2;
		const shown = label.length > 22 ? `${label.slice(0, 21)}…` : label;
		if (rotate) {
			const node = text(svg, shown, x, plot.bottom + 14, "nfo-chart-label", "end");
			node.setAttribute("transform", `rotate(-35 ${x} ${plot.bottom + 14})`);
		} else {
			text(svg, shown, x, plot.bottom + 20, "nfo-chart-label");
		}
	});
}

function maxOf(data: ChartData, stacked: boolean): number {
	if (stacked) {
		let max = 0;
		for (let i = 0; i < data.labels.length; i++) {
			let total = 0;
			for (const series of data.series) total += Math.max(0, series.values[i]);
			max = Math.max(max, total);
		}
		return max;
	}
	let max = 0;
	for (const series of data.series) for (const value of series.values) max = Math.max(max, value);
	return max;
}

function drawColumns(svg: SVGSVGElement, config: ChartConfig, data: ChartData, height: number): void {
	const plot = plotArea(height);
	const stacked = !!config.stacked && data.series.length > 1;
	const max = niceMax(maxOf(data, stacked));
	drawGrid(svg, plot, max);

	const slot = plot.width / data.labels.length;
	const padding = Math.min(12, slot * 0.18);
	const bandWidth = slot - padding * 2;
	const barWidth = stacked ? bandWidth : bandWidth / data.series.length;

	data.labels.forEach((label, labelIndex) => {
		const bandLeft = plot.left + slot * labelIndex + padding;
		let stackTop = plot.bottom;

		data.series.forEach((series, seriesIndex) => {
			const value = series.values[labelIndex];
			const barHeight = max === 0 ? 0 : (Math.max(0, value) / max) * plot.height;
			const x = stacked ? bandLeft : bandLeft + barWidth * seriesIndex;
			const y = stacked ? stackTop - barHeight : plot.bottom - barHeight;

			const rect = svgEl(svg, "rect", {
				x,
				y,
				width: Math.max(1, barWidth - (stacked ? 0 : 2)),
				height: Math.max(0, barHeight),
				rx: 3,
				class: "nfo-chart-bar",
			});
			rect.style.fill = seriesColor(seriesIndex);
			svgEl(rect, "title").textContent = `${label} · ${series.name}: ${formatNumber(value)}`;

			if (config.showValues !== false && !stacked && value > 0 && data.labels.length <= 14) {
				text(svg, formatNumber(value), x + barWidth / 2, y - 6, "nfo-chart-value");
			}
			if (stacked) stackTop -= barHeight;
		});

		if (config.showValues !== false && stacked && data.labels.length <= 14) {
			const total = data.series.reduce((sum, s) => sum + Math.max(0, s.values[labelIndex]), 0);
			if (total > 0) {
				text(svg, formatNumber(total), bandLeft + bandWidth / 2, stackTop - 6, "nfo-chart-value");
			}
		}
	});

	drawCategoryLabels(svg, plot, data.labels);
}

function drawHorizontalBars(
	svg: SVGSVGElement,
	config: ChartConfig,
	data: ChartData,
	height: number
): void {
	// Wide gutter: the category labels live to the left of the bars here.
	const plot = plotArea(height, 140, 28);
	const max = niceMax(maxOf(data, false));
	const slot = plot.height / data.labels.length;
	const barHeight = Math.max(6, (slot - 8) / data.series.length);

	for (let i = 0; i <= 4; i++) {
		const x = plot.left + (plot.width / 4) * i;
		svgEl(svg, "line", { x1: x, y1: plot.top, x2: x, y2: plot.bottom, class: "nfo-chart-grid" });
		text(svg, formatNumber((max / 4) * i), x, plot.bottom + 18, "nfo-chart-tick");
	}

	data.labels.forEach((label, labelIndex) => {
		const bandTop = plot.top + slot * labelIndex + 4;
		const shown = label.length > 18 ? `${label.slice(0, 17)}…` : label;
		text(svg, shown, plot.left - 10, bandTop + slot / 2 - 2, "nfo-chart-label", "end");

		data.series.forEach((series, seriesIndex) => {
			const value = series.values[labelIndex];
			const barWidth = max === 0 ? 0 : (Math.max(0, value) / max) * plot.width;
			const y = bandTop + barHeight * seriesIndex;
			const rect = svgEl(svg, "rect", {
				x: plot.left,
				y,
				width: Math.max(0, barWidth),
				height: Math.max(1, barHeight - 2),
				rx: 3,
				class: "nfo-chart-bar",
			});
			rect.style.fill = seriesColor(seriesIndex);
			svgEl(rect, "title").textContent = `${label} · ${series.name}: ${formatNumber(value)}`;

			if (config.showValues !== false && value > 0) {
				text(svg, formatNumber(value), plot.left + barWidth + 6, y + barHeight / 2 + 3, "nfo-chart-value", "start");
			}
		});
	});
}

function drawLine(svg: SVGSVGElement, config: ChartConfig, data: ChartData, height: number): void {
	const plot = plotArea(height);
	const max = niceMax(maxOf(data, false));
	drawGrid(svg, plot, max);

	const step = data.labels.length > 1 ? plot.width / (data.labels.length - 1) : 0;
	const pointX = (index: number) =>
		data.labels.length === 1 ? plot.left + plot.width / 2 : plot.left + step * index;
	const pointY = (value: number) =>
		max === 0 ? plot.bottom : plot.bottom - (Math.max(0, value) / max) * plot.height;

	data.series.forEach((series, seriesIndex) => {
		const points = series.values.map((value, index) => `${pointX(index)},${pointY(value)}`);

		if (config.kind === "area") {
			const area = svgEl(svg, "polygon", {
				points: [`${pointX(0)},${plot.bottom}`, ...points, `${pointX(series.values.length - 1)},${plot.bottom}`].join(" "),
				class: "nfo-chart-area",
			});
			area.style.fill = seriesColor(seriesIndex);
		}

		const line = svgEl(svg, "polyline", { points: points.join(" "), class: "nfo-chart-line" });
		line.style.stroke = seriesColor(seriesIndex);

		series.values.forEach((value, index) => {
			const dot = svgEl(svg, "circle", {
				cx: pointX(index),
				cy: pointY(value),
				r: 3.5,
				class: "nfo-chart-dot",
			});
			dot.style.fill = seriesColor(seriesIndex);
			svgEl(dot, "title").textContent = `${data.labels[index]} · ${series.name}: ${formatNumber(value)}`;
		});
	});

	drawCategoryLabels(svg, plot, data.labels);
}

function drawScatter(svg: SVGSVGElement, data: ChartData, height: number): void {
	const plot = plotArea(height);
	const max = niceMax(maxOf(data, false));
	drawGrid(svg, plot, max);

	const slot = plot.width / data.labels.length;
	data.series.forEach((series, seriesIndex) => {
		series.values.forEach((value, index) => {
			const dot = svgEl(svg, "circle", {
				cx: plot.left + slot * index + slot / 2,
				cy: max === 0 ? plot.bottom : plot.bottom - (Math.max(0, value) / max) * plot.height,
				r: 5,
				class: "nfo-chart-dot",
			});
			dot.style.fill = seriesColor(seriesIndex);
			svgEl(dot, "title").textContent = `${data.labels[index]} · ${series.name}: ${formatNumber(value)}`;
		});
	});

	drawCategoryLabels(svg, plot, data.labels);
}

function drawPie(svg: SVGSVGElement, config: ChartConfig, data: ChartData, height: number): void {
	// Pies show a single measure; collapse any series into one total per label.
	const totals = data.labels.map((_label, index) =>
		data.series.reduce((sum, series) => sum + Math.max(0, series.values[index]), 0)
	);
	const total = totals.reduce((a, b) => a + b, 0);

	const cx = WIDTH / 2;
	const cy = height / 2;
	const radius = Math.min(WIDTH, height) / 2 - 30;
	const innerRadius = config.kind === "donut" ? radius * 0.58 : 0;

	if (total === 0) {
		text(svg, "No values to plot", cx, cy, "nfo-chart-label");
		return;
	}

	let angle = -Math.PI / 2;
	totals.forEach((value, index) => {
		if (value <= 0) return;
		const sweep = (value / total) * Math.PI * 2;
		const end = angle + sweep;
		const largeArc = sweep > Math.PI ? 1 : 0;

		const x1 = cx + radius * Math.cos(angle);
		const y1 = cy + radius * Math.sin(angle);
		const x2 = cx + radius * Math.cos(end);
		const y2 = cy + radius * Math.sin(end);

		let d: string;
		if (innerRadius > 0) {
			const ix1 = cx + innerRadius * Math.cos(end);
			const iy1 = cy + innerRadius * Math.sin(end);
			const ix2 = cx + innerRadius * Math.cos(angle);
			const iy2 = cy + innerRadius * Math.sin(angle);
			d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
		} else {
			d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
		}

		const slice = svgEl(svg, "path", { d, class: "nfo-chart-slice" });
		slice.style.fill = seriesColor(index);
		const percent = Math.round((value / total) * 100);
		svgEl(slice, "title").textContent = `${data.labels[index]}: ${formatNumber(value)} (${percent}%)`;

		// Only label slices with room for the text.
		if (config.showValues !== false && percent >= 6) {
			const mid = angle + sweep / 2;
			const labelRadius = innerRadius > 0 ? (radius + innerRadius) / 2 : radius * 0.65;
			text(
				svg,
				`${percent}%`,
				cx + labelRadius * Math.cos(mid),
				cy + labelRadius * Math.sin(mid) + 4,
				"nfo-chart-slice-label"
			);
		}
		angle = end;
	});

	if (innerRadius > 0) {
		text(svg, formatNumber(total), cx, cy - 2, "nfo-chart-donut-total");
		text(svg, data.valueLabel, cx, cy + 18, "nfo-chart-donut-caption");
	}
}

/** Pie and donut charts colour by label, so their legend is label-based. */
export function renderPieLegend(container: HTMLElement, data: ChartData): void {
	const legend = container.createDiv({ cls: "nfo-chart-legend" });
	data.labels.forEach((label, index) => {
		const item = legend.createDiv({ cls: "nfo-chart-legend-item" });
		const swatch = item.createSpan({ cls: "nfo-chart-swatch" });
		swatch.style.background = seriesColor(index);
		item.createSpan({ text: label });
	});
}
