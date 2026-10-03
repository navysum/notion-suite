import { PropertyDef } from "../types";
import { asKey, asText } from "../utils/text";
import { today } from "../utils/dates";

/**
 * "When Status becomes Done, set Completed to today."
 *
 * The bookkeeping a database is meant to remove. Recurring rows already do one
 * fixed version of this -- tick the box, get the next row -- and the general
 * shape is the same: something changed, so something else should change too.
 *
 * Rules are deliberately small. There is no condition language, no chaining,
 * no scripting: a rule watches one property, matches one value, and sets one
 * other property. Anything cleverer than that is a formula's job, and a
 * formula is already here, already safe, and already computed on read rather
 * than written into somebody's notes.
 */

export interface Automation {
	id: string;
	/** Off without deleting it, so a rule can be parked. */
	enabled?: boolean;
	/** The property whose change is watched. */
	when: string;
	/**
	 * The value it has to become. Empty means any change at all -- useful for
	 * "whenever Status moves, stamp Updated".
	 */
	becomes?: string;
	/** The property to write. */
	set: string;
	/**
	 * What to write. `today` is resolved when the rule runs; anything else is
	 * written literally, and `""` clears the property.
	 */
	to: string;
}

/** The values `to` understands beyond a literal. */
export const AUTOMATION_TOKENS: { token: string; label: string }[] = [
	{ token: "today", label: "Today's date" },
	{ token: "now", label: "Today's date" },
	{ token: "true", label: "Checked" },
	{ token: "false", label: "Unchecked" },
	{ token: "", label: "Clear it" },
];

/**
 * Whether a rule fires for this edit.
 *
 * It fires on the *change*, not on the state: setting Status to Done when it
 * already said Done is not an event, and treating it as one would restamp a
 * completion date every time somebody re-picked the same option.
 */
export function shouldFire(rule: Automation, propertyId: string, before: unknown, after: unknown): boolean {
	if (rule.enabled === false) return false;
	if (rule.when !== propertyId) return false;
	if (asKey(before) === asKey(after)) return false;
	if (!rule.becomes) return true;
	return asKey(after) === asKey(rule.becomes);
}

/**
 * The value a rule writes, resolved at the moment it fires.
 *
 * Returns null to mean "clear it", which is distinct from writing the string
 * "null" and from the rule not firing at all.
 */
export function resolveValue(rule: Automation, prop: PropertyDef | undefined): unknown {
	const raw = rule.to.trim();
	const lower = raw.toLowerCase();

	if (raw === "") return null;
	if (lower === "today" || lower === "now") return today();
	if (prop?.type === "checkbox") return lower === "true" || lower === "yes" || lower === "checked";
	if (prop?.type === "number") {
		const n = Number(raw);
		return Number.isFinite(n) ? n : null;
	}
	if (prop?.type === "multiselect" || prop?.type === "person") {
		return raw.split(",").map((part) => part.trim()).filter(Boolean);
	}
	return asText(raw);
}

/**
 * Every rule that fires for one edit, in the order they were written.
 *
 * A rule never triggers another: the writes it causes are applied without
 * re-running the rule list. Two rules both watching Status both fire, which is
 * predictable; a rule firing a rule firing a rule is not, and the loop it can
 * form is not worth the power it buys.
 */
export function firedBy(
	rules: Automation[] | undefined,
	propertyId: string,
	before: unknown,
	after: unknown
): Automation[] {
	return (rules ?? []).filter((rule) => shouldFire(rule, propertyId, before, after));
}
