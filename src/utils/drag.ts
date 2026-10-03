/**
 * Dragging that also works with a finger.
 *
 * The boards used HTML5 drag-and-drop, which never fires on touch: on a phone,
 * dragging a card did nothing at all -- no movement, no error, no hint that the
 * gesture was unsupported. The manifest said `isDesktopOnly: false` the whole
 * time, so every mobile user was told this worked.
 *
 * Pointer events cover mouse, pen and touch in one API, so the drag is
 * implemented once here and the native one is kept alongside it: Obsidian's
 * desktop drag affordances (the cursor, the drag image) come free with the
 * native one, and there is no reason to lose them to support touch.
 *
 * A touch drag has to begin deliberately. A finger that moves is usually
 * scrolling, so this waits for a long press before claiming the gesture, and
 * lets go the moment the finger moves first.
 */

/** How long a finger must rest on a card before it becomes a drag. */
export const LONG_PRESS_MS = 350;

/** How far a finger may stray during that press and still count as still. */
const SLOP_PX = 10;

export interface DragSource {
	/** What is being dragged, for the drop target to read. */
	payload: Record<string, string>;
	/** The element the user grabbed. */
	element: HTMLElement;
}

export interface TouchDragHandlers {
	/** Called once the gesture is definitely a drag. */
	onStart?: () => void;
	/** Called as the pointer moves, with whatever is under it. */
	onMove?: (over: Element | null) => void;
	/** Called on release, with whatever is under the pointer. */
	onDrop: (over: Element | null) => void;
	/** Called on cancel, or when the drag ends either way. */
	onEnd?: () => void;
}

/**
 * Make an element draggable by finger as well as by mouse.
 *
 * Returns nothing: listeners are added to the element and to the document for
 * the life of the gesture only, so there is nothing to clean up once a drag
 * finishes or is abandoned.
 */
export function enableTouchDrag(
	element: HTMLElement,
	handlers: TouchDragHandlers
): void {
	let timer: number | null = null;
	let startX = 0;
	let startY = 0;
	let dragging = false;

	const cancelPress = (): void => {
		if (timer !== null) {
			window.clearTimeout(timer);
			timer = null;
		}
	};

	const finish = (over: Element | null, dropped: boolean): void => {
		cancelPress();
		document.removeEventListener("pointermove", onMove);
		document.removeEventListener("pointerup", onUp);
		document.removeEventListener("pointercancel", onCancel);
		if (dragging) {
			dragging = false;
			element.removeClass("nfo-card-dragging");
			if (dropped) handlers.onDrop(over);
			handlers.onEnd?.();
		}
	};

	const onMove = (evt: PointerEvent): void => {
		if (!dragging) {
			// Still deciding. A finger that travels is scrolling, not dragging.
			if (Math.abs(evt.clientX - startX) > SLOP_PX || Math.abs(evt.clientY - startY) > SLOP_PX) {
				cancelPress();
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				document.removeEventListener("pointercancel", onCancel);
			}
			return;
		}
		// Once dragging, the page must not scroll under the finger.
		evt.preventDefault();
		handlers.onMove?.(elementUnder(evt));
	};

	const onUp = (evt: PointerEvent): void => finish(elementUnder(evt), dragging);
	const onCancel = (): void => finish(null, false);

	element.addEventListener("pointerdown", (evt) => {
		// Mouse and pen already have the native drag; only touch needs this.
		if (evt.pointerType !== "touch") return;
		startX = evt.clientX;
		startY = evt.clientY;
		document.addEventListener("pointermove", onMove, { passive: false });
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		timer = window.setTimeout(() => {
			timer = null;
			dragging = true;
			element.addClass("nfo-card-dragging");
			handlers.onStart?.();
		}, LONG_PRESS_MS);
	});
}

/**
 * What is under the pointer.
 *
 * The dragged element is skipped: it follows the finger, so it would otherwise
 * be the answer to every question about what is underneath.
 */
function elementUnder(evt: PointerEvent): Element | null {
	const found = document.elementFromPoint(evt.clientX, evt.clientY);
	return found;
}

/** The nearest ancestor matching a selector, including the element itself. */
export function closestMatch(start: Element | null, selector: string): HTMLElement | null {
	if (!start) return null;
	return start.closest(selector);
}
