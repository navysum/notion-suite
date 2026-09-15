import { setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { addMonths, calendarGrid, monthTitle, parseDate, sameDay, toISODate, WEEKDAY_LABELS } from "../utils/dates";
import { findProperty } from "../db/query";
import { autoColor } from "../utils/dom";
import { asText } from "../utils/text";

/**
 * Which month each calendar is showing.
 *
 * Keyed on the code block's own element (`stateHost`), not on the container we
 * draw into: the container is rebuilt on every refresh, so state stored against
 * it would be discarded the moment the user clicked "next month".
 */
const monthState = new WeakMap<HTMLElement, Date>();

export function renderCalendar(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[],
	stateHost: HTMLElement
): void {
	const dateKey =
		view.dateProperty ??
		view.groupBy ??
		properties.find((p) => ["date", "created", "updated"].includes(p.type))?.id;

	if (!dateKey) {
		container.createDiv({
			cls: "nfo-callout-error",
			text: "Calendar view needs a `date` property. Add one to the database, or set `date: <property>` on the view.",
		});
		return;
	}

	const dateProp = findProperty(ctx.schema, dateKey);
	if (!dateProp) {
		container.createDiv({
			cls: "nfo-callout-error",
			text: `Calendar view: no property named “${dateKey}” in this database.`,
		});
		return;
	}

	const host = container.createDiv({ cls: "nfo-calendar" });
	const current = monthState.get(stateHost) ?? new Date();
	monthState.set(stateHost, current);

	const nav = host.createDiv({ cls: "nfo-calendar-nav" });
	const prev = nav.createDiv({ cls: "nfo-calendar-nav-btn" });
	setIcon(prev, "chevron-left");
	nav.createDiv({ cls: "nfo-calendar-title", text: monthTitle(current) });
	const next = nav.createDiv({ cls: "nfo-calendar-nav-btn" });
	setIcon(next, "chevron-right");
	const todayBtn = nav.createDiv({ cls: "nfo-calendar-today", text: "Today" });

	prev.addEventListener("click", () => {
		monthState.set(stateHost, addMonths(current, -1));
		ctx.refresh();
	});
	next.addEventListener("click", () => {
		monthState.set(stateHost, addMonths(current, 1));
		ctx.refresh();
	});
	todayBtn.addEventListener("click", () => {
		monthState.set(stateHost, new Date());
		ctx.refresh();
	});

	const weekdays = host.createDiv({ cls: "nfo-calendar-weekdays" });
	for (const label of WEEKDAY_LABELS) weekdays.createDiv({ cls: "nfo-calendar-weekday", text: label });

	// Bucket rows by day once, rather than scanning all rows for each of 42 cells.
	const byDay = new Map<string, DatabaseRow[]>();
	for (const row of rows) {
		const date = parseDate(row.values[dateProp.id]);
		if (!date) continue;
		const key = toISODate(date);
		const bucket = byDay.get(key);
		if (bucket) bucket.push(row);
		else byDay.set(key, [row]);
	}

	const grid = host.createDiv({ cls: "nfo-calendar-grid" });
	const now = new Date();
	const colorProp = properties.find((p) => p.type === "select");

	for (const day of calendarGrid(current)) {
		const cell = grid.createDiv({ cls: "nfo-calendar-cell" });
		if (day.getMonth() !== current.getMonth()) cell.addClass("nfo-calendar-outside");
		if (sameDay(day, now)) cell.addClass("nfo-calendar-is-today");

		const header = cell.createDiv({ cls: "nfo-calendar-daynum", text: String(day.getDate()) });
		const addBtn = header.createSpan({ cls: "nfo-calendar-add" });
		setIcon(addBtn, "plus");
		addBtn.addEventListener("click", (evt) => {
			evt.stopPropagation();
			void (async () => {
				const file = await ctx.store.createRow(ctx.schema, "Untitled", {
					[dateProp.id]: toISODate(day),
				});
				// Stay on the calendar, as everywhere else.
				if (file) await ctx.app.workspace.getLeaf(false).openFile(file);
				ctx.refresh();
			})();
		});

		for (const row of byDay.get(toISODate(day)) ?? []) {
			const chip = cell.createDiv({ cls: "nfo-calendar-event", text: row.name });
			if (colorProp) {
				const value = row.values[colorProp.id];
				if (value) {
					const option = ctx.store.optionFor(colorProp, asText(value));
					chip.addClass(`nfo-color-${option?.color ?? autoColor(asText(value))}`);
				}
			}
			chip.addEventListener("click", (evt) => openRow(ctx, row.path, evt));
			chip.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));
		}
	}
}
