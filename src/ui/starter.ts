import { Notice, TFile } from "obsidian";
import type NotionForObsidian from "../main";
import { databaseTemplates } from "./templates";
import { fence } from "../views/blockEdit";

/**
 * Something to land on.
 *
 * A new install showed an empty sidebar. Everything this plugin can do was
 * behind a slash command nobody had any reason to type yet, and the README is
 * not in the app. People installed eighteen features and saw nothing, which is
 * the most likely reason an install stops being a user.
 *
 * So: one command that builds a real, working page -- a task database with
 * rows in it, a board, counts that count something, a chart with bars. It is
 * deliberately made of the ordinary pieces rather than anything special, so
 * everything on it can be clicked, changed and copied.
 */
export const STARTER_NOTE = "Notion Suite — start here";

export async function createStarterWorkspace(plugin: NotionForObsidian): Promise<TFile | null> {
	const existing = plugin.app.vault.getAbstractFileByPath(`${STARTER_NOTE}.md`);
	if (existing instanceof TFile) {
		// Running it twice should take you back, not make a second one.
		await plugin.app.workspace.getLeaf(false).openFile(existing);
		return existing;
	}

	const template = databaseTemplates().find((entry) => entry.id === "tasks");
	if (!template) return null;

	const schema = await plugin.store.createDatabase({
		name: "Tasks",
		folder: `${plugin.settings.defaultDatabaseFolder}/Tasks`,
		icon: template.icon,
		description: template.description,
		properties: template.properties,
	});

	for (const row of template.sampleRows ?? []) {
		await plugin.store.createRow(schema, row.name, row.values);
	}

	const file = await plugin.app.vault.create(`${STARTER_NOTE}.md`, starterBody(schema.name));
	await plugin.app.workspace.getLeaf(false).openFile(file);
	new Notice("Made you a Tasks database and a page to drive it from.");
	return file;
}

/**
 * The page itself.
 *
 * Every block here is one a person could have typed, and the note says where
 * each came from, because the point is to be read and copied rather than
 * admired. Nothing is generated that `/` could not generate.
 */
function starterBody(database: string): string {
	return [
		"---",
		"icon: 🚀",
		"---",
		"",
		`Everything below is made of ordinary blocks — type \`/\` anywhere to add more.`,
		"Change anything you like; this is your note now.",
		"",
		"## How it is going",
		"",
		fence("notion-widget", [
			"widgets:",
			`  - widget: metric`,
			`    database: ${database}`,
			"    aggregate: count_all",
			"    filter: [Status is not Done]",
			"    label: Still open",
			`  - widget: progress`,
			`    database: ${database}`,
			"    filter: [Status is Done]",
			"    label: Done so far",
			`  - widget: countdown`,
			`    database: ${database}`,
			"    date: due",
			"    label: Next due",
		].join("\n")),
		"",
		"## The work",
		"",
		"Drag a card between columns and the note behind it changes. That is the whole trick.",
		"",
		fence("notion-db", [`database: ${database}`, "view: board", "group: status"].join("\n")),
		"",
		"## The same rows, as a table",
		"",
		"Click any cell to edit it. Click a column heading to sort, group or total it.",
		"",
		fence("notion-db", [`database: ${database}`, "view: table", "sort: due asc"].join("\n")),
		"",
		"## Where the work is",
		"",
		fence("notion-chart", [
			`database: ${database}`,
			"chart: donut",
			"group: status",
			"aggregate: count",
			"title: Tasks by status",
		].join("\n")),
		"",
		"## What to try next",
		"",
		"- Type `/` and pick **Database — new** to make another one.",
		"- Right-click a database in the sidebar for **When this changes, do that…** and **Repeating rows…**.",
		"- Open a view's **⚙ Settings** to build a filter by clicking.",
		"- Click a row: its properties are editable at the top of its own note.",
		"",
	].join("\n");
}
