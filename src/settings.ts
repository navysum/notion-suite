import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type NotionForObsidian from "./main";
import { DatabaseSchema } from "./types";
import { ImportFolderModal } from "./ui/modals";

export interface NotionSettings {
	enableSlashMenu: boolean;
	slashTrigger: string;
	defaultDatabaseFolder: string;
	notionTypography: boolean;
	compactRows: boolean;
	showRowNumbers: boolean;
	databases: DatabaseSchema[];
}

export const DEFAULT_SETTINGS: NotionSettings = {
	enableSlashMenu: true,
	slashTrigger: "/",
	defaultDatabaseFolder: "Databases",
	notionTypography: true,
	compactRows: false,
	showRowNumbers: false,
	databases: [],
};

export class NotionSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: NotionForObsidian) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Editing").setHeading();

		new Setting(containerEl)
			.setName("Slash command menu")
			.setDesc("Type the trigger character in the editor to insert blocks, views and charts.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableSlashMenu).onChange(async (value) => {
					this.plugin.settings.enableSlashMenu = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Trigger character")
			.setDesc("Defaults to “/”, matching Notion. A single character.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.slashTrigger)
					.setPlaceholder("/")
					.onChange(async (value) => {
						// An empty or multi-character trigger would fire on every keystroke.
						this.plugin.settings.slashTrigger = value.trim().slice(0, 1) || "/";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Notion typography")
			.setDesc("Apply Notion-like spacing, headings and callout styling to notes.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.notionTypography).onChange(async (value) => {
					this.plugin.settings.notionTypography = value;
					await this.plugin.saveSettings();
					this.plugin.applyBodyClasses();
				})
			);

		new Setting(containerEl).setName("Databases").setHeading();

		new Setting(containerEl)
			.setName("Default folder")
			.setDesc("New databases are created inside this folder.")
			.addText((text) =>
				text
					.setValue(this.plugin.settings.defaultDatabaseFolder)
					.setPlaceholder("Databases")
					.onChange(async (value) => {
						this.plugin.settings.defaultDatabaseFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Compact rows")
			.setDesc("Tighter row height in table and list views.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.compactRows).onChange(async (value) => {
					this.plugin.settings.compactRows = value;
					await this.plugin.saveSettings();
					this.plugin.applyBodyClasses();
				})
			);

		new Setting(containerEl)
			.setName("Import an existing folder")
			.setDesc("Turn a folder of notes (for example a Notion export) into a database.")
			.addButton((button) =>
				button
					.setButtonText("Import folder")
					.onClick(() => {
						new ImportFolderModal(this.app, this.plugin.store, () => this.display()).open();
					})
			);

		this.renderDatabaseList(containerEl);
	}

	private renderDatabaseList(containerEl: HTMLElement): void {
		const databases = this.plugin.store.all();
		new Setting(containerEl).setName(`Your databases (${databases.length})`).setHeading();

		if (databases.length === 0) {
			containerEl.createEl("p", {
				cls: "nfo-modal-hint",
				text: "None yet. Use the command “Notion: New database”, or type /database in a note.",
			});
			return;
		}

		for (const schema of databases) {
			const setting = new Setting(containerEl)
				.setName(`${schema.icon ?? "🗂️"} ${schema.name}`)
				.setDesc(`${schema.folder} · ${schema.properties.length} properties`);

			setting.addButton((button) =>
				button
					.setButtonText("Copy view block")
					.onClick(async () => {
						await navigator.clipboard.writeText(
							`\`\`\`notion-db\ndatabase: ${schema.name}\nview: table\n\`\`\``
						);
						new Notice("View block copied to clipboard.");
					})
			);

			setting.addButton((button) =>
				button
					.setButtonText("Remove")
					.setWarning()
					.onClick(async () => {
						// Only the schema is removed; the notes in the folder are left alone.
						await this.plugin.store.deleteDatabase(schema.id);
						new Notice(`Removed the “${schema.name}” database definition. Your notes are untouched.`);
						this.display();
					})
			);
		}
	}
}
