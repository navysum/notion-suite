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
