import { App, MarkdownPostProcessorContext, TFile, setIcon } from "obsidian";

/**
 * The small page-structure blocks: a table of contents and a breadcrumb.
 *
 * Both read from what Obsidian already knows about the note, so neither
 * duplicates anything into the file or goes stale.
 */

/** ```notion-toc — links to every heading in this note. */
export function renderTableOfContents(
	app: App,
	source: string,
	container: HTMLElement,
	ctx: MarkdownPostProcessorContext
): void {
	container.addClass("nfo-toc");

	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	const headings = file instanceof TFile ? app.metadataCache.getFileCache(file)?.headings : null;

	// `depth: 2` limits how far down the outline goes.
	const maxDepth = Number(source.match(/depth:\s*(\d+)/)?.[1] ?? 6);

	const shown = (headings ?? []).filter((h) => h.level <= maxDepth);
	if (shown.length === 0) {
		container.createDiv({
			cls: "nfo-toc-empty",
			text: "No headings in this note yet.",
		});
		return;
	}

	// Indent relative to the shallowest heading present, so a note whose
	// top level is H2 does not render every entry pre-indented.
	const base = Math.min(...shown.map((h) => h.level));
	for (const heading of shown) {
		const entry = container.createDiv({ cls: "nfo-toc-entry" });
		entry.style.paddingLeft = `${(heading.level - base) * 16}px`;
		const link = entry.createSpan({ cls: "nfo-toc-link", text: heading.heading });
		link.addEventListener("click", () => {
			if (!(file instanceof TFile)) return;
			void app.workspace.openLinkText(`${file.basename}#${heading.heading}`, file.path);
		});
	}
}

/** ```notion-breadcrumb — the folder trail leading to this note. */
export function renderBreadcrumb(
	app: App,
	container: HTMLElement,
	ctx: MarkdownPostProcessorContext
): void {
	container.addClass("nfo-breadcrumb");

	const parts = ctx.sourcePath.split("/");
	const fileName = parts.pop() ?? "";

	const home = container.createSpan({ cls: "nfo-crumb" });
	setIcon(home, "vault");
	home.setAttribute("aria-label", "Vault root");

	let walked = "";
	for (const part of parts) {
		walked = walked ? `${walked}/${part}` : part;
		container.createSpan({ cls: "nfo-crumb-sep", text: "/" });
		container.createSpan({ cls: "nfo-crumb", text: part });
	}

	container.createSpan({ cls: "nfo-crumb-sep", text: "/" });
	container.createSpan({
		cls: "nfo-crumb nfo-crumb-current",
		text: fileName.replace(/\.md$/, ""),
	});
	void app;
}
