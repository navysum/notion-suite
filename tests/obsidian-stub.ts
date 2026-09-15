/**
 * Minimal stand-in for the parts of the Obsidian API the pure logic modules
 * touch, so the query, value, chart and config engines can be tested in Node.
 */

/** A deliberately small YAML subset: scalars, inline lists, and `- ` lists. */
export function parseYaml(source: string): unknown {
	const root: Record<string, unknown> = {};
	const lines = source.split("\n");
	let currentKey: string | null = null;
	let currentList: string[] | null = null;

	const flush = () => {
		if (currentKey && currentList) root[currentKey] = currentList;
		currentKey = null;
		currentList = null;
	};

	for (const line of lines) {
		if (!line.trim() || line.trim().startsWith("#")) continue;

		const listItem = line.match(/^\s+-\s+(.*)$/);
		if (listItem && currentKey) {
			currentList = currentList ?? [];
			currentList.push(stripQuotes(listItem[1]));
			continue;
		}

		const pair = line.match(/^([A-Za-z0-9_ -]+):\s*(.*)$/);
		if (!pair) continue;
		flush();

		const key = pair[1].trim();
		const value = pair[2].trim();
		if (value === "") {
			currentKey = key;
			continue;
		}
		if (value.startsWith("[") && value.endsWith("]")) {
			root[key] = value
				.slice(1, -1)
				.split(",")
				.map((v) => stripQuotes(v.trim()))
				.filter(Boolean);
			continue;
		}
		root[key] = castScalar(value);
	}
	flush();
	return root;
}

function stripQuotes(value: string): string {
	return value.replace(/^["']|["']$/g, "");
}

function castScalar(value: string): unknown {
	const text = stripQuotes(value);
	if (text === "true") return true;
	if (text === "false") return false;
	if (text !== "" && !isNaN(Number(text))) return Number(text);
	return text;
}

export function stringifyYaml(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

export class Events {
	on(): void {}
	off(): void {}
	trigger(): void {}
}

export const normalizePath = (p: string): string => p;
export class Notice {
	constructor(public message: string) {}
}
export class TFile {}
export class TFolder {}
export class Menu {
	addItem(): this {
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): this {
		return this;
	}
}

// Enough of the UI classes for modules that merely import them to bundle.
// The tests exercise pure logic, never the UI itself.
export class Modal {
	contentEl: unknown = null;
	open(): void {}
	close(): void {}
}

export class Setting {
	constructor(_containerEl?: unknown) {}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addTextArea(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addDropdown(): this {
		return this;
	}
	addButton(): this {
		return this;
	}
	addExtraButton(): this {
		return this;
	}
}
export const setIcon = (): void => undefined;
