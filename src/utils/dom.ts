import { OptionColor } from "../types";

/** Shorthand element factory; Obsidian augments HTMLElement with createEl/createDiv. */
export function el<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	cls?: string,
	text?: string
): HTMLElementTagNameMap[K] {
	const node = parent.createEl(tag, { cls, text });
	return node;
}

/** Renders a Notion-style coloured pill for select / multi-select values. */
export function pill(parent: HTMLElement, text: string, color: OptionColor = "default"): HTMLElement {
	const span = parent.createSpan({ cls: `nfo-pill nfo-color-${color}`, text });
	return span;
}

export function icon(parent: HTMLElement, glyph: string, cls = ""): HTMLElement {
	return parent.createSpan({ cls: `nfo-glyph ${cls}`.trim(), text: glyph });
}

/** Stable colour choice for values that have no configured option colour. */
export function autoColor(value: string): OptionColor {
	const palette: OptionColor[] = [
		"blue", "green", "orange", "purple", "pink", "yellow", "red", "brown", "gray",
	];
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
	}
	return palette[hash % palette.length];
}

/**
 * Draw a row's own emoji before its title, when it has one.
 *
 * Notion shows a page's icon everywhere that page appears. A board of identical
 * cards is much harder to scan than one you can recognise at a glance, and the
 * icon is already in the note's frontmatter for the page banner to use.
 */
export function rowIcon(container: HTMLElement, icon: string | undefined): void {
	if (!icon) return;
	container.createSpan({ cls: "nfo-row-icon", text: icon });
}
