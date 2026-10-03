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
	// One level of nesting, which is what `filter: { any: [...] }` needs.
	let nestedUnder: string | null = null;
	let nestedKey: string | null = null;
	let nestedList: string[] | null = null;

	const flushNested = () => {
		if (nestedUnder && nestedKey && nestedList) {
			root[nestedUnder] = { [nestedKey]: nestedList };
		}
		nestedUnder = null;
		nestedKey = null;
		nestedList = null;
	};

	const flush = () => {
		if (currentKey && currentList) root[currentKey] = currentList;
		flushNested();
		currentKey = null;
		currentList = null;
	};

	for (const line of lines) {
		if (!line.trim() || line.trim().startsWith("#")) continue;

		// A deeper list item belongs to the nested key, not the outer one.
		const deepItem = line.match(/^\s{4,}-\s+(.*)$/);
		if (deepItem && nestedKey) {
			nestedList = nestedList ?? [];
			nestedList.push(stripQuotes(deepItem[1]));
			continue;
		}

		const nestedPair = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*$/);
		if (nestedPair && currentKey) {
			nestedUnder = currentKey;
			nestedKey = nestedPair[1];
			nestedList = null;
			continue;
		}

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
export class MarkdownView {}
export class ItemView {}
export class WorkspaceLeaf {}
export class PluginSettingTab {}
export class FuzzySuggestModal {}
export class Plugin {}
export class MarkdownRenderChild {}
export class TFolder {}
/**
 * Menus, real enough to drive.
 *
 * Almost every action in this plugin is behind a menu -- the row context menu,
 * the column menu, the property menu, "add an option". None of it was
 * reachable from a test, so a whole class of behaviour was only ever checked
 * by hand. A menu now records its items and `clickMenuItem` runs one.
 */
export interface StubMenuItem {
	title: string;
	disabled: boolean;
	checked: boolean;
	handler?: () => void;
}

/** Menus opened and not yet dismissed, most recent last. */
export const openMenus: StubMenu[] = [];

class StubMenuItemBuilder implements StubMenuItem {
	title = "";
	disabled = false;
	checked = false;
	handler?: () => void;
	setTitle(text: string): this {
		this.title = text;
		return this;
	}
	setIcon(): this {
		return this;
	}
	setChecked(on: boolean): this {
		this.checked = on;
		return this;
	}
	setDisabled(on: boolean): this {
		this.disabled = on;
		return this;
	}
	setSection(): this {
		return this;
	}
	setWarning(): this {
		return this;
	}
	onClick(handler: () => void): this {
		this.handler = handler;
		return this;
	}
}

export class StubMenu {
	items: StubMenuItem[] = [];
	addItem(callback: (item: StubMenuItemBuilder) => void): this {
		const item = new StubMenuItemBuilder();
		callback(item);
		this.items.push(item);
		return this;
	}
	addSeparator(): this {
		return this;
	}
	showAtMouseEvent(): this {
		openMenus.push(this);
		return this;
	}
	showAtPosition(): this {
		openMenus.push(this);
		return this;
	}
	hide(): this {
		const at = openMenus.indexOf(this);
		if (at >= 0) openMenus.splice(at, 1);
		return this;
	}
}

export const Menu = StubMenu;

/** The menu most recently opened. */
export function currentMenu(): StubMenu {
	const menu = openMenus[openMenus.length - 1];
	if (!menu) throw new Error("no menu is open");
	return menu;
}

/** Choose an item from the open menu, by its exact title. */
export function clickMenuItem(title: string): void {
	const menu = currentMenu();
	const item = menu.items.find((entry) => entry.title === title);
	if (!item) {
		throw new Error(
			`no menu item "${title}". Present: ${menu.items.map((i) => i.title).join(", ") || "none"}`
		);
	}
	menu.hide();
	item.handler?.();
}

/** What the open menu offers, for a test that wants to assert on the list. */
export function menuTitles(): string[] {
	return currentMenu().items.map((item) => item.title);
}

/**
 * Modals and settings, real enough to drive.
 *
 * These used to be empty shells, on the grounds that the tests only exercised
 * pure logic. That was the problem: the dialog that asks what to do with a row's
 * sub-items had a version where dismissing it deleted the parent, and no test
 * could have caught it. `open()` now runs `onOpen`, `close()` runs `onClose`,
 * and buttons remember their label and handler -- so a test can press "Cancel",
 * press the destructive button, or dismiss the dialog outright, and check what
 * happened.
 */
export const openModals: Modal[] = [];

export class Modal {
	contentEl: HTMLElement = makeEl();
	open(): void {
		openModals.push(this);
		this.onOpen();
	}
	close(): void {
		const at = openModals.indexOf(this);
		if (at >= 0) openModals.splice(at, 1);
		this.onClose();
	}
	onOpen(): void {}
	onClose(): void {}
}

/** The most recently opened dialog, for a test to answer. */
export function currentModal(): Modal {
	const modal = openModals[openModals.length - 1];
	if (!modal) throw new Error("no dialog is open");
	return modal;
}

/** Press the button with this label on the open dialog. */
export function pressButton(label: string): void {
	const modal = currentModal() as Modal & { buttons?: StubButton[] };
	const button = (modal.buttons ?? []).find((b) => b.label === label);
	if (!button) {
		const labels = (modal.buttons ?? []).map((b) => b.label).join(", ");
		throw new Error(`no button called "${label}". Present: ${labels || "none"}`);
	}
	button.handler?.();
}

/** Dismiss the open dialog, as pressing Escape or clicking away would. */
export function dismissModal(): void {
	currentModal().close();
}

/** Drive the open dialog's text field. */
export function typeInto(value: string, placeholder?: string): void {
	const modal = currentModal() as Modal & { texts?: StubText[] };
	const fields = modal.texts ?? [];
	const field = placeholder ? fields.find((f) => f.placeholder === placeholder) : fields[0];
	if (!field) {
		const seen = fields.map((f) => f.placeholder || "(no placeholder)").join(", ");
		throw new Error(`no text field${placeholder ? ` "${placeholder}"` : ""}. Present: ${seen || "none"}`);
	}
	field.value = value;
	field.handler?.(value);
}

interface StubText {
	placeholder: string;
	value: string;
	handler?: (value: string) => void;
}

class StubTextComponent implements StubText {
	placeholder = "";
	value = "";
	handler?: (value: string) => void;
	inputEl = makeEl();
	setPlaceholder(text: string): this {
		this.placeholder = text;
		return this;
	}
	setValue(text: string): this {
		this.value = text;
		return this;
	}
	getValue(): string {
		return this.value;
	}
	onChange(handler: (value: string) => void): this {
		this.handler = handler;
		return this;
	}
}

interface StubButton {
	label: string;
	cta: boolean;
	warning: boolean;
	handler?: () => void;
}

class StubButtonComponent implements StubButton {
	label = "";
	cta = false;
	warning = false;
	handler?: () => void;
	setButtonText(text: string): this {
		this.label = text;
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	setWarning(): this {
		this.warning = true;
		return this;
	}
	setIcon(): this {
		return this;
	}
	setTooltip(): this {
		return this;
	}
	onClick(handler: () => void): this {
		this.handler = handler;
		return this;
	}
}

/**
 * Buttons are recorded against the dialog they were added to, which is what
 * `pressButton` looks up. Everything else is still a shell: these tests are
 * about which handler runs, not about how a text field looks.
 */
export class Setting {
	private owner: { buttons?: StubButton[]; texts?: StubText[] } | undefined;
	constructor(containerEl?: unknown) {
		this.owner = ownerOf(containerEl);
	}
	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	setClass(): this {
		return this;
	}
	addText(callback: (text: StubTextComponent) => void): this {
		const field = new StubTextComponent();
		callback(field);
		if (this.owner) {
			const owner = this.owner as { texts?: StubText[] };
			owner.texts = owner.texts ?? [];
			owner.texts.push(field);
		}
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
	addButton(callback: (button: StubButtonComponent) => void): this {
		const button = new StubButtonComponent();
		callback(button);
		if (this.owner) {
			this.owner.buttons = this.owner.buttons ?? [];
			this.owner.buttons.push(button);
		}
		return this;
	}
	addExtraButton(): this {
		return this;
	}
}

/** Which open dialog a Setting's container belongs to. */
function ownerOf(containerEl: unknown): { buttons?: StubButton[]; texts?: StubText[] } | undefined {
	return openModals.find(
		(modal) => modal.contentEl === containerEl || contains(modal.contentEl, containerEl)
	) as { buttons?: StubButton[]; texts?: StubText[] } | undefined;
}

/** A Setting may be built inside a child of the dialog, not the dialog itself. */
function contains(root: unknown, node: unknown): boolean {
	const el = root as { contains?: (other: unknown) => boolean } | null;
	return !!(el && node && typeof el.contains === "function" && el.contains(node));
}

/**
 * Modals reach for `contentEl.createEl` before any DOM exists in the pure-logic
 * suites, so fall back to an object that swallows those calls. When
 * `tests/dom.ts` has installed a document, this is a real element.
 */
function makeEl(): HTMLElement {
	if (typeof document !== "undefined") return document.createElement("div");
	const noop = (): HTMLElement => makeEl();
	return {
		addClass: noop,
		createEl: noop,
		createDiv: noop,
		createSpan: noop,
		empty: noop,
	} as unknown as HTMLElement;
}

export const Platform = {
	isMobile: false,
	isDesktop: true,
	isWin: false,
	isMacOS: false,
	isLinux: true,
	isAndroidApp: false,
	isIosApp: false,
};

export const setIcon = (): void => undefined;
