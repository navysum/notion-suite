import { App, Modal, Setting } from "obsidian";
import { DatabaseSchema, ViewConfig } from "../types";

/**
 * Name a view so it can be reopened.
 *
 * A view is a block of settings -- a filter, a sort, which properties, which
 * type -- and rebuilding that every time you want "this week's work" is the
 * thing saved views exist to stop. Saved views live on the database, so they
 * show up in the sidebar wherever you are in the vault.
 */
export class SaveViewModal extends Modal {
	private name: string;

	constructor(
		app: App,
		private schema: DatabaseSchema,
		view: ViewConfig,
		private onSave: (name: string) => void
	) {
		super(app);
		this.name = view.name || suggestName(view);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Save this view" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text: "It will appear under this database in the sidebar.",
		});

		new Setting(contentEl).setName("Name").addText((text) => {
			text.setValue(this.name).onChange((value) => (this.name = value));
			text.inputEl.focus();
			text.inputEl.select();
		});

		const existing = this.schema.views.some((v) => v.name === this.name);
		if (existing) {
			contentEl.createEl("p", {
				cls: "nfo-modal-hint",
				text: "A view with this name already exists and will be replaced.",
			});
		}

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						const clean = this.name.trim();
						if (!clean) return;
						this.onSave(clean);
						this.close();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** A name that says what the view is, for someone who has not named it. */
function suggestName(view: ViewConfig): string {
	const type = view.type.charAt(0).toUpperCase() + view.type.slice(1);
	if (view.groupBy) return `${type} by ${view.groupBy}`;
	if (view.filter?.rules.length) return `Filtered ${type.toLowerCase()}`;
	return type;
}
