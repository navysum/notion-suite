import { Menu, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig, ViewType } from "../types";
import { queryRows } from "../db/query";
import { ViewContext } from "./context";
import { renderTable, createInlineRow, iconForType } from "./table";
import { renderBoard } from "./board";
import { renderGallery } from "./gallery";
import { renderList } from "./list";
import { renderCalendar } from "./calendar";
import { renderTimeline } from "./timeline";
import { formatValue } from "../db/value";
import { PropertyModal } from "../ui/propertyModal";
import { addEditButton } from "./blockEdit";

/** Per-block UI state that should survive a re-render but not be persisted. */
interface BlockState {
	search: string;
	viewType?: ViewType;
	/** Row whose title should open for editing on the next render. */
	focusRow?: string;
}

const blockState = new WeakMap<HTMLElement, BlockState>();

export function renderDatabaseView(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig
): void {
	container.empty();
	container.addClass("nfo-view");

	const state = blockState.get(container) ?? { search: "" };
	blockState.set(container, state);
	const activeType = state.viewType ?? view.type;

	// A freshly created row asks to be renamed; the table consumes this once.
	ctx.requestTitleFocus = (path: string) => {
		state.focusRow = path;
	};
	ctx.takeTitleFocus = () => {
		const path = state.focusRow ?? null;
		state.focusRow = undefined;
		return path;
	};

	const properties = visibleProperties(ctx, view);
	let rows = queryRows(ctx.schema, ctx.store.rows(ctx.schema), view.filter, view.sorts, view.pageSize);
	if (state.search) rows = searchRows(rows, properties, state.search);

	renderToolbar(container, ctx, view, activeType, state, rows.length);

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
			// `container` is the stable code-block element; the calendar keeps its
			// current month against it so navigation survives a re-render.
			renderCalendar(bodyEl, ctx, view, rows, properties, container);
			break;
		case "timeline":
			renderTimeline(bodyEl, ctx, view, rows, properties, container);
			break;
		default:
			renderTable(bodyEl, ctx, view, rows, properties);
	}
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
	state: BlockState,
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
						void ctx.store
							.updateDatabase(ctx.schema.id, (schema) => {
								const target = schema.properties.find((p) => p.id === prop.id);
								if (target) target.hidden = !target.hidden;
							})
							.then(() => ctx.refresh());
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
	search.addEventListener("input", () => {
		state.search = search.value;
		ctx.refresh();
		// Re-rendering replaces the input, so restore focus and caret position.
		const next = container.querySelector<HTMLInputElement>(".nfo-search");
		if (next) {
			next.focus();
			next.setSelectionRange(next.value.length, next.value.length);
		}
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
