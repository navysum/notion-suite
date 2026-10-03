import { App, Modal, Setting, setIcon } from "obsidian";
import { DatabaseStore, makeId } from "../db/store";
import { Automation } from "../db/automation";
import { DatabaseSchema, PropertyDef } from "../types";
import { DERIVED_TYPES } from "../db/store";

/**
 * The rules that write one property when another changes.
 *
 * Each rule reads as a sentence, because that is what it is: *when* Status
 * *becomes* Done, *set* Completed *to* today. Four controls in that order, so
 * there is nothing to learn and nothing to remember.
 */
export class AutomationModal extends Modal {
	private rules: Automation[];
	private listEl: HTMLElement | null = null;

	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		private onSave: () => void
	) {
		super(app);
		// A copy, so closing without saving really does change nothing.
		this.rules = (schema.automations ?? []).map((rule) => ({ ...rule }));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal", "nfo-automations");
		contentEl.createEl("h2", { text: "When this changes, do that" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text:
				"A rule watches one property and writes another. It fires on a change, so " +
				"re-picking a value it already had does nothing — a completion date is " +
				"stamped once, not every time somebody opens the menu.",
		});

		this.listEl = contentEl.createDiv({ cls: "nfo-automation-list" });
		this.draw();

		const add = contentEl.createDiv({ cls: "nfo-filter-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "Add a rule" });
		add.addEventListener("click", () => {
			const watchable = this.watchable()[0];
			const settable = this.settable()[0];
			if (!watchable || !settable) return;
			this.rules.push({
				id: makeId("rule"),
				when: watchable.id,
				becomes: "",
				set: settable.id,
				to: "today",
			});
			this.draw();
		});

		new Setting(contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => void this.save())
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Anything whose change can be noticed: not a computed value. */
	private watchable(): PropertyDef[] {
		return this.schema.properties.filter((p) => !DERIVED_TYPES.includes(p.type));
	}

	/** Anything a rule may write. A computed property would be overwritten. */
	private settable(): PropertyDef[] {
		return this.schema.properties.filter(
			(p) => !DERIVED_TYPES.includes(p.type) && p.type !== "uniqueid"
		);
	}

	private draw(): void {
		const host = this.listEl;
		if (!host) return;
		host.empty();

		if (this.watchable().length === 0 || this.settable().length === 0) {
			host.createDiv({
				cls: "nfo-callout-error",
				text: "This database needs at least two editable properties before a rule can do anything.",
			});
			return;
		}

		if (this.rules.length === 0) {
			host.createDiv({ cls: "nfo-filter-empty", text: "No rules — nothing happens on its own." });
			return;
		}

		this.rules.forEach((rule, index) => this.drawRule(host, rule, index));
	}

	private drawRule(host: HTMLElement, rule: Automation, index: number): void {
		const line = host.createDiv({ cls: "nfo-automation-row" });
		line.createSpan({ cls: "nfo-automation-word", text: "When" });

		const when = line.createEl("select", { cls: "nfo-filter-prop" });
		for (const prop of this.watchable()) {
			when.createEl("option", { text: prop.name }).value = prop.id;
		}
		when.value = rule.when;
		when.addEventListener("change", () => {
			rule.when = when.value;
			this.draw();
		});

		line.createSpan({ cls: "nfo-automation-word", text: "becomes" });

		const watched = this.schema.properties.find((p) => p.id === rule.when);
		// A select's values are known, so offer them rather than ask for typing.
		if (watched?.options?.length) {
			const becomes = line.createEl("select", { cls: "nfo-filter-value" });
			becomes.createEl("option", { text: "anything" }).value = "";
			for (const option of watched.options) {
				becomes.createEl("option", { text: option.name }).value = option.name;
			}
			becomes.value = rule.becomes ?? "";
			becomes.addEventListener("change", () => (rule.becomes = becomes.value));
		} else if (watched?.type === "checkbox") {
			const becomes = line.createEl("select", { cls: "nfo-filter-value" });
			becomes.createEl("option", { text: "anything" }).value = "";
			becomes.createEl("option", { text: "checked" }).value = "true";
			becomes.createEl("option", { text: "unchecked" }).value = "false";
			becomes.value = rule.becomes ?? "";
			becomes.addEventListener("change", () => (rule.becomes = becomes.value));
		} else {
			const becomes = line.createEl("input", { cls: "nfo-filter-value" });
			becomes.type = "text";
			becomes.placeholder = "anything";
			becomes.value = rule.becomes ?? "";
			becomes.addEventListener("input", () => (rule.becomes = becomes.value));
		}

		line.createSpan({ cls: "nfo-automation-word", text: "set" });

		const set = line.createEl("select", { cls: "nfo-filter-prop" });
		for (const prop of this.settable()) {
			set.createEl("option", { text: prop.name }).value = prop.id;
		}
		set.value = rule.set;
		set.addEventListener("change", () => {
			rule.set = set.value;
			this.draw();
		});

		line.createSpan({ cls: "nfo-automation-word", text: "to" });

		const target = this.schema.properties.find((p) => p.id === rule.set);
		if (target?.type === "date") {
			const to = line.createEl("select", { cls: "nfo-filter-value" });
			to.createEl("option", { text: "today" }).value = "today";
			to.createEl("option", { text: "clear it" }).value = "";
			to.value = rule.to === "" ? "" : "today";
			to.addEventListener("change", () => (rule.to = to.value));
		} else if (target?.type === "checkbox") {
			const to = line.createEl("select", { cls: "nfo-filter-value" });
			to.createEl("option", { text: "checked" }).value = "true";
			to.createEl("option", { text: "unchecked" }).value = "false";
			to.value = rule.to === "false" ? "false" : "true";
			to.addEventListener("change", () => (rule.to = to.value));
		} else if (target?.options?.length) {
			const to = line.createEl("select", { cls: "nfo-filter-value" });
			for (const option of target.options) {
				to.createEl("option", { text: option.name }).value = option.name;
			}
			to.createEl("option", { text: "clear it" }).value = "";
			to.value = rule.to;
			to.addEventListener("change", () => (rule.to = to.value));
		} else {
			const to = line.createEl("input", { cls: "nfo-filter-value" });
			to.type = "text";
			to.value = rule.to;
			to.addEventListener("input", () => (rule.to = to.value));
		}

		const remove = line.createSpan({ cls: "nfo-filter-remove" });
		setIcon(remove, "x");
		remove.setAttribute("aria-label", "Remove this rule");
		remove.addEventListener("click", () => {
			this.rules.splice(index, 1);
			this.draw();
		});
	}

	private async save(): Promise<void> {
		await this.store.updateDatabase(this.schema.id, (schema) => {
			if (this.rules.length === 0) delete schema.automations;
			else schema.automations = this.rules;
		});
		this.onSave();
		this.close();
	}
}
