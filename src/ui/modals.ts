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
import { DatabaseSchema, ChartKind, Aggregation, ViewType, ChartConfig, ViewConfig } from "../types";
import { filterToText, parseFilterShorthand } from "../views/config";
import { buildChartData } from "../charts/aggregate";
import { renderChart } from "../charts/svg";
import { fence } from "../views/blockEdit";
import { FilterGroup, FilterRule } from "../types";
import { DatabaseTemplate, databaseTemplates } from "./templates";

/** Parse the editor's filter textarea into a filter group. */
function parseFilterLines(text: string): FilterGroup | undefined {
	const rules = text
		.split("\n")
		.map((line) => parseFilterShorthand(line))
		.filter((rule): rule is FilterRule => rule !== null);
	return rules.length > 0 ? { conjunction: "and", rules } : undefined;
}

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
			properties: structuredClone(this.selected.properties),
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

const VIEW_TYPES: ViewType[] = ["table", "board", "gallery", "list", "calendar", "timeline"];

/** Build a ```notion-db block for an existing database. */
export class InsertViewModal extends Modal {
	private schema: DatabaseSchema | null = null;
	private viewType: ViewType = "table";
	private groupBy = "";
	private dateProperty = "";
	private filter = "";
	private sort = "";
	private title = "";
	private properties = "";
	private coverProperty = "";
	private timelineStart = "";
	private timelineEnd = "";
	private timelineScale = "";
	private cardSize = "";
	private limit = "";
	private readonly isEdit: boolean;

	constructor(
		app: App,
		private store: DatabaseStore,
		private onInsert: (block: string) => void,
		initial?: ViewConfig
	) {
		super(app);
		this.isEdit = initial !== undefined;
		if (initial) this.adopt(initial);
	}

	/** Populate the controls from an existing view so nothing is lost on edit. */
	private adopt(config: ViewConfig): void {
		this.schema = this.store.get(config.databaseId) ?? null;
		this.viewType = config.type;
		this.groupBy = config.groupBy ?? "";
		this.dateProperty = config.dateProperty ?? "";
		this.filter = filterToText(config.filter);
		this.sort = (config.sorts ?? [])
			.map((rule) => `${rule.property} ${rule.direction}`)
			.join("\n");
		this.title = config.name ?? "";
		this.properties = (config.visibleProperties ?? []).join(", ");
		this.coverProperty = config.coverProperty ?? "";
		this.timelineStart = config.timelineStart ?? "";
		this.timelineEnd = config.timelineEnd ?? "";
		this.timelineScale = config.timelineScale ?? "";
		this.cardSize = config.cardSize ?? "";
		this.limit = config.pageSize ? String(config.pageSize) : "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: this.isEdit ? "View settings" : "Insert database view" });

		const databases = this.store.all();
		if (databases.length === 0) {
			contentEl.createEl("p", {
				text: "No databases yet — create one first with “Notion: New database”.",
			});
			return;
		}
		this.schema = this.schema ?? databases[0];

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
				.setButtonText(this.isEdit ? "Save" : "Insert")
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
				["status", "select", "multiselect", "checkbox"].includes(p.type)
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

		if (this.viewType === "timeline") {
			const dates = schema.properties.filter((p) =>
				["date", "created", "updated"].includes(p.type)
			);
			this.timelineStart = this.timelineStart || dates[0]?.id || "";
			new Setting(parent)
				.setName("Start date")
				.setDesc("Where each bar begins.")
				.addDropdown((dropdown) => {
					if (dates.length === 0) dropdown.addOption("", "No date property available");
					for (const prop of dates) dropdown.addOption(prop.id, prop.name);
					dropdown.setValue(this.timelineStart).onChange((value) => (this.timelineStart = value));
				});

			new Setting(parent)
				.setName("End date")
				.setDesc("Leave as None to mark single days instead of bars.")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "None");
					for (const prop of dates) dropdown.addOption(prop.id, prop.name);
					dropdown.setValue(this.timelineEnd).onChange((value) => (this.timelineEnd = value));
				});

			new Setting(parent).setName("Scale").addDropdown((dropdown) => {
				dropdown.addOption("day", "Days");
				dropdown.addOption("week", "Weeks");
				dropdown.addOption("month", "Months");
				dropdown.setValue(this.timelineScale || "day").onChange((value) => (this.timelineScale = value));
			});
		}

		if (this.viewType === "gallery" || this.viewType === "board") {
			const images = schema.properties.filter((p) => ["files", "url", "text"].includes(p.type));
			new Setting(parent)
				.setName("Cover image")
				.setDesc("Property holding an image path or URL.")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "None");
					for (const prop of images) dropdown.addOption(prop.id, prop.name);
					dropdown.setValue(this.coverProperty).onChange((value) => (this.coverProperty = value));
				});
		}

		if (this.viewType === "gallery") {
			new Setting(parent).setName("Card size").addDropdown((dropdown) => {
				dropdown.addOption("", "Medium");
				dropdown.addOption("small", "Small");
				dropdown.addOption("large", "Large");
				dropdown.setValue(this.cardSize).onChange((value) => (this.cardSize = value));
			});
		}

		new Setting(parent)
			.setName("Filter")
			.setDesc('Plain English, one per line — e.g. "Status is not Done".')
			.addTextArea((area) =>
				area
					.setValue(this.filter)
					.setPlaceholder("Status is not Done")
					.onChange((value) => (this.filter = value))
			);

		new Setting(parent)
			.setName("Sort")
			.setDesc('e.g. "Due asc" or "-Priority". One per line for tie-breaking.')
			.addTextArea((area) =>
				area.setValue(this.sort).setPlaceholder("Due asc").onChange((value) => (this.sort = value))
			);

		new Setting(parent)
			.setName("Show properties")
			.setDesc("Comma-separated, in order. Blank shows all of them.")
			.addText((text) =>
				text
					.setValue(this.properties)
					.setPlaceholder("All")
					.onChange((value) => (this.properties = value))
			);

		new Setting(parent)
			.setName("Show only the first")
			.setDesc("Leave blank for every row.")
			.addText((text) =>
				text
					.setValue(this.limit)
					.setPlaceholder("All")
					.onChange((value) => (this.limit = value.replace(/[^0-9]/g, "")))
			);

		new Setting(parent)
			.setName("Heading")
			.setDesc("Shown in the view's toolbar instead of the database name.")
			.addText((text) =>
				text.setValue(this.title).setPlaceholder("Optional").onChange((value) => (this.title = value))
			);
	}

	private buildBlock(): string {
		const schema = this.schema;
		if (!schema) return "";
		const lines = [`database: ${schema.name}`, `view: ${this.viewType}`];
		if (this.viewType === "board" && this.groupBy) lines.push(`group: ${this.groupBy}`);
		if (this.viewType === "calendar" && this.dateProperty) lines.push(`date: ${this.dateProperty}`);
		if (this.viewType === "timeline") {
			if (this.timelineStart) lines.push(`start: ${this.timelineStart}`);
			if (this.timelineEnd) lines.push(`end: ${this.timelineEnd}`);
			if (this.timelineScale && this.timelineScale !== "day") {
				lines.push(`scale: ${this.timelineScale}`);
			}
		}
		if (this.coverProperty) lines.push(`cover: ${this.coverProperty}`);
		if (this.cardSize) lines.push(`size: ${this.cardSize}`);

		const filters = this.filter
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (filters.length > 0) {
			lines.push("filter:");
			for (const rule of filters) lines.push(`  - ${rule}`);
		}

		const sorts = this.sort
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (sorts.length === 1) lines.push(`sort: ${sorts[0]}`);
		else if (sorts.length > 1) {
			lines.push("sort:");
			for (const rule of sorts) lines.push(`  - ${rule}`);
		}

		const properties = this.properties
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean);
		if (properties.length > 0) lines.push(`properties: [${properties.join(", ")}]`);
		if (this.limit) lines.push(`limit: ${this.limit}`);
		if (this.title.trim()) lines.push(`title: ${this.title.trim()}`);

		return `${fence("notion-db", lines.join("\n"))}\n`;
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
/**
 * Build or change a chart entirely through controls.
 *
 * Every key the block understands has a control here, and the preview redraws
 * on each change, so the YAML is an implementation detail the user never has to
 * learn or even see.
 */
export class InsertChartModal extends Modal {
	private schema: DatabaseSchema | null = null;
	private kind: ChartKind = "column";
	private groupBy = "";
	private aggregation: Aggregation = "count";
	private valueProperty = "";
	private series = "";
	private title = "";
	private filterText = "";
	private sort: NonNullable<ChartConfig["sort"]> = "value_desc";
	private limit = "";
	private height = "";
	private stacked = false;
	private showLegend = true;
	private showValues = true;

	private previewEl: HTMLElement | null = null;
	private readonly isEdit: boolean;

	constructor(
		app: App,
		private store: DatabaseStore,
		private onInsert: (block: string) => void,
		initial?: ChartConfig
	) {
		super(app);
		this.isEdit = initial !== undefined;
		if (initial) this.adopt(initial);
	}

	/** Populate the controls from an existing chart so nothing is lost on edit. */
	private adopt(config: ChartConfig): void {
		this.schema = this.store.get(config.database) ?? null;
		this.kind = config.kind;
		this.groupBy = config.groupBy;
		this.aggregation = config.aggregation;
		this.valueProperty = config.value ?? "";
		this.series = config.series ?? "";
		this.title = config.title ?? "";
		this.filterText = filterToText(config.filter);
		this.sort = config.sort ?? "value_desc";
		this.limit = config.limit ? String(config.limit) : "";
		this.height = config.height ? String(config.height) : "";
		this.stacked = config.stacked ?? false;
		this.showLegend = config.showLegend !== false;
		this.showValues = config.showValues !== false;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal", "nfo-chart-modal");
		contentEl.createEl("h2", { text: this.isEdit ? "Chart settings" : "Insert chart" });

		const databases = this.store.all();
		if (databases.length === 0) {
			contentEl.createEl("p", { text: "No databases yet — create one first." });
			return;
		}
		this.schema = this.schema ?? databases[0];

		this.previewEl = contentEl.createDiv({ cls: "nfo-chart-preview" });

		const body = contentEl.createDiv();
		const rebuild = () => {
			body.empty();
			this.renderOptions(body);
			this.drawPreview();
		};

		new Setting(contentEl.createDiv()).setName("Database").addDropdown((dropdown) => {
			for (const schema of databases) dropdown.addOption(schema.id, schema.name);
			dropdown.setValue(this.schema!.id).onChange((value) => {
				this.schema = this.store.get(value) ?? null;
				// Property ids do not carry across databases.
				this.groupBy = "";
				this.valueProperty = "";
				this.series = "";
				rebuild();
			});
		});

		contentEl.appendChild(body);
		rebuild();

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText(this.isEdit ? "Save" : "Insert")
				.setCta()
				.onClick(() => {
					this.onInsert(this.buildBlock());
					this.close();
				})
		);
	}

	/** Redraw the sample chart from whatever the controls currently say. */
	private drawPreview(): void {
		const host = this.previewEl;
		if (!host) return;
		host.empty();
		const schema = this.schema;
		if (!schema) return;

		const config = this.currentConfig(schema);
		try {
			const data = buildChartData(schema, this.store.rows(schema), config);
			renderChart(host, { ...config, height: 220 }, data);
		} catch {
			// A half-typed filter should read as "nothing to show", not an error.
			host.createDiv({ cls: "nfo-chart-empty", text: "Nothing to preview yet." });
		}
	}

	private currentConfig(schema: DatabaseSchema): ChartConfig {
		return {
			database: schema.name,
			kind: this.kind,
			groupBy: this.groupBy,
			value: this.aggregation === "count" ? undefined : this.valueProperty || undefined,
			aggregation: this.aggregation,
			series: this.series || undefined,
			filter: parseFilterLines(this.filterText),
			sort: this.sort,
			limit: this.limit ? Number(this.limit) : undefined,
			title: this.title.trim() || undefined,
			height: this.height ? Number(this.height) : undefined,
			stacked: this.stacked,
			showLegend: this.showLegend,
			showValues: this.showValues,
		};
	}

	private renderOptions(parent: HTMLElement): void {
		if (!this.schema) return;
		const schema = this.schema;
		// Any control that changes the picture redraws it; the ones that change
		// which *other* controls apply rebuild the whole panel.
		const redraw = () => this.drawPreview();
		const rebuild = () => {
			parent.empty();
			this.renderOptions(parent);
			this.drawPreview();
		};

		new Setting(parent).setName("Chart type").addDropdown((dropdown) => {
			for (const kind of CHART_KINDS) {
				dropdown.addOption(kind, kind.charAt(0).toUpperCase() + kind.slice(1));
			}
			dropdown.setValue(this.kind).onChange((value) => {
				this.kind = value as ChartKind;
				rebuild();
			});
		});

		this.groupBy = this.groupBy || schema.properties[0]?.id || "";
		new Setting(parent)
			.setName("Group by")
			.setDesc("Each value of this property becomes a bar or slice.")
			.addDropdown((dropdown) => {
				for (const prop of schema.properties) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.groupBy).onChange((value) => {
					this.groupBy = value;
					redraw();
				});
			});

		new Setting(parent)
			.setName("Measure")
			.setDesc("How each group is turned into a number.")
			.addDropdown((dropdown) => {
				for (const agg of AGGREGATIONS) dropdown.addOption(agg, agg.replace(/_/g, " "));
				dropdown.setValue(this.aggregation).onChange((value) => {
					this.aggregation = value as Aggregation;
					rebuild();
				});
			});

		// `count` needs no operand; every other measure does. A rollup is a
		// legitimate operand here, since its result is a number.
		if (this.aggregation !== "count") {
			const numeric = schema.properties.filter((p) =>
				["number", "formula", "rollup", "checkbox"].includes(p.type)
			);
			this.valueProperty = this.valueProperty || numeric[0]?.id || "";
			new Setting(parent).setName("Value property").addDropdown((dropdown) => {
				if (numeric.length === 0) dropdown.addOption("", "No numeric property available");
				for (const prop of numeric) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.valueProperty).onChange((value) => {
					this.valueProperty = value;
					redraw();
				});
			});
		}

		new Setting(parent)
			.setName("Split into series")
			.setDesc("Optional second grouping, drawn as separate colours.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "None");
				for (const prop of schema.properties) dropdown.addOption(prop.id, prop.name);
				dropdown.setValue(this.series).onChange((value) => {
					this.series = value;
					rebuild();
				});
			});

		// Stacking only means anything with more than one series on a bar chart.
		if (this.series && ["column", "bar"].includes(this.kind)) {
			new Setting(parent)
				.setName("Stack the series")
				.setDesc("Off places them side by side.")
				.addToggle((toggle) =>
					toggle.setValue(this.stacked).onChange((value) => {
						this.stacked = value;
						redraw();
					})
				);
		}

		new Setting(parent)
			.setName("Filter")
			.setDesc('Plain English, one per line — e.g. "Status is not Done".')
			.addTextArea((area) =>
				area
					.setValue(this.filterText)
					.setPlaceholder("Status is not Done")
					.onChange((value) => {
						this.filterText = value;
						redraw();
					})
			);

		new Setting(parent).setName("Order").addDropdown((dropdown) => {
			dropdown.addOption("value_desc", "Largest first");
			dropdown.addOption("value", "Smallest first");
			dropdown.addOption("label", "By name");
			dropdown.addOption("none", "Leave as-is");
			dropdown.setValue(this.sort ?? "value_desc").onChange((value) => {
				this.sort = value as NonNullable<ChartConfig["sort"]>;
				redraw();
			});
		});

		new Setting(parent)
			.setName("Show only the top")
			.setDesc("Leave blank for every group.")
			.addText((text) =>
				text
					.setValue(this.limit)
					.setPlaceholder("All")
					.onChange((value) => {
						this.limit = value.replace(/[^0-9]/g, "");
						redraw();
					})
			);

		new Setting(parent)
			.setName("Title")
			.addText((text) =>
				text
					.setValue(this.title)
					.setPlaceholder("Optional")
					.onChange((value) => {
						this.title = value;
						redraw();
					})
			);

		new Setting(parent)
			.setName("Height")
			.setDesc("Pixels. Blank uses the default.")
			.addText((text) =>
				text
					.setValue(this.height)
					.setPlaceholder("340")
					.onChange((value) => (this.height = value.replace(/[^0-9]/g, "")))
			);

		new Setting(parent).setName("Show legend").addToggle((toggle) =>
			toggle.setValue(this.showLegend).onChange((value) => {
				this.showLegend = value;
				redraw();
			})
		);

		new Setting(parent).setName("Show data labels").addToggle((toggle) =>
			toggle.setValue(this.showValues).onChange((value) => {
				this.showValues = value;
				redraw();
			})
		);
	}

	/** Emit only what differs from the defaults, so the block stays readable. */
	private buildBlock(): string {
		const schema = this.schema;
		if (!schema) return "";
		const lines = [
			`database: ${schema.name}`,
			`chart: ${this.kind}`,
			`group: ${this.groupBy}`,
			`aggregate: ${this.aggregation}`,
		];
		if (this.aggregation !== "count" && this.valueProperty) {
			lines.push(`value: ${this.valueProperty}`);
		}
		if (this.series) lines.push(`series: ${this.series}`);
		if (this.stacked && this.series) lines.push("stacked: true");

		const filters = this.filterText
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (filters.length > 0) {
			lines.push("filter:");
			for (const rule of filters) lines.push(`  - ${rule}`);
		}

		if (this.sort && this.sort !== "value_desc") lines.push(`sort: ${this.sort}`);
		if (this.limit) lines.push(`limit: ${this.limit}`);
		if (this.title.trim()) lines.push(`title: ${this.title.trim()}`);
		if (this.height) lines.push(`height: ${this.height}`);
		if (!this.showLegend) lines.push("legend: false");
		if (!this.showValues) lines.push("values: false");

		return `${fence("notion-chart", lines.join("\n"))}\n`;
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
