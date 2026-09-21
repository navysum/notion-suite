import {
	Editor,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
} from "obsidian";
import { DEFAULT_SETTINGS, NotionSettingTab, NotionSettings } from "./settings";
import { DatabaseStore } from "./db/store";
import { parseChartBlock, parseViewBlock } from "./views/config";
import { renderDatabaseView } from "./views/renderer";
import { ViewContext } from "./views/context";
import { renderColumns } from "./views/columns";
import { buildChartData } from "./charts/aggregate";
import { renderChart } from "./charts/svg";
import { parseWidgetBlock, renderWidget } from "./widgets/widget";
import { SlashSuggest } from "./slash/suggest";
import { SlashCommand } from "./slash/commands";
import {
	DatabasePickerModal,
	ImportFolderModal,
	InsertChartModal,
	InsertViewModal,
	NewDatabaseModal,
	NewRowModal,
} from "./ui/modals";
import { PropertyModal } from "./ui/propertyModal";
import { addEditButton, replaceBlock, setBlockKey, updateBlockBody } from "./views/blockEdit";
import { DatabaseSchema } from "./types";
import { DATABASE_VIEW_TYPE, DatabaseItemView, openDatabaseTab } from "./views/databaseView";
import { SIDEBAR_VIEW_TYPE, DatabaseSidebarView } from "./views/sidebar";
import { renderBreadcrumb, renderTableOfContents } from "./views/pageBlocks";
import { registerBanners } from "./ui/pageBanner";
import { registerPropertyPanel } from "./ui/propertyPanel";
import { PageStyleModal } from "./ui/pageStyleModal";
import { runDetached } from "./utils/async";

export default class NotionForObsidian extends Plugin {
	settings: NotionSettings = { ...DEFAULT_SETTINGS };
	store!: DatabaseStore;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new DatabaseStore(this.app, async () => {
			this.settings.databases = this.store.serialize();
			await this.saveData(this.settings);
		});
		this.store.load(this.settings.databases);

		this.registerMarkdownCodeBlockProcessor("notion-db", (source, el, ctx) =>
			this.renderViewBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("notion-chart", (source, el, ctx) =>
			this.renderChartBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("notion-toc", (source, el, ctx) =>
			renderTableOfContents(this.app, source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("notion-breadcrumb", (_source, el, ctx) =>
			renderBreadcrumb(el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("notion-widget", (source, el, ctx) =>
			this.renderWidgetBlock(source, el, ctx)
		);
		this.registerMarkdownCodeBlockProcessor("notion-columns", async (source, el, ctx) => {
			const child = new MarkdownRenderChild(el);
			ctx.addChild(child);
			await renderColumns(this.app, source, el, ctx.sourcePath, child);
		});

		this.registerEditorSuggest(
			new SlashSuggest({
				app: this.app,
				isEnabled: () => this.settings.enableSlashMenu,
				triggerCharacter: () => this.settings.slashTrigger,
				runAction: (action, editor) => this.runSlashAction(action, editor),
			})
		);

		this.registerView(
			DATABASE_VIEW_TYPE,
			(leaf) => new DatabaseItemView(leaf, this)
		);
		this.registerView(SIDEBAR_VIEW_TYPE, (leaf) => new DatabaseSidebarView(leaf, this));

		registerPropertyPanel(this, this.store, () => ({
			showPropertyPanel: this.settings.showPropertyPanel,
		}));

		registerBanners(this, () => ({
			showBanners: this.settings.showBanners,
			bannerHeight: this.settings.bannerHeight,
			allowRemoteCovers: this.settings.allowRemoteCovers,
		}));

		this.registerVaultListeners();
		this.registerCommands();

		this.addRibbonIcon("database", "Notion Suite: databases", () => void this.revealSidebar());

		// Open the sidebar on first run so the databases are discoverable at all
		// rather than waiting to be found in the command palette.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.openSidebarOnStart) void this.revealSidebar(false);
		});
		this.addSettingTab(new NotionSettingTab(this.app, this));
		this.applyBodyClasses();
	}

	onunload(): void {
		document.body.removeClass("nfo-typography", "nfo-compact");
	}

	// --- rendering ---------------------------------------------------------

	private renderViewBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const { config, error } = parseViewBlock(source);
		if (!config) {
			this.renderBlockError(el, error ?? "Could not read this view.");
			return;
		}

		const schema = this.store.get(config.databaseId);
		if (!schema) {
			this.renderBlockError(
				el,
				`No database called “${config.databaseId}”. Create one with the “Notion: New database” command, or check the spelling.`
			);
			return;
		}

		const child = new BlockRenderChild(el, this.store, () => {
			const viewCtx: ViewContext = {
				app: this.app,
				store: this.store,
				schema,
				sourcePath: ctx.sourcePath,
				sidePeek: this.settings.sidePeek,
				refresh: () => child.rerender(),
				requestEdit: () => {
					new InsertViewModal(
						this.app,
						this.store,
						(block) => void replaceBlock(this.app, ctx, el, block),
						// Hand the modal the view as parsed, so every control opens
						// showing what this block actually says.
						{ ...config, databaseId: schema.name }
					).open();
				},
				persistKey: (key, value) => {
					void updateBlockBody(this.app, ctx, el, "notion-db", (body) =>
						setBlockKey(body, key, value)
					);
				},
			};
			renderDatabaseView(el, viewCtx, config);
		});
		ctx.addChild(child);
	}

	private renderChartBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const { config, error } = parseChartBlock(source);
		if (!config) {
			this.renderBlockError(el, error ?? "Could not read this chart.");
			return;
		}

		const schema = this.store.get(config.database);
		if (!schema) {
			this.renderBlockError(el, `No database called “${config.database}”.`);
			return;
		}

		const child = new BlockRenderChild(el, this.store, () => {
			el.empty();
			const data = buildChartData(schema, this.store.rows(schema), config);
			renderChart(el, config, data);

			// The gear is the whole point: the block's YAML is never something
			// the user has to open, remember or type.
			const bar = el.createDiv({ cls: "nfo-chart-actions" });
			addEditButton(bar, "Edit chart", () => {
				new InsertChartModal(
					this.app,
					this.store,
					(block) => void replaceBlock(this.app, ctx, el, block),
					config
				).open();
			});
		});
		ctx.addChild(child);
	}

	private renderWidgetBlock(
		source: string,
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): void {
		const { config, error } = parseWidgetBlock(source);
		if (!config) {
			this.renderBlockError(el, error ?? "Could not read this widget.");
			return;
		}

		// Widgets read whichever databases their own config names, so the
		// context carries no single schema; each widget resolves its own.
		const child = new BlockRenderChild(el, this.store, () => {
			el.empty();
			const widgetCtx: ViewContext = {
				app: this.app,
				store: this.store,
				schema: this.store.all()[0],
				sourcePath: ctx.sourcePath,
				sidePeek: this.settings.sidePeek,
				refresh: () => child.rerender(),
			};
			renderWidget(el, widgetCtx, config);
		});
		ctx.addChild(child);
	}

	private renderBlockError(el: HTMLElement, message: string): void {
		el.empty();
		const box = el.createDiv({ cls: "nfo-callout-error" });
		box.createDiv({ cls: "nfo-callout-error-title", text: "Notion Suite" });
		box.createDiv({ text: message });
	}

	// --- commands ----------------------------------------------------------

	private registerCommands(): void {
		this.addCommand({
			id: "show-databases",
			name: "Show the databases sidebar",
			callback: () => void this.revealSidebar(),
		});

		this.addCommand({
			id: "open-database",
			name: "Open a database",
			callback: () => {
				this.pickDatabase((schema) => void openDatabaseTab(this, schema));
			},
		});

		this.addCommand({
			id: "assign-unique-ids",
			name: "Assign unique IDs to existing rows",
			callback: () => {
				this.pickDatabase((schema) => {
					runDetached("assign unique IDs", async () => {
						const filled = await this.store.backfillUniqueIds(schema);
						new Notice(
							filled === 0
								? "Every row already has an ID."
								: `Assigned IDs to ${filled} ${filled === 1 ? "row" : "rows"}.`
						);
					});
				});
			},
		});

		this.addCommand({
			id: "new-database",
			name: "New database",
			callback: () => this.commandNewDatabase(),
		});

		this.addCommand({
			id: "insert-view",
			name: "Insert database view",
			editorCallback: (editor) => {
				new InsertViewModal(this.app, this.store, (block) => insertAtCursor(editor, block)).open();
			},
		});

		this.addCommand({
			id: "insert-chart",
			name: "Insert chart from database",
			editorCallback: (editor) => {
				new InsertChartModal(this.app, this.store, (block) => insertAtCursor(editor, block)).open();
			},
		});

		this.addCommand({
			id: "new-row",
			name: "Add item to a database",
			callback: () => {
				this.pickDatabase((schema) => {
					new NewRowModal(this.app, this.store, schema, (file) => {
						void this.app.workspace.getLeaf(false).openFile(file);
					}).open();
				});
			},
		});

		this.addCommand({
			id: "add-property",
			name: "Add a property to a database",
			callback: () => {
				this.pickDatabase((schema) => this.openPropertyEditor(schema));
			},
		});

		this.addCommand({
			id: "import-folder",
			name: "Turn a folder into a database",
			callback: () => {
				new ImportFolderModal(this.app, this.store, () => undefined).open();
			},
		});

		this.addCommand({
			id: "toggle-slash-menu",
			name: "Toggle the slash menu",
			callback: async () => {
				this.settings.enableSlashMenu = !this.settings.enableSlashMenu;
				await this.saveSettings();
				new Notice(`Slash menu ${this.settings.enableSlashMenu ? "enabled" : "disabled"}.`);
			},
		});

		this.addCommand({
			id: "page-style",
			name: "Set this note's icon and cover",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) new PageStyleModal(this.app, file).open();
				return true;
			},
		});

		// Bound to nothing by default: Obsidian asks plugins not to claim
		// hotkeys, since anything popular collides with someone's setup.
		this.addCommand({
			id: "toggle-done",
			name: "Toggle the checkbox property on the active row",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const schema = this.store
					.all()
					.find((candidate) => file.path.startsWith(`${candidate.folder}/`));
				const prop = schema?.properties.find((p) => p.type === "checkbox");
				if (!schema || !prop) return false;
				if (!checking) {
					const row = this.store.rows(schema).find((r) => r.path === file.path);
					runDetached(`set ${prop.name}`, () =>
						this.store.setValue(schema, file.path, prop.id, !row?.values[prop.id])
					);
				}
				return true;
			},
		});

		this.addCommand({
			id: "refresh-databases",
			name: "Refresh all database views",
			callback: () => {
				this.store.invalidate();
				new Notice("Database views refreshed.");
			},
		});
	}

	commandNewDatabase(): void {
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		new NewDatabaseModal(
			this.app,
			this.store,
			this.settings.defaultDatabaseFolder,
			(schema: DatabaseSchema, block: string) => {
				if (editor) insertAtCursor(editor, block);
				else new Notice(`Created “${schema.name}”. Open a note and run “Insert database view”.`);
			}
		).open();
	}

	/** Show the databases sidebar, opening it in the right pane if needed. */
	async revealSidebar(activate = true): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
		if (existing.length > 0) {
			if (activate) await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: activate });
		if (activate) await this.app.workspace.revealLeaf(leaf);
	}

	/** Open the property editor for a database, used by the settings tab. */
	openPropertyEditor(schema: DatabaseSchema): void {
		new PropertyModal(this.app, this.store, schema, null, () => this.store.invalidate()).open();
	}

	private pickDatabase(onPick: (schema: DatabaseSchema) => void): void {
		const databases = this.store.all();
		if (databases.length === 0) {
			new Notice("No databases yet. Create one first.");
			return;
		}
		if (databases.length === 1) {
			onPick(databases[0]);
			return;
		}
		new DatabasePickerModal(this.app, this.store, onPick).open();
	}

	private runSlashAction(action: NonNullable<SlashCommand["action"]>, editor: Editor): void {
		switch (action) {
			case "new-database":
				new NewDatabaseModal(
					this.app,
					this.store,
					this.settings.defaultDatabaseFolder,
					(_schema, block) => insertAtCursor(editor, block)
				).open();
				break;
			case "insert-view":
			case "link-database":
				new InsertViewModal(this.app, this.store, (block) => insertAtCursor(editor, block)).open();
				break;
			case "insert-chart":
				new InsertChartModal(this.app, this.store, (block) => insertAtCursor(editor, block)).open();
				break;
			case "page-style": {
				const file = this.app.workspace.getActiveFile();
				if (file) new PageStyleModal(this.app, file).open();
				else new Notice("Open a note first.");
				break;
			}
			case "new-row":
				this.pickDatabase((schema) => {
					new NewRowModal(this.app, this.store, schema, (file: TFile) => {
						insertAtCursor(editor, `[[${file.basename}]]`);
					}).open();
				});
				break;
		}
	}

	// --- plumbing ----------------------------------------------------------

	private registerVaultListeners(): void {
		// Any of these can change what a view should display, so the row cache
		// is dropped and open blocks re-render (debounced inside the store).
		this.registerEvent(this.app.metadataCache.on("changed", () => this.store.invalidate()));
		this.registerEvent(this.app.vault.on("create", () => this.store.invalidate()));
		this.registerEvent(this.app.vault.on("delete", () => this.store.invalidate()));
		// A rename is not just a cache change: relations and sub-item links hold
		// a note's title, so the row that moved has to be repointed to before
		// anything re-reads it. Covers renames from the file explorer too.
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					void this.store.relinkRenamed(oldPath, file.path).catch((error: unknown) => {
						console.error("Notion Suite: could not repoint links after a rename", error);
						new Notice("Some links to the renamed row could not be updated.");
					});
					return;
				}
				this.store.invalidate();
			})
		);
	}

	applyBodyClasses(): void {
		document.body.toggleClass("nfo-typography", this.settings.notionTypography);
		document.body.toggleClass("nfo-compact", this.settings.compactRows);
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<NotionSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	}

	async saveSettings(): Promise<void> {
		this.settings.databases = this.store ? this.store.serialize() : this.settings.databases;
		await this.saveData(this.settings);
	}
}

/**
 * Keeps one rendered block in sync with the store.
 *
 * Obsidian owns the lifetime of a code block: `onload` fires when it becomes
 * visible and `onunload` when it scrolls away or the note closes, which is
 * exactly when the store subscription should start and stop.
 */
class BlockRenderChild extends MarkdownRenderChild {
	private handler = () => this.rerender();

	constructor(
		containerEl: HTMLElement,
		private store: DatabaseStore,
		private draw: () => void
	) {
		super(containerEl);
	}

	onload(): void {
		this.store.on("changed", this.handler);
		this.draw();
	}

	onunload(): void {
		this.store.off("changed", this.handler);
	}

	rerender(): void {
		this.draw();
	}
}

function insertAtCursor(editor: Editor, text: string): void {
	const cursor = editor.getCursor();
	const line = editor.getLine(cursor.line);
	// Blocks need their own line; nudge onto a fresh one if the caret is mid-text.
	const prefix = line.slice(0, cursor.ch).trim().length > 0 ? "\n" : "";
	editor.replaceRange(prefix + text, cursor);
	editor.focus();
}
