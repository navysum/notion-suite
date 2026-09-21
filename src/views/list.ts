import { Notice, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { ViewContext, openRow, rowContextMenu, runWrite } from "./context";
import { formatValue, isEmpty } from "../db/value";
import { autoColor, pill, rowIcon } from "../utils/dom";
import { createInlineRow, renderTemplatePicker } from "./table";

export function renderList(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[]
): void {
	const list = container.createDiv({ cls: "nfo-list" });

	for (const row of rows) {
		const item = list.createDiv({ cls: "nfo-list-item" });

		// A checkbox property gets promoted to a leading tick box, so a task
		// database reads as a to-do list rather than a table of one column.
		const checkbox = properties.find((p) => p.type === "checkbox");
		if (checkbox) {
			const box = item.createEl("input", { type: "checkbox", cls: "nfo-list-check" });
			box.checked = !!row.values[checkbox.id];
			box.addEventListener("change", () => {
				runWrite(
					ctx,
					`set ${checkbox.name}`,
					(async () => {
						await ctx.store.setValue(ctx.schema, row.path, checkbox.id, box.checked);
						const next = await ctx.store.repeatIfDue(
							ctx.schema,
							row.path,
							checkbox.id,
							box.checked
						);
						if (next) new Notice(`“${row.name}” repeats — next one due ${next}.`);
					})()
				);
			});
			if (box.checked) item.addClass("nfo-list-done");
		} else {
			setIcon(item.createSpan({ cls: "nfo-list-bullet" }), "file-text");
		}

		rowIcon(item, row.icon);
		const title = item.createSpan({ cls: "nfo-row-title", text: row.name });
		title.addEventListener("click", (evt) => openRow(ctx, row.path, evt));

		const meta = item.createSpan({ cls: "nfo-list-meta" });
		for (const prop of properties.filter((p) => p.type !== "checkbox").slice(0, 3)) {
			const value = row.values[prop.id];
			if (isEmpty(value)) continue;
			if (prop.type === "select" || prop.type === "status") {
				const option = ctx.store.optionFor(prop, String(value));
				pill(meta, String(value), option?.color ?? autoColor(String(value)));
			} else if (prop.type === "multiselect") {
				for (const entry of value as string[]) {
					const option = ctx.store.optionFor(prop, entry);
					pill(meta, entry, option?.color ?? autoColor(entry));
				}
			} else {
				meta.createSpan({ cls: "nfo-list-field", text: formatValue(prop, value) });
			}
		}

		item.addEventListener("contextmenu", (evt) => rowContextMenu(ctx, row.path, evt));
	}

	const add = list.createDiv({ cls: "nfo-list-add" });
	setIcon(add.createSpan(), "plus");
	add.createSpan({ text: "New" });
	renderTemplatePicker(add, ctx, view);
	add.addEventListener("click", () => void createInlineRow(ctx, view));

	if (rows.length === 0) {
		list.createDiv({ cls: "nfo-empty-row", text: "No rows match this view." });
	}
}
