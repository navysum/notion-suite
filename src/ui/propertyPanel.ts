import { App, MarkdownView, Plugin, setIcon } from "obsidian";
import { DatabaseStore } from "../db/store";
import { DatabaseRow, DatabaseSchema, PropertyDef } from "../types";
import { renderCell } from "../views/cells";
import { ViewContext } from "../views/context";
import { iconForType } from "../views/table";
import { PropertyModal } from "./propertyModal";

/**
 * A row's properties, at the top of its own note.
 *
 * Opening a row used to be a one-way trip. The views are full of Notion-style
 * controls -- a select opens a menu of its options, a date opens a picker, a
 * relation opens a searchable list -- and then you click the row, land in the
 * note, and edit `status: Doing` as raw YAML. Notion shows the same properties
 * at the top of the page you opened, editable the same way, and that continuity
 * is most of what makes a database feel like one thing rather than two.
 *
 * Nothing here is written into the note's body: the panel is injected into the
 * view, the way the page banner is, and disappears with it. What it edits is
 * the frontmatter that was already there.
 */

const PANEL_CLASS = "nfo-props";

export interface PanelSettings {
	showPropertyPanel: boolean;
}

/** Draw (or clear) the property panel for one markdown view. */
export function applyPropertyPanel(
	app: App,
	store: DatabaseStore,
	view: MarkdownView,
	settings: PanelSettings,
	refresh: () => void
): void {
	const container = view.contentEl;
	for (const stale of Array.from(container.querySelectorAll(`.${PANEL_CLASS}`))) {
		stale.remove();
	}
	if (!settings.showPropertyPanel) return;

	const file = view.file;
	if (!file) return;

	const schema = store.schemaForPath(file.path);
	if (!schema) return;
	const row = store.rows(schema).find((candidate) => candidate.path === file.path);
	if (!row) return;

	const properties = schema.properties.filter((prop) => !prop.hidden);
	if (properties.length === 0) return;

	// Below the banner, above the note. Reading view and live preview each have
	// their own sizer, which is why this asks the view rather than assuming one.
	const host =
		container.querySelector(".markdown-preview-sizer") ??
		container.querySelector(".cm-sizer") ??
		container.firstElementChild;
	if (!host) return;

	const panel = createDiv({ cls: PANEL_CLASS });
	drawPanel(panel, app, store, schema, row, properties, file.path, refresh);

	const banner = host.querySelector(".nfo-banner, .nfo-page-emoji");
	if (banner?.parentElement === host) banner.insertAdjacentElement("afterend", panel);
	else host.prepend(panel);
}

function drawPanel(
	panel: HTMLElement,
	app: App,
	store: DatabaseStore,
	schema: DatabaseSchema,
	row: DatabaseRow,
	properties: PropertyDef[],
	sourcePath: string,
	refresh: () => void
): void {
	const ctx: ViewContext = {
		app,
		store,
		schema,
		sourcePath,
		// A committed edit re-reads the note, so the panel is rebuilt from what
		// is actually on disk rather than from what we hoped we wrote.
		refresh,
	};

	for (const prop of properties) {
		const line = panel.createDiv({ cls: "nfo-props-row" });
		const label = line.createDiv({ cls: "nfo-props-label" });
		const glyph = label.createSpan({ cls: "nfo-props-icon" });
		setIcon(glyph, iconForType(prop.type));
		label.createSpan({ text: prop.name });

		const value = line.createDiv({ cls: "nfo-props-value" });
		renderCell(value, ctx, row, prop);
	}

	const add = panel.createDiv({ cls: "nfo-props-add" });
	setIcon(add.createSpan(), "plus");
	add.createSpan({ text: "Add a property" });
	add.addEventListener("click", () => {
		new PropertyModal(app, store, schema, null, refresh).open();
	});
}

/** Keep every open note's property panel in step with its database. */
export function registerPropertyPanel(
	plugin: Plugin,
	store: DatabaseStore,
	settings: () => PanelSettings
): void {
	const refreshAll = (): void => {
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				applyPropertyPanel(plugin.app, store, view, settings(), refreshAll);
			}
		}
	};

	plugin.registerEvent(plugin.app.workspace.on("file-open", () => refreshAll()));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", () => refreshAll()));
	plugin.registerEvent(plugin.app.metadataCache.on("changed", () => refreshAll()));
	plugin.registerEvent(store.on("changed", () => refreshAll()));
	plugin.app.workspace.onLayoutReady(refreshAll);
}
