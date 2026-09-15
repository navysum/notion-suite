import { App, MarkdownPostProcessorContext, Notice, TFile, setIcon } from "obsidian";

/**
 * Editing a rendered code block in place.
 *
 * A chart or view is configured by the YAML inside its code block, but nobody
 * should have to remember that YAML. These helpers let the rendered block
 * rewrite its own source, so every setting can be a dropdown.
 */

/** Splice a replacement block over the given line range. Pure, so it is testable. */
export function spliceLines(
	document: string,
	lineStart: number,
	lineEnd: number,
	replacement: string
): string {
	const lines = document.split("\n");
	// Trailing blank lines would accumulate on every edit.
	const replacementLines = replacement.replace(/\n+$/, "").split("\n");
	lines.splice(lineStart, lineEnd - lineStart + 1, ...replacementLines);
	return lines.join("\n");
}

/**
 * Set one top-level key in a block's body, preserving every other line.
 *
 * Used for single-setting changes (switching view type) where regenerating the
 * whole block would discard filters, sorts and anything else the user wrote.
 */
export function setBlockKey(source: string, key: string, value: string): string {
	const lines = source.split("\n");
	const pattern = new RegExp(`^\\s*${key}\\s*:`);
	const existing = lines.findIndex((line) => pattern.test(line));
	if (existing !== -1) {
		lines[existing] = `${key}: ${value}`;
		return lines.join("\n");
	}
	// Put it just under `database:` so the block keeps reading top-down.
	const anchor = lines.findIndex((line) => /^\s*(database|db|source)\s*:/.test(line));
	lines.splice(anchor === -1 ? 0 : anchor + 1, 0, `${key}: ${value}`);
	return lines.join("\n");
}

export function fence(language: string, body: string): string {
	return `\`\`\`${language}\n${body.replace(/\n+$/, "")}\n\`\`\``;
}

/**
 * Overwrite the code block that produced `el` with new source.
 *
 * `getSectionInfo` is read at call time, never cached: earlier edits to the
 * note shift every line number below them.
 */
export async function replaceBlock(
	app: App,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	newBlock: string
): Promise<boolean> {
	const info = ctx.getSectionInfo(el);
	if (!info) {
		new Notice("Couldn't locate this block in the note — try again in reading view.");
		return false;
	}
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return false;

	await app.vault.process(file, (data) =>
		spliceLines(data, info.lineStart, info.lineEnd, newBlock)
	);
	return true;
}

/**
 * Rewrite a block by transforming its *current* body.
 *
 * Reads the body back out of the file rather than trusting the source string
 * captured when the block was rendered: an earlier edit in this same session
 * would have made that copy stale, and writing it back would silently undo the
 * change.
 */
export async function updateBlockBody(
	app: App,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	language: string,
	transform: (body: string) => string
): Promise<boolean> {
	const info = ctx.getSectionInfo(el);
	if (!info) {
		new Notice("Couldn't locate this block in the note — try again in reading view.");
		return false;
	}
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) return false;

	await app.vault.process(file, (data) => {
		const lines = data.split("\n");
		// The fences sit on lineStart and lineEnd; the body is what is between.
		const body = lines.slice(info.lineStart + 1, info.lineEnd).join("\n");
		return spliceLines(data, info.lineStart, info.lineEnd, fence(language, transform(body)));
	});
	return true;
}

/** The small gear that opens a block's settings. */
export function addEditButton(
	parent: HTMLElement,
	label: string,
	onClick: () => void
): HTMLElement {
	const button = parent.createDiv({ cls: "nfo-block-edit" });
	setIcon(button.createSpan(), "settings-2");
	button.createSpan({ text: label });
	button.setAttribute("aria-label", label);
	button.addEventListener("click", (evt) => {
		evt.stopPropagation();
		onClick();
	});
	return button;
}
