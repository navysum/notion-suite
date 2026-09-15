import { Menu, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef } from "../types";
import { formatValue, isEmpty } from "../db/value";
import { autoColor, pill } from "../utils/dom";
import { formatDate, toISODate } from "../utils/dates";
import { ViewContext, openRow } from "./context";
import { asText } from "../utils/text";

const READ_ONLY: string[] = ["formula", "rollup", "created", "updated"];

/**
 * Render one property value as an editable control.
 *
 * Every editor follows the same contract: show a read-only representation
 * until the user activates it, swap in an input, then write straight back to
 * the note's frontmatter and refresh. Nothing is held in intermediate state,
 * so an edit made in another pane never gets clobbered by a stale view.
 */
export function renderCell(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef
): void {
	container.empty();
	container.addClass("nfo-cell");
	container.addClass(`nfo-cell-${prop.type}`);
	const value = row.values[prop.id];

	if (READ_ONLY.includes(prop.type)) {
		container.addClass("nfo-cell-readonly");
		const text = formatValue(prop, value);
		container.createSpan({ text: text || "—" });
		return;
	}

	switch (prop.type) {
		case "checkbox":
			renderCheckbox(container, ctx, row, prop, value);
			break;
		case "select":
		case "status":
			renderSelect(container, ctx, row, prop, value);
			break;
		case "multiselect":
		case "person":
			renderMultiSelect(container, ctx, row, prop, value);
			break;
		case "date":
			renderDate(container, ctx, row, prop, value);
			break;
		case "number":
			renderInput(container, ctx, row, prop, value, "number");
			break;
		case "url":
		case "email":
		case "phone":
			renderLinkish(container, ctx, row, prop, value);
			break;
		case "relation":
			renderRelation(container, ctx, row, prop, value);
			break;
		default:
			renderInput(container, ctx, row, prop, value, "text");
	}
}

function commit(ctx: ViewContext, row: DatabaseRow, prop: PropertyDef, value: unknown): void {
	void ctx.store.setValue(ctx.schema, row.path, prop.id, value).then(() => ctx.refresh());
}

function renderCheckbox(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const box = container.createEl("input", { type: "checkbox" });
	box.checked = !!value;
	box.addEventListener("change", () => commit(ctx, row, prop, box.checked));
}

function renderInput(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown,
	inputType: "text" | "number"
): void {
	const display = container.createDiv({ cls: "nfo-cell-display" });
	const text = formatValue(prop, value);
	display.setText(text);
	if (!text) display.addClass("nfo-cell-empty");

	display.addEventListener("click", () => {
		display.hide();
		const input = container.createEl("input", { cls: "nfo-cell-input", type: inputType });
		input.value = asText(value);
		input.focus();
		input.select();

		let settled = false;
		const finish = (save: boolean) => {
			if (settled) return;
			settled = true;
			input.remove();
			display.show();
			if (!save) return;
			const raw = input.value.trim();
			if (inputType === "number") {
				const n = Number(raw);
				commit(ctx, row, prop, raw === "" || isNaN(n) ? null : n);
			} else {
				commit(ctx, row, prop, raw === "" ? null : raw);
			}
		};

		input.addEventListener("blur", () => finish(true));
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				finish(true);
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				finish(false);
			}
		});
	});
}

function renderLinkish(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const wrapper = container.createDiv({ cls: "nfo-cell-linkish" });
	const text = asText(value);
	if (text) {
		const href =
			prop.type === "email"
				? `mailto:${text}`
				: prop.type === "phone"
					? `tel:${text}`
					: text;
		const anchor = wrapper.createEl("a", { text, href, cls: "nfo-cell-link" });
		anchor.addEventListener("click", (evt) => evt.stopPropagation());
	}
	const edit = wrapper.createSpan({ cls: "nfo-cell-edit-affordance" });
	setIcon(edit, "pencil");
	edit.addEventListener("click", (evt) => {
		evt.stopPropagation();
		wrapper.empty();
		const input = wrapper.createEl("input", { cls: "nfo-cell-input", type: "text" });
		input.value = text;
		input.focus();
		const finish = (save: boolean) => {
			if (!save) {
				ctx.refresh();
				return;
			}
			commit(ctx, row, prop, input.value.trim() || null);
		};
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") finish(true);
			if (e.key === "Escape") finish(false);
		});
	});
}

function renderSelect(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const wrapper = container.createDiv({ cls: "nfo-cell-select" });
	if (!isEmpty(value)) {
		const name = String(value);
		const option = ctx.store.optionFor(prop, name);
		pill(wrapper, name, option?.color ?? autoColor(name));
	} else {
		wrapper.createSpan({ cls: "nfo-cell-empty", text: "Empty" });
	}

	wrapper.addEventListener("click", (evt) => {
		evt.stopPropagation();
		const menu = new Menu();
		for (const option of prop.options ?? []) {
			menu.addItem((item) =>
				item
					.setTitle(option.name)
					.setChecked(String(value) === option.name)
					.onClick(() => commit(ctx, row, prop, option.name))
			);
		}
		if ((prop.options ?? []).length > 0) menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Clear")
				.setIcon("x")
				.onClick(() => commit(ctx, row, prop, null))
		);
		menu.addItem((item) =>
			item
				.setTitle("Add new option…")
				.setIcon("plus")
				.onClick(() => promptForOption(wrapper, ctx, row, prop, false))
		);
		menu.showAtMouseEvent(evt);
	});
}

function renderMultiSelect(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const wrapper = container.createDiv({ cls: "nfo-cell-select" });
	const selected = Array.isArray(value) ? value.map(String) : [];
	if (selected.length === 0) {
		wrapper.createSpan({ cls: "nfo-cell-empty", text: "Empty" });
	}
	for (const name of selected) {
		const option = ctx.store.optionFor(prop, name);
		pill(wrapper, name, option?.color ?? autoColor(name));
	}

	wrapper.addEventListener("click", (evt) => {
		evt.stopPropagation();
		const menu = new Menu();
		const known = new Set<string>([...(prop.options ?? []).map((o) => o.name), ...selected]);
		for (const name of known) {
			const isOn = selected.includes(name);
			menu.addItem((item) =>
				item
					.setTitle(name)
					.setChecked(isOn)
					.onClick(() => {
						const next = isOn ? selected.filter((v) => v !== name) : [...selected, name];
						commit(ctx, row, prop, next);
					})
			);
		}
		if (known.size > 0) menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Add new option…")
				.setIcon("plus")
				.onClick(() => promptForOption(wrapper, ctx, row, prop, true))
		);
		if (selected.length > 0) {
			menu.addItem((item) =>
				item
					.setTitle("Clear all")
					.setIcon("x")
					.onClick(() => commit(ctx, row, prop, []))
			);
		}
		menu.showAtMouseEvent(evt);
	});
}

/**
 * Inline "new option" entry. A one-field modal would be heavier than the
 * interaction deserves, so the cell turns into a text box in place.
 */
function promptForOption(
	anchor: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	multi: boolean
): void {
	// Anchor to the view this cell belongs to, not to whichever view happens to
	// come first in the document -- a note can hold several.
	const cellHost = anchor.closest(".nfo-view") ?? anchor.parentElement;
	if (!cellHost) return;
	const host = cellHost.createDiv({ cls: "nfo-inline-prompt" });
	const input = host.createEl("input", { type: "text", cls: "nfo-cell-input" });
	input.placeholder = "New option name";
	input.focus();

	const finish = async (save: boolean) => {
		const name = input.value.trim();
		host.remove();
		if (!save || !name) {
			ctx.refresh();
			return;
		}
		await ctx.store.ensureOption(ctx.schema.id, prop.id, name);
		if (multi) {
			const current = Array.isArray(row.values[prop.id])
				? (row.values[prop.id] as string[]).map(String)
				: [];
			commit(ctx, row, prop, [...current, name]);
		} else {
			commit(ctx, row, prop, name);
		}
	};

	input.addEventListener("blur", () => void finish(true));
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") void finish(true);
		if (e.key === "Escape") void finish(false);
	});
}

function renderDate(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const display = container.createDiv({ cls: "nfo-cell-display" });
	const text = formatDate(value);
	display.setText(text || "");
	if (!text) display.addClass("nfo-cell-empty");

	display.addEventListener("click", () => {
		display.hide();
		const input = container.createEl("input", { cls: "nfo-cell-input", type: "date" });
		input.value = asText(value).slice(0, 10) || toISODate(new Date());
		input.focus();
		if (typeof input.showPicker === "function") {
			// Not available in every Electron build; failure here is cosmetic.
			try {
				input.showPicker();
			} catch {
				/* ignore */
			}
		}
		let settled = false;
		const finish = (save: boolean) => {
			if (settled) return;
			settled = true;
			input.remove();
			display.show();
			if (save) commit(ctx, row, prop, input.value || null);
		};
		input.addEventListener("change", () => finish(true));
		input.addEventListener("blur", () => finish(true));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") finish(false);
		});
	});
}

function renderRelation(
	container: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	prop: PropertyDef,
	value: unknown
): void {
	const wrapper = container.createDiv({ cls: "nfo-cell-select" });
	const linked = Array.isArray(value) ? value.map(String) : [];
	if (linked.length === 0) wrapper.createSpan({ cls: "nfo-cell-empty", text: "Empty" });

	for (const name of linked) {
		const chip = wrapper.createSpan({ cls: "nfo-pill nfo-color-blue nfo-relation", text: name });
		chip.addEventListener("click", (evt) => {
			evt.stopPropagation();
			const target = ctx.app.metadataCache.getFirstLinkpathDest(name, ctx.sourcePath);
			if (target) openRow(ctx, target.path, evt);
		});
	}

	wrapper.addEventListener("click", (evt) => {
		evt.stopPropagation();
		const related = prop.relationDatabaseId ? ctx.store.get(prop.relationDatabaseId) : undefined;
		const menu = new Menu();
		if (!related) {
			menu.addItem((item) => item.setTitle("No related database configured").setDisabled(true));
		} else {
			for (const candidate of ctx.store.rows(related).slice(0, 50)) {
				const isOn = linked.includes(candidate.name);
				menu.addItem((item) =>
					item
						.setTitle(candidate.name)
						.setChecked(isOn)
						.onClick(() => {
							const next = isOn
								? linked.filter((v) => v !== candidate.name)
								: [...linked, candidate.name];
							commit(ctx, row, prop, next);
						})
				);
			}
		}
		menu.showAtMouseEvent(evt);
	});
}
