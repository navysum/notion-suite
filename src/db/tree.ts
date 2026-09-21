import { DatabaseRow, DatabaseSchema } from "../types";
import { linkTarget } from "../utils/text";

/**
 * Sub-items: rows that name another row as their parent.
 *
 * The parent link is an ordinary property holding the parent's title, so the
 * hierarchy is visible and editable in the note itself rather than hidden in
 * plugin state. Everything here works on already-filtered rows, so a view's
 * filter still decides what is on screen.
 */

export interface TreeRow {
	row: DatabaseRow;
	depth: number;
	hasChildren: boolean;
}

/**
 * Order rows so each parent is followed by its descendants.
 *
 * Rows whose parent is not in the set are treated as roots: a child whose
 * parent the view filtered out must still be visible, or filtering by status
 * would make tasks vanish rather than flatten.
 *
 * Cycles are a real possibility -- two rows can name each other, by hand or by
 * accident -- so a row is emitted at most once and anything still unvisited at
 * the end is appended as a root.
 */
export function buildTree(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	collapsed: ReadonlySet<string> = new Set()
): TreeRow[] {
	const parentKey = schema.parentProperty;
	if (!parentKey) return rows.map((row) => ({ row, depth: 0, hasChildren: false }));

	const byName = new Map<string, DatabaseRow>();
	for (const row of rows) {
		if (!byName.has(row.name.toLowerCase())) byName.set(row.name.toLowerCase(), row);
	}

	const children = new Map<string, DatabaseRow[]>();
	const roots: DatabaseRow[] = [];
	for (const row of rows) {
		const parent = linkTarget(row.values[parentKey]).toLowerCase();
		const parentRow = parent ? byName.get(parent) : undefined;
		if (!parentRow || parentRow.path === row.path) {
			roots.push(row);
			continue;
		}
		const bucket = children.get(parentRow.path);
		if (bucket) bucket.push(row);
		else children.set(parentRow.path, [row]);
	}

	const out: TreeRow[] = [];
	const seen = new Set<string>();

	/**
	 * Mark a subtree as accounted for without emitting it.
	 *
	 * Needed for collapsed rows: the recovery pass below appends anything still
	 * unvisited, and without this it would append the very descendants the user
	 * just collapsed, defeating the collapse entirely.
	 */
	const swallow = (row: DatabaseRow): void => {
		if (seen.has(row.path)) return;
		seen.add(row.path);
		for (const child of children.get(row.path) ?? []) swallow(child);
	};

	const walk = (row: DatabaseRow, depth: number): void => {
		if (seen.has(row.path)) return;
		seen.add(row.path);
		const kids = children.get(row.path) ?? [];
		out.push({ row, depth, hasChildren: kids.length > 0 });
		if (collapsed.has(row.path)) {
			for (const child of kids) swallow(child);
			return;
		}
		// Cap the depth so a chain that somehow escapes the cycle guard cannot
		// indent forever.
		if (depth >= 12) {
			for (const child of kids) swallow(child);
			return;
		}
		for (const child of kids) walk(child, depth + 1);
	};

	for (const root of roots) walk(root, 0);
	// Anything left is part of a cycle; show it rather than lose it.
	for (const row of rows) if (!seen.has(row.path)) walk(row, 0);

	return out;
}

/** Rows that would be orphaned by deleting this one. */
export function descendantsOf(
	schema: DatabaseSchema,
	rows: DatabaseRow[],
	path: string
): DatabaseRow[] {
	const tree = buildTree(schema, rows);
	const index = tree.findIndex((entry) => entry.row.path === path);
	if (index === -1) return [];
	const depth = tree[index].depth;
	const out: DatabaseRow[] = [];
	for (let i = index + 1; i < tree.length && tree[i].depth > depth; i++) {
		out.push(tree[i].row);
	}
	return out;
}
