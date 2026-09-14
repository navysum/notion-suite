import { today } from "../utils/dates";

/**
 * A slash command either inserts a snippet or runs an action.
 *
 * `insert` may contain the marker `$cursor$` to say where the caret should land
 * after insertion; if it is absent the caret goes to the end of the snippet.
 */
export interface SlashCommand {
	id: string;
	title: string;
	description: string;
	icon: string;
	group: string;
	aliases?: string[];
	insert?: string;
	/** Commands that need UI (modals) declare an action id handled by the plugin. */
	action?: "new-database" | "insert-view" | "insert-chart" | "link-database" | "new-row";
}

export const CURSOR = "$cursor$";

export function slashCommands(): SlashCommand[] {
	return [
		// --- Basic blocks --------------------------------------------------
		{
			id: "text",
			title: "Text",
			description: "Just start writing with plain text.",
			icon: "type",
			group: "Basic blocks",
			aliases: ["paragraph", "plain"],
			insert: CURSOR,
		},
		{
			id: "h1",
			title: "Heading 1",
			description: "Big section heading.",
			icon: "heading-1",
			group: "Basic blocks",
			aliases: ["title", "#"],
			insert: `# ${CURSOR}`,
		},
		{
			id: "h2",
			title: "Heading 2",
			description: "Medium section heading.",
			icon: "heading-2",
			group: "Basic blocks",
			aliases: ["subtitle", "##"],
			insert: `## ${CURSOR}`,
		},
		{
			id: "h3",
			title: "Heading 3",
			description: "Small section heading.",
			icon: "heading-3",
			group: "Basic blocks",
			aliases: ["###"],
			insert: `### ${CURSOR}`,
		},
		{
			id: "bulleted",
			title: "Bulleted list",
			description: "Create a simple bulleted list.",
			icon: "list",
			group: "Basic blocks",
			aliases: ["ul", "bullet", "-"],
			insert: `- ${CURSOR}`,
		},
		{
			id: "numbered",
			title: "Numbered list",
			description: "Create a list with numbering.",
			icon: "list-ordered",
			group: "Basic blocks",
			aliases: ["ol", "ordered", "1."],
			insert: `1. ${CURSOR}`,
		},
		{
			id: "todo",
			title: "To-do list",
			description: "Track tasks with a checkbox.",
			icon: "check-square",
			group: "Basic blocks",
			aliases: ["task", "checkbox", "check"],
			insert: `- [ ] ${CURSOR}`,
		},
		{
			id: "toggle",
			title: "Toggle list",
			description: "Hide content inside a collapsible block.",
			icon: "chevron-right",
			group: "Basic blocks",
			aliases: ["collapse", "fold", "details"],
			insert: `> [!note]- ${CURSOR}\n> Hidden content`,
		},
		{
			id: "quote",
			title: "Quote",
			description: "Capture a quotation.",
			icon: "quote",
			group: "Basic blocks",
			aliases: ["blockquote"],
			insert: `> ${CURSOR}`,
		},
		{
			id: "divider",
			title: "Divider",
			description: "Visually divide blocks.",
			icon: "minus",
			group: "Basic blocks",
			aliases: ["hr", "line", "---"],
			insert: `\n---\n${CURSOR}`,
		},
		{
			id: "code",
			title: "Code",
			description: "Capture a snippet of code.",
			icon: "code",
			group: "Basic blocks",
			aliases: ["snippet"],
			insert: "```\n" + CURSOR + "\n```",
		},
		{
			id: "table",
			title: "Table",
			description: "Insert a simple markdown table.",
			icon: "table",
			group: "Basic blocks",
			aliases: ["grid"],
			insert:
				`| ${CURSOR} | Column | Column |\n` +
				`| --- | --- | --- |\n` +
				`|  |  |  |\n` +
				`|  |  |  |`,
		},
		{
			id: "columns",
			title: "Columns",
			description: "Place blocks side by side.",
			icon: "columns",
			group: "Basic blocks",
			aliases: ["column", "side by side", "split"],
			insert:
				"```notion-columns\n" +
				`${CURSOR}Left column\n` +
				"===\n" +
				"Right column\n" +
				"```",
		},

		// --- Callouts -------------------------------------------------------
		{
			id: "callout-info",
			title: "Callout",
			description: "Make writing stand out.",
			icon: "info",
			group: "Callouts",
			aliases: ["note", "aside"],
			insert: `> [!info] ${CURSOR}`,
		},
		{
			id: "callout-tip",
			title: "Callout: tip",
			description: "A helpful hint.",
			icon: "lightbulb",
			group: "Callouts",
			aliases: ["hint", "idea"],
			insert: `> [!tip] ${CURSOR}`,
		},
		{
			id: "callout-warning",
			title: "Callout: warning",
			description: "Something to watch out for.",
			icon: "alert-triangle",
			group: "Callouts",
			aliases: ["caution"],
			insert: `> [!warning] ${CURSOR}`,
		},
		{
			id: "callout-danger",
			title: "Callout: danger",
			description: "A serious warning.",
			icon: "alert-octagon",
			group: "Callouts",
			aliases: ["error", "important"],
			insert: `> [!danger] ${CURSOR}`,
		},
		{
			id: "callout-success",
			title: "Callout: success",
			description: "Confirm something went well.",
			icon: "check-circle",
			group: "Callouts",
			aliases: ["done", "check"],
			insert: `> [!success] ${CURSOR}`,
		},
		{
			id: "callout-question",
			title: "Callout: question",
			description: "Pose an open question.",
			icon: "help-circle",
			group: "Callouts",
			aliases: ["faq", "help"],
			insert: `> [!question] ${CURSOR}`,
		},

		// --- Databases ------------------------------------------------------
		{
			id: "database-new",
			title: "Database — new",
			description: "Create a brand-new database and embed it here.",
			icon: "database",
			group: "Databases",
			aliases: ["db", "new database", "table view"],
			action: "new-database",
		},
		{
			id: "database-view",
			title: "Database — view",
			description: "Embed a table, board, gallery, list or calendar.",
			icon: "layout",
			group: "Databases",
			aliases: ["view", "board", "kanban", "gallery", "calendar", "linked"],
			action: "insert-view",
		},
		{
			id: "database-row",
			title: "Database — add item",
			description: "Create a new row in an existing database.",
			icon: "file-plus",
			group: "Databases",
			aliases: ["add row", "new item", "entry"],
			action: "new-row",
		},
		{
			id: "chart",
			title: "Chart from database",
			description: "Bar, line, pie or donut built from your data.",
			icon: "bar-chart-3",
			group: "Databases",
			aliases: ["graph", "bar", "pie", "donut", "line", "visualize"],
			action: "insert-chart",
		},

		// --- Inline ---------------------------------------------------------
		{
			id: "date-today",
			title: "Date — today",
			description: `Insert ${today()}.`,
			icon: "calendar",
			group: "Inline",
			aliases: ["now", "today"],
			insert: today(),
		},
		{
			id: "date-tomorrow",
			title: "Date — tomorrow",
			description: "Insert tomorrow's date.",
			icon: "calendar-plus",
			group: "Inline",
			aliases: ["tomorrow"],
			insert: offsetDate(1),
		},
		{
			id: "link-page",
			title: "Link to page",
			description: "Link to another note in your vault.",
			icon: "link",
			group: "Inline",
			aliases: ["mention", "wikilink", "[["],
			insert: `[[${CURSOR}]]`,
		},
		{
			id: "embed-page",
			title: "Embed page",
			description: "Show another note inline.",
			icon: "file-symlink",
			group: "Inline",
			aliases: ["transclude", "include"],
			insert: `![[${CURSOR}]]`,
		},
		{
			id: "math",
			title: "Equation",
			description: "Insert a LaTeX block equation.",
			icon: "sigma",
			group: "Inline",
			aliases: ["latex", "formula", "tex"],
			insert: `$$\n${CURSOR}\n$$`,
		},
		{
			id: "highlight",
			title: "Highlight",
			description: "Emphasise a phrase.",
			icon: "highlighter",
			group: "Inline",
			aliases: ["mark"],
			insert: `==${CURSOR}==`,
		},
	];
}

function offsetDate(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Score a command against what the user typed after the slash.
 * Returns null for a non-match so the caller can filter in one pass.
 */
export function scoreCommand(command: SlashCommand, query: string): number | null {
	if (!query) return 0;
	const needle = query.toLowerCase();
	const haystacks = [command.title, ...(command.aliases ?? [])].map((h) => h.toLowerCase());

	let best: number | null = null;
	for (const hay of haystacks) {
		if (hay === needle) best = Math.max(best ?? 0, 100);
		else if (hay.startsWith(needle)) best = Math.max(best ?? 0, 80);
		else if (hay.includes(needle)) best = Math.max(best ?? 0, 60);
		else if (isSubsequence(needle, hay)) best = Math.max(best ?? 0, 30);
	}
	if (best === null && command.description.toLowerCase().includes(needle)) best = 10;
	return best;
}

function isSubsequence(needle: string, hay: string): boolean {
	let i = 0;
	for (const char of hay) {
		if (char === needle[i]) i++;
		if (i === needle.length) return true;
	}
	return i === needle.length;
}
