import { ViewType } from "../types";

/**
 * Per-surface UI state that has to survive a re-render but is never persisted:
 * the search box's contents, which sub-items are folded away, which rows are
 * ticked, the month a calendar is showing.
 *
 * ## Why this module exists
 *
 * This state used to live in a `WeakMap<HTMLElement, ...>` inside whichever
 * module needed it, keyed on whatever element that module had been handed. Three
 * separate bugs came out of that, all the same shape: the element the state was
 * keyed on was one the render path rebuilds, so the state was thrown away by the
 * very re-render it was supposed to survive. Calendar navigation never advanced
 * a month; the full-page database cleared its own search box as you typed.
 *
 * The fix is structural rather than careful. There is exactly one element-keyed
 * map in the plugin and it lives here. `surfaceState` is resolved **once**, at
 * the top of a render, against the surface's stable host, and handed down the
 * render tree on the `ViewContext`. Everything below that point reads
 * `ctx.state` and has no element to key anything on, so it has nothing to get
 * wrong. `tests/guards.test.ts` fails the build if a second element-keyed map
 * appears anywhere else in `src/`.
 *
 * ## What counts as a stable host
 *
 * The element that outlives a refresh. For an inline `notion-db` block that is
 * the code block's own element, which Obsidian hands to the post-processor and
 * which the renderer empties but never replaces. For a full-page database view
 * it is the body element the view creates once in `onOpen` and reuses. Anything
 * a render path calls `createDiv` on is **not** a stable host.
 */
export interface SurfaceState {
	/** Contents of the view's search box. */
	search: string;
	/** View type the user switched to, overriding the block's own. */
	viewType?: ViewType;
	/** Row whose title should open for editing on the next render. */
	focusRow?: string;
	/** Sub-item rows the user has collapsed, by path. */
	collapsed: Set<string>;
	/** Rows ticked for a bulk edit, by path. */
	selected: Set<string>;
	/** The month a calendar view is showing. */
	calendarMonth?: Date;
	/** The first bucket a timeline view is scrolled to. */
	timelineAnchor?: Date;
	/**
	 * How many rows this surface is currently drawing.
	 *
	 * A view with no `limit:` used to render every row it had. An imported
	 * Notion workspace is routinely thousands of rows, and each one costs a
	 * table row's worth of elements and listeners, so opening the view locked
	 * Obsidian up for seconds and every keystroke in the search box paid for it
	 * again. Views now draw a page at a time and offer the rest.
	 */
	shown?: number;
	/** The search term `shown` was last reset for. */
	shownFor?: string;
}

function blank(): SurfaceState {
	return { search: "", collapsed: new Set<string>(), selected: new Set<string>() };
}

/**
 * The plugin's only element-keyed state map. See the note above before adding
 * another one -- and then don't: add a field here instead.
 */
const states = new WeakMap<HTMLElement, SurfaceState>();

/** Read (creating on first use) the state belonging to a surface's stable host. */
export function surfaceState(host: HTMLElement): SurfaceState {
	const existing = states.get(host);
	if (existing) return existing;
	const fresh = blank();
	states.set(host, fresh);
	return fresh;
}
