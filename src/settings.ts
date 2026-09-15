import {
	App,
	Notice,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
} from "obsidian";
import type NotionForObsidian from "./main";
import { DatabaseSchema } from "./types";
import { ImportFolderModal } from "./ui/modals";

export interface NotionSettings {
	enableSlashMenu: boolean;
	slashTrigger: string;
	defaultDatabaseFolder: string;
	notionTypography: boolean;
	sidePeek: boolean;
	openSidebarOnStart: boolean;
	compactRows: boolean;
	showRowNumbers: boolean;
	databases: DatabaseSchema[];
}

export const DEFAULT_SETTINGS: NotionSettings = {
	enableSlashMenu: true,
	slashTrigger: "/",
	defaultDatabaseFolder: "Databases",
	notionTypography: true,
	sidePeek: true,
	openSidebarOnStart: true,
	compactRows: false,
	showRowNumbers: false,
	databases: [],
};

/** Setting keys the declarative controls bind to. */
type SettingKey = keyof Omit<NotionSettings, "databases" | "showRowNumbers">;

/**
 * The settings tab, declared rather than drawn.
 *
 * `display()` is deliberately not overridden. Obsidian calls
 * `getSettingDefinitions()` from its own `display()`, and again when the tab is
 * registered so the settings can be indexed — which is what puts them in the
 * settings search. Drawing the tab by hand would mean maintaining the same UI
 * twice and keeping the two in step.
 */
export class NotionSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NotionForObsidian) {
		super(app, plugin);
	}

	/** Values come from, and go back to, the plugin's own settings object. */
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = value;
		await this.plugin.saveSettings();
		// Two of these settings are expressed as body classes, not behaviour.
		this.plugin.applyBodyClasses();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Editing",
				items: [
					{
						name: "Slash command menu",
						desc: "Type the trigger character in the editor to insert blocks, views and charts.",
						aliases: ["slash", "commands", "menu", "insert"],
						control: { type: "toggle", key: "enableSlashMenu", defaultValue: true },
					},
					{
						name: "Trigger character",
						desc: "Defaults to “/”, matching Notion. A single character.",
						aliases: ["slash", "shortcut"],
						control: {
							type: "text",
							key: "slashTrigger",
							placeholder: "/",
							defaultValue: "/",
							// An empty or multi-character trigger would fire on
							// every keystroke, so reject it rather than silently
							// rewriting what the user typed.
							validate: (value) =>
								value.trim().length === 1
									? undefined
									: "Enter exactly one character.",
						},
					},
					{
						name: "Notion typography",
						desc: "Apply Notion-like spacing, headings and callout styling to notes.",
						aliases: ["fonts", "headings", "callouts", "style"],
						control: { type: "toggle", key: "notionTypography", defaultValue: true },
					},
				],
			},
			{
				type: "group",
				heading: "Databases",
				items: [
					{
						name: "Default folder",
						desc: "New databases are created inside this folder.",
						aliases: ["location", "path"],
						control: {
							type: "folder",
							key: "defaultDatabaseFolder",
							placeholder: "Databases",
							defaultValue: "Databases",
						},
					},
					{
						name: "Show the databases sidebar on startup",
						desc: "Keeps every database one click away, the way Notion's sidebar does.",
						aliases: ["sidebar", "panel", "browse"],
						control: { type: "toggle", key: "openSidebarOnStart", defaultValue: true },
					},
					{
						name: "Open rows beside the view",
						desc: "Clicking a row opens its note in a side pane, so you keep the table or board you were working in.",
						aliases: ["peek", "split", "pane", "preview"],
						control: { type: "toggle", key: "sidePeek", defaultValue: true },
					},
					{
						name: "Compact rows",
						desc: "Tighter row height in table and list views.",
						aliases: ["density", "spacing"],
						control: { type: "toggle", key: "compactRows", defaultValue: false },
					},
					{
						name: "Import an existing folder",
						desc: "Turn a folder of notes (for example a Notion export) into a database.",
						aliases: ["notion", "export", "migrate"],
						action: () => {
							new ImportFolderModal(this.app, this.plugin.store, () => this.update()).open();
						},
					},
				],
			},
			this.databaseList(),
		];
	}

	/**
	 * The databases themselves, as a list the user can delete from.
	 *
	 * Rendered through `render` rather than as bound controls: these rows are
	 * data the plugin owns, not preferences, so there is no settings key to
	 * bind and the row contents depend on the vault.
	 */
	private databaseList(): SettingDefinitionItem {
		const databases = this.plugin.store.all();
		return {
			type: "list",
			heading: `Your databases (${databases.length})`,
			emptyState: "None yet. Use the command “Notion: New database”, or type /database in a note.",
			addItem: {
				name: "New database",
				action: () => {
					this.plugin.commandNewDatabase();
				},
			},
			onDelete: (index: number) => {
				const schema = databases[index];
				if (!schema) return;
				void (async () => {
					// Only the schema is forgotten; the notes stay where they are.
					await this.plugin.store.deleteDatabase(schema.id);
					new Notice(
						`Removed the “${schema.name}” database definition. Your notes are untouched.`
					);
					this.update();
				})();
			},
			items: databases.map((schema) => ({
				name: `${schema.icon ?? "🗂️"} ${schema.name}`,
				desc: `${schema.folder} · ${schema.properties.length} ${
					schema.properties.length === 1 ? "property" : "properties"
				}`,
				aliases: [schema.folder, ...schema.properties.map((p) => p.name)],
				render: (setting: Setting) => {
					setting.addExtraButton((button) =>
						button
							.setIcon("pencil")
							.setTooltip("Add a property")
							.onClick(() => {
								this.plugin.openPropertyEditor(schema);
							})
					);
				},
			})),
		};
	}
}
