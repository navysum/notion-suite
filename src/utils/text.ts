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
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	if (Array.isArray(value)) {
		return (value as unknown[]).map(asText).filter((part) => part.length > 0).join(", ");
	}
	return "";
}

/** Lower-cased `asText`, for the many case-insensitive comparisons. */
export function asKey(value: unknown): string {
	return asText(value).toLowerCase();
}
