/**
 * Dragging with a finger.
 *
 * The boards used HTML5 drag-and-drop, which never fires on touch: on a phone a
 * card could not be moved at all, with nothing to say the gesture was
 * unsupported — while the manifest said `isDesktopOnly: false` the whole time.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { host, installDom } from "./dom";

installDom();

import { closestMatch, enableTouchDrag, LONG_PRESS_MS } from "../src/utils/drag";

interface PointerInit {
	type: string;
	x?: number;
	y?: number;
	pointerType?: string;
}

function pointer(el: Element | Document, { type, x = 0, y = 0, pointerType = "touch" }: PointerInit) {
	const evt = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(evt, { clientX: x, clientY: y, pointerType });
	el.dispatchEvent(evt);
	return evt;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function card(): HTMLElement {
	const root = host();
	document.body.appendChild(root);
	const el = root.createDiv({ cls: "nfo-card" });
	return el;
}

test("a long press starts a drag", async () => {
	const el = card();
	let started = false;
	enableTouchDrag(el, { onStart: () => (started = true), onDrop: () => undefined });

	pointer(el, { type: "pointerdown" });
	assert.equal(started, false, "a drag started before the press was long enough");

	await wait(LONG_PRESS_MS + 60);
	assert.equal(started, true, "a long press did not start a drag");
	assert.ok(el.classList.contains("nfo-card-dragging"));
});

/** A finger that moves straight away is scrolling the page, not dragging. */
test("a finger that moves immediately scrolls instead of dragging", async () => {
	const el = card();
	let started = false;
	enableTouchDrag(el, { onStart: () => (started = true), onDrop: () => undefined });

	pointer(el, { type: "pointerdown", x: 0, y: 0 });
	pointer(document, { type: "pointermove", x: 0, y: 60 });
	await wait(LONG_PRESS_MS + 60);

	assert.equal(started, false, "scrolling was taken for a drag");
});

/** A finger never holds perfectly still; a few pixels must not cancel it. */
test("a small wobble during the press is tolerated", async () => {
	const el = card();
	let started = false;
	enableTouchDrag(el, { onStart: () => (started = true), onDrop: () => undefined });

	pointer(el, { type: "pointerdown", x: 100, y: 100 });
	pointer(document, { type: "pointermove", x: 103, y: 104 });
	await wait(LONG_PRESS_MS + 60);

	assert.equal(started, true, "a few pixels of wobble cancelled the drag");
});

test("releasing after a drag reports where it was dropped", async () => {
	const el = card();
	let dropped: Element | null | undefined;
	enableTouchDrag(el, { onDrop: (over) => (dropped = over) });

	pointer(el, { type: "pointerdown" });
	await wait(LONG_PRESS_MS + 60);
	pointer(document, { type: "pointerup" });

	assert.notEqual(dropped, undefined, "the drop was never reported");
	assert.ok(!el.classList.contains("nfo-card-dragging"), "the card stayed in its dragging state");
});

test("releasing without a drag drops nothing", async () => {
	const el = card();
	let drops = 0;
	enableTouchDrag(el, { onDrop: () => drops++ });

	pointer(el, { type: "pointerdown" });
	pointer(document, { type: "pointerup" });
	await wait(LONG_PRESS_MS + 60);

	assert.equal(drops, 0, "a tap was treated as a drag and a drop");
});

/** Mouse and pen already have the native drag; this must not double up. */
test("a mouse press is left to the native drag", async () => {
	const el = card();
	let started = false;
	enableTouchDrag(el, { onStart: () => (started = true), onDrop: () => undefined });

	pointer(el, { type: "pointerdown", pointerType: "mouse" });
	await wait(LONG_PRESS_MS + 60);

	assert.equal(started, false, "the touch drag also claimed a mouse press");
});

test("a cancelled gesture drops nothing and cleans up", async () => {
	const el = card();
	let drops = 0;
	enableTouchDrag(el, { onDrop: () => drops++ });

	pointer(el, { type: "pointerdown" });
	await wait(LONG_PRESS_MS + 60);
	pointer(document, { type: "pointercancel" });

	assert.equal(drops, 0);
	assert.ok(!el.classList.contains("nfo-card-dragging"));
});

test("closestMatch finds the container a drop landed in", () => {
	const root = host();
	const list = root.createDiv({ cls: "nfo-board-cards" });
	const inner = list.createDiv({ cls: "nfo-card" });
	const deep = inner.createSpan();

	assert.equal(closestMatch(deep, ".nfo-board-cards"), list);
	assert.equal(closestMatch(deep, ".nfo-card"), inner);
	assert.equal(closestMatch(deep, ".nothing-like-this"), null);
	assert.equal(closestMatch(null, ".nfo-card"), null);
});
