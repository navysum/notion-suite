import { App, Menu } from "obsidian";
import { DatabaseStore } from "../db/store";
import { DatabaseSchema } from "../types";
import { SaveTemplateModal } from "../ui/templateModal";
import { descendantsOf } from "../db/tree";
import { choose } from "../ui/confirmModal";

export interface ViewContext {
	app: App;
	store: DatabaseStore;
	schema: DatabaseSchema;
	/** Re-render the current view in place. */
	refresh: () => void;
	sourcePath: string;
	/** Open this view's settings. Absent when the block cannot be located. */
	requestEdit?: () => void;
	/** Persist a single setting back into the block's source. */
	persistKey?: (key: string, value: string) => void;
	/** Ask the view to start editing this row's title on the next render. */
	requestTitleFocus?: (path: string) => void;
	/** Read and clear that request. Called once per render by the table. */
	takeTitleFocus?: () => string | null;
	/** Whether clicking a row opens it beside the view. Defaults to true. */
	sidePeek?: boolean;
	/** Sub-item rows the user has collapsed, by path. Mutated in place. */
	collapsed?: Set<string>;
	/** Rows ticked for a bulk edit, by path. Mutated in place. */
	selected?: Set<string>;
}

/**
 * Open a row's note.
 *
 * By default it opens beside the view rather than over it -- Notion's "side
 * peek". Losing the board you were working in every time you glance at a row is
 * the main reason a row-per-file database feels heavier than an inline one.
 * Modifier-click still forces a new tab, and the behaviour is a setting.
 */
export function openRow(ctx: ViewContext, path: string, event?: MouseEvent): void {
	const file = ctx.store.getFile(path);
	if (!file) return;

	if (event && (event.ctrlKey || event.metaKey || event.button === 1)) {
		void ctx.app.workspace.getLeaf("tab").openFile(file);
		return;
	}

	if (ctx.sidePeek === false) {
		void ctx.app.workspace.getLeaf(false).openFile(file);
		return;
	}

	// Reuse an existing side pane so repeated glances do not stack up panes --
	// but only one in the right sidebar. "Anywhere outside the main editor"
	// also matches the left sidebar, so a glance at a row could hijack whatever
	// the user had pinned over there.
	const existing = ctx.app.workspace.getLeavesOfType("markdown").find(
		(leaf) => leaf.getRoot() === ctx.app.workspace.rightSplit
	);
	const leaf = existing ?? ctx.app.workspace.getLeaf("split", "vertical");
	void leaf.openFile(file);
}

/**
 * Delete a row, asking first about anything nested under it.
 *
 * Sub-items point at their parent by name, so deleting a parent leaves its
 * children pointing at a note that is gone -- they silently become top-level
 * rows. Better to say so and offer to take them too.
 */
export async function deleteRowAndAsk(ctx: ViewContext, path: string): Promise<void> {
	const rows = ctx.store.rows(ctx.schema);
	const children = descendantsOf(ctx.schema, rows, path);

	if (children.length > 0) {
		const name = rows.find((row) => row.path === path)?.name ?? "this row";
		const answer = await choose(ctx.app, {
			title: `Delete “${name}”?`,
			body: `${children.length} ${children.length === 1 ? "row is" : "rows are"} nested under it.`,
			detail:
				"Keeping them leaves them pointing at a note that no longer exists, " +
				"so they become top-level rows.",
			choices: [
				{ id: "one", label: "Delete only this row" },
				{ id: "all", label: `Delete all ${children.length + 1}`, cta: true, destructive: true },
			],
		});
		// Dismissing cancels the delete outright rather than picking for them.
		if (answer === null) return;
		if (answer === "all") {
			for (const child of children) await ctx.store.deleteRow(child.path);
		}
	}

	await ctx.store.deleteRow(path);
	ctx.refresh();
}

export function rowContextMenu(ctx: ViewContext, path: string, event: MouseEvent): void {
	const menu = new Menu();
	menu.addItem((item) =>
		item
			.setTitle("Open")
			.setIcon("file-text")
			.onClick(() => openRow(ctx, path))
	);
	menu.addItem((item) =>
		item
			.setTitle("Open in new pane")
			.setIcon("separator-vertical")
			.onClick(() => {
				const file = ctx.store.getFile(path);
				if (file) void ctx.app.workspace.getLeaf(true).openFile(file);
			})
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Save as template")
			.setIcon("copy-plus")
			.onClick(() => {
				const row = ctx.store.rows(ctx.schema).find((r) => r.path === path);
				if (!row) return;
				new SaveTemplateModal(ctx.app, ctx.store, ctx.schema, row, ctx.refresh).open();
			})
	);
	menu.addItem((item) =>
		item
			.setTitle("Delete")
			.setIcon("trash")
			.onClick(() => void deleteRowAndAsk(ctx, path))
	);
	menu.showAtMouseEvent(event);
}
