import { Menu, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { findProperty, groupRows, RowGroup } from "../db/query";
import { formatValue, isEmpty } from "../db/value";
import { autoColor, pill } from "../utils/dom";
import { asText } from "../utils/text";
import { createInlineRow, renderTemplatePicker } from "./table";
import { positionFor, sortByOrder } from "../db/order";

/**
 * Kanban board. Cards are dragged between columns; dropping writes the new
 * group value straight into the note's frontmatter, so the board and the
 * markdown never disagree.
 */
export function renderBoard(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[]
): void {
	const groupKey = view.groupBy ?? firstGroupableProperty(ctx, properties);
	if (!groupKey) {
		container.createDiv({
			cls: "nfo-callout-error",
			text: "Board view needs a `group` property (a select, multi-select or checkbox).",
		});
		return;
	}

	const groupProp = findProperty(ctx.schema, groupKey);
	const groups = groupRows(ctx.schema, rows, groupKey, { dateBuckets: view.dateBuckets });
	const board = container.createDiv({ cls: "nfo-board" });
	const cardProperties = properties.filter((p) => p.id !== groupProp?.id);
	const collapsed = new Set(view.collapsedGroups ?? []);
	const limits = view.limits ?? {};

	for (const group of groups) {
		const column = board.createDiv({ cls: "nfo-board-column" });
		const isCollapsed = collapsed.has(group.key);
		if (isCollapsed) column.addClass("nfo-board-collapsed");

		const header = column.createDiv({ cls: "nfo-board-header" });

		const twisty = header.createSpan({ cls: "nfo-board-twisty" });
		setIcon(twisty, isCollapsed ? "chevron-right" : "chevron-down");
		twisty.setAttribute("aria-label", isCollapsed ? "Expand column" : "Collapse column");
		twisty.addEventListener("click", () => toggleCollapsed(ctx, view, group.key));

		if (group.key === "") {
			header.createSpan({ cls: "nfo-pill nfo-color-default", text: group.label });
		} else {
			const option = groupProp ? ctx.store.optionFor(groupProp, group.key) : undefined;
			pill(header, group.label, option?.color ?? autoColor(group.key));
		}

		// A limit is a signal, not a rule: it colours the count, never blocks a drop.
		const limit = limits[group.key];
		const count = header.createSpan({ cls: "nfo-board-count" });
		count.setText(limit ? `${group.rows.length} / ${limit}` : String(group.rows.length));
		if (limit && group.rows.length > limit) count.addClass("nfo-board-over");

		const more = header.createSpan({ cls: "nfo-board-more" });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (evt) => columnMenu(evt, ctx, view, group, limit));

		if (isCollapsed) continue;

		const list = column.createDiv({ cls: "nfo-board-cards" });

		// Drop target: the whole column body, so a card can land in empty space.
		list.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			list.addClass("nfo-drop-active");
		});
		list.addEventListener("dragleave", () => list.removeClass("nfo-drop-active"));
		list.addEventListener("drop", (evt) => {
			evt.preventDefault();
			list.removeClass("nfo-drop-active");
			const path = evt.dataTransfer?.getData("text/nfo-row");
			if (!path || !groupProp) return;
			const from = evt.dataTransfer?.getData("text/nfo-group") ?? "";
			// Dropping on the column body, past the cards, means "last".
			void moveCard(ctx, path, groupProp, from, group.key, group.rows, group.rows.length);
		});

		const subKey = view.subGroupBy;
		if (subKey) {
			// Sub-grouping splits each column, so a Status board can read
			// Priority-first inside every column.
			const subProp = findProperty(ctx.schema, subKey);
			for (const sub of groupRows(ctx.schema, group.rows, subKey)) {
				const band = list.createDiv({ cls: "nfo-board-subgroup" });
				const bandHead = band.createDiv({ cls: "nfo-board-subhead" });
				const option = subProp ? ctx.store.optionFor(subProp, sub.key) : undefined;
				pill(bandHead, sub.label, option?.color ?? autoColor(sub.key));
				bandHead.createSpan({ cls: "nfo-board-count", text: String(sub.rows.length) });
				for (const row of sub.rows) {
					renderCard(band, ctx, row, cardProperties, view, group.key, [], 0, groupProp);
				}
			}
		} else {
			// Manual order only applies inside a column, which is where dragging
			// to reorder happens.
			const columnRows = sortByOrder(ctx.schema, group.rows);
			columnRows.forEach((row, position) => {
				renderCard(list, ctx, row, cardProperties, view, group.key, columnRows, position, groupProp);
			});
		}

		const add = column.createDiv({ cls: "nfo-board-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "New" });
		renderTemplatePicker(add, ctx, view);
		add.addEventListener("click", () => {
			const seed: Record<string, unknown> = {};
			if (groupProp && group.key !== "") {
				seed[groupProp.id] =
					groupProp.type === "multiselect"
						? [group.key]
						: groupProp.type === "checkbox"
							? group.key === "Checked"
							: group.key;
			}
			void createInlineRow(ctx, view, seed);
		});
	}
}

/** Fold a column away, remembering it in the block. */
function toggleCollapsed(ctx: ViewContext, view: ViewConfig, key: string): void {
	const next = new Set(view.collapsedGroups ?? []);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	view.collapsedGroups = [...next];
	if (ctx.persistKey) ctx.persistKey("collapsed", `[${[...next].join(", ")}]`);
	else ctx.refresh();
}

/** Per-column actions: the limit, and collapsing. */
function columnMenu(
	evt: MouseEvent,
	ctx: ViewContext,
	view: ViewConfig,
	group: RowGroup,
	limit: number | undefined
): void {
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle(view.collapsedGroups?.includes(group.key) ? "Expand" : "Collapse")
			.setIcon("chevrons-down-up")
			.onClick(() => toggleCollapsed(ctx, view, group.key))
	);
	menu.addSeparator();
	for (const option of [3, 5, 8, 10, 15]) {
		menu.addItem((item) =>
			item
				.setTitle(`Limit ${option}`)
				.setChecked(limit === option)
				.onClick(() => setLimit(ctx, view, group.key, option))
		);
	}
	if (limit) {
		menu.addItem((item) =>
			item
				.setTitle("No limit")
				.setIcon("x")
				.onClick(() => setLimit(ctx, view, group.key, null))
		);
	}
	menu.showAtMouseEvent(evt);
}

function setLimit(
	ctx: ViewContext,
	view: ViewConfig,
	key: string,
	limit: number | null
): void {
	const next = { ...(view.limits ?? {}) };
	if (limit === null) delete next[key];
	else next[key] = limit;
	view.limits = next;
	const encoded = Object.entries(next).map(([k, v]) => `${k}: ${v}`).join(", ");
	if (ctx.persistKey) ctx.persistKey("limits", `{${encoded}}`);
	else ctx.refresh();
}

async function moveCard(
	ctx: ViewContext,
	path: string,
	groupProp: PropertyDef,
	sourceKey: string,
	targetKey: string,
	siblings: DatabaseRow[] = [],
	index = -1
): Promise<void> {
	// Reordering within one column is a position change, not a group change.
	if (sourceKey === targetKey) {
		if (index >= 0) await reorderWithin(ctx, path, siblings, index);
		return;
	}

	let value: unknown;
	if (groupProp.type === "multiselect") {
		// A card can sit in several columns at once, so a move swaps just the
		// column it was dragged from and leaves its other values intact.
		const row = ctx.store.rows(ctx.schema).find((r) => r.path === path);
		const existing = row?.values[groupProp.id];
		const current = Array.isArray(existing) ? (existing as unknown[]).map(asText) : [];
		const remaining = current.filter((v) => v !== sourceKey);
		value = targetKey === "" ? remaining : [...new Set([...remaining, targetKey])];
	} else if (targetKey === "") {
		value = null;
	} else if (groupProp.type === "checkbox") {
		value = targetKey === "Checked";
	} else {
		value = targetKey;
	}

	await ctx.store.setValue(ctx.schema, path, groupProp.id, value);
	if (index >= 0) await reorderWithin(ctx, path, siblings, index);
	ctx.refresh();
}

/**
 * Write a row's new position, plus any respacing the move forced.
 *
 * Does nothing at all when the database has no order property: manual order
 * costs a property, and silently creating one behind the user's back would
 * write to every note in the database.
 */
async function reorderWithin(
	ctx: ViewContext,
	path: string,
	siblings: DatabaseRow[],
	index: number
): Promise<void> {
	const orderKey = ctx.schema.orderProperty;
	if (!orderKey) return;
	const moving = ctx.store.rows(ctx.schema).find((row) => row.path === path);
	if (!moving) return;

	const ordered = sortByOrder(ctx.schema, siblings);
	const { value, renumber } = positionFor(ctx.schema, ordered, index, moving);
	for (const entry of renumber) {
		await ctx.store.setValue(ctx.schema, entry.row.path, orderKey, entry.value);
	}
	await ctx.store.setValue(ctx.schema, path, orderKey, value);
}

function renderCard(
	parent: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	properties: PropertyDef[],
	view: ViewConfig,
	groupKey: string,
	siblings: DatabaseRow[] = [],
	position = 0,
	groupProp?: PropertyDef
): void {
	const card = parent.createDiv({ cls: "nfo-card" });
	card.setAttribute("draggable", "true");

	card.addEventListener("dragstart", (evt) => {
		evt.dataTransfer?.setData("text/nfo-row", row.path);
		evt.dataTransfer?.setData("text/nfo-group", groupKey);
		card.addClass("nfo-card-dragging");
	});
	card.addEventListener("dragend", () => card.removeClass("nfo-card-dragging"));

	// Dropping onto a card inserts relative to it, which is what makes
	// reordering inside a column possible at all.
	if (ctx.schema.orderProperty) {
		card.addEventListener("dragover", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			const rect = card.getBoundingClientRect();
			const below = evt.clientY > rect.top + rect.height / 2;
			card.removeClass("nfo-card-drop-above", "nfo-card-drop-below");
			card.addClass(below ? "nfo-card-drop-below" : "nfo-card-drop-above");
		});
		card.addEventListener("dragleave", () =>
			card.removeClass("nfo-card-drop-above", "nfo-card-drop-below")
		);
		card.addEventListener("drop", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			card.removeClass("nfo-card-drop-above", "nfo-card-drop-below");
			const moved = evt.dataTransfer?.getData("text/nfo-row");
			const from = evt.dataTransfer?.getData("text/nfo-group") ?? "";
			if (!moved || !groupProp) return;
			const rect = card.getBoundingClientRect();
			const below = evt.clientY > rect.top + rect.height / 2;
			void moveCard(ctx, moved, groupProp, from, groupKey, siblings, position + (below ? 1 : 0));
		});
	}

	if (view.coverProperty) {
		const cover = coverUrl(ctx, row, view.coverProperty);
		if (cover) {
			const img = card.createEl("img", { cls: "nfo-card-cover" });
			img.src = cover;
		}
	}

	const title = card.createDiv({ cls: "nfo-card-title", text: row.name });
	title.addEventListener("click", (evt) => openRow(ctx, row.path, evt));
	card.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));

	const meta = card.createDiv({ cls: "nfo-card-meta" });
	for (const prop of properties.slice(0, 4)) {
		const value = row.values[prop.id];
		if (isEmpty(value) && prop.type !== "checkbox") continue;

		if (prop.type === "select" || prop.type === "status") {
			const option = ctx.store.optionFor(prop, String(value));
			pill(meta, String(value), option?.color ?? autoColor(String(value)));
		} else if (prop.type === "multiselect") {
			for (const item of value as string[]) {
				const option = ctx.store.optionFor(prop, item);
				pill(meta, item, option?.color ?? autoColor(item));
			}
		} else if (prop.type === "checkbox") {
			const chip = meta.createSpan({ cls: "nfo-card-field" });
			setIcon(chip.createSpan(), value ? "check-square" : "square");
			chip.createSpan({ text: prop.name });
		} else {
			const chip = meta.createSpan({ cls: "nfo-card-field" });
			chip.createSpan({ cls: "nfo-card-field-name", text: `${prop.name}:` });
			chip.createSpan({ text: formatValue(prop, value) });
		}
	}
}

export function coverUrl(ctx: ViewContext, row: DatabaseRow, propertyId: string): string | null {
	const raw = row.values[propertyId];
	const first = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
	const text = asText(first);
	if (!text) return null;
	if (/^https?:\/\//.test(text)) return text;

	// Otherwise treat it as a vault path or wikilink to an attachment.
	const linkText = text.replace(/^!?\[\[|\]\]$/g, "");
	const file = ctx.app.metadataCache.getFirstLinkpathDest(linkText, row.path);
	return file ? ctx.app.vault.getResourcePath(file) : null;
}

function firstGroupableProperty(ctx: ViewContext, properties: PropertyDef[]): string | null {
	const candidate = properties.find((p) =>
		["status", "select", "multiselect", "checkbox"].includes(p.type)
	);
	return candidate ? candidate.id : null;
}
