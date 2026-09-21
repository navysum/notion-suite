import { DatabaseRow, PropertyDef } from "../types";
import { formatValue } from "./value";

/**
 * Turn rows into CSV.
 *
 * A database that cannot leave is a database you are locked into, which is the
 * thing this whole plugin exists to avoid. The notes are already plain markdown,
 * but "open every note and read its frontmatter" is not an export -- a
 * spreadsheet is.
 *
 * Values are written as they are displayed rather than as they are stored, so a
 * rollup exports its number and a date exports the day you see. That is what
 * makes the file useful in a spreadsheet; the notes remain the source of truth.
 */

/**
 * Quote a field the way RFC 4180 asks.
 *
 * Only fields that need it are quoted, and a quote inside one is doubled. The
 * leading-character guard is for spreadsheets rather than for the format: a
 * value beginning `=`, `+`, `-` or `@` is treated as a formula by Excel and
 * Sheets, so a task called "=SUM(A1:A9)" would execute on open. Prefixing a
 * tab keeps the text intact and stops it being read as a formula.
 */
export function csvField(value: string): string {
	const dangerous = /^[=+\-@\t\r]/.test(value);
	const text = dangerous ? `\t${value}` : value;
	if (!/[",\n\r]/.test(text) && !dangerous) return text;
	return `"${text.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows: DatabaseRow[], properties: PropertyDef[]): string {
	const header = ["Name", ...properties.map((prop) => prop.name)];
	const lines = [header.map(csvField).join(",")];

	for (const row of rows) {
		const cells = [row.name, ...properties.map((prop) => formatValue(prop, row.values[prop.id]))];
		lines.push(cells.map(csvField).join(","));
	}

	// A trailing newline: every tool copes with one, and several complain
	// about its absence.
	return `${lines.join("\n")}\n`;
}

/** A file name that will not collide with the note it came from. */
export function csvFileName(databaseName: string, when = new Date()): string {
	const stamp = [
		when.getFullYear(),
		String(when.getMonth() + 1).padStart(2, "0"),
		String(when.getDate()).padStart(2, "0"),
	].join("-");
	const safe = databaseName.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "database";
	return `${safe} ${stamp}.csv`;
}
