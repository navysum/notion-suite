/**
 * Bases property ids, and what they mean to us.
 *
 * Obsidian addresses a property as `<kind>.<name>`: `note.status` is a
 * frontmatter key, `file.name` is something about the file itself, and
 * `formula.total` is computed by the Base. Only the first kind is a real
 * frontmatter key, which matters the moment a view wants to write one back --
 * dropping a card into a column has to know it is editing `status`, and must
 * refuse to try when the board is grouped by something computed.
 */

export type BasesKind = "note" | "formula" | "file";

export interface ParsedPropertyId {
	kind: BasesKind;
	/** The part after the dot: the frontmatter key, for a `note.` property. */
	name: string;
}

export function parsePropertyId(id: string): ParsedPropertyId | null {
	const dot = id.indexOf(".");
	if (dot <= 0) return null;
	const kind = id.slice(0, dot);
	// A frontmatter key may itself contain a dot, so only the first one splits.
	const name = id.slice(dot + 1);
	if (!name) return null;
	if (kind !== "note" && kind !== "formula" && kind !== "file") return null;
	return { kind, name };
}

/**
 * The frontmatter key a property id writes to, or null when it has none.
 *
 * A formula is computed and a file property belongs to the filesystem, so
 * neither can be set by dragging a card. Returning null rather than guessing
 * is what lets the board refuse the drop instead of silently writing a key
 * that nothing reads.
 */
export function writableKey(id: string): string | null {
	const parsed = parsePropertyId(id);
	return parsed && parsed.kind === "note" ? parsed.name : null;
}
