import { Menu, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { renderCell } from "./cells";
import { ViewContext, openRow, rowContextMenu } from "./context";
import { findProperty } from "../db/query";
import { PropertyModal } from "../ui/propertyModal";

export function renderTable(
	container: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[]
): void {
	const scroller = container.createDiv({ cls: "nfo-table-scroll" });
	const table = scroller.createEl("table", { cls: "nfo-table" });

	const head = table.createEl("thead").createEl("tr");
	head.createEl("th", { cls: "nfo-th nfo-th-name", text: "Name" });
	for (const prop of properties) {
		const th = head.createEl("th", { cls: "nfo-th" });
		if (prop.width) th.style.width = `${prop.width}px`;
		const label = th.createDiv({ cls: "nfo-th-label" });
		const glyph = label.createSpan({ cls: "nfo-th-icon" });
		setIcon(glyph, iconForType(prop.type));
		label.createSpan({ text: prop.name });
		th.addEventListener("click", (evt) => propertyMenu(evt, ctx, view, prop));
	}
	const addColumn = head.createEl("th", { cls: "nfo-th nfo-th-actions" });
	const addProp = addColumn.createDiv({ cls: "nfo-th-add" });
	setIcon(addProp, "plus");
	addProp.setAttribute("aria-label", "Add a property");
	addProp.addEventListener("click", () => {
		new PropertyModal(ctx.app, ctx.store, ctx.schema, null, () => ctx.refresh()).open();
	});

	const focusPath = ctx.takeTitleFocus ? ctx.takeTitleFocus() : null;

	const body = table.createEl("tbody");
	for (const row of rows) {
		const tr = body.createEl("tr", { cls: "nfo-tr" });

		const nameCell = tr.createEl("td", { cls: "nfo-td nfo-td-name" });
		renderTitleCell(nameCell, ctx, row, focusPath === row.path);

		for (const prop of properties) {
			const td = tr.createEl("td", { cls: "nfo-td" });
			renderCell(td, ctx, row, prop);
		}

		const actions = tr.createEl("td", { cls: "nfo-td nfo-td-actions" });
		const more = actions.createSpan({ cls: "nfo-row-more" });
		setIcon(more, "more-horizontal");
		more.addEventListener("click", (evt) => rowContextMenu(ctx, row.path, evt));
	}

	if (rows.length === 0) {
		const tr = body.createEl("tr");
		const td = tr.createEl("td", { cls: "nfo-empty-row" });
		td.colSpan = properties.length + 2;
		td.setText("No rows yet. Use “+ New” to add the first one.");
	}

	const footer = table.createEl("tfoot").createEl("tr");
	const footerCell = footer.createEl("td", { cls: "nfo-new-row" });
	footerCell.colSpan = properties.length + 2;
	const newBtn = footerCell.createDiv({ cls: "nfo-new-row-btn" });
	setIcon(newBtn.createSpan(), "plus");
	newBtn.createSpan({ text: "New" });
	newBtn.addEventListener("click", () => void createInlineRow(ctx, view));

	const count = container.createDiv({ cls: "nfo-count" });
	count.setText(`${rows.length} ${rows.length === 1 ? "row" : "rows"}`);
}

/**
 * The Name cell: the note's title, edited in place.
 *
 * A row's title is its filename, so renaming it is a file rename rather than a
 * frontmatter write -- but from the user's side it should feel like any other
 * cell. Opening the note moves to its own button, because needing to open a
 * file just to retitle it is the single biggest piece of friction in a
 * folder-of-notes database.
 */
function renderTitleCell(
	cell: HTMLElement,
	ctx: ViewContext,
	row: DatabaseRow,
	autoFocus: boolean
): void {
	const title = cell.createSpan({ cls: "nfo-row-title", text: row.name });

	const beginEdit = () => {
		title.hide();
		const input = cell.createEl("input", { cls: "nfo-cell-input nfo-title-input", type: "text" });
		input.value = row.name;
		input.focus();
		input.select();

		let settled = false;
		const finish = (save: boolean) => {
			if (settled) return;
			settled = true;
			input.remove();
			title.show();
			const next = input.value.trim();
			if (!save || !next || next === row.name) return;
			void ctx.store.renameRow(row.path, next).then(() => ctx.refresh());
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
	};

	title.addEventListener("click", beginEdit);

	const openBtn = cell.createSpan({ cls: "nfo-row-open" });
	setIcon(openBtn, "maximize-2");
	openBtn.setAttribute("aria-label", "Open note");
	openBtn.addEventListener("click", (evt) => openRow(ctx, row.path, evt));

	// A row created by "+ New" starts in edit mode, so the next thing you do is
	// type its name rather than hunt for where it went.
	if (autoFocus) beginEdit();
}

/** Seed a new row with whatever the active filter demands, as Notion does. */
export async function createInlineRow(
	ctx: ViewContext,
	view: ViewConfig,
	extraSeed: Record<string, unknown> = {}
): Promise<void> {
	const seed: Record<string, unknown> = { ...extraSeed };
	for (const rule of view.filter?.rules ?? []) {
		if (rule.operator !== "is" || rule.value === undefined) continue;
		const prop = findProperty(ctx.schema, rule.property);
		if (!prop || seed[prop.id] !== undefined) continue;
		seed[prop.id] = prop.type === "multiselect" ? [rule.value] : rule.value;
	}
	const file = await ctx.store.createRow(ctx.schema, "Untitled", seed);
	// Stay put. Notion adds the row in the grid and lets you type its title
	// there; opening the note would throw the user out of the board or table
	// they are working in.
	if (file && ctx.requestTitleFocus) ctx.requestTitleFocus(file.path);
	ctx.refresh();
}

function propertyMenu(
	evt: MouseEvent,
	ctx: ViewContext,
	view: ViewConfig,
	prop: PropertyDef
): void {
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle("Sort ascending")
			.setIcon("arrow-up")
			.onClick(() => {
				view.sorts = [{ property: prop.id, direction: "asc" }];
				ctx.refresh();
			})
	);
	menu.addItem((item) =>
		item
			.setTitle("Sort descending")
			.setIcon("arrow-down")
			.onClick(() => {
				view.sorts = [{ property: prop.id, direction: "desc" }];
				ctx.refresh();
			})
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Edit property…")
			.setIcon("settings-2")
			.onClick(() => {
				new PropertyModal(ctx.app, ctx.store, ctx.schema, prop, () => ctx.refresh()).open();
			})
	);
	menu.addItem((item) =>
		item
			.setTitle("Hide property")
			.setIcon("eye-off")
			.onClick(() => {
				void ctx.store.updateDatabase(ctx.schema.id, (schema) => {
					const target = schema.properties.find((p) => p.id === prop.id);
					if (target) target.hidden = true;
				});
				ctx.refresh();
			})
	);
	menu.showAtMouseEvent(evt);
}

export function iconForType(type: string): string {
	switch (type) {
		case "number":
			return "hash";
		case "select":
			return "chevron-down-circle";
		case "multiselect":
			return "list";
		case "date":
		case "created":
		case "updated":
			return "calendar";
		case "checkbox":
			return "check-square";
		case "url":
			return "link";
		case "email":
			return "mail";
		case "phone":
			return "phone";
		case "person":
			return "user";
		case "files":
			return "paperclip";
		case "relation":
			return "arrow-left-right";
		case "rollup":
			return "layers";
		case "formula":
			return "sigma";
		default:
			return "text";
	}
}
