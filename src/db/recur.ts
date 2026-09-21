import { parseDate, toISODate } from "../utils/dates";
import { asKey } from "../utils/text";

/**
 * Repeating rows.
 *
 * "Water the plants, every Tuesday" is a task you want back the moment you have
 * done it, not one you want to retype. Notion does this with recurring database
 * templates on a timer; here the trigger is ticking the row off, which is both
 * simpler and closer to how a task list is actually used -- nothing appears
 * until you have finished the last one, so a fortnight away does not leave
 * fourteen identical rows waiting for you.
 *
 * The rule lives in an ordinary text property, in the words someone would say:
 * `weekly`, `every 3 days`, `every Tuesday`, `monthly`, `weekdays`.
 */

export type RecurrenceUnit = "day" | "week" | "month" | "year";

export interface Recurrence {
	unit: RecurrenceUnit;
	/** How many units apart. `every 3 days` is 3. */
	every: number;
	/** 0-6, Sunday first, when the rule names a day: `every Tuesday`. */
	weekday?: number;
	/** Monday to Friday only. */
	weekdaysOnly?: boolean;
}

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const WORD_NUMBERS: Record<string, number> = {
	a: 1,
	an: 1,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

const UNIT_WORDS: Record<string, RecurrenceUnit> = {
	day: "day",
	days: "day",
	daily: "day",
	week: "week",
	weeks: "week",
	weekly: "week",
	fortnight: "week",
	fortnightly: "week",
	month: "month",
	months: "month",
	monthly: "month",
	quarter: "month",
	quarterly: "month",
	year: "year",
	years: "year",
	yearly: "year",
	annually: "year",
};

/**
 * Read a repeat rule written the way a person would say it.
 *
 * Returns null for anything it does not understand, so an unrelated text
 * property that happens to hold prose never silently starts creating rows.
 */
export function parseRecurrence(value: unknown): Recurrence | null {
	const text = asKey(value).trim().replace(/\s+/g, " ");
	if (!text) return null;

	if (text === "weekdays" || text === "every weekday" || text === "weekdays only") {
		return { unit: "day", every: 1, weekdaysOnly: true };
	}

	// `every tuesday`, `tuesdays`, `each monday`
	const named = text.match(/^(?:every |each )?([a-z]+?)s?$/);
	if (named) {
		const index = DAY_NAMES.indexOf(named[1]);
		if (index >= 0) return { unit: "week", every: 1, weekday: index };
	}

	// A bare unit word: `daily`, `weekly`, `fortnightly`, `quarterly`.
	const bare = UNIT_WORDS[text];
	if (bare) return { unit: bare, every: multiplierFor(text) };

	// `every 3 days`, `every other week`, `every two months`
	const repeated = text.match(/^(?:every |each )(other |[a-z0-9]+ )?([a-z]+)$/);
	if (repeated) {
		const unit = UNIT_WORDS[repeated[2]];
		if (!unit) return null;
		const countWord = (repeated[1] ?? "").trim();
		let every = multiplierFor(repeated[2]);
		if (countWord === "other") every = 2;
		else if (countWord) {
			const n = WORD_NUMBERS[countWord] ?? Number(countWord);
			if (!Number.isFinite(n) || n < 1) return null;
			every = n * multiplierFor(repeated[2]);
		}
		return { unit, every };
	}

	return null;
}

/** `fortnightly` is two weeks; `quarterly` is three months. */
function multiplierFor(word: string): number {
	if (word.startsWith("fortnight")) return 2;
	if (word.startsWith("quarter")) return 3;
	return 1;
}

/**
 * The next date a rule lands on, strictly after `from`.
 *
 * Strictly after matters: a weekly task completed on its own due date has to
 * move to next week, not sit on today forever.
 */
export function nextOccurrence(rule: Recurrence, from: Date): Date {
	const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());

	if (rule.weekdaysOnly) {
		const next = new Date(start);
		do {
			next.setDate(next.getDate() + 1);
		} while (next.getDay() === 0 || next.getDay() === 6);
		return next;
	}

	if (rule.unit === "week" && rule.weekday !== undefined) {
		const next = new Date(start);
		do {
			next.setDate(next.getDate() + 1);
		} while (next.getDay() !== rule.weekday);
		// `every other tuesday` skips a whole week, not a day.
		if (rule.every > 1) next.setDate(next.getDate() + 7 * (rule.every - 1));
		return next;
	}

	switch (rule.unit) {
		case "day":
			return shiftDays(start, rule.every);
		case "week":
			return shiftDays(start, 7 * rule.every);
		case "month":
			return shiftMonths(start, rule.every);
		case "year":
			return new Date(start.getFullYear() + rule.every, start.getMonth(), start.getDate());
	}
}

/**
 * Add months, keeping the day of the month.
 *
 * Not `addMonths` from the date helpers: that one snaps to the 1st, which is
 * what a calendar's "next month" button wants and the opposite of what a
 * monthly task wants. The clamp is for month ends -- the 31st of January plus
 * a month is the end of February, not the 3rd of March, which is where the
 * naive version lands.
 */
function shiftMonths(from: Date, months: number): Date {
	const day = from.getDate();
	const target = new Date(from.getFullYear(), from.getMonth() + months, 1);
	const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
	target.setDate(Math.min(day, lastDay));
	return target;
}

function shiftDays(from: Date, days: number): Date {
	const next = new Date(from);
	next.setDate(next.getDate() + days);
	return next;
}

/**
 * Work out the next row's date from the row that was just completed.
 *
 * It counts from the row's own date rather than from today, so a weekly chore
 * ticked off three days late is still due on its usual day. If the row has no
 * date, or the date is behind us by more than one interval, it counts from
 * today instead -- otherwise catching up on a month of missed chores would
 * schedule the next one in the past.
 */
export function nextDateFor(rule: Recurrence, current: unknown, today = new Date()): string {
	const from = parseDate(current);
	const base = from ?? today;
	let next = nextOccurrence(rule, base);

	const guard = 500;
	let steps = 0;
	while (next.getTime() <= startOfDay(today).getTime() && steps < guard) {
		next = nextOccurrence(rule, next);
		steps++;
	}
	return toISODate(next);
}

function startOfDay(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
