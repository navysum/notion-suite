import { App, Modal, Setting } from "obsidian";
import { DatabaseStore } from "../db/store";
import { DatabaseSchema } from "../types";
import { parseRecurrence } from "../db/recur";

/**
 * Set up repeating rows for a database.
 *
 * Three choices, because a repeat needs three things: where the rule is
 * written, which date moves, and what counts as "done". Keeping them explicit
 * beats guessing from property names -- a database with `repeat` meaning
 * something else entirely should not start creating rows on its own.
 */
export class RecurrenceModal extends Modal {
	private rule: string;
	private date: string;
	private trigger: string;

	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		private onSave: () => void
	) {
		super(app);
		const current = schema.recurrence;
		this.rule = current?.rule ?? "";
		this.date = current?.date ?? "";
		this.trigger = current?.trigger ?? "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Repeating rows" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text:
				"Ticking a row off creates the next one, with everything else about it " +
				"copied across. Nothing appears until you finish the last one, so a " +
				"fortnight away does not leave you fourteen identical rows.",
		});

		const texts = this.schema.properties.filter((p) => p.type === "text");
		const dates = this.schema.properties.filter((p) => p.type === "date");
		const checks = this.schema.properties.filter((p) => p.type === "checkbox");

		if (texts.length === 0 || dates.length === 0 || checks.length === 0) {
			contentEl.createEl("p", {
				cls: "nfo-callout-error",
				text:
					"This needs a text property for the rule, a date property to move, and a " +
					"checkbox to tick. Add whichever is missing first.",
			});
			new Setting(contentEl).addButton((button) =>
				button.setButtonText("Close").onClick(() => this.close())
			);
			return;
		}

		new Setting(contentEl)
			.setName("The rule is in")
			.setDesc('A text property holding "weekly", "every 3 days", "every Tuesday".')
			.addDropdown((dropdown) => {
				dropdown.addOption("", "Not set up");
				for (const prop of texts) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.rule).onChange((value) => (this.rule = value));
			});

		new Setting(contentEl)
			.setName("Move this date")
			.addDropdown((dropdown) => {
				for (const prop of dates) dropdown.addOption(prop.id, prop.name);
				this.date = this.date || dates[0].id;
				dropdown.setValue(this.date).onChange((value) => (this.date = value));
			});

		new Setting(contentEl)
			.setName("When this is ticked")
			.addDropdown((dropdown) => {
				for (const prop of checks) dropdown.addOption(prop.id, prop.name);
				this.trigger = this.trigger || checks[0].id;
				dropdown.setValue(this.trigger).onChange((value) => (this.trigger = value));
			});

		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text: 'Understood rules: daily · weekly · fortnightly · monthly · quarterly · yearly · every 3 days · every other week · every Tuesday · weekdays',
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => {
						void this.save();
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async save(): Promise<void> {
		await this.store.updateDatabase(this.schema.id, (schema) => {
			// Clearing the rule property is how you turn the whole thing off,
			// rather than having a separate switch that can disagree with it.
			if (!this.rule) delete schema.recurrence;
			else schema.recurrence = { rule: this.rule, date: this.date, trigger: this.trigger };
		});
		this.onSave();
		this.close();
	}
}

/** Exported for the settings copy: what the parser will accept. */
export const RECURRENCE_EXAMPLES = [
	"daily",
	"weekly",
	"fortnightly",
	"monthly",
	"quarterly",
	"yearly",
	"every 3 days",
	"every other week",
	"every Tuesday",
	"weekdays",
].filter((example) => parseRecurrence(example) !== null);
