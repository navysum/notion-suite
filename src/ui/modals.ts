import {
	App,
	ButtonComponent,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TFile,
} from "obsidian";
import { DatabaseStore, slugify } from "../db/store";
import { DatabaseSchema, ChartKind, Aggregation, ViewType } from "../types";
import { DatabaseTemplate, databaseTemplates } from "./templates";

/** Pick a database from the ones defined in the vault. */
export class DatabasePickerModal extends FuzzySuggestModal<DatabaseSchema> {
	constructor(
		app: App,
		private store: DatabaseStore,
		private onPick: (schema: DatabaseSchema) => void
	) {
		super(app);
		this.setPlaceholder("Choose a database…");
	}

	getItems(): DatabaseSchema[] {
		return this.store.all();
	}

	getItemText(schema: DatabaseSchema): string {
		return `${schema.icon ?? ""} ${schema.name}`.trim();
	}

	onChooseItem(schema: DatabaseSchema): void {
		this.onPick(schema);
	}
}

/**
 * Create-a-database wizard: pick a starter, name it, choose a folder.
 * On submit it creates the folder, the schema, any sample rows, and hands the
 * caller a ready-to-paste view block.
 */
export class NewDatabaseModal extends Modal {
	private templates = databaseTemplates();
	private selected: DatabaseTemplate = this.templates[1];
	private name = "";
	private folder = "";
	private folderTouched = false;
	private includeSamples = true;

	constructor(
		app: App,
		private store: DatabaseStore,
		private defaultFolder: string,
		private onCreate: (schema: DatabaseSchema, block: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "New database" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text: "A database is a folder of notes. Each note is a row, and its properties live in the note's frontmatter — so everything stays plain markdown.",
		});

		const grid = contentEl.createDiv({ cls: "nfo-template-grid" });
		const cards = new Map<string, HTMLElement>();

		const select = (template: DatabaseTemplate) => {
			this.selected = template;
			for (const [id, card] of cards) card.toggleClass("is-selected", id === template.id);
			if (!this.name || !this.folderTouched) {
				this.name = this.name || template.name;
				nameInput.setValue(this.name);
				this.syncFolder();
				folderInput.setValue(this.folder);
			}
		};

		for (const template of this.templates) {
			const card = grid.createDiv({ cls: "nfo-template-card" });
			card.createDiv({ cls: "nfo-template-icon", text: template.icon });
			card.createDiv({ cls: "nfo-template-name", text: template.name });
			card.createDiv({ cls: "nfo-template-desc", text: template.description });
			card.addEventListener("click", () => select(template));
			cards.set(template.id, card);
		}

		let nameInput!: { setValue: (v: string) => void };
		let folderInput!: { setValue: (v: string) => void };

		new Setting(contentEl).setName("Name").addText((text) => {
			nameInput = text;
			text.setPlaceholder("Tasks").onChange((value) => {
				this.name = value;
				if (!this.folderTouched) {
					this.syncFolder();
					folderInput.setValue(this.folder);
				}
			});
		});

		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Where the row notes are stored.")
			.addText((text) => {
				folderInput = text;
				text.setPlaceholder("Databases/Tasks").onChange((value) => {
					this.folder = value;
					this.folderTouched = true;
				});
			});

		new Setting(contentEl)
			.setName("Add a few example rows")
			.setDesc("Handy for seeing the views working straight away.")
			.addToggle((toggle) =>
				toggle.setValue(this.includeSamples).onChange((value) => (this.includeSamples = value))
			);

		select(this.selected);

		const footer = new Setting(contentEl);
		footer.addButton((button: ButtonComponent) =>
			button.setButtonText("Cancel").onClick(() => this.close())
		);
		footer.addButton((button: ButtonComponent) =>
			button
				.setButtonText("Create database")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private syncFolder(): void {
		const base = this.defaultFolder.replace(/\/+$/, "");
		const leaf = this.name || this.selected.name;
		this.folder = base ? `${base}/${leaf}` : leaf;
	}

	private async submit(): Promise<void> {
		const name = (this.name || this.selected.name).trim();
		if (!name) {
			new Notice("Give the database a name first.");
			return;
		}
		if (this.store.all().some((s) => s.name.toLowerCase() === name.toLowerCase())) {
			new Notice(`A database called “${name}” already exists.`);
			return;
		}
		if (!this.folder) this.syncFolder();

		const schema = await this.store.createDatabase({
			name,
			folder: this.folder,
			icon: this.selected.icon,
			description: this.selected.description,
			// Clone the template's properties; they must not be shared by reference.
			properties: JSON.parse(JSON.stringify(this.selected.properties)),
		});

		if (this.includeSamples) {
			for (const row of this.selected.sampleRows ?? []) {
				await this.store.createRow(schema, row.name, row.values);
			}
		}

		const lines = [
			"```notion-db",
			`database: ${schema.name}`,
			`view: ${this.selected.defaultView}`,
		];
		if (this.selected.defaultView === "board" && this.selected.groupBy) {
			lines.push(`group: ${this.selected.groupBy}`);
		}
		if (this.selected.defaultView === "calendar") {
			const dateProp = this.selected.properties.find((p) => p.type === "date");
			if (dateProp) lines.push(`date: ${dateProp.id}`);
		}
		lines.push("```", "");

		this.onCreate(schema, lines.join("\n"));
		this.close();
	}
}

const VIEW_TYPES: ViewType[] = ["table", "board", "gallery", "list", "calendar"];

/** Build a ```notion-db block for an existing database. */
export class InsertViewModal extends Modal {
	private schema: DatabaseSchema | null = null;
	private viewType: ViewType = "table";
	private groupBy = "";
	private dateProperty = "";
	private filter = "";
	private sort = "";

	constructor(
		app: App,
		private store: DatabaseStore,
		private onInsert: (block: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Insert database view" });

		const databases = this.store.all();
		if (databases.length === 0) {
			contentEl.createEl("p", {
				text: "No databases yet — create one first with “Notion: New database”.",
			});
			return;
		}
		this.schema = databases[0];

		const body = contentEl.createDiv();
		const rebuild = () => {
			body.empty();
			this.renderOptions(body);
		};

		new Setting(contentEl.createDiv())
			.setName("Database")
			.addDropdown((dropdown) => {
				for (const schema of databases) dropdown.addOption(schema.id, schema.name);
				dropdown.setValue(this.schema!.id).onChange((value) => {
					this.schema = this.store.get(value) ?? null;
					this.groupBy = "";
					this.dateProperty = "";
					rebuild();
				});
			});

		contentEl.appendChild(body);
		rebuild();

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Insert")
				.setCta()
				.onClick(() => {
					this.onInsert(this.buildBlock());
					this.close();
				})
		);
	}

	private renderOptions(parent: HTMLElement): void {
		if (!this.schema) return;
		const schema = this.schema;

		new Setting(parent).setName("View").addDropdown((dropdown) => {
			for (const type of VIEW_TYPES) {
				dropdown.addOption(type, type.charAt(0).toUpperCase() + type.slice(1));
			}
			dropdown.setValue(this.viewType).onChange((value) => {
				this.viewType = value as ViewType;
				parent.empty();
				this.renderOptions(parent);
			});
		});

		if (this.viewType === "board") {
			const groupable = schema.properties.filter((p) =>
				["select", "multiselect", "checkbox"].includes(p.type)
			);
			this.groupBy = this.groupBy || groupable[0]?.id || "";
			new Setting(parent)
				.setName("Group by")
				.setDesc("Each value becomes a column.")
				.addDropdown((dropdown) => {
					if (groupable.length === 0) dropdown.addOption("", "No select property available");
					for (const prop of groupable) dropdown.addOption(prop.id, prop.name);
					dropdown.setValue(this.groupBy).onChange((value) => (this.groupBy = value));
				});
		}

		if (this.viewType === "calendar") {
			const dates = schema.properties.filter((p) =>
				["date", "created", "updated"].includes(p.type)
			);
			this.dateProperty = this.dateProperty || dates[0]?.id || "";
			new Setting(parent).setName("Date property").addDropdown((dropdown) => {
				if (dates.length === 0) dropdown.addOption("", "No date property available");
				for (const prop of dates) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.dateProperty).onChange((value) => (this.dateProperty = value));
			});
		}

		new Setting(parent)
			.setName("Filter")
			.setDesc('Plain English, e.g. "Status is not Done" — one per line.')
			.addTextArea((area) =>
				area.setPlaceholder("Status is not Done").onChange((value) => (this.filter = value))
			);

		new Setting(parent)
			.setName("Sort")
			.setDesc('e.g. "Due asc" or "-Priority".')
			.addText((text) => text.setPlaceholder("Due asc").onChange((value) => (this.sort = value)));
	}

	private buildBlock(): string {
		const schema = this.schema;
		if (!schema) return "";
		const lines = ["```notion-db", `database: ${schema.name}`, `view: ${this.viewType}`];
		if (this.viewType === "board" && this.groupBy) lines.push(`group: ${this.groupBy}`);
		if (this.viewType === "calendar" && this.dateProperty) lines.push(`date: ${this.dateProperty}`);

		const filters = this.filter
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (filters.length > 0) {
			lines.push("filter:");
			for (const rule of filters) lines.push(`  - ${rule}`);
		}
		if (this.sort.trim()) lines.push(`sort: ${this.sort.trim()}`);
		lines.push("```", "");
		return lines.join("\n");
	}
}

const CHART_KINDS: ChartKind[] = ["column", "bar", "line", "area", "pie", "donut", "scatter"];
const AGGREGATIONS: Aggregation[] = [
	"count",
	"sum",
	"average",
	"median",
	"min",
	"max",
	"count_unique",
	"percent_checked",
];

/** Build a ```notion-chart block for an existing database. */
export class InsertChartModal extends Modal {
	private schema: DatabaseSchema | null = null;
	private kind: ChartKind = "column";
	private groupBy = "";
	private aggregation: Aggregation = "count";
	private valueProperty = "";
	private series = "";
	private title = "";

	constructor(
		app: App,
		private store: DatabaseStore,
		private onInsert: (block: string) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Insert chart" });

		const databases = this.store.all();
		if (databases.length === 0) {
			contentEl.createEl("p", { text: "No databases yet — create one first." });
			return;
		}
		this.schema = databases[0];

		const body = contentEl.createDiv();
		const rebuild = () => {
			body.empty();
			this.renderOptions(body);
		};

		new Setting(contentEl.createDiv()).setName("Database").addDropdown((dropdown) => {
			for (const schema of databases) dropdown.addOption(schema.id, schema.name);
			dropdown.setValue(this.schema!.id).onChange((value) => {
				this.schema = this.store.get(value) ?? null;
				this.groupBy = "";
				this.valueProperty = "";
				rebuild();
			});
		});

		contentEl.appendChild(body);
		rebuild();

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Insert")
				.setCta()
				.onClick(() => {
					this.onInsert(this.buildBlock());
					this.close();
				})
		);
	}

	private renderOptions(parent: HTMLElement): void {
		if (!this.schema) return;
		const schema = this.schema;

		new Setting(parent).setName("Chart type").addDropdown((dropdown) => {
			for (const kind of CHART_KINDS) {
				dropdown.addOption(kind, kind.charAt(0).toUpperCase() + kind.slice(1));
			}
			dropdown.setValue(this.kind).onChange((value) => (this.kind = value as ChartKind));
		});

		this.groupBy = this.groupBy || schema.properties[0]?.id || "";
		new Setting(parent)
			.setName("Group by")
			.setDesc("Each value of this property becomes a bar or slice.")
			.addDropdown((dropdown) => {
				for (const prop of schema.properties) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.groupBy).onChange((value) => (this.groupBy = value));
			});

		new Setting(parent)
			.setName("Measure")
			.setDesc("How each group is turned into a number.")
			.addDropdown((dropdown) => {
				for (const agg of AGGREGATIONS) dropdown.addOption(agg, agg.replace(/_/g, " "));
				dropdown.setValue(this.aggregation).onChange((value) => {
					this.aggregation = value as Aggregation;
					parent.empty();
					this.renderOptions(parent);
				});
			});

		// `count` needs no operand; every other measure does.
		if (this.aggregation !== "count") {
			const numeric = schema.properties.filter((p) =>
				["number", "formula", "checkbox"].includes(p.type)
			);
			this.valueProperty = this.valueProperty || numeric[0]?.id || "";
			new Setting(parent).setName("Value property").addDropdown((dropdown) => {
				if (numeric.length === 0) dropdown.addOption("", "No numeric property available");
				for (const prop of numeric) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.valueProperty).onChange((value) => (this.valueProperty = value));
			});
		}

		new Setting(parent)
			.setName("Split into series")
			.setDesc("Optional second grouping, drawn as separate colours.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "None");
				for (const prop of schema.properties) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.series).onChange((value) => (this.series = value));
			});

		new Setting(parent)
			.setName("Title")
			.addText((text) => text.setPlaceholder("Optional").onChange((value) => (this.title = value)));
	}

	private buildBlock(): string {
		const schema = this.schema;
		if (!schema) return "";
		const lines = [
			"```notion-chart",
			`database: ${schema.name}`,
			`chart: ${this.kind}`,
			`group: ${this.groupBy}`,
			`aggregate: ${this.aggregation}`,
		];
		if (this.aggregation !== "count" && this.valueProperty) lines.push(`value: ${this.valueProperty}`);
		if (this.series) lines.push(`series: ${this.series}`);
		if (this.title.trim()) lines.push(`title: ${this.title.trim()}`);
		lines.push("```", "");
		return lines.join("\n");
	}
}

/** Create a row in an existing database and open it. */
export class NewRowModal extends Modal {
	private name = "";

	constructor(
		app: App,
		private store: DatabaseStore,
		private schema: DatabaseSchema,
		private onCreated: (file: TFile) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: `New item in ${this.schema.name}` });

		new Setting(contentEl).setName("Title").addText((text) => {
			text.setPlaceholder("Untitled").onChange((value) => (this.name = value));
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") void this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Create")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private async submit(): Promise<void> {
		const file = await this.store.createRow(this.schema, this.name || "Untitled");
		this.close();
		if (file) this.onCreated(file);
	}
}

/** Turn an existing folder of notes into a database by inferring its schema. */
export class ImportFolderModal extends Modal {
	private folder = "";
	private name = "";

	constructor(
		app: App,
		private store: DatabaseStore,
		private onCreate: (schema: DatabaseSchema) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Turn a folder into a database" });
		contentEl.createEl("p", {
			cls: "nfo-modal-hint",
			text: "Reads the frontmatter of every note in the folder and guesses a property for each key. Ideal for a Notion export.",
		});

		new Setting(contentEl)
			.setName("Folder")
			.setDesc("Vault-relative, e.g. Notion Export/Tasks")
			.addText((text) =>
				text.setPlaceholder("Notion Export/Tasks").onChange((value) => {
					this.folder = value;
					if (!this.name) this.name = value.split("/").pop() ?? "";
				})
			);

		new Setting(contentEl)
			.setName("Database name")
			.addText((text) => text.setPlaceholder("Tasks").onChange((value) => (this.name = value)));

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Import")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private async submit(): Promise<void> {
		if (!this.folder.trim()) {
			new Notice("Enter the folder to import.");
			return;
		}
		const properties = this.store.inferProperties(this.folder.trim());
		if (properties.length === 0) {
			new Notice("No frontmatter properties found in that folder.");
			return;
		}
		const schema = await this.store.createDatabase({
			name: this.name.trim() || slugify(this.folder),
			folder: this.folder.trim(),
			icon: "📥",
			properties,
		});
		new Notice(`Imported ${properties.length} properties into “${schema.name}”.`);
		this.onCreate(schema);
		this.close();
	}
}
