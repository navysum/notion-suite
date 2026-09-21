import { Menu, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig, ViewType } from "../types";
import { queryRows } from "../db/query";
import { runWrite, ViewContext } from "./context";
import { renderTable, createInlineRow, iconForType } from "./table";
import { renderBoard } from "./board";
import { renderGallery } from "./gallery";
import { renderList } from "./list";
import { renderCalendar } from "./calendar";
import { renderTimeline } from "./timeline";
import { formatValue } from "../db/value";
import { PropertyModal } from "../ui/propertyModal";
import { addEditButton } from "./blockEdit";
import { SurfaceState, surfaceState } from "./viewState";

/**
 * How many rows a view draws before offering the rest.
 *
 * Big enough that an ordinary database is never truncated, small enough that a
 * four-thousand-row import opens instantly instead of freezing the app.
 */
export const PAGE_SIZE = 100;

/**
 * How long the search box waits before re-running.
 *
 * Every keystroke used to redraw the whole view synchronously, so typing into a
 * large database stuttered a word behind. One render per pause instead.
 */
export const SEARCH_DEBOUNCE_MS = 150;

export function renderDatabaseView(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig
): void {
	container.empty();
	container.addClass("nfo-view");

	// `container` is the surface's stable host: the renderer empties it but never
	// replaces it. Everything below reads the state off `ctx`, so no sub-renderer
	// has an element to key state on. See viewState.ts.
	const state = surfaceState(container);
	const activeType = state.viewType ?? view.type;

	// A freshly created row asks to be renamed; the table consumes this once.
	ctx.requestTitleFocus = (path: string) => {
		state.focusRow = path;
	};
	ctx.collapsed = state.collapsed;
	ctx.selected = state.selected;
	ctx.takeTitleFocus = () => {
		const path = state.focusRow ?? null;
		state.focusRow = undefined;
		return path;
	};

	const properties = visibleProperties(ctx, view);
	let rows = queryRows(ctx.schema, ctx.store.rows(ctx.schema), view.filter, view.sorts, view.pageSize);
	if (state.search) rows = searchRows(rows, properties, state.search);

	renderToolbar(container, ctx, view, activeType, state, rows.length);

	// Changing the search is a new question, so start its answer at page one
	// rather than leaving a "show all" from the previous term in force.
	if (state.shownFor !== state.search) {
		state.shownFor = state.search;
		state.shown = PAGE_SIZE;
	}
	const total = rows.length;
	const shown = Math.min(state.shown ?? PAGE_SIZE, total);
	if (shown < total) rows = rows.slice(0, shown);

	const bodyEl = container.createDiv({ cls: "nfo-view-body" });
	switch (activeType) {
		case "board":
			renderBoard(bodyEl, ctx, view, rows, properties);
			break;
		case "gallery":
			renderGallery(bodyEl, ctx, view, rows, properties);
			break;
		case "list":
			renderList(bodyEl, ctx, view, rows, properties);
			break;
		case "calendar":
			renderCalendar(bodyEl, ctx, view, rows, properties, state);
			break;
		case "timeline":
			renderTimeline(bodyEl, ctx, view, rows, properties, state);
			break;
		default:
			renderTable(bodyEl, ctx, view, rows, properties);
	}

	if (shown < total) renderMore(container, ctx, state, shown, total);
}

/**
 * The footer offering the rows a view is holding back.
 *
 * Stating the real total matters as much as the button does: a silently
 * truncated view and a view that genuinely has a hundred rows look identical,
 * and the first one quietly lies about your data.
 */
function renderMore(
	container: HTMLElement,
	ctx: ViewContext,
	state: SurfaceState,
	shown: number,
	total: number
): void {
	const bar = container.createDiv({ cls: "nfo-more-bar" });
	bar.createSpan({
		cls: "nfo-more-count",
		text: `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`,
	});

	const step = Math.min(PAGE_SIZE, total - shown);
	const more = bar.createDiv({ cls: "nfo-more-btn", text: `Show ${step.toLocaleString()} more` });
	more.addEventListener("click", () => {
		state.shown = shown + PAGE_SIZE;
		ctx.refresh();
	});

	const rest = bar.createDiv({ cls: "nfo-more-btn nfo-more-all", text: "Show all" });
	rest.addEventListener("click", () => {
		state.shown = total;
		ctx.refresh();
	});
}

/**
 * Resolve which properties this view shows.
 *
 * Two levels of hiding, and they mean different things: a property hidden on
 * the schema is hidden everywhere, while `hiddenProperties` on a view hides it
 * in that view alone. Notion only has the second, which is what people
 * actually want -- the same database read two ways.
 */
function visibleProperties(ctx: ViewContext, view: ViewConfig): PropertyDef[] {
	const hiddenHere = new Set(view.hiddenProperties ?? []);
	const all = ctx.schema.properties.filter((p) => !p.hidden && !hiddenHere.has(p.id));
	const requested = view.visibleProperties ?? [];
	if (requested.length === 0) return all;

	const resolved: PropertyDef[] = [];
	for (const key of requested) {
		const needle = key.trim().toLowerCase();
		const match = ctx.schema.properties.find(
			(p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle
		);
		if (match && !resolved.includes(match) && !hiddenHere.has(match.id)) resolved.push(match);
	}
	return resolved.length > 0 ? resolved : all;
}

function searchRows(rows: DatabaseRow[], properties: PropertyDef[], term: string): DatabaseRow[] {
	const needle = term.toLowerCase();
	return rows.filter((row) => {
		if (row.name.toLowerCase().includes(needle)) return true;
		return properties.some((prop) =>
			formatValue(prop, row.values[prop.id]).toLowerCase().includes(needle)
		);
	});
}

function renderToolbar(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	activeType: ViewType,
	state: SurfaceState,
	rowCount: number
): void {
	const bar = container.createDiv({ cls: "nfo-toolbar" });

	const identity = bar.createDiv({ cls: "nfo-toolbar-identity" });
	if (ctx.schema.icon) identity.createSpan({ cls: "nfo-db-icon", text: ctx.schema.icon });
	identity.createSpan({
		cls: "nfo-db-name",
		text: view.name || ctx.schema.name,
	});
	identity.createSpan({ cls: "nfo-db-count", text: `${rowCount}` });

	const actions = bar.createDiv({ cls: "nfo-toolbar-actions" });

	const switcher = actions.createDiv({ cls: "nfo-toolbar-btn" });
	setIcon(switcher.createSpan(), viewIcon(activeType));
	switcher.createSpan({ text: capitalize(activeType) });
	switcher.addEventListener("click", (evt) => {
		const menu = new Menu();
		for (const type of [
			"table",
			"board",
			"gallery",
			"list",
			"calendar",
			"timeline",
		] as ViewType[]) {
			menu.addItem((item) =>
				item
					.setTitle(capitalize(type))
					.setIcon(viewIcon(type))
					.setChecked(type === activeType)
					.onClick(() => {
						// Switching sticks: write it back to the block, as Notion does.
						// Without a writable block it degrades to a session preview.
						state.viewType = type;
						if (ctx.persistKey) ctx.persistKey("view", type);
						else ctx.refresh();
					})
			);
		}
		menu.showAtMouseEvent(evt);
	});

	const propsBtn = actions.createDiv({ cls: "nfo-toolbar-btn" });
	setIcon(propsBtn.createSpan(), "settings-2");
	propsBtn.createSpan({ text: "Properties" });
	propsBtn.addEventListener("click", (evt) => {
		const menu = new Menu();
		const hiddenHere = new Set(view.hiddenProperties ?? []);
		for (const prop of ctx.schema.properties) {
			const shown = !prop.hidden && !hiddenHere.has(prop.id);
			menu.addItem((item) =>
				item
					.setTitle(prop.name)
					.setIcon(iconForType(prop.type))
					.setChecked(shown)
					.onClick(() => {
						// Hide in this view when the block can be written back to;
						// fall back to hiding everywhere when it cannot.
						if (ctx.persistKey) {
							const next = new Set(hiddenHere);
							if (shown) next.add(prop.id);
							else next.delete(prop.id);
							view.hiddenProperties = [...next];
							ctx.persistKey("hide", `[${[...next].join(", ")}]`);
							return;
						}
						runWrite(
							ctx,
							"hide that property",
							ctx.store.updateDatabase(ctx.schema.id, (schema) => {
								const target = schema.properties.find((p) => p.id === prop.id);
								if (target) target.hidden = !target.hidden;
							})
						);
					})
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("New property…")
				.setIcon("plus")
				.onClick(() => {
					new PropertyModal(ctx.app, ctx.store, ctx.schema, null, () => ctx.refresh()).open();
				})
		);
		menu.showAtMouseEvent(evt);
	});

	const search = actions.createEl("input", { cls: "nfo-search", type: "search" });
	search.placeholder = "Search…";
	search.value = state.search;
	// Searching redraws the whole view, so wait for a pause in typing rather
	// than paying for it on every keystroke. The input is not re-rendered in
	// between, so what you typed stays on screen either way.
	let pending: number | null = null;
	search.addEventListener("input", () => {
		if (pending !== null) window.clearTimeout(pending);
		pending = window.setTimeout(() => {
			pending = null;
			state.search = search.value;
			ctx.refresh();
			// Re-rendering replaces the input, so restore focus and caret position.
			const next = container.querySelector<HTMLInputElement>(".nfo-search");
			if (next) {
				next.focus();
				next.setSelectionRange(next.value.length, next.value.length);
			}
		}, SEARCH_DEBOUNCE_MS);
	});

	if (ctx.requestEdit) {
		addEditButton(actions, "Settings", ctx.requestEdit);
	}

	const newBtn = actions.createDiv({ cls: "nfo-toolbar-btn nfo-toolbar-primary" });
	setIcon(newBtn.createSpan(), "plus");
	newBtn.createSpan({ text: "New" });
	newBtn.addEventListener("click", () => void createInlineRow(ctx, view));
}

export function viewIcon(type: ViewType): string {
	switch (type) {
		case "board":
			return "columns";
		case "gallery":
			return "layout-grid";
		case "list":
			return "list";
		case "calendar":
			return "calendar";
		case "timeline":
			return "gantt-chart";
		default:
			return "table";
	}
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}
