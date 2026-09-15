import { DatabaseRow, DatabaseSchema, ORDER_STEP } from "../types";

/**
 * Manual ordering.
 *
 * Order has to live somewhere durable, and on a folder-of-notes model the only
 * durable place is the note, so it is an ordinary number property the user can
 * see and edit. That is a visible trade: manual order costs one property.
 *
 * Positions are spaced rather than consecutive, so dropping a card between two
 * others usually rewrites one note instead of renumbering the column.
 */

export function orderOf(schema: DatabaseSchema, row: DatabaseRow): number {
	if (!schema.orderProperty) return 0;
	const value = Number(row.values[schema.orderProperty]);
	return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

/** Sort by manual position, falling back to title so ties are not arbitrary. */
export function sortByOrder(schema: DatabaseSchema, rows: DatabaseRow[]): DatabaseRow[] {
	if (!schema.orderProperty) return rows;
	return [...rows].sort((a, b) => {
		const diff = orderOf(schema, a) - orderOf(schema, b);
		return diff !== 0 ? diff : a.name.localeCompare(b.name);
	});
}

export interface Reposition {
	/** The position to write. */
	value: number;
	/** Rows that must be renumbered because the gap ran out. */
	renumber: Array<{ row: DatabaseRow; value: number }>;
}

/**
 * Work out the position for a row dropped at `index` within `siblings`.
 *
 * Returns the midpoint of its new neighbours where there is room. When two
 * neighbours are adjacent there is no midpoint to take, so the column is
 * respaced and every affected row is reported back for rewriting.
 */
export function positionFor(
	schema: DatabaseSchema,
	siblings: DatabaseRow[],
	index: number,
	moving: DatabaseRow
): Reposition {
	const others = siblings.filter((row) => row.path !== moving.path);
	const clamped = Math.max(0, Math.min(index, others.length));

	const before = clamped > 0 ? orderOf(schema, others[clamped - 1]) : null;
	const after = clamped < others.length ? orderOf(schema, others[clamped]) : null;

	if (before === null && after === null) return { value: ORDER_STEP, renumber: [] };
	if (before === null && after !== null) {
		// Room below the first card? Take it; otherwise respace.
		if (after > 1) return { value: Math.floor(after / 2), renumber: [] };
		return respace(schema, others, clamped, moving);
	}
	if (after === null && before !== null) {
		return { value: before + ORDER_STEP, renumber: [] };
	}

	const gap = (after as number) - (before as number);
	if (gap > 1) {
		return { value: (before as number) + Math.floor(gap / 2), renumber: [] };
	}
	return respace(schema, others, clamped, moving);
}

/** Lay the whole column out again on a fresh grid. */
function respace(
	schema: DatabaseSchema,
	others: DatabaseRow[],
	index: number,
	moving: DatabaseRow
): Reposition {
	const ordered = [...others];
	ordered.splice(index, 0, moving);

	const renumber: Array<{ row: DatabaseRow; value: number }> = [];
	let value = ORDER_STEP;
	let movedTo = ORDER_STEP;
	for (const row of ordered) {
		if (row.path === moving.path) movedTo = value;
		else renumber.push({ row, value });
		value += ORDER_STEP;
	}
	return { value: movedTo, renumber };
}
