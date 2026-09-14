import { setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { findProperty, groupRows } from "../db/query";
import { formatValue, isEmpty } from "../db/value";
import { autoColor, pill } from "../utils/dom";
import { createInlineRow } from "./table";

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
	const groups = groupRows(ctx.schema, rows, groupKey);
	const board = container.createDiv({ cls: "nfo-board" });
	const cardProperties = properties.filter((p) => p.id !== groupProp?.id);

	for (const group of groups) {
		const column = board.createDiv({ cls: "nfo-board-column" });
		const header = column.createDiv({ cls: "nfo-board-header" });
		if (group.key === "") {
			header.createSpan({ cls: "nfo-pill nfo-color-default", text: group.label });
		} else {
			const option = groupProp ? ctx.store.optionFor(groupProp, group.key) : undefined;
			pill(header, group.label, option?.color ?? autoColor(group.key));
		}
		header.createSpan({ cls: "nfo-board-count", text: String(group.rows.length) });

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
			void moveCard(ctx, path, groupProp, from, group.key);
		});

		for (const row of group.rows) {
			renderCard(list, ctx, row, cardProperties, view, group.key);
		}

		const add = column.createDiv({ cls: "nfo-board-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "New" });
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

async function moveCard(
	ctx: ViewContext,
	path: string,
	groupProp: PropertyDef,
	sourceKey: string,
	targetKey: string
): Promise<void> {
	if (sourceKey === targetKey) return;

	let value: unknown;
	if (groupProp.type === "multiselect") {
		// A card can sit in several columns at once, so a move swaps just the
		// column it was dragged from and leaves its other values intact.
		const row = ctx.store.rows(ctx.schema).find((r) => r.path === path);
		const current = Array.isArray(row?.values[groupProp.id])
			? (row!.values[groupProp.id] as string[]).map(String)
			: [];
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
	ctx.refresh();
}

function renderCard(
	parent: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	properties: PropertyDef[],
	view: ViewConfig,
	groupKey: string
): void {
	const card = parent.createDiv({ cls: "nfo-card" });
	card.setAttribute("draggable", "true");

	card.addEventListener("dragstart", (evt) => {
		evt.dataTransfer?.setData("text/nfo-row", row.path);
		evt.dataTransfer?.setData("text/nfo-group", groupKey);
		card.addClass("nfo-card-dragging");
	});
	card.addEventListener("dragend", () => card.removeClass("nfo-card-dragging"));

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

		if (prop.type === "select") {
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
	const first = Array.isArray(raw) ? raw[0] : raw;
	if (!first) return null;
	const text = String(first);
	if (/^https?:\/\//.test(text)) return text;

	// Otherwise treat it as a vault path or wikilink to an attachment.
	const linkText = text.replace(/^!?\[\[|\]\]$/g, "");
	const file = ctx.app.metadataCache.getFirstLinkpathDest(linkText, row.path);
	return file ? ctx.app.vault.getResourcePath(file) : null;
}

function firstGroupableProperty(ctx: ViewContext, properties: PropertyDef[]): string | null {
	const candidate = properties.find((p) =>
		["select", "multiselect", "checkbox"].includes(p.type)
	);
	return candidate ? candidate.id : null;
}
