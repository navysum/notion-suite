import { Menu, Notice, setIcon } from "obsidian";
import { DatabaseRow, PropertyDef, ViewConfig } from "../types";
import { renderCell } from "./cells";
import { autoColor, pill } from "../utils/dom";
import { ViewContext, openRow, rowContextMenu, runWrite } from "./context";
import { findProperty, groupRows } from "../db/query";
import {
	calculateColumn,
	calculationLabel,
	calculationsFor,
	formatCalculation,
} from "../db/calculate";
import { RollupFunction, RowTemplate, isFilterGroup } from "../types";
import { buildTree, descendantsOf, TreeRow } from "../db/tree";
import { DERIVED_TYPES } from "../db/store";
import { BulkValueModal } from "../ui/bulkModal";
import { PropertyModal } from "../ui/propertyModal";
import { ManageTemplatesModal } from "../ui/templateModal";
import { choose, confirm } from "../ui/confirmModal";
import { runDetached } from "../utils/async";

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
	const span = properties.length + 2;

	// A table can be grouped the way a board is: Notion's "Group by", with a
	// foldable band per value. Grouping and sub-items are both hierarchies, so
	// the tree is built inside each group rather than across all of them.
	if (view.groupBy) {
		const groups = groupRows(ctx.schema, rows, view.groupBy, {
			dateBuckets: view.dateBuckets,
		});
		const collapsed = new Set(view.collapsedGroups ?? []);
		const groupProp = findProperty(ctx.schema, view.groupBy);

		for (const group of groups) {
			// An empty group that is not a real option is noise, not information.
			if (group.rows.length === 0 && !groupProp?.options?.some((o) => o.name === group.key)) {
				continue;
			}
			const folded = collapsed.has(group.key);
			renderGroupHeader(body, ctx, view, group, properties, span, folded, groupProp);
			if (!folded) renderRowBlock(body, ctx, group.rows, properties, focusPath);
		}

		if (groups.length === 0) renderEmptyRow(body, span);
	} else {
		const drawn = renderRowBlock(body, ctx, rows, properties, focusPath);
		if (drawn === 0) renderEmptyRow(body, span);
	}

	const foot = table.createEl("tfoot");

	const newRow = foot.createEl("tr");
	const footerCell = newRow.createEl("td", { cls: "nfo-new-row" });
	footerCell.colSpan = properties.length + 2;
	const newBtn = footerCell.createDiv({ cls: "nfo-new-row-btn" });
	setIcon(newBtn.createSpan(), "plus");
	newBtn.createSpan({ text: "New" });
	newBtn.addEventListener("click", () => void createInlineRow(ctx, view));
	renderTemplatePicker(footerCell, ctx, view);

	renderCalculationRow(foot, ctx, view, rows, properties);

	renderBulkBar(container, ctx, rows);

	const count = container.createDiv({ cls: "nfo-count" });
	count.setText(`${rows.length} ${rows.length === 1 ? "row" : "rows"}`);
}

/**
 * The chevron beside "New" that offers this database's row templates.
 *
 * Absent entirely when there are none, so a database that does not use
 * templates shows no trace of the feature.
 */
export function renderTemplatePicker(
	parent: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig
): void {
	const templates = ctx.schema.rowTemplates ?? [];
	if (templates.length === 0) return;

	const chevron = parent.createDiv({ cls: "nfo-new-row-templates" });
	setIcon(chevron, "chevron-down");
	chevron.setAttribute("aria-label", "New from template");
	chevron.addEventListener("click", (evt) => {
		evt.stopPropagation();
		const menu = new Menu();
		for (const template of templates) {
			menu.addItem((item) =>
				item
					.setTitle(`${template.icon ?? ""} ${template.name}`.trim())
					.onClick(() => void createInlineRow(ctx, view, {}, template))
			);
		}
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Manage templates…")
				.setIcon("settings-2")
				.onClick(() => {
					new ManageTemplatesModal(ctx.app, ctx.store, ctx.schema, ctx.refresh).open();
				})
		);
		menu.showAtMouseEvent(evt);
	});
}

/**
 * The "Calculate" row under the table.
 *
 * Every cell is empty until the user picks a calculation, so the row costs a
 * line of chrome and nothing else until it is wanted. Choices are written back
 * into the view's block, so they survive a reload.
 */
function renderCalculationRow(
	foot: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	rows: DatabaseRow[],
	properties: PropertyDef[]
): void {
	const chosen = view.calculate ?? {};
	const tr = foot.createEl("tr", { cls: "nfo-calc-row" });
	tr.createEl("td", { cls: "nfo-td nfo-calc-cell nfo-calc-label", text: "Calculate" });

	for (const prop of properties) {
		const cell = tr.createEl("td", { cls: "nfo-td nfo-calc-cell" });
		const how = chosen[prop.id];

		const button = cell.createDiv({ cls: "nfo-calc-pick" });
		if (how) {
			button.createSpan({ cls: "nfo-calc-name", text: calculationLabel(how) });
			button.createSpan({
				cls: "nfo-calc-value",
				text: formatCalculation(how, calculateColumn(rows, prop, how)),
			});
		} else {
			button.addClass("nfo-calc-empty");
			button.createSpan({ text: "Calculate" });
		}

		button.addEventListener("click", (evt) => {
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("None")
					.setChecked(!how)
					.onClick(() => setCalculation(ctx, view, prop.id, null))
			);
			menu.addSeparator();
			for (const option of calculationsFor(prop)) {
				menu.addItem((item) =>
					item
						.setTitle(calculationLabel(option))
						.setChecked(how === option)
						.onClick(() => setCalculation(ctx, view, prop.id, option))
				);
			}
			menu.showAtMouseEvent(evt);
		});
	}

	tr.createEl("td", { cls: "nfo-td nfo-calc-cell" });
}

/** Persist a column's calculation into the view's block, if it is writable. */
function setCalculation(
	ctx: ViewContext,
	view: ViewConfig,
	propertyId: string,
	how: RollupFunction | null
): void {
	const next = { ...(view.calculate ?? {}) };
	if (how) next[propertyId] = how;
	else delete next[propertyId];
	view.calculate = next;

	const encoded = Object.entries(next)
		.map(([key, value]) => `${key}: ${value}`)
		.join(", ");
	if (ctx.persistKey) ctx.persistKey("calculate", `{${encoded}}`);
	else ctx.refresh();
}

/** One band of a grouped table: a fold arrow, the value, a count, any totals. */
function renderGroupHeader(
	body: HTMLElement,
	ctx: ViewContext,
	view: ViewConfig,
	group: { key: string; label: string; rows: DatabaseRow[] },
	properties: PropertyDef[],
	span: number,
	folded: boolean,
	groupProp: PropertyDef | undefined
): void {
	const tr = body.createEl("tr", { cls: "nfo-group-row" });
	const td = tr.createEl("td", { cls: "nfo-group-cell" });
	td.colSpan = span;

	const bar = td.createDiv({ cls: "nfo-group-bar" });
	const twisty = bar.createSpan({ cls: "nfo-group-twisty" });
	setIcon(twisty, folded ? "chevron-right" : "chevron-down");
	twisty.setAttribute("aria-label", folded ? "Expand group" : "Collapse group");

	if (group.key === "" || !groupProp) {
		bar.createSpan({ cls: "nfo-pill nfo-color-default", text: group.label });
	} else {
		const option = ctx.store.optionFor(groupProp, group.key);
		pill(bar, group.label, option?.color ?? autoColor(group.key));
	}
	bar.createSpan({ cls: "nfo-group-count", text: String(group.rows.length) });

	// The column totals the table already knows how to compute, per group --
	// which is the whole reason to group a table rather than filter six views.
	for (const [propertyId, how] of Object.entries(view.calculate ?? {})) {
		const prop = findProperty(ctx.schema, propertyId);
		if (!prop) continue;
		const value = calculateColumn(group.rows, prop, how);
		bar.createSpan({
			cls: "nfo-group-calc",
			text: `${prop.name} ${calculationLabel(how).toLowerCase()}: ${formatCalculation(how, value)}`,
		});
	}

	bar.addEventListener("click", () => toggleGroup(ctx, view, group.key));
}

/** Fold a group away, remembering it in the block the way a board does. */
function toggleGroup(ctx: ViewContext, view: ViewConfig, key: string): void {
	const next = new Set(view.collapsedGroups ?? []);
	if (next.has(key)) next.delete(key);
	else next.add(key);
	view.collapsedGroups = [...next];
	if (ctx.persistKey) ctx.persistKey("collapsed", `[${[...next].join(", ")}]`);
	else ctx.refresh();
}

function renderEmptyRow(body: HTMLElement, span: number): void {
	const tr = body.createEl("tr");
	const td = tr.createEl("td", { cls: "nfo-empty-row" });
	td.colSpan = span;
	td.setText("No rows yet. Use “+ new” to add the first one.");
}

/** Draw a set of rows, sub-items and all. Returns how many lines it drew. */
function renderRowBlock(
	body: HTMLElement,
	ctx: ViewContext,
	rows: DatabaseRow[],
	properties: PropertyDef[],
	focusPath: string | null
): number {
	const tree = buildTree(ctx.schema, rows, ctx.collapsed ?? new Set());
	for (const entry of tree) {
		const row = entry.row;
		const tr = body.createEl("tr", { cls: "nfo-tr" });
		if (ctx.selected?.has(row.path)) tr.addClass("nfo-tr-selected");

		const nameCell = tr.createEl("td", { cls: "nfo-td nfo-td-name" });
		renderSelectBox(nameCell, ctx, row);
		if (entry.depth > 0) {
			nameCell.createSpan({ cls: "nfo-row-indent" }).style.width = `${entry.depth * 18}px`;
		}
		renderDisclosure(nameCell, ctx, entry);
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
	return tree.length;
}

/** The tick box that puts a row into a bulk edit. */
function renderSelectBox(cell: HTMLElement, ctx: ViewContext, row: DatabaseRow): void {
	const selected = ctx.selected;
	if (!selected) return;
	const box = cell.createEl("input", { type: "checkbox", cls: "nfo-row-select" });
	box.checked = selected.has(row.path);
	box.addEventListener("click", (evt) => evt.stopPropagation());
	box.addEventListener("change", () => {
		if (box.checked) selected.add(row.path);
		else selected.delete(row.path);
		ctx.refresh();
	});
}

/** The twisty that folds a row's sub-items away. */
function renderDisclosure(cell: HTMLElement, ctx: ViewContext, entry: TreeRow): void {
	const collapsed = ctx.collapsed;
	// Keep the space even on childless rows so titles line up down the column.
	const slot = cell.createSpan({ cls: "nfo-row-twisty" });
	if (!collapsed || !entry.hasChildren) return;

	const isCollapsed = collapsed.has(entry.row.path);
	slot.addClass("nfo-row-twisty-active");
	setIcon(slot, isCollapsed ? "chevron-right" : "chevron-down");
	slot.setAttribute("aria-label", isCollapsed ? "Expand sub-items" : "Collapse sub-items");
	slot.addEventListener("click", (evt) => {
		evt.stopPropagation();
		if (isCollapsed) collapsed.delete(entry.row.path);
		else collapsed.add(entry.row.path);
		ctx.refresh();
	});
}

/**
 * The bar that appears once rows are ticked.
 *
 * Every edit it performs is one property across every selected row, which is
 * the whole point: the alternative is opening twenty notes.
 */
function renderBulkBar(container: HTMLElement, ctx: ViewContext, rows: DatabaseRow[]): void {
	const selected = ctx.selected;
	if (!selected || selected.size === 0) return;

	// A selection can outlive the rows it referred to, if a filter changed.
	const live = rows.filter((row) => selected.has(row.path));
	if (live.length === 0) {
		selected.clear();
		return;
	}

	const bar = container.createDiv({ cls: "nfo-bulk-bar" });
	bar.createSpan({
		cls: "nfo-bulk-count",
		text: `${live.length} selected`,
	});

	const setBtn = bar.createDiv({ cls: "nfo-bulk-action" });
	setIcon(setBtn.createSpan(), "pencil");
	setBtn.createSpan({ text: "Set a property" });
	setBtn.addEventListener("click", (evt) => {
		const menu = new Menu();
		const editable = ctx.schema.properties.filter(
			(p) => !DERIVED_TYPES.includes(p.type) && p.type !== "uniqueid"
		);
		for (const prop of editable) {
			menu.addItem((item) =>
				item
					.setTitle(prop.name)
					.setIcon(iconForType(prop.type))
					.onClick(() => promptBulkValue(ctx, live, prop))
			);
		}
		menu.showAtMouseEvent(evt);
	});

	const deleteBtn = bar.createDiv({ cls: "nfo-bulk-action nfo-bulk-danger" });
	setIcon(deleteBtn.createSpan(), "trash");
	deleteBtn.createSpan({ text: "Delete" });
	deleteBtn.addEventListener("click", () => {
		void deleteSelected(ctx, live, selected);
	});

	const clearBtn = bar.createDiv({ cls: "nfo-bulk-action" });
	clearBtn.createSpan({ text: "Clear selection" });
	clearBtn.addEventListener("click", () => {
		selected.clear();
		ctx.refresh();
	});
}

/**
 * Delete every ticked row, asking first.
 *
 * Deleting one row has always asked, and asked again about anything nested
 * under it. Deleting eighty did neither: it emptied the selection on the spot
 * and orphaned every sub-item on the way. A bulk action is the one that most
 * needs the question, not the one that least does.
 */
async function deleteSelected(
	ctx: ViewContext,
	rows: DatabaseRow[],
	selected: Set<string>
): Promise<void> {
	if (rows.length === 0) return;

	const all = ctx.store.rows(ctx.schema);
	const ticked = new Set(rows.map((row) => row.path));
	// Sub-items that are not themselves ticked. Anything already in the
	// selection is going anyway and must not be counted twice.
	const orphans = new Map<string, DatabaseRow>();
	for (const row of rows) {
		for (const child of descendantsOf(ctx.schema, all, row.path)) {
			if (!ticked.has(child.path)) orphans.set(child.path, child);
		}
	}

	const count = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
	let alsoChildren = false;

	if (orphans.size > 0) {
		const nested = `${orphans.size} ${orphans.size === 1 ? "row is" : "rows are"}`;
		const answer = await choose(ctx.app, {
			title: `Delete ${count}?`,
			body: `${nested} nested under what you have ticked, and not ticked themselves.`,
			detail:
				"Keeping them leaves them pointing at notes that no longer exist, " +
				"so they become top-level rows.",
			choices: [
				{ id: "ticked", label: `Delete the ${rows.length} ticked` },
				{
					id: "all",
					label: `Delete all ${rows.length + orphans.size}`,
					cta: true,
					destructive: true,
				},
			],
		});
		// Dismissing cancels outright rather than picking an answer.
		if (answer === null) return;
		alsoChildren = answer === "all";
	} else {
		const ok = await confirm(ctx.app, {
			title: `Delete ${count}?`,
			body: "The notes go to your vault's trash, so this can be undone there.",
			confirmText: `Delete ${count}`,
			destructive: true,
		});
		if (!ok) return;
	}

	const targets = alsoChildren ? [...rows, ...orphans.values()] : rows;
	let deleted = 0;
	try {
		for (const row of targets) {
			await ctx.store.deleteRow(row.path);
			deleted++;
		}
	} catch (error) {
		console.error("Notion Suite: deleting rows failed", error);
		new Notice(`Deleted ${deleted} of ${targets.length} rows, then hit an error.`);
		selected.clear();
		ctx.refresh();
		return;
	}

	selected.clear();
	new Notice(`Deleted ${deleted} ${deleted === 1 ? "row" : "rows"}.`);
	ctx.refresh();
}

/** Ask for one value, then write it to every selected row. */
function promptBulkValue(ctx: ViewContext, rows: DatabaseRow[], prop: PropertyDef): void {
	const apply = (value: unknown): void => {
		runDetached(`set ${prop.name}`, async () => {
			let done = 0;
			try {
				for (const row of rows) {
					await ctx.store.setValue(ctx.schema, row.path, prop.id, value);
					done++;
				}
			} finally {
				// Say how far it got either way: a bulk edit that stops half way
				// through has still changed real notes, and silence about that
				// leaves the user with no idea what state they are in.
				const all = done === rows.length;
				new Notice(
					all
						? `Set ${prop.name} on ${done} ${done === 1 ? "row" : "rows"}.`
						: `Set ${prop.name} on ${done} of ${rows.length} rows before stopping.`
				);
				ctx.refresh();
			}
		});
	};

	if (prop.type === "checkbox") {
		const menu = new Menu();
		menu.addItem((item) => item.setTitle("Checked").onClick(() => apply(true)));
		menu.addItem((item) => item.setTitle("Unchecked").onClick(() => apply(false)));
		menu.showAtPosition({ x: 0, y: 0 });
		return;
	}

	if ((prop.type === "select" || prop.type === "status") && prop.options?.length) {
		const menu = new Menu();
		for (const option of prop.options) {
			menu.addItem((item) => item.setTitle(option.name).onClick(() => apply(option.name)));
		}
		menu.addSeparator();
		menu.addItem((item) => item.setTitle("Clear").onClick(() => apply(null)));
		menu.showAtPosition({ x: 0, y: 0 });
		return;
	}

	new BulkValueModal(ctx.app, prop, apply).open();
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
			void ctx.store
				.renameRow(row.path, next)
				.then((result) => {
					if (!result.ok) new Notice(result.reason);
					ctx.refresh();
				})
				.catch((error: unknown) => {
					console.error("Notion Suite: renaming a row failed", error);
					new Notice("Could not rename that row.");
					ctx.refresh();
				});
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
	extraSeed: Record<string, unknown> = {},
	template?: RowTemplate
): Promise<void> {
	const seed: Record<string, unknown> = { ...extraSeed };
	// Only the top-level `is` rules of an AND group describe every row the view
	// shows. Inside an `or`, or under a nested group, a rule constrains some
	// rows and not others, so seeding from it would be a guess.
	if (!view.filter || view.filter.conjunction === "and") {
		for (const node of view.filter?.rules ?? []) {
			if (isFilterGroup(node)) continue;
			if (node.operator !== "is" || node.value === undefined) continue;
			const prop = findProperty(ctx.schema, node.property);
			if (!prop || seed[prop.id] !== undefined) continue;
			seed[prop.id] = prop.type === "multiselect" ? [node.value] : node.value;
		}
	}
	const file = await ctx.store.createRow(ctx.schema, template?.name ?? "Untitled", seed, template);
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
				runWrite(
					ctx,
					"hide that property",
					ctx.store.updateDatabase(ctx.schema.id, (schema) => {
						const target = schema.properties.find((p) => p.id === prop.id);
						if (target) target.hidden = true;
					})
				);
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
		case "status":
			return "loader";
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
		case "uniqueid":
			return "hash";
		case "formula":
			return "sigma";
		default:
			return "text";
	}
}
