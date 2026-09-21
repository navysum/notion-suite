import { setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { formatValue, isEmpty } from "../db/value";
import { autoColor, pill, rowIcon } from "../utils/dom";
import { coverUrl } from "./board";
import { createInlineRow } from "./table";

export function renderGallery(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[]
): void {
	const grid = container.createDiv({
		cls: `nfo-gallery nfo-gallery-${view.cardSize ?? "medium"}`,
	});

	for (const row of rows) {
		const card = grid.createDiv({ cls: "nfo-gallery-card" });
		const coverProp =
			view.coverProperty ?? properties.find((p) => p.type === "files")?.id ?? null;
		const cover = coverProp ? coverUrl(ctx, row, coverProp) : null;

		const coverBox = card.createDiv({ cls: "nfo-gallery-cover" });
		if (cover) {
			const img = coverBox.createEl("img");
			img.src = cover;
		} else {
			// A stable initial keeps the grid from collapsing on cover-less rows.
			coverBox.addClass("nfo-gallery-cover-empty");
			coverBox.createSpan({ text: row.icon || row.name.slice(0, 1).toUpperCase() });
		}

		const bodyEl = card.createDiv({ cls: "nfo-gallery-body" });
		const title = bodyEl.createDiv({ cls: "nfo-card-title" });
		rowIcon(title, row.icon);
		title.createSpan({ text: row.name });
		title.addEventListener("click", (evt) => openRow(ctx, row.path, evt));

		const meta = bodyEl.createDiv({ cls: "nfo-card-meta" });
		for (const prop of properties.filter((p) => p.id !== coverProp).slice(0, 3)) {
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
			} else {
				const chip = meta.createSpan({ cls: "nfo-card-field" });
				chip.createSpan({ cls: "nfo-card-field-name", text: `${prop.name}:` });
				chip.createSpan({ text: formatValue(prop, value) });
			}
		}

		card.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));
	}

	const add = grid.createDiv({ cls: "nfo-gallery-card nfo-gallery-add" });
	setIcon(add.createSpan(), "plus");
	add.createSpan({ text: "New" });
	add.addEventListener("click", () => void createInlineRow(ctx, view));
}
