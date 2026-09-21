import { ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import type NotionForObsidian from "../main";
import { databaseContextMenu, openDatabaseTab } from "./databaseView";
import { viewIcon } from "./renderer";
import { runDetached } from "../utils/async";
import { queryRows } from "../db/query";

export const SIDEBAR_VIEW_TYPE = "notion-suite-sidebar";

/**
 * The list of every database in the vault.
 *
 * This is the piece that makes the plugin feel like a workspace rather than a
 * set of code blocks: a database is reachable from the same place every time,
 * whether or not anyone remembered which note they embedded it in.
 */
export class DatabaseSidebarView extends ItemView {
	private detach: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: NotionForObsidian) {
		super(leaf);
		this.icon = "database";
	}

	getViewType(): string {
		return SIDEBAR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Databases";
	}

	protected async onOpen(): Promise<void> {
		const handler = () => this.render();
		this.plugin.store.on("changed", handler);
		this.detach = () => this.plugin.store.off("changed", handler);
		this.render();
	}

	protected async onClose(): Promise<void> {
		this.detach?.();
		this.detach = null;
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass("nfo-sidebar");

		const header = container.createDiv({ cls: "nfo-sidebar-header" });
		header.createSpan({ cls: "nfo-sidebar-title", text: "Databases" });

		const add = header.createSpan({ cls: "nfo-sidebar-add" });
		setIcon(add, "plus");
		add.setAttribute("aria-label", "New database");
		add.addEventListener("click", () => this.plugin.commandNewDatabase());

		const databases = this.plugin.store.all();
		if (databases.length === 0) {
			const empty = container.createDiv({ cls: "nfo-sidebar-empty" });
			empty.createDiv({ text: "No databases yet." });
			const create = empty.createDiv({ cls: "nfo-sidebar-create", text: "Create your first one" });
			create.addEventListener("click", () => this.plugin.commandNewDatabase());
			return;
		}

		const list = container.createDiv({ cls: "nfo-sidebar-list" });
		for (const schema of databases) {
			const item = list.createDiv({ cls: "nfo-sidebar-item" });

			const icon = item.createSpan({ cls: "nfo-sidebar-icon" });
			if (schema.icon) icon.setText(schema.icon);
			else setIcon(icon, "table");

			const text = item.createDiv({ cls: "nfo-sidebar-text" });
			text.createDiv({ cls: "nfo-sidebar-name", text: schema.name });

			// A live row count is the cheapest possible signal that the database
			// is real and has something in it.
			const count = queryRows(schema, this.plugin.store.rows(schema)).length;
			text.createDiv({
				cls: "nfo-sidebar-meta",
				text: `${count} ${count === 1 ? "row" : "rows"}`,
			});

			item.addEventListener("click", () => void openDatabaseTab(this.plugin, schema));
			item.addEventListener("contextmenu", (evt) =>
				databaseContextMenu(evt, this.plugin, schema)
			);

			// Saved views hang under their database. A view is a block of
			// settings -- a filter, a sort, which properties, which type -- and
			// rebuilding "this week's work" every time is what these exist to
			// stop.
			const saved = schema.views.filter((view) => view.name);
			for (const view of saved) {
				const child = list.createDiv({ cls: "nfo-sidebar-item nfo-sidebar-view" });
				const glyph = child.createSpan({ cls: "nfo-sidebar-icon" });
				setIcon(glyph, viewIcon(view.type));
				child.createDiv({ cls: "nfo-sidebar-text" }).createDiv({
					cls: "nfo-sidebar-name",
					text: view.name,
				});
				child.addEventListener("click", () => {
					void openDatabaseTab(this.plugin, schema, view.type, view.id);
				});
				child.addEventListener("contextmenu", (evt) => {
					evt.preventDefault();
					const menu = new Menu();
					menu.addItem((entry) =>
						entry
							.setTitle("Forget this view")
							.setIcon("trash")
							.onClick(() => {
								runDetached("forget that view", () =>
									this.plugin.store.updateDatabase(schema.id, (target) => {
										target.views = target.views.filter((v) => v.id !== view.id);
									})
								);
							})
					);
					menu.showAtMouseEvent(evt);
				});
			}
		}
	}
}
