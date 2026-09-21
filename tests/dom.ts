/**
 * A DOM, plus the element helpers Obsidian adds to it.
 *
 * ## Why this exists
 *
 * Roughly a third of this plugin only runs inside Obsidian: element lifecycles,
 * pane handling, drag handlers. Four of the six bugs in the last audit lived
 * there, and none of them were reachable from a unit test, because a unit test
 * had no document to render into. The only check was a human clicking through
 * the app, which is exactly the check that kept missing them.
 *
 * So: give the tests a real DOM (happy-dom), and teach it the handful of helper
 * methods Obsidian bolts onto `HTMLElement` -- `createDiv`, `empty`, `addClass`
 * and friends. With those in place the plugin's actual renderers run unmodified,
 * and a test can type into the search box, click "next month" or drop a card and
 * then look at what the user would be looking at.
 *
 * ## What this proves, and what it does not
 *
 * It proves the plugin's own behaviour: that state survives a refresh, that a
 * handler updates what it should, that a click produces the right elements. That
 * is where every bug of this kind has actually been.
 *
 * It does **not** prove Obsidian behaves the way this file pretends. The stub is
 * a model of the API, and a wrong model passes its own tests. Anything that
 * turns on Obsidian's real semantics -- how `rightSplit` resolves, when a
 * post-processor re-runs, what a real drag gesture carries -- stays in
 * docs/SMOKE.md and needs a human in the app.
 */
import { Window } from "happy-dom";

interface DomInfo {
	cls?: string | string[];
	text?: string | number;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	value?: string;
	type?: string;
	placeholder?: string;
	href?: string;
	prepend?: boolean;
}

function apply(el: HTMLElement, info?: DomInfo | string): HTMLElement {
	if (typeof info === "string") {
		el.className = info;
		return el;
	}
	if (!info) return el;
	if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
	if (info.text !== undefined) el.textContent = String(info.text);
	if (info.title !== undefined) el.setAttribute("title", info.title);
	if (info.href !== undefined) el.setAttribute("href", info.href);
	if (info.type !== undefined) el.setAttribute("type", info.type);
	if (info.placeholder !== undefined) el.setAttribute("placeholder", info.placeholder);
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
	for (const [key, value] of Object.entries(info.attr ?? {})) {
		if (value !== null && value !== false) el.setAttribute(key, String(value));
	}
	return el;
}

/** Install a DOM on the global object, with Obsidian's element helpers on it. */
export function installDom(): void {
	const window = new Window({ url: "https://localhost/" });
	const g = globalThis as Record<string, unknown>;
	for (const key of [
		"window",
		"document",
		"Node",
		"Element",
		"HTMLElement",
		"HTMLInputElement",
		"Event",
		"MouseEvent",
		"KeyboardEvent",
		"DragEvent",
		"CustomEvent",
		"getComputedStyle",
	]) {
		g[key] = (window as unknown as Record<string, unknown>)[key];
	}

	const proto = (window as unknown as { HTMLElement: { prototype: Record<string, unknown> } })
		.HTMLElement.prototype;

	proto.createEl = function (
		this: HTMLElement,
		tag: string,
		info?: DomInfo | string,
		callback?: (el: HTMLElement) => void
	): HTMLElement {
		const el = this.ownerDocument.createElement(tag) as HTMLElement;
		apply(el, info);
		if (typeof info === "object" && info?.prepend) this.prepend(el);
		else this.appendChild(el);
		callback?.(el);
		return el;
	};

	proto.createDiv = function (
		this: HTMLElement,
		info?: DomInfo | string,
		callback?: (el: HTMLElement) => void
	): HTMLElement {
		return (this as unknown as { createEl: typeof proto.createEl }).createEl("div", info, callback);
	};

	proto.createSpan = function (
		this: HTMLElement,
		info?: DomInfo | string,
		callback?: (el: HTMLElement) => void
	): HTMLElement {
		return (this as unknown as { createEl: typeof proto.createEl }).createEl("span", info, callback);
	};

	proto.empty = function (this: HTMLElement): void {
		while (this.firstChild) this.removeChild(this.firstChild);
	};

	proto.detach = function (this: HTMLElement): void {
		this.remove();
	};

	proto.addClass = function (this: HTMLElement, ...classes: string[]): void {
		this.classList.add(...classes.filter(Boolean));
	};

	proto.removeClass = function (this: HTMLElement, ...classes: string[]): void {
		this.classList.remove(...classes.filter(Boolean));
	};

	proto.toggleClass = function (this: HTMLElement, classes: string | string[], on: boolean): void {
		for (const cls of Array.isArray(classes) ? classes : [classes]) {
			this.classList.toggle(cls, on);
		}
	};

	proto.hasClass = function (this: HTMLElement, cls: string): boolean {
		return this.classList.contains(cls);
	};

	proto.setText = function (this: HTMLElement, text: string): void {
		this.textContent = text;
	};

	proto.setAttr = function (this: HTMLElement, key: string, value: string | number | boolean): void {
		this.setAttribute(key, String(value));
	};

	proto.show = function (this: HTMLElement): void {
		this.style.display = "";
	};

	proto.hide = function (this: HTMLElement): void {
		this.style.display = "none";
	};

	proto.setCssStyles = function (this: HTMLElement, styles: Record<string, string>): void {
		for (const [key, value] of Object.entries(styles)) {
			this.style.setProperty(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), value);
		}
	};
}

/** A detached element to render into, standing in for a code block. */
export function host(): HTMLElement {
	return document.createElement("div");
}

/** Click an element the way a user would. */
export function click(el: Element | null | undefined): void {
	if (!el) throw new Error("clicked nothing");
	el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** Type into an input, firing the event the plugin listens for. */
export function type(el: Element | null | undefined, text: string): void {
	if (!el) throw new Error("typed into nothing");
	(el as HTMLInputElement).value = text;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Every element matching a selector, as an array. */
export function all(root: Element, selector: string): HTMLElement[] {
	return [...root.querySelectorAll(selector)] as HTMLElement[];
}

/** The text of every element matching a selector. */
export function texts(root: Element, selector: string): string[] {
	return all(root, selector).map((el) => el.textContent?.trim() ?? "");
}

/**
 * Tick or untick a checkbox.
 *
 * A real browser flips `checked` itself and then fires `change`; happy-dom's
 * synthetic click does not, so do both here rather than have tests dispatch a
 * click and wonder why nothing happened.
 */
export function tick(el: Element | null | undefined, checked = true): void {
	if (!el) throw new Error("ticked nothing");
	(el as HTMLInputElement).checked = checked;
	el.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Wait for the view's debounced work (the search box) to run.
 *
 * The search deliberately waits for a pause in typing, so a test that types and
 * immediately asserts is asking about a render that has not happened yet.
 */
export function settle(ms = 250): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
