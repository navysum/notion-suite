import { calendarDate, toISODate } from "./dates";

/**
 * Coerce an unknown value into display text.
 *
 * `String(value)` is the wrong tool here. Frontmatter and block YAML are
 * hand-written, so a key that should hold a scalar can legitimately come back
 * as a map or a nested list -- and `String({})` yields the useless
 * "[object Object]", which would then be shown in a cell, matched by a filter,
 * or written into a chart label. Anything that is not a scalar reads as empty
 * instead, which every caller already treats as "no value".
 */
export function asText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	// The calendar day that was written down, not the UTC instant: see
	// calendarDate. toISOString() here shifted every date a day early west of
	// Greenwich, including the value handed to the date picker.
	if (value instanceof Date) return toISODate(calendarDate(value));
	if (Array.isArray(value)) {
		return (value as unknown[]).map(asText).filter((part) => part.length > 0).join(", ");
	}
	return "";
}

/** Lower-cased `asText`, for the many case-insensitive comparisons. */
export function asKey(value: unknown): string {
	return asText(value).toLowerCase();
}

/**
 * Strip a wikilink down to the note title it points at.
 *
 * Relations, parent links and cover images all store a note's title, and a
 * human may write that as `Note`, `[[Note]]`, `[[Note|an alias]]` or
 * `[[Note#A heading]]`. Every one of those means the same note.
 *
 * This lived in three places -- the sub-item tree, relation resolution and the
 * page banner -- each with its own copy. Rename handling needs a fourth reader,
 * and a fourth copy is how the copies start to disagree.
 */
export function linkTarget(value: unknown): string {
	const raw = Array.isArray(value) ? (value as unknown[])[0] : value;
	return asText(raw)
		.replace(/^!?\[\[/, "")
		.replace(/\]\]$/, "")
		.split("|")[0]
		.split("#")[0]
		.trim();
}
