/** Date helpers. Everything is stored as an ISO `YYYY-MM-DD` string in frontmatter. */

/**
 * Read a Date as the calendar day it was meant to be.
 *
 * A date-only value in YAML -- `due: 2026-03-14` -- is parsed into midnight
 * **UTC**. Reading that back with the local getters gives the day before for
 * anyone west of Greenwich: a task due on the 14th displayed as the 13th, sat
 * in the Overdue column, and filtered as though it had already passed. The
 * whole of the Americas saw every date shifted by one.
 *
 * A timestamp of exactly midnight UTC is a calendar date, not an instant, so
 * its UTC parts are the parts that were written down. Anything with a time on
 * it is a real moment and is left in local time, where it belongs.
 */
export function calendarDate(d: Date): Date {
	const isDateOnly =
		d.getUTCHours() === 0 &&
		d.getUTCMinutes() === 0 &&
		d.getUTCSeconds() === 0 &&
		d.getUTCMilliseconds() === 0;
	if (!isDateOnly) return d;
	return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function toISODate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function today(): string {
	return toISODate(new Date());
}

/**
 * Parse the date shapes that realistically show up in frontmatter: ISO strings,
 * `YYYY/MM/DD`, JS Date objects (the YAML parser produces these), and epoch ms.
 * Returns null rather than an Invalid Date so callers can branch cleanly.
 */
export function parseDate(value: unknown): Date | null {
	if (value === null || value === undefined || value === "") return null;
	if (value instanceof Date) return isNaN(value.getTime()) ? null : calendarDate(value);
	if (typeof value === "number") {
		const d = new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const iso = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
	if (iso) {
		const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
		return isNaN(d.getTime()) ? null : d;
	}
	const parsed = new Date(trimmed);
	return isNaN(parsed.getTime()) ? null : parsed;
}

const MONTHS = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDate(value: unknown): string {
	const d = parseDate(value);
	if (!d) return "";
	return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

export function monthTitle(d: Date): string {
	return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function sameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

/** The 42 cells (6 weeks) of a month grid, starting on Sunday. */
export function calendarGrid(month: Date): Date[] {
	const first = new Date(month.getFullYear(), month.getMonth(), 1);
	const start = new Date(first);
	start.setDate(1 - first.getDay());
	const days: Date[] = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(start);
		d.setDate(start.getDate() + i);
		days.push(d);
	}
	return days;
}

export function addMonths(d: Date, delta: number): Date {
	return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
