import { App, Events, TFile, TFolder, normalizePath, stringifyYaml } from "obsidian";
import {
	DatabaseRow,
	DatabaseSchema,
	RowTemplate,
	PropertyDef,
	PropertyType,
	SelectOption,
	ViewConfig,
} from "../types";
import { coerce } from "./value";
import { RowResolver } from "./resolve";
import { autoColor } from "../utils/dom";

/** Property types whose value is computed on read and never stored in a note. */
export const DERIVED_TYPES: PropertyType[] = ["formula", "rollup", "created", "updated"];

/**
 * Format a unique ID. The prefix is cosmetic; the number is what is stored,
 * so renaming the prefix later renumbers nothing.
 */
export function formatUniqueId(prop: PropertyDef, value: unknown): string {
	// Number(null) and Number("") are both 0, which is finite -- an unset id
	// would render as a real-looking "TASK-0" without this guard.
	if (value === null || value === undefined || value === "") return "";
	const n = Number(value);
	if (!Number.isFinite(n)) return "";
	const prefix = (prop.idPrefix ?? "").trim();
	return prefix ? `${prefix}-${n}` : String(n);
}

/**
 * The frontmatter a newly created row starts with.
 *
 * Seeds arrive from a view's filters and from board and calendar "new" buttons,
 * and those can legitimately name a derived property -- a board grouped by a
 * rollup, say. Derived values are computed on read, so writing one into the note
 * would plant a key that looks like data, is stale the moment it lands, and
 * becomes wrong live data if the property's type ever changes.
 */
export function seedFrontmatter(
	schema: DatabaseSchema,
	seed: Record<string, unknown>
): Record<string, unknown> {
	const frontmatter: Record<string, unknown> = { ...(schema.defaultTemplate ?? {}) };
	const derived = new Set(
		schema.properties.filter((p) => DERIVED_TYPES.includes(p.type)).map((p) => p.id)
	);

	for (const [key, value] of Object.entries(seed)) {
		if (derived.has(key)) continue;
		if (value !== undefined && value !== null && value !== "") frontmatter[key] = value;
	}
	// Give the editable properties an explicit starting value so the new row
	// renders with real controls rather than a line of empty cells.
	for (const prop of schema.properties) {
		if (DERIVED_TYPES.includes(prop.type)) continue;
		if (frontmatter[prop.id] !== undefined) continue;
		if (prop.type === "checkbox") frontmatter[prop.id] = false;
		else if (prop.type === "multiselect") frontmatter[prop.id] = [];
	}
	return frontmatter;
}

export function slugify(input: string): string {
	return (
		input
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "database"
	);
}

export function makeId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Characters Obsidian refuses in file names. */
function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
}

/**
 * Owns every database schema and turns folders of notes into rows.
 *
 * Emits `changed` whenever schemas or the underlying notes move, so that open
 * views can re-render without each of them registering its own vault listeners.
 */
export class DatabaseStore extends Events {
	private schemas: DatabaseSchema[] = [];
	private notifyTimer: number | null = null;
	/** Fills in rollups and formulas, and keeps cross-database cycles finite. */
	private resolver = new RowResolver({
		schema: (id) => this.get(id),
		baseRows: (schema) => this.baseRows(schema),
	});

	constructor(private app: App, private persist: () => Promise<void>) {
		super();
	}

	load(schemas: DatabaseSchema[]): void {
		this.schemas = schemas ?? [];
		this.resolver.clear();
	}

	all(): DatabaseSchema[] {
		return [...this.schemas].sort((a, b) => a.name.localeCompare(b.name));
	}

	get(idOrName: string): DatabaseSchema | undefined {
		if (!idOrName) return undefined;
		const needle = idOrName.trim().toLowerCase();
		return (
			this.schemas.find((s) => s.id.toLowerCase() === needle) ??
			this.schemas.find((s) => s.name.toLowerCase() === needle) ??
			this.schemas.find((s) => s.folder.toLowerCase() === needle)
		);
	}

	/** Invalidate caches and let views know they should redraw. */
	invalidate(): void {
		this.resolver.clear();
		// Vault events arrive in bursts (a rename touches many files); coalesce them.
		if (this.notifyTimer !== null) window.clearTimeout(this.notifyTimer);
		this.notifyTimer = window.setTimeout(() => {
			this.notifyTimer = null;
			this.trigger("changed");
		}, 80);
	}

	async save(): Promise<void> {
		await this.persist();
		this.invalidate();
	}

	serialize(): DatabaseSchema[] {
		return this.schemas;
	}

	// --- schema mutations -------------------------------------------------

	async createDatabase(options: {
		name: string;
		folder: string;
		icon?: string;
		description?: string;
		properties: PropertyDef[];
		views?: ViewConfig[];
	}): Promise<DatabaseSchema> {
		const folder = normalizePath(options.folder);
		await this.ensureFolder(folder);

		const schema: DatabaseSchema = {
			id: makeId("db"),
			name: options.name,
			folder,
			icon: options.icon,
			description: options.description,
			properties: options.properties,
			views: options.views ?? [],
			createdAt: Date.now(),
		};
		if (schema.views.length === 0) {
			schema.views.push({
				id: makeId("view"),
				name: "Table",
				type: "table",
				databaseId: schema.id,
			});
		}
		this.schemas.push(schema);
		await this.save();
		return schema;
	}

	async deleteDatabase(id: string): Promise<void> {
		this.schemas = this.schemas.filter((s) => s.id !== id);
		await this.save();
	}

	async updateDatabase(id: string, mutate: (schema: DatabaseSchema) => void): Promise<void> {
		const schema = this.schemas.find((s) => s.id === id);
		if (!schema) return;
		mutate(schema);
		await this.save();
	}

	async addProperty(databaseId: string, prop: PropertyDef): Promise<void> {
		await this.updateDatabase(databaseId, (schema) => {
			if (!schema.properties.some((p) => p.id === prop.id)) schema.properties.push(prop);
		});
	}

	/**
	 * Register a select option discovered while editing, so newly typed values
	 * become first-class options with a stable colour instead of one-offs.
	 */
	async ensureOption(databaseId: string, propertyId: string, name: string): Promise<void> {
		if (!name) return;
		await this.updateDatabase(databaseId, (schema) => {
			const prop = schema.properties.find((p) => p.id === propertyId);
			if (!prop) return;
			if (prop.type !== "select" && prop.type !== "multiselect") return;
			prop.options = prop.options ?? [];
			if (!prop.options.some((o) => o.name === name)) {
				prop.options.push({ name, color: autoColor(name) });
			}
		});
	}

	optionFor(prop: PropertyDef, value: string): SelectOption | undefined {
		return prop.options?.find((o) => o.name === value);
	}

	// --- row reading ------------------------------------------------------

	private folderFiles(folder: string): TFile[] {
		const node = this.app.vault.getAbstractFileByPath(normalizePath(folder));
		if (!(node instanceof TFolder)) return [];
		const files: TFile[] = [];
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (child instanceof TFile && child.extension === "md") files.push(child);
				else if (child instanceof TFolder) walk(child);
			}
		};
		walk(node);
		return files;
	}

	/**
	 * Decode every note in the database folder, without any derived value.
	 * The resolver layers rollups and formulas on top of this.
	 */
	private baseRows(schema: DatabaseSchema): DatabaseRow[] {
		return this.folderFiles(schema.folder).map((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const values: Record<string, unknown> = {};
			for (const prop of schema.properties) {
				if (prop.type === "created") {
					values[prop.id] = new Date(file.stat.ctime).toISOString().slice(0, 10);
				} else if (prop.type === "updated") {
					values[prop.id] = new Date(file.stat.mtime).toISOString().slice(0, 10);
				} else if (prop.type === "formula" || prop.type === "rollup") {
					values[prop.id] = null; // derived; the resolver fills these in
				} else {
					values[prop.id] = coerce(prop, (frontmatter as Record<string, unknown>)[prop.id]);
				}
			}
			const row: DatabaseRow = {
				path: file.path,
				name: file.basename,
				values,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
			};
			return row;
		});
	}

	/** Every row of a database, with rollups and formulas resolved. */
	rows(schema: DatabaseSchema): DatabaseRow[] {
		return this.resolver.rows(schema);
	}

	getFile(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	// --- row writing ------------------------------------------------------

	/** Write one property back to a note's frontmatter. */
	async setValue(
		schema: DatabaseSchema,
		rowPath: string,
		propertyId: string,
		value: unknown
	): Promise<void> {
		const file = this.getFile(rowPath);
		if (!file) return;
		const prop = schema.properties.find((p) => p.id === propertyId);
		// Computed properties are derived on read; there is nothing to persist.
		if (prop && DERIVED_TYPES.includes(prop.type)) return;

		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			if (value === null || value === undefined || value === "") delete frontmatter[propertyId];
			else frontmatter[propertyId] = value;
		});
		this.invalidate();
	}

	async renameRow(rowPath: string, newName: string): Promise<void> {
		const file = this.getFile(rowPath);
		if (!file) return;
		const clean = sanitizeFileName(newName);
		if (!clean || clean === file.basename) return;
		const target = normalizePath(`${file.parent?.path ?? ""}/${clean}.md`).replace(/^\/+/, "");
		if (this.app.vault.getAbstractFileByPath(target)) return;
		await this.app.fileManager.renameFile(file, target);
		this.invalidate();
	}

	async deleteRow(rowPath: string): Promise<void> {
		const file = this.getFile(rowPath);
		if (!file) return;
		await this.app.fileManager.trashFile(file);
		this.invalidate();
	}

	/**
	 * Claim the next unique id for a database, bumping the stored counter.
	 *
	 * The counter is seeded past whatever the rows already use, so a database
	 * that gained the property after rows existed cannot hand out a duplicate.
	 */
	private async nextUniqueId(schema: DatabaseSchema): Promise<number> {
		const used = this.rows(schema).flatMap((row) =>
			schema.properties
				.filter((p) => p.type === "uniqueid")
				.map((p) => Number(row.values[p.id]))
				.filter((n) => Number.isFinite(n))
		);
		const highest = used.length > 0 ? Math.max(...used) : 0;
		const next = Math.max(schema.nextId ?? 1, highest + 1);
		await this.updateDatabase(schema.id, (target) => {
			target.nextId = next + 1;
		});
		return next;
	}

	/** Give every row that lacks one a unique id, oldest row first. */
	async backfillUniqueIds(schema: DatabaseSchema): Promise<number> {
		const idProps = schema.properties.filter((p) => p.type === "uniqueid");
		if (idProps.length === 0) return 0;

		const missing = this.rows(schema)
			.filter((row) => idProps.some((p) => !Number.isFinite(Number(row.values[p.id]))))
			.sort((a, b) => a.ctime - b.ctime);

		for (const row of missing) {
			const file = this.getFile(row.path);
			if (!file) continue;
			for (const prop of idProps) {
				if (Number.isFinite(Number(row.values[prop.id]))) continue;
				const id = await this.nextUniqueId(schema);
				await this.app.fileManager.processFrontMatter(
					file,
					(frontmatter: Record<string, unknown>) => {
						frontmatter[prop.id] = id;
					}
				);
			}
		}
		this.invalidate();
		return missing.length;
	}

	/** Create a new note in the database folder, seeded with default values. */
	async createRow(
		schema: DatabaseSchema,
		name: string,
		seed: Record<string, unknown> = {},
		template?: RowTemplate
	): Promise<TFile | null> {
		await this.ensureFolder(schema.folder);
		const base = sanitizeFileName(name || "Untitled");
		let path = normalizePath(`${schema.folder}/${base}.md`);
		let counter = 2;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${schema.folder}/${base} ${counter++}.md`);
		}

		// A template's values are the starting point; anything the caller seeds
		// (a board column, a view filter) wins over them, since that is the
		// context the row is actually being created in.
		const merged = template ? { ...template.values, ...seed } : { ...seed };
		// Unique ids are assigned here rather than derived on read: the whole
		// point is that a row keeps the same id for its lifetime.
		for (const prop of schema.properties) {
			if (prop.type !== "uniqueid") continue;
			if (merged[prop.id] !== undefined) continue;
			merged[prop.id] = await this.nextUniqueId(schema);
		}
		const frontmatter = stringifyYaml(seedFrontmatter(schema, merged));
		const body = `---\n${frontmatter}---\n\n${template?.body ? `${template.body}\n` : ""}`;
		const file = await this.app.vault.create(path, body);
		this.invalidate();
		return file;
	}

	async ensureFolder(folder: string): Promise<void> {
		const path = normalizePath(folder);
		if (!path || path === "/") return;
		if (this.app.vault.getAbstractFileByPath(path)) return;
		// Create each missing ancestor; `createFolder` does not do this itself.
		const segments = path.split("/");
		let current = "";
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current).catch(() => undefined);
			}
		}
	}

	/**
	 * Infer a schema from notes already in a folder -- the path for people who
	 * exported a Notion database and just want it to work.
	 */
	inferProperties(folder: string): PropertyDef[] {
		const seen = new Map<string, { types: Map<PropertyType, number>; values: Set<string> }>();
		for (const file of this.folderFiles(folder)) {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!frontmatter) continue;
			for (const [key, raw] of Object.entries(frontmatter)) {
				if (key === "position") continue;
				const entry = seen.get(key) ?? { types: new Map(), values: new Set() };
				const guessed = guessType(raw);
				entry.types.set(guessed, (entry.types.get(guessed) ?? 0) + 1);
				if (guessed === "select") entry.values.add(String(raw));
				if (Array.isArray(raw)) for (const v of raw) entry.values.add(String(v));
				seen.set(key, entry);
			}
		}

		const properties: PropertyDef[] = [];
		for (const [key, entry] of seen) {
			let best: PropertyType = "text";
			let bestCount = -1;
			for (const [type, count] of entry.types) {
				if (count > bestCount) {
					best = type;
					bestCount = count;
				}
			}
			const prop: PropertyDef = { id: key, name: titleCase(key), type: best };
			if (best === "select" || best === "multiselect") {
				prop.options = [...entry.values]
					.filter((v) => v.length > 0)
					.slice(0, 40)
					.map((name) => ({ name, color: autoColor(name) }));
			}
			properties.push(prop);
		}
		return properties;
	}
}

function titleCase(input: string): string {
	return input
		.replace(/[-_]+/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase())
		.trim();
}

function guessType(raw: unknown): PropertyType {
	if (typeof raw === "boolean") return "checkbox";
	if (typeof raw === "number") return "number";
	if (Array.isArray(raw)) return "multiselect";
	if (raw instanceof Date) return "date";
	if (typeof raw === "string") {
		const value = raw.trim();
		if (/^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
		if (/^https?:\/\//.test(value)) return "url";
		if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "email";
		if (value.length > 0 && value.length <= 32 && !value.includes(" ")) return "select";
		return "text";
	}
	return "text";
}
