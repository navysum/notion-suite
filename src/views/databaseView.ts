import { ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import type NotionForObsidian from "../main";
import { DatabaseSchema, ViewConfig, ViewType } from "../types";
import { renderDatabaseView } from "./renderer";
import { ViewContext } from "./context";
import { viewIcon } from "./renderer";

export const DATABASE_VIEW_TYPE = "notion-suite-database";

export interface DatabaseViewState {
	databaseId: string;
	viewType: ViewType;
}

/**
 * A database opened as its own tab.
 *
 * Until now a database only existed where someone had pasted a code block, so
 * forgetting which note held it effectively lost it. This gives every database
 * a place of its own that does not depend on any note, which is what makes the
 * sidebar able to point at something.
 */
export class DatabaseItemView extends ItemView {
	private databaseId = "";
	private viewType: ViewType = "table";
	private detach: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: NotionForObsidian) {
		super(leaf);
		this.icon = "database";
	}

	getViewType(): string {
		return DATABASE_VIEW_TYPE;
	}

	getDisplayText(): string {
		const schema = this.plugin.store.get(this.databaseId);
		return schema ? schema.name : "Database";
	}

	async setState(state: unknown, result: unknown): Promise<void> {
		const incoming = state as Partial<DatabaseViewState> | null;
		if (incoming?.databaseId) this.databaseId = incoming.databaseId;
		if (incoming?.viewType) this.viewType = incoming.viewType;
		await super.setState(state, result as Parameters<ItemView["setState"]>[1]);
		this.render();
	}

	getState(): Record<string, unknown> {
		return { databaseId: this.databaseId, viewType: this.viewType };
	}

	protected async onOpen(): Promise<void> {
		// Redraw when any row or schema changes, the same signal the code
		// blocks use, so an edit in a note shows up here immediately.
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
		container.addClass("nfo-page");

		const schema = this.plugin.store.get(this.databaseId);
		if (!schema) {
			container.createDiv({
				cls: "nfo-callout-error",
				text: "This database no longer exists. It may have been removed from settings.",
			});
			return;
		}

		this.renderHeader(container, schema);

		const body = container.createDiv({ cls: "nfo-page-body" });
		const view: ViewConfig = {
			id: `page-${schema.id}`,
			name: "",
			type: this.viewType,
			databaseId: schema.id,
		};

		const ctx: ViewContext = {
			app: this.app,
			store: this.plugin.store,
			schema,
			sourcePath: "",
			sidePeek: this.plugin.settings.sidePeek,
			refresh: () => this.render(),
			// A full-page database has no block to write settings back into, so
			// view changes are held for the session rather than persisted.
			persistKey: undefined,
		};
		renderDatabaseView(body, ctx, view);
	}

	private renderHeader(container: HTMLElement, schema: DatabaseSchema): void {
		const header = container.createDiv({ cls: "nfo-page-header" });

		const title = header.createDiv({ cls: "nfo-page-title" });
		if (schema.icon) title.createSpan({ cls: "nfo-page-icon", text: schema.icon });
		title.createSpan({ text: schema.name });

		if (schema.description) {
			header.createDiv({ cls: "nfo-page-desc", text: schema.description });
		}

		const tabs = header.createDiv({ cls: "nfo-page-tabs" });
		const types: ViewType[] = ["table", "board", "gallery", "list", "calendar", "timeline"];
		for (const type of types) {
			const tab = tabs.createDiv({ cls: "nfo-page-tab" });
			if (type === this.viewType) tab.addClass("is-active");
			setIcon(tab.createSpan(), viewIcon(type));
			tab.createSpan({ text: type.charAt(0).toUpperCase() + type.slice(1) });
			tab.addEventListener("click", () => {
				this.viewType = type;
				// Record it so reopening the tab returns to the same view.
				this.app.workspace.requestSaveLayout();
				this.render();
			});
		}

		const folder = header.createDiv({ cls: "nfo-page-folder" });
		setIcon(folder.createSpan(), "folder");
		folder.createSpan({ text: schema.folder });
		folder.setAttribute("aria-label", "Where this database's notes live");
	}
}

/** Open a database in a tab, reusing one that already shows it. */
export async function openDatabaseTab(
	plugin: NotionForObsidian,
	schema: DatabaseSchema,
	viewType: ViewType = "table"
): Promise<void> {
	const existing = plugin.app.workspace
		.getLeavesOfType(DATABASE_VIEW_TYPE)
		.find((leaf) => {
			const state = leaf.view.getState() as Partial<DatabaseViewState>;
			return state.databaseId === schema.id;
		});

	if (existing) {
		await plugin.app.workspace.revealLeaf(existing);
		return;
	}

	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({
		type: DATABASE_VIEW_TYPE,
		active: true,
		state: { databaseId: schema.id, viewType },
	});
	await plugin.app.workspace.revealLeaf(leaf);
}

/** Offer the view types for a database, for the sidebar's context menu. */
export function databaseContextMenu(
	evt: MouseEvent,
	plugin: NotionForObsidian,
	schema: DatabaseSchema
): void {
	const menu = new Menu();
	const types: ViewType[] = ["table", "board", "gallery", "list", "calendar", "timeline"];
	for (const type of types) {
		menu.addItem((item) =>
			item
				.setTitle(`Open as ${type}`)
				.setIcon(viewIcon(type))
				.onClick(() => void openDatabaseTab(plugin, schema, type))
		);
	}
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle("Add a property…")
			.setIcon("plus")
			.onClick(() => plugin.openPropertyEditor(schema))
	);
	menu.showAtMouseEvent(evt);
}
