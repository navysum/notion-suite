import { App, Modal, Notice, Setting } from "obsidian";
import { DatabaseStore } from "../db/store";
import {
	DatabaseSchema,
	PropertyDef,
	PropertyType,
	PROPERTY_TYPES,
	PROPERTY_TYPE_LABELS,
	ROLLUP_FUNCTIONS,
	ROLLUP_FUNCTION_LABELS,
	ROLLUP_TITLE_KEY,
	RollupFunction,
	SelectOption,
	StatusStage,
} from "../types";
import { autoColor } from "../utils/dom";
import { CURRENCIES, defaultCurrency } from "../db/currency";

/**
 * Point a dropdown at `preferred` if that is a real option, else at the first
 * one, and report back what was actually selected.
 *
 * `setValue` with an unknown value leaves the control showing the first option
 * without firing a change event, so the draft would keep a dangling id -- a
 * relation whose target database was deleted, or a rollup naming a property
 * that no longer exists -- while the UI claimed otherwise.
 */
function selectOption(
	dropdown: { addOption: (v: string, d: string) => void; setValue: (v: string) => void },
	options: Array<[string, string]>,
	preferred: string | undefined
): string {
	for (const [value, label] of options) dropdown.addOption(value, label);
	const resolved = options.some(([value]) => value === preferred)
		? (preferred as string)
		: (options[0]?.[0] ?? "");
	dropdown.setValue(resolved);
	return resolved;
}

/** Stage colours follow the traffic-light reading of a board. */
function stageColor(stage: StatusStage): SelectOption["color"] {
	if (stage === "done") return "green";
	if (stage === "doing") return "blue";
	return "gray";
}

/** Turn a display name into a frontmatter key. */
export function propertyKey(name: string): string {
	return (
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 48) || "property"
	);
}

/**
 * Create or edit a single property.
 *
 * This is the only place relations and rollups can be wired up, so it takes
 * care to offer only choices that can actually work: relation targets are real
 * databases, and a rollup can only follow a relation that already exists on
 * this database.
 */
export class PropertyModal extends Modal {
	private draft: PropertyDef;
	private readonly isNew: boolean;
	/** The type this property had when the modal opened. The Type dropdown
	 *  writes straight into `draft`, so `draft.type` cannot answer "was this a
	 *  relation?" once the user has touched it. */
	private readonly originalType: PropertyDef["type"] | null;
	private optionsText = "";
	/** Whether this relation should become the schema's parent link. */
	private asParentLink: boolean | null = null;
	/** Whether this number should become the schema's manual-order field. */
	private asOrderField: boolean | null = null;

	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		existing: PropertyDef | null,
		private onDone: () => void
	) {
		super(app);
		this.isNew = existing === null;
		this.originalType = existing ? existing.type : null;
		this.draft = existing ? structuredClone(existing) : { id: "", name: "", type: "text" };
		this.optionsText = (this.draft.options ?? []).map((o) => o.name).join("\n");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: this.isNew ? "New property" : "Edit property" });

		new Setting(contentEl).setName("Name").addText((text) =>
			text
				.setValue(this.draft.name)
				.setPlaceholder("Status")
				.onChange((value) => {
					this.draft.name = value;
					// The frontmatter key is only derived from the name while the
					// property is new. Changing it later would orphan existing data.
					if (this.isNew) this.draft.id = propertyKey(value);
					keyHint.setText(this.draft.id ? `Frontmatter key: ${this.draft.id}` : "");
				})
		);

		const keyHint = contentEl.createDiv({
			cls: "nfo-modal-hint",
			text: this.draft.id ? `Frontmatter key: ${this.draft.id}` : "",
		});

		new Setting(contentEl).setName("Type").addDropdown((dropdown) => {
			for (const type of PROPERTY_TYPES) dropdown.addOption(type, PROPERTY_TYPE_LABELS[type]);
			dropdown.setValue(this.draft.type).onChange((value) => {
				this.draft.type = value as PropertyType;
				this.renderTypeOptions(typeBox);
			});
		});

		const typeBox = contentEl.createDiv();
		this.renderTypeOptions(typeBox);

		const footer = new Setting(contentEl);
		if (!this.isNew) {
			footer.addButton((button) =>
				button
					.setButtonText("Delete")
					.setDestructive()
					.onClick(() => void this.remove())
			);
		}
		footer.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((button) =>
			button
				.setButtonText(this.isNew ? "Create" : "Save")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private renderTypeOptions(parent: HTMLElement): void {
		parent.empty();
		const type = this.draft.type;

		if (type === "status") {
			new Setting(parent)
				.setName("Options")
				.setDesc(
					"One per line. Prefix with a stage to group them: " +
						"“todo: Not started”, “doing: In progress”, “done: Shipped”. " +
						"Boards order their columns by that stage."
				)
				.addTextArea((area) =>
					area
						.setValue(this.statusText())
						.setPlaceholder("todo: Not started\ndoing: In progress\ndone: Complete")
						.onChange((value) => (this.optionsText = value))
				);
		}

		if (type === "select" || type === "multiselect") {
			new Setting(parent)
				.setName("Options")
				.setDesc("One per line. Colours are assigned automatically.")
				.addTextArea((area) =>
					area
						.setValue(this.optionsText)
						.setPlaceholder("Not started\nIn progress\nDone")
						.onChange((value) => (this.optionsText = value))
				);
		}

		if (type === "uniqueid") {
			new Setting(parent)
				.setName("Prefix")
				.setDesc("Put in front of the number, e.g. TASK gives TASK-1. Cosmetic: changing it renumbers nothing.")
				.addText((text) =>
					text
						.setValue(this.draft.idPrefix ?? "")
						.setPlaceholder("TASK")
						.onChange((value) => (this.draft.idPrefix = value.trim() || undefined))
				);
		}

		if (type === "number") {
			new Setting(parent)
				.setName("Use for manual ordering")
				.setDesc(
					"Lets you drag cards into an order within a board column. " +
						"The position is stored in this property, so it is visible and editable like any other."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.schema.orderProperty === this.draft.id)
						.onChange((value) => (this.asOrderField = value))
				);

			new Setting(parent).setName("Format").addDropdown((dropdown) => {
				dropdown.addOption("plain", "Plain");
				dropdown.addOption("percent", "Percent");
				dropdown.addOption("currency", "Currency");
				dropdown
					.setValue(this.draft.numberFormat ?? "plain")
					.onChange((value) => {
						this.draft.numberFormat = value as "plain" | "percent" | "currency";
						// The currency picker only exists for a currency, so the
						// form has to be redrawn rather than just updated.
						parent.empty();
						this.renderTypeOptions(parent);
					});
			});

			if (this.draft.numberFormat === "currency") {
				new Setting(parent)
					.setName("Currency")
					.setDesc(
						"The symbol, where it sits and how the digits are grouped all follow " +
							"the currency, so this is not only a symbol swap."
					)
					.addDropdown((dropdown) => {
						for (const entry of CURRENCIES) dropdown.addOption(entry.code, entry.label);
						this.draft.currency = this.draft.currency ?? defaultCurrency();
						dropdown
							.setValue(this.draft.currency)
							.onChange((value) => (this.draft.currency = value));
					});
			}
		}

		if (type === "formula") {
			new Setting(parent)
				.setName("Expression")
				.setDesc("Reference properties in {braces}. Arithmetic only: + - * / ( )")
				.addText((text) =>
					text
						.setValue(this.draft.formula ?? "")
						.setPlaceholder("{Current} / {Target}")
						.onChange((value) => (this.draft.formula = value))
				);
		}

		if (type === "relation") {
			const others = this.store.all();
			new Setting(parent)
				.setName("Related database")
				.setDesc("Rows are linked by note title.")
				.addDropdown((dropdown) => {
					const options: Array<[string, string]> =
						others.length === 0
							? [["", "No other databases yet"]]
							: others.map((other) => [other.id, other.name] as [string, string]);
					this.draft.relationDatabaseId = selectOption(
						dropdown,
						options,
						this.draft.relationDatabaseId
					);
					dropdown.onChange((value) => (this.draft.relationDatabaseId = value));
				});
		}

		if (type === "rollup") {
			this.renderRollupOptions(parent);
		}

		if (type === "relation") {
			new Setting(parent)
				.setName("Use as the parent link")
				.setDesc(
					"Turns rows into a tree: a row pointing at another becomes its sub-item, " +
						"indented beneath it with a fold arrow."
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.schema.parentProperty === this.draft.id)
						.onChange((value) => (this.asParentLink = value))
				);
		}
	}

	private renderRollupOptions(parent: HTMLElement): void {
		const relations = this.schema.properties.filter((p) => p.type === "relation");

		if (relations.length === 0) {
			parent.createDiv({
				cls: "nfo-callout-error",
				text:
					"A rollup reaches through a relation, so this database needs a relation property first. " +
					"Add one (type: Relation) pointing at the database you want to pull numbers from, then come back.",
			});
			return;
		}

		this.draft.rollupRelation = this.draft.rollupRelation ?? relations[0].id;
		this.draft.rollupFunction = this.draft.rollupFunction ?? "sum";

		new Setting(parent)
			.setName("Relation")
			.setDesc("Which link to follow.")
			.addDropdown((dropdown) => {
				this.draft.rollupRelation = selectOption(
					dropdown,
					relations.map((relation) => [relation.id, relation.name] as [string, string]),
					this.draft.rollupRelation
				);
				dropdown.onChange((value) => {
					this.draft.rollupRelation = value;
					this.draft.rollupProperty = undefined;
					this.renderTypeOptions(parent.parentElement as HTMLElement);
				});
			});

		const relation = relations.find((r) => r.id === this.draft.rollupRelation);
		const target = relation?.relationDatabaseId
			? this.store.get(relation.relationDatabaseId)
			: undefined;

		if (!target) {
			parent.createDiv({
				cls: "nfo-callout-error",
				text: `The “${relation?.name ?? "selected"}” relation does not point at a database yet. Edit it and choose one.`,
			});
			return;
		}

		// Anything derived on the far side is still fine to roll up: it is
		// resolved before this rollup reads it.
		const candidates = target.properties;
		this.draft.rollupProperty = this.draft.rollupProperty ?? ROLLUP_TITLE_KEY;

		new Setting(parent)
			.setName("Property")
			.setDesc(`Which property of each related ${target.name} row to gather.`)
			.addDropdown((dropdown) => {
				const options: Array<[string, string]> = [
					[ROLLUP_TITLE_KEY, "Name (note title)"],
					...candidates.map((prop) => [prop.id, prop.name] as [string, string]),
				];
				this.draft.rollupProperty = selectOption(dropdown, options, this.draft.rollupProperty);
				dropdown.onChange((value) => (this.draft.rollupProperty = value));
			});

		new Setting(parent)
			.setName("Calculate")
			.setDesc("How the gathered values become one value.")
			.addDropdown((dropdown) => {
				for (const fn of ROLLUP_FUNCTIONS) dropdown.addOption(fn, ROLLUP_FUNCTION_LABELS[fn]);
				dropdown
					.setValue(this.draft.rollupFunction!)
					.onChange((value) => (this.draft.rollupFunction = value as RollupFunction));
			});
	}

	private async submit(): Promise<void> {
		const name = this.draft.name.trim();
		if (!name) {
			new Notice("Give the property a name.");
			return;
		}
		if (this.isNew) this.draft.id = this.draft.id || propertyKey(name);
		this.draft.name = name;

		const clash = this.schema.properties.some(
			(p) => p.id === this.draft.id && (this.isNew || p !== this.findExisting())
		);
		if (this.isNew && clash) {
			new Notice(`This database already has a property using the key “${this.draft.id}”.`);
			return;
		}

		if (this.draft.type === "status") {
			const existing = new Map((this.draft.options ?? []).map((o) => [o.name, o]));
			const stages: Record<string, StatusStage> = {};
			const options: SelectOption[] = [];
			for (const line of this.optionsText.split("\n")) {
				const text = line.trim();
				if (!text) continue;
				// "stage: Name", or a bare name that defaults to the to-do stage.
				const match = text.match(/^(todo|doing|done)\s*:\s*(.+)$/i);
				const stage = (match ? match[1].toLowerCase() : "todo") as StatusStage;
				const name = match ? match[2].trim() : text;
				if (!name) continue;
				stages[name] = stage;
				options.push(existing.get(name) ?? { name, color: stageColor(stage) });
			}
			this.draft.options = options;
			this.draft.statusStages = stages;
		} else if (this.draft.type === "select" || this.draft.type === "multiselect") {
			const existing = new Map((this.draft.options ?? []).map((o) => [o.name, o]));
			this.draft.options = this.optionsText
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean)
				// Keep the colour an option already had, so editing the list does
				// not reshuffle every pill's colour.
				.map((optionName) => existing.get(optionName) ?? { name: optionName, color: autoColor(optionName) });
		} else {
			delete this.draft.options;
		}

		if (this.draft.type === "rollup" && !this.draft.rollupRelation) {
			new Notice("Choose which relation this rollup should follow.");
			return;
		}
		if (this.draft.type === "relation" && !this.draft.relationDatabaseId) {
			new Notice("Choose which database this relation points at.");
			return;
		}

		const draft = this.draft;
		const asParent = this.asParentLink;
		const asOrder = this.asOrderField;
		await this.store.updateDatabase(this.schema.id, (schema) => {
			const index = schema.properties.findIndex((p) => p.id === draft.id);
			if (index === -1) schema.properties.push(draft);
			else schema.properties[index] = draft;

			if (asParent === true) schema.parentProperty = draft.id;
			else if (asParent === false && schema.parentProperty === draft.id) {
				delete schema.parentProperty;
			}

			if (asOrder === true) schema.orderProperty = draft.id;
			else if (asOrder === false && schema.orderProperty === draft.id) {
				delete schema.orderProperty;
			}
		});

		this.close();
		this.onDone();
	}

	/** Render existing status options back as "stage: Name" lines. */
	private statusText(): string {
		if (this.optionsText && this.optionsText.includes(":")) return this.optionsText;
		return (this.draft.options ?? [])
			.map((option) => `${this.draft.statusStages?.[option.name] ?? "todo"}: ${option.name}`)
			.join("\n");
	}

	private findExisting(): PropertyDef | undefined {
		return this.schema.properties.find((p) => p.id === this.draft.id);
	}

	private async remove(): Promise<void> {
		const draft = this.draft;
		await this.store.updateDatabase(this.schema.id, (schema) => {
			schema.properties = schema.properties.filter((p) => p.id !== draft.id);
			// A deleted property cannot go on being the parent or order field.
			if (schema.parentProperty === draft.id) delete schema.parentProperty;
			if (schema.orderProperty === draft.id) delete schema.orderProperty;
			// Drop rollups that followed a relation which no longer exists,
			// rather than leaving them silently blank forever.
			if (this.originalType === "relation") {
				schema.properties = schema.properties.filter(
					(p) => !(p.type === "rollup" && p.rollupRelation === draft.id)
				);
			}
		});
		new Notice(`Removed “${draft.name}”. The frontmatter in your notes is untouched.`);
		this.close();
		this.onDone();
	}
}
