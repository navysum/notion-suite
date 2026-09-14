import { App, Component, MarkdownRenderer } from "obsidian";

/**
 * Side-by-side columns, which markdown has no syntax for.
 *
 * The block body is split on a line containing only `===`; each part is
 * rendered as normal markdown, so links, embeds and even database views keep
 * working inside a column.
 */
export async function renderColumns(
	app: App,
	source: string,
	container: HTMLElement,
	sourcePath: string,
	component: Component
): Promise<void> {
	container.addClass("nfo-columns");
	const parts = source.split(/^\s*={3,}\s*$/m);

	for (const part of parts) {
		const column = container.createDiv({ cls: "nfo-column" });
		await MarkdownRenderer.render(app, part.trim(), column, sourcePath, component);
	}

	// Equal widths by default, which is what Notion's column blocks start with.
	container.style.setProperty("--nfo-column-count", String(Math.max(1, parts.length)));
}
