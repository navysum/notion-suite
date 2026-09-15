import { App, Menu } from "obsidian";
import { DatabaseStore } from "../db/store";
import { DatabaseSchema } from "../types";

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
}

/** Open a row's note, honouring modifier-click for a new pane. */
export function openRow(ctx: ViewContext, path: string, event?: MouseEvent): void {
	const file = ctx.store.getFile(path);
	if (!file) return;
	const newLeaf = !!event && (event.ctrlKey || event.metaKey || event.button === 1);
	void ctx.app.workspace.getLeaf(newLeaf).openFile(file);
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
			.setTitle("Delete")
			.setIcon("trash")
			.onClick(async () => {
				await ctx.store.deleteRow(path);
				ctx.refresh();
			})
	);
	menu.showAtMouseEvent(event);
}
