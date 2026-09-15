import { setIcon } from "obsidian";
import { DatabaseRow, DatabaseSchema, PropertyDef } from "../types";
import { applyFilter, findProperty, queryRows } from "../db/query";
import { collapse, gatherValues } from "../db/rollup";
import { coerce, formatValue, isEmpty } from "../db/value";
import { formatDate, parseDate } from "../utils/dates";
import { ViewContext, openRow } from "../views/context";
import type {
	ButtonWidget,
	CountdownWidget,
	ListWidget,
	MetricWidget,
	ProgressWidget,
	Widget,
} from "./widget";
import {
	countdownDays,
	formatFigure,
	isPercentAggregate,
	pickCountdownDate,
	progressPercent,
} from "./widget";

/**
 * The widget renderers.
 *
 * Every card is plain DOM built through Obsidian's element helpers, and every
 * colour resolves through the plugin's `--nfo-*` custom properties, so a
 * dashboard follows the user's theme in light and dark without a repaint.
 */

/** Property types the plugin computes rather than stores; never written to. */
const COMPUTED_TYPES = ["formula", "rollup", "created", "updated"];

function card(parent: HTMLElement, kind: string): HTMLElement {
	return parent.createDiv({ cls: `nfo-widget nfo-widget-${kind}` });
}

/** The same error presentation the code-block processors use, card-sized. */
function cardError(parent: HTMLElement, message: string): void {
	const box = parent.createDiv({ cls: "nfo-widget nfo-callout-error" });
	box.createDiv({ cls: "nfo-callout-error-title", text: "Notion for Obsidian" });
	box.createDiv({ text: message });
}

function caption(parent: HTMLElement, text: string | undefined): void {
	if (text) parent.createDiv({ cls: "nfo-widget-label", text });
}

/**
 * Widgets each name their own database, so a dashboard can mix several. The
 * context handed in carries the block's own schema; each card swaps in the one
 * it asked for.
 */
function contextFor(ctx: ViewContext, database: string): ViewContext | null {
	const schema = ctx.store.get(database);
	if (!schema) return null;
	return { ...ctx, schema };
}

export function renderWidgetCard(parent: HTMLElement, ctx: ViewContext, widget: Widget): void {
	// A countdown to a literal date is the one widget that needs no database.
	if (widget.kind === "countdown" && !widget.database) {
		renderCountdown(parent, null, widget);
		return;
	}

	const database = widget.kind === "countdown" ? widget.database ?? "" : widget.database;
	const scoped = contextFor(ctx, database);
	if (!scoped) {
		cardError(parent, `No database called “${database}”. Check the spelling of \`database:\`.`);
		return;
	}

	switch (widget.kind) {
		case "metric":
			renderMetric(parent, scoped, widget);
			return;
		case "progress":
			renderProgress(parent, scoped, widget);
			return;
		case "countdown":
			renderCountdown(parent, scoped, widget);
			return;
		case "list":
			renderList(parent, scoped, widget);
			return;
		default:
			renderButton(parent, scoped, widget);
	}
}

// --- metric ----------------------------------------------------------------

/**
 * Gather the values the aggregate collapses. A list-valued property
 * contributes each of its entries, which is what makes "count unique" over a
 * multi-select count tags rather than rows.
 */
function renderMetric(parent: HTMLElement, ctx: ViewContext, widget: MetricWidget): void {
	const prop = widget.value ? findProperty(ctx.schema, widget.value) : undefined;
	if (widget.value && !prop) {
		cardError(parent, `“${ctx.schema.name}” has no property called “${widget.value}”.`);
		return;
	}

	const rows = applyFilter(ctx.schema, ctx.store.rows(ctx.schema), widget.filter);
	// `collapse` already implements every aggregation the rollup menu offers.
	const result = collapse(gatherValues(rows, prop?.id), rows.length, widget.aggregate);

	const box = card(parent, "metric");
	const figure = box.createDiv({ cls: "nfo-widget-figure" });
	if (widget.prefix) figure.createSpan({ cls: "nfo-widget-affix", text: widget.prefix });
	figure.createSpan({ cls: "nfo-widget-number", text: formatFigure(result) });

	const suffix = widget.suffix ?? (isPercentAggregate(widget.aggregate) ? "%" : undefined);
	if (suffix) figure.createSpan({ cls: "nfo-widget-affix", text: suffix });

	caption(box, widget.label ?? ctx.schema.name);
}

// --- progress --------------------------------------------------------------

function renderProgress(parent: HTMLElement, ctx: ViewContext, widget: ProgressWidget): void {
	const all = ctx.store.rows(ctx.schema);
	const pool = widget.totalFilter ? applyFilter(ctx.schema, all, widget.totalFilter) : all;
	const done = applyFilter(ctx.schema, pool, widget.filter).length;
	const percent = progressPercent(done, pool.length);

	const box = card(parent, "progress");
	const head = box.createDiv({ cls: "nfo-widget-progress-head" });
	head.createSpan({ cls: "nfo-widget-label", text: widget.label ?? ctx.schema.name });
	head.createSpan({ cls: "nfo-widget-percent", text: `${percent}%` });

	const track = box.createDiv({ cls: "nfo-widget-track" });
	const fill = track.createDiv({ cls: "nfo-widget-fill" });
	fill.style.width = `${percent}%`;
	if (percent >= 100) fill.addClass("is-complete");

	box.createDiv({ cls: "nfo-widget-sub", text: `${done} of ${pool.length}` });
}

// --- countdown -------------------------------------------------------------

function countdownTarget(ctx: ViewContext | null, widget: CountdownWidget): Date | null {
	if (!ctx || !widget.dateProperty) return parseDate(widget.date);

	const prop = findProperty(ctx.schema, widget.dateProperty);
	if (!prop) return null;

	const rows = applyFilter(ctx.schema, ctx.store.rows(ctx.schema), widget.filter);
	const dates: Date[] = [];
	for (const row of rows) {
		const date = parseDate(row.values[prop.id]);
		if (date) dates.push(date);
	}
	return pickCountdownDate(dates);
}

function renderCountdown(
	parent: HTMLElement,
	ctx: ViewContext | null,
	widget: CountdownWidget
): void {
	if (ctx && widget.dateProperty && !findProperty(ctx.schema, widget.dateProperty)) {
		cardError(parent, `“${ctx.schema.name}” has no property called “${widget.dateProperty}”.`);
		return;
	}

	const target = countdownTarget(ctx, widget);
	const box = card(parent, "countdown");

	if (!target) {
		box.createDiv({ cls: "nfo-widget-figure" }).createSpan({
			cls: "nfo-widget-number",
			text: "—",
		});
		caption(box, widget.label ?? "No date to count down to");
		return;
	}

	const days = countdownDays(target);
	const figure = box.createDiv({ cls: "nfo-widget-figure" });
	if (days === 0) {
		figure.createSpan({ cls: "nfo-widget-number", text: "Today" });
	} else {
		figure.createSpan({ cls: "nfo-widget-number", text: String(Math.abs(days)) });
		figure.createSpan({
			cls: "nfo-widget-affix",
			text: Math.abs(days) === 1 ? "day" : "days",
		});
	}
	if (days < 0) box.addClass("is-overdue");

	const when = formatDate(target);
	const phrase = days === 0 ? when : days > 0 ? `until ${when}` : `since ${when}`;
	caption(box, widget.label ? `${widget.label} · ${phrase}` : phrase);
}

// --- list ------------------------------------------------------------------

function renderList(parent: HTMLElement, ctx: ViewContext, widget: ListWidget): void {
	const rows = queryRows(
		ctx.schema,
		ctx.store.rows(ctx.schema),
		widget.filter,
		widget.sorts,
		widget.limit
	);
	const prop = widget.show ? findProperty(ctx.schema, widget.show) : undefined;

	const box = card(parent, "list");
	caption(box, widget.label ?? ctx.schema.name);

	const list = box.createDiv({ cls: "nfo-widget-list" });
	for (const row of rows) {
		const item = list.createDiv({ cls: "nfo-widget-item" });
		const title = item.createSpan({ cls: "nfo-widget-item-title", text: row.name });
		title.addEventListener("click", (evt) => openRow(ctx, row.path, evt));

		if (prop) {
			const value = row.values[prop.id];
			if (!isEmpty(value)) {
				item.createSpan({ cls: "nfo-widget-item-meta", text: formatValue(prop, value) });
			}
		}
	}

	if (rows.length === 0) {
		list.createDiv({ cls: "nfo-widget-empty", text: "Nothing to show yet." });
	}
}

// --- button ----------------------------------------------------------------

/**
 * Translate the block's `set:` map into frontmatter keys.
 *
 * Computed properties are dropped here as well as in the store: a formula or a
 * "last edited" stamp has no stored value to write, and writing one would be
 * overwritten (or worse, believed) on the next read.
 */
function buildSeed(schema: DatabaseSchema, set: Record<string, unknown>): Record<string, unknown> {
	const seed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(set)) {
		const prop = findProperty(schema, key);
		if (!prop) {
			// An unknown key is still a legitimate frontmatter key to write.
			seed[key] = value;
			continue;
		}
		if (COMPUTED_TYPES.includes(prop.type)) continue;
		seed[prop.id] = coerce(prop, value);
	}
	return seed;
}

function renderButton(parent: HTMLElement, ctx: ViewContext, widget: ButtonWidget): void {
	const box = card(parent, "button");
	const button = box.createEl("button", { cls: "nfo-widget-button" });
	setIcon(button.createSpan({ cls: "nfo-widget-button-icon" }), "plus");
	button.createSpan({ text: widget.label });

	button.addEventListener("click", () => {
		button.disabled = true;
		const name = widget.rowName ?? widget.label;
		// `createRow` owns the frontmatter guards, so every button goes through
		// it rather than writing the note itself.
		void ctx.store
			.createRow(ctx.schema, name, buildSeed(ctx.schema, widget.set))
			.then(() => ctx.refresh())
			.catch((e: unknown) => {
				button.disabled = false;
				box.createDiv({
					cls: "nfo-widget-error",
					text: `Could not add a row: ${(e as Error).message}`,
				});
			});
	});
}
