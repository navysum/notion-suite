import { App, Modal, Notice, Setting } from "obsidian";
import { DatabaseStore, makeId } from "../db/store";
import { DatabaseSchema, DatabaseRow, RowTemplate } from "../types";
import { DERIVED_TYPES } from "../db/store";
import { runDetached } from "../utils/async";

/**
 * Save an existing row as a reusable template.
 *
 * Templates are made from a row the user has already set up rather than filled
 * in from a blank form: it is the difference between "describe the row you
 * want" and "make another one like that". Derived values are excluded, since
 * they are recomputed and would be stale the moment they were copied.
 */
export class SaveTemplateModal extends Modal {
	private name = "";

	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		private row: DatabaseRow,
		private onSaved: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Save as template" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text: `New rows made from this template start with the same property values as “${this.row.name}”.`,
		});

		new Setting(contentEl).setName("Template name").addText((text) => {
			text.setPlaceholder(this.row.name).onChange((value) => (this.name = value));
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") void this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Save template")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private async submit(): Promise<void> {
		const name = (this.name || this.row.name).trim();
		if (!name) {
			new Notice("Give the template a name.");
			return;
		}

		const values: Record<string, unknown> = {};
		for (const prop of this.schema.properties) {
			if (DERIVED_TYPES.includes(prop.type)) continue;
			const value = this.row.values[prop.id];
			if (value === null || value === undefined || value === "") continue;
			if (Array.isArray(value) && value.length === 0) continue;
			values[prop.id] = value;
		}

		const template: RowTemplate = { id: makeId("tpl"), name, values };
		await this.store.updateDatabase(this.schema.id, (schema) => {
			schema.rowTemplates = [...(schema.rowTemplates ?? []), template];
		});
		new Notice(`Saved the “${name}” template.`);
		this.close();
		this.onSaved();
	}
}

/** List a database's row templates, with a way to remove them. */
export class ManageTemplatesModal extends Modal {
	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		private onChanged: () => void
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass("nfo-modal");
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Templates in ${this.schema.name}` });

		const templates = this.schema.rowTemplates ?? [];
		if (templates.length === 0) {
			contentEl.createEl("p", {
				cls: "nfo-modal-hint",
				text: "None yet. Set a row up the way you like, then right-click it and choose “Save as template”.",
			});
			return;
		}

		for (const template of templates) {
			const filled = Object.keys(template.values).length;
			new Setting(contentEl)
				.setName(template.name)
				.setDesc(`${filled} ${filled === 1 ? "property" : "properties"} pre-filled`)
				.addButton((button) =>
					button
						.setButtonText("Delete")
						.setDestructive()
						.onClick(() => {
							runDetached("delete that template", async () => {
								await this.store.updateDatabase(this.schema.id, (schema) => {
									schema.rowTemplates = (schema.rowTemplates ?? []).filter(
										(t) => t.id !== template.id
									);
								});
								this.onChanged();
								this.render();
							});
						})
				);
		}
	}
}
