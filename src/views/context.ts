import { App, Menu } from "obsidian";
import { DatabaseStore } from "../db/store";
import { DatabaseSchema } from "../types";
import { SaveTemplateModal } from "../ui/templateModal";

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

	// Reuse the existing side pane when one is already open, so repeated
	// glances do not stack up panes.
	const existing = ctx.app.workspace.getLeavesOfType("markdown").find((leaf) => {
		const root = leaf.getRoot();
		return root !== ctx.app.workspace.rootSplit;
	});
	const leaf = existing ?? ctx.app.workspace.getLeaf("split", "vertical");
	void leaf.openFile(file);
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
			.onClick(async () => {
				await ctx.store.deleteRow(path);
				ctx.refresh();
			})
	);
	menu.showAtMouseEvent(event);
}
