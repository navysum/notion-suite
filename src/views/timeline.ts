import { setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { addMonths, formatDate, monthTitle, parseDate, sameDay } from "../utils/dates";
import { findProperty } from "../db/query";
import { autoColor } from "../utils/dom";
import { asText } from "../utils/text";
import { SurfaceState } from "./viewState";

type TimelineScale = "day" | "week" | "month";

/**
/** How many buckets a window holds, and how wide each one is drawn. */
const SCALES: Record<TimelineScale, { buckets: number; width: number }> = {
	day: { buckets: 28, width: 34 },
	week: { buckets: 18, width: 56 },
	month: { buckets: 12, width: 78 },
};

const DAY_MS = 86400000;

export function renderTimeline(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[],
	state: SurfaceState
): void {
	// The scale comes from hand-written block config, so an unknown value falls
	// back to days rather than producing a zero-width chart.
	const requested = view.timelineScale ?? "day";
	const scale: TimelineScale = requested in SCALES ? requested : "day";
	const spec = SCALES[scale];

	const startKey =
		view.timelineStart ??
		view.dateProperty ??
		properties.find((p) => ["date", "created", "updated"].includes(p.type))?.id;

	if (!startKey) {
		container.createDiv({
			cls: "nfo-callout-error",
			text: "Timeline view needs a `date` property. Add one to the database, or set `start: <property>` (and optionally `end: <property>`) on the view.",
		});
		return;
	}

	const startProp = findProperty(ctx.schema, startKey);
	if (!startProp) {
		container.createDiv({
			cls: "nfo-callout-error",
			text: `Timeline view: no property named “${startKey}” in this database.`,
		});
		return;
	}
	const endProp = view.timelineEnd ? findProperty(ctx.schema, view.timelineEnd) : undefined;

	const host = container.createDiv({ cls: "nfo-timeline" });
	// See viewState.ts: the anchor rides the surface state, never an element
	// drawn by this render.
	const anchor = state.timelineAnchor ?? new Date();
	state.timelineAnchor = anchor;
	const first = windowStart(anchor, scale);

	// Bucket boundaries are computed once and reused for every row, rather than
	// walking the calendar again for each bar.
	const buckets: Date[] = [];
	for (let i = 0; i < spec.buckets; i++) buckets.push(bucketStart(first, scale, i));
	const lastDay = bucketEndDay(buckets[buckets.length - 1], scale);
	const canvasWidth = spec.buckets * spec.width;

	renderNav(host, ctx, state, scale, spec.buckets, first, buckets[buckets.length - 1], lastDay);

	const chart = host.createDiv({ cls: "nfo-timeline-chart" });
	const labels = chart.createDiv({ cls: "nfo-timeline-labels" });
	labels.createDiv({ cls: "nfo-timeline-labels-head" });

	const scroll = chart.createDiv({ cls: "nfo-timeline-scroll" });
	const canvas = scroll.createDiv({ cls: "nfo-timeline-canvas" });
	canvas.style.width = `${canvasWidth}px`;

	const now = new Date();
	const todayIndex = bucketIndex(now, first, scale);

	const head = canvas.createDiv({ cls: "nfo-timeline-head" });
	for (let i = 0; i < buckets.length; i++) {
		const cell = head.createDiv({ cls: "nfo-timeline-head-cell" });
		cell.style.width = `${spec.width}px`;
		if (i === todayIndex) cell.addClass("nfo-timeline-is-today");
		const parts = bucketLabel(buckets[i], scale);
		cell.createDiv({ cls: "nfo-timeline-head-top", text: parts[0] });
		cell.createDiv({ cls: "nfo-timeline-head-sub", text: parts[1] });
	}

	const body = canvas.createDiv({ cls: "nfo-timeline-body" });
	if (todayIndex >= 0 && todayIndex < spec.buckets) {
		const marker = body.createDiv({ cls: "nfo-timeline-today-line" });
		marker.style.left = `${todayIndex * spec.width}px`;
	}

	const colorProp = properties.find((p) => ["select", "status"].includes(p.type));
	const unscheduled: DatabaseRow[] = [];

	for (const row of rows) {
		const start = parseDate(row.values[startProp.id]);
		if (!start) {
			unscheduled.push(row);
			continue;
		}
		// An end before its start is a typo in someone's frontmatter, not a
		// reason to draw a negative-width bar: fall back to a single day.
		let end = endProp ? parseDate(row.values[endProp.id]) : null;
		if (end && end.getTime() < start.getTime()) end = null;

		const label = labels.createDiv({ cls: "nfo-timeline-label", text: row.name });
		label.setAttribute("title", row.name);
		label.addEventListener("click", (evt) => openRow(ctx, row.path, evt));
		label.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));

		const track = body.createDiv({ cls: "nfo-timeline-track" });
		track.style.backgroundSize = `${spec.width}px 100%`;

		const rawFrom = bucketIndex(start, first, scale);
		const rawTo = bucketIndex(end ?? start, first, scale);
		if (rawTo < 0 || rawFrom > spec.buckets - 1) continue; // outside this window

		const from = Math.max(0, rawFrom);
		const to = Math.min(spec.buckets - 1, rawTo);
		const bar = track.createDiv({ cls: end ? "nfo-timeline-bar" : "nfo-timeline-bar nfo-timeline-point" });
		bar.style.left = `${from * spec.width + 1}px`;
		bar.style.width = end
			? `${Math.max(8, (to - from + 1) * spec.width - 2)}px`
			: `${Math.min(14, Math.max(8, spec.width - 2))}px`;
		if (rawFrom < 0) bar.addClass("nfo-timeline-clip-start");
		if (rawTo > spec.buckets - 1) bar.addClass("nfo-timeline-clip-end");

		if (colorProp) {
			const value = asText(row.values[colorProp.id]);
			if (value) {
				const option = ctx.store.optionFor(colorProp, value);
				bar.addClass(`nfo-color-${option?.color ?? autoColor(value)}`);
			}
		}

		const range = end && !sameDay(start, end)
			? `${formatDate(start)} → ${formatDate(end)}`
			: formatDate(start);
		bar.setAttribute("title", `${row.name}\n${range}`);
		bar.createSpan({ cls: "nfo-timeline-bar-label", text: row.name });
		bar.addEventListener("click", (evt) => openRow(ctx, row.path, evt));
		bar.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));
	}

	if (rows.length === 0) {
		host.createDiv({ cls: "nfo-timeline-empty", text: "No rows to show." });
	}

	if (unscheduled.length > 0) {
		const section = host.createDiv({ cls: "nfo-timeline-unscheduled" });
		section.createDiv({
			cls: "nfo-timeline-unscheduled-title",
			text: `Unscheduled (${unscheduled.length})`,
		});
		const list = section.createDiv({ cls: "nfo-timeline-unscheduled-list" });
		for (const row of unscheduled) {
			const chip = list.createDiv({ cls: "nfo-timeline-unscheduled-item", text: row.name });
			chip.addEventListener("click", (evt) => openRow(ctx, row.path, evt));
			chip.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));
		}
	}
}

function renderNav(
	host: HTMLElement,
	ctx: ViewContext,
	state: SurfaceState,
	scale: TimelineScale,
	buckets: number,
	first: Date,
	lastBucket: Date,
	lastDay: Date
): void {
	const nav = host.createDiv({ cls: "nfo-timeline-nav" });
	const prev = nav.createDiv({ cls: "nfo-timeline-nav-btn" });
	setIcon(prev, "chevron-left");
	nav.createDiv({ cls: "nfo-timeline-title", text: windowTitle(first, lastBucket, lastDay, scale) });
	const next = nav.createDiv({ cls: "nfo-timeline-nav-btn" });
	setIcon(next, "chevron-right");
	const todayBtn = nav.createDiv({ cls: "nfo-timeline-today", text: "Today" });

	prev.addEventListener("click", () => {
		state.timelineAnchor = shift(first, scale, -buckets);
		ctx.refresh();
	});
	next.addEventListener("click", () => {
		state.timelineAnchor = shift(first, scale, buckets);
		ctx.refresh();
	});
	todayBtn.addEventListener("click", () => {
		state.timelineAnchor = new Date();
		ctx.refresh();
	});
}

/** Local midnight, so bucket maths never trips over a time-of-day component. */
function midnight(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole days between two dates, DST-safe because both ends are local midnight. */
function dayDiff(from: Date, to: Date): number {
	return Math.round((midnight(to).getTime() - midnight(from).getTime()) / DAY_MS);
}

/** The Sunday on or before `d`, matching the calendar view's week start. */
function weekStart(d: Date): Date {
	const start = midnight(d);
	start.setDate(start.getDate() - start.getDay());
	return start;
}

function windowStart(anchor: Date, scale: TimelineScale): Date {
	if (scale === "month") return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
	return weekStart(anchor);
}

function bucketStart(first: Date, scale: TimelineScale, index: number): Date {
	if (scale === "month") return addMonths(first, index);
	const d = new Date(first);
	d.setDate(first.getDate() + index * (scale === "week" ? 7 : 1));
	return d;
}

/** The last day covered by a bucket, used for the window title. */
function bucketEndDay(start: Date, scale: TimelineScale): Date {
	const d = new Date(start);
	if (scale === "month") {
		d.setMonth(d.getMonth() + 1);
		d.setDate(0);
	} else if (scale === "week") {
		d.setDate(d.getDate() + 6);
	}
	return d;
}

/** Which bucket a date falls in; may be negative or past the end of the window. */
function bucketIndex(date: Date, first: Date, scale: TimelineScale): number {
	if (scale === "month") {
		return (date.getFullYear() - first.getFullYear()) * 12 + (date.getMonth() - first.getMonth());
	}
	const days = dayDiff(first, date);
	return scale === "week" ? Math.floor(days / 7) : days;
}

function shift(first: Date, scale: TimelineScale, delta: number): Date {
	if (scale === "month") return addMonths(first, delta);
	const d = new Date(first);
	d.setDate(first.getDate() + delta * (scale === "week" ? 7 : 1));
	return d;
}

function bucketLabel(start: Date, scale: TimelineScale): [string, string] {
	const month = monthTitle(start).slice(0, 3);
	if (scale === "month") return [month, String(start.getFullYear())];
	if (scale === "week") return [`${month} ${start.getDate()}`, "wk"];
	return [String(start.getDate()), ["S", "M", "T", "W", "T", "F", "S"][start.getDay()]];
}

function windowTitle(first: Date, lastBucket: Date, lastDay: Date, scale: TimelineScale): string {
	if (scale === "month") return `${monthTitle(first)} – ${monthTitle(lastBucket)}`;
	return `${formatDate(first)} – ${formatDate(lastDay)}`;
}

