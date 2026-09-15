import { PropertyDef, DatabaseRow } from "../types";
import { parseDate, toISODate } from "../utils/dates";

/**
 * The formula language.
 *
 * A tokenizer, a Pratt parser and a tree-walking evaluator for Notion-style
 * formulas. There is deliberately no `eval`, no `Function` constructor and no
 * other dynamic code generation anywhere in this file: a formula is data the
 * user types into a property definition, so it must never become code.
 *
 * Everything is failure-tolerant. A half-typed formula is a completely normal
 * state while somebody is editing one, and this runs on Obsidian's UI thread on
 * every render, so the engine never throws and never runs away: it caps the
 * input length, the token count and the nesting depth, and any problem -- a
 * syntax error, an unknown function, a type mismatch, a division by zero --
 * collapses to `null`.
 *
 * Supported syntax:
 *   literals      12, 1.5, "text", 'text', true, false
 *   properties    {Name}            (also matches on property id)
 *                 prop("Name")      (Notion's spelling of the same thing)
 *   operators     + - * / %, unary -, == != > >= < <=,
 *                 and/&&, or/||, not/!, and `+` as string concatenation
 *   functions     see FUNCTIONS below
 */

/** Longest formula we will even look at, in characters. */
export const MAX_FORMULA_LENGTH = 2000;
/** Most tokens a formula may contain. */
export const MAX_FORMULA_TOKENS = 600;
/** Deepest nesting (parentheses, calls, operators) the parser will accept. */
export const MAX_FORMULA_DEPTH = 32;

/** Values flowing through the evaluator. Lists come from multi-selects/rollups. */
type Value = number | string | boolean | null | string[];

/** Anything the engine considers a failure. Never escapes `evaluateFormula`. */
class FormulaError extends Error {}

function fail(message: string): never {
	throw new FormulaError(message);
}

// --- tokenizer -------------------------------------------------------------

type TokenKind = "num" | "str" | "ident" | "prop" | "op";

interface Token {
	kind: TokenKind;
	/** Operator text, identifier name, property name, or the string's contents. */
	text: string;
	num: number;
}

/** Multi-character operators, longest first so `>=` never reads as `>` then `=`. */
const OPERATORS = ["==", "!=", ">=", "<=", "&&", "||", ">", "<", "+", "-", "*", "/", "%", "!", "(", ")", ","];

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'" };

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			i++;
			continue;
		}
		if (tokens.length >= MAX_FORMULA_TOKENS) fail("formula too complex");

		// {Property Name}
		if (ch === "{") {
			const end = src.indexOf("}", i + 1);
			if (end === -1) fail("unterminated property reference");
			tokens.push({ kind: "prop", text: src.slice(i + 1, end).trim(), num: 0 });
			i = end + 1;
			continue;
		}

		// "string" / 'string'
		if (ch === '"' || ch === "'") {
			let out = "";
			let j = i + 1;
			let closed = false;
			while (j < src.length) {
				const c = src[j];
				if (c === "\\" && j + 1 < src.length) {
					const next = src[j + 1];
					out += ESCAPES[next] ?? next;
					j += 2;
					continue;
				}
				if (c === ch) {
					closed = true;
					j++;
					break;
				}
				out += c;
				j++;
			}
			if (!closed) fail("unterminated string");
			tokens.push({ kind: "str", text: out, num: 0 });
			i = j;
			continue;
		}

		// 12 / 1.5 / .5
		if ((ch >= "0" && ch <= "9") || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
			let j = i;
			while (j < src.length && /[0-9]/.test(src[j])) j++;
			if (src[j] === ".") {
				j++;
				while (j < src.length && /[0-9]/.test(src[j])) j++;
			}
			const n = Number(src.slice(i, j));
			if (isNaN(n)) fail("bad number");
			tokens.push({ kind: "num", text: src.slice(i, j), num: n });
			i = j;
			continue;
		}

		// identifier / keyword / function name
		if (/[A-Za-z_]/.test(ch)) {
			let j = i;
			while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
			tokens.push({ kind: "ident", text: src.slice(i, j), num: 0 });
			i = j;
			continue;
		}

		const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
		if (!op) fail(`unexpected character ${ch}`);
		tokens.push({ kind: "op", text: op, num: 0 });
		i += op.length;
	}
	return tokens;
}

// --- parser ----------------------------------------------------------------

type Node =
	| { type: "literal"; value: Value }
	| { type: "prop"; name: string }
	| { type: "unary"; op: string; operand: Node }
	| { type: "binary"; op: string; left: Node; right: Node }
	| { type: "call"; name: string; args: Node[] };

/** Left-binding power of each infix operator. Everything is left-associative. */
const BINARY_PRECEDENCE: Record<string, number> = {
	or: 1,
	"||": 1,
	and: 2,
	"&&": 2,
	"==": 3,
	"!=": 3,
	"<": 4,
	"<=": 4,
	">": 4,
	">=": 4,
	"+": 5,
	"-": 5,
	"*": 6,
	"/": 6,
	"%": 6,
};

const UNARY_PRECEDENCE = 7;

function parse(tokens: Token[]): Node {
	let pos = 0;
	let depth = 0;

	function peek(): Token | null {
		return pos < tokens.length ? tokens[pos] : null;
	}

	function infixOperator(token: Token | null): string | null {
		if (!token) return null;
		if (token.kind === "op" && token.text in BINARY_PRECEDENCE) return token.text;
		if (token.kind === "ident") {
			const word = token.text.toLowerCase();
			if (word === "and" || word === "or") return word;
		}
		return null;
	}

	function parseExpression(minPrecedence: number): Node {
		if (++depth > MAX_FORMULA_DEPTH) fail("formula nested too deeply");
		try {
			let left = parseUnary();
			for (;;) {
				const op = infixOperator(peek());
				if (op === null) break;
				const precedence = BINARY_PRECEDENCE[op];
				if (precedence < minPrecedence) break;
				pos++;
				const right = parseExpression(precedence + 1);
				left = { type: "binary", op, left, right };
			}
			return left;
		} finally {
			depth--;
		}
	}

	function parseUnary(): Node {
		const token = peek();
		if (token && token.kind === "op" && (token.text === "-" || token.text === "!")) {
			pos++;
			return { type: "unary", op: token.text, operand: parseExpression(UNARY_PRECEDENCE) };
		}
		if (token && token.kind === "ident" && token.text.toLowerCase() === "not") {
			pos++;
			return { type: "unary", op: "!", operand: parseExpression(UNARY_PRECEDENCE) };
		}
		return parsePrimary();
	}

	function parsePrimary(): Node {
		if (++depth > MAX_FORMULA_DEPTH) fail("formula nested too deeply");
		try {
			const token = peek();
			if (!token) fail("unexpected end of formula");
			pos++;
			switch (token.kind) {
				case "num":
					return { type: "literal", value: token.num };
				case "str":
					return { type: "literal", value: token.text };
				case "prop":
					return { type: "prop", name: token.text };
				case "ident": {
					const word = token.text.toLowerCase();
					if (word === "true") return { type: "literal", value: true };
					if (word === "false") return { type: "literal", value: false };
					const next = peek();
					if (!next || next.kind !== "op" || next.text !== "(") fail(`unknown name ${token.text}`);
					pos++;
					const args: Node[] = [];
					if (peek()?.text !== ")") {
						for (;;) {
							args.push(parseExpression(1));
							const separator = peek();
							if (separator && separator.kind === "op" && separator.text === ",") {
								pos++;
								continue;
							}
							break;
						}
					}
					const close = peek();
					if (!close || close.kind !== "op" || close.text !== ")") fail("missing )");
					pos++;
					return { type: "call", name: token.text, args };
				}
				default: {
					if (token.text === "(") {
						const inner = parseExpression(1);
						const close = peek();
						if (!close || close.kind !== "op" || close.text !== ")") fail("missing )");
						pos++;
						return inner;
					}
					return fail(`unexpected ${token.text}`);
				}
			}
		} finally {
			depth--;
		}
	}

	const root = parseExpression(1);
	if (pos !== tokens.length) fail("trailing input");
	return root;
}

// --- value helpers ---------------------------------------------------------

function isList(value: Value): value is string[] {
	return Array.isArray(value);
}

function isEmptyValue(value: Value): boolean {
	if (value === null) return true;
	if (isList(value)) return value.length === 0;
	if (typeof value === "string") return value.trim().length === 0;
	return false;
}

/** Everything renders as a string; this is also what `format()` returns. */
function toText(value: Value): string {
	if (value === null) return "";
	if (isList(value)) return value.join(", ");
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") return numberToText(value);
	return value;
}

function numberToText(n: number): string {
	if (!isFinite(n)) return "";
	// Trim the floating-point noise 0.1 + 0.2 style arithmetic leaves behind.
	const rounded = Math.round(n * 1e10) / 1e10;
	return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Numeric coercion for arithmetic. `null` (an empty or missing property) counts
 * as 0, which is what the original arithmetic-only engine did and what keeps
 * `{Missing} + 1` equal to 1. A non-numeric string or a list is an error.
 */
function toNumeric(value: Value): number {
	if (value === null) return 0;
	if (typeof value === "number") {
		if (!isFinite(value)) fail("non-finite number");
		return value;
	}
	if (typeof value === "boolean") return value ? 1 : 0;
	if (isList(value)) fail("cannot use a list as a number");
	const n = parseNumberText(value);
	if (n === null) fail(`not a number: ${value}`);
	return n;
}

/** Lenient string->number used by `toNumber()` and by numeric coercion. */
function parseNumberText(text: string): number | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	const cleaned = trimmed.replace(/[,$%\s]/g, "");
	if (!cleaned) return null;
	const n = Number(cleaned);
	return isNaN(n) || !isFinite(n) ? null : n;
}

/** Truthiness: booleans as themselves, everything else by "is there anything here". */
function toBoolean(value: Value): boolean {
	if (typeof value === "boolean") return value;
	if (value === null) return false;
	if (typeof value === "number") return value !== 0;
	if (isList(value)) return value.length > 0;
	return value.trim().length > 0;
}

// --- dates -----------------------------------------------------------------

const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DATE_TIME_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)/;

/**
 * Parse a formula date. ISO `YYYY-MM-DD` with an optional `THH:mm(:ss)` is
 * handled here so times survive (the shared `parseDate` helper truncates to
 * midnight); anything else falls back to that helper.
 */
function toDate(value: Value): Date | null {
	if (value === null || typeof value === "boolean" || isList(value)) return null;
	if (typeof value === "number") {
		const d = new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}
	const match = DATE_TIME_RE.exec(value.trim());
	if (match) {
		const d = new Date(
			Number(match[1]),
			Number(match[2]) - 1,
			Number(match[3]),
			Number(match[4] ?? 0),
			Number(match[5] ?? 0),
			Number(match[6] ?? 0)
		);
		return isNaN(d.getTime()) ? null : d;
	}
	return parseDate(value);
}

function requireDate(value: Value): Date {
	const d = toDate(value);
	if (!d) fail("not a date");
	return d;
}

/** Did this value carry a time component we should preserve on output? */
function hasTime(value: Value): boolean {
	if (typeof value === "number") return true;
	if (typeof value !== "string") return false;
	const match = DATE_TIME_RE.exec(value.trim());
	return match ? match[4] !== undefined : false;
}

function toISODateTime(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function renderDate(d: Date, withTime: boolean): string {
	return withTime ? toISODateTime(d) : toISODate(d);
}

type DateUnit = "days" | "weeks" | "months" | "years" | "hours" | "minutes";

const DATE_UNITS: DateUnit[] = ["days", "weeks", "months", "years", "hours", "minutes"];

function requireUnit(value: Value): DateUnit {
	const text = toText(value).trim().toLowerCase();
	const unit = DATE_UNITS.find((u) => u === text || u === `${text}s`);
	if (!unit) fail(`unknown date unit ${text}`);
	return unit;
}

/** Whole calendar months from `b` to `a`, truncated towards zero. */
function monthsBetween(a: Date, b: Date): number {
	let months = (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
	const shifted = new Date(b.getTime());
	shifted.setMonth(shifted.getMonth() + months);
	if (months > 0 && shifted.getTime() > a.getTime()) months--;
	if (months < 0 && shifted.getTime() < a.getTime()) months++;
	return months;
}

/**
 * `dateBetween(a, b, unit)` is `a - b`, matching Notion: the first argument is
 * the later date in the common `dateBetween(end, start, "days")` reading, so
 * `dateBetween(today(), yesterday, "days")` is +1 and swapping them gives -1.
 * Partial units are truncated towards zero (not rounded).
 */
function dateBetween(a: Date, b: Date, unit: DateUnit): number {
	if (unit === "months") return monthsBetween(a, b);
	if (unit === "years") return Math.trunc(monthsBetween(a, b) / 12);
	const ms = a.getTime() - b.getTime();
	switch (unit) {
		case "minutes":
			return Math.trunc(ms / 60000);
		case "hours":
			return Math.trunc(ms / 3600000);
		case "weeks":
			return Math.trunc(ms / (7 * 86400000));
		default:
			return Math.trunc(ms / 86400000);
	}
}

function dateShift(d: Date, amount: number, unit: DateUnit): Date {
	const out = new Date(d.getTime());
	switch (unit) {
		case "minutes":
			out.setMinutes(out.getMinutes() + amount);
			break;
		case "hours":
			out.setHours(out.getHours() + amount);
			break;
		case "days":
			out.setDate(out.getDate() + amount);
			break;
		case "weeks":
			out.setDate(out.getDate() + amount * 7);
			break;
		case "months":
			out.setMonth(out.getMonth() + amount);
			break;
		case "years":
			out.setFullYear(out.getFullYear() + amount);
			break;
	}
	if (isNaN(out.getTime())) fail("date out of range");
	return out;
}

const DATE_TOKEN_RE = /YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|mm|ss/g;

function formatDateWith(d: Date, pattern: string): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return pattern.replace(DATE_TOKEN_RE, (token) => {
		switch (token) {
			case "YYYY":
				return String(d.getFullYear());
			case "YY":
				return pad(d.getFullYear() % 100);
			case "MMMM":
				return MONTH_NAMES[d.getMonth()];
			case "MMM":
				return MONTH_NAMES[d.getMonth()].slice(0, 3);
			case "MM":
				return pad(d.getMonth() + 1);
			case "M":
				return String(d.getMonth() + 1);
			case "dddd":
				return DAY_NAMES[d.getDay()];
			case "ddd":
				return DAY_NAMES[d.getDay()].slice(0, 3);
			case "DD":
				return pad(d.getDate());
			case "D":
				return String(d.getDate());
			case "HH":
				return pad(d.getHours());
			case "mm":
				return pad(d.getMinutes());
			case "ss":
				return pad(d.getSeconds());
			default:
				return token;
		}
	});
}

// --- operators -------------------------------------------------------------

function applyBinary(op: string, left: Value, right: Value): Value {
	switch (op) {
		case "+":
			// `+` doubles as string concatenation, as it does in Notion.
			if (typeof left === "string" || typeof right === "string") return toText(left) + toText(right);
			return toNumeric(left) + toNumeric(right);
		case "-":
			return toNumeric(left) - toNumeric(right);
		case "*":
			return toNumeric(left) * toNumeric(right);
		case "/": {
			const divisor = toNumeric(right);
			if (divisor === 0) fail("division by zero");
			return toNumeric(left) / divisor;
		}
		case "%": {
			const divisor = toNumeric(right);
			if (divisor === 0) fail("division by zero");
			return toNumeric(left) % divisor;
		}
		case "==":
			return valuesEqual(left, right);
		case "!=":
			return !valuesEqual(left, right);
		case "<":
		case "<=":
		case ">":
		case ">=":
			return compare(op, left, right);
		default:
			return fail(`unknown operator ${op}`);
	}
}

function valuesEqual(a: Value, b: Value): boolean {
	if (a === null || b === null) return isEmptyValue(a) && isEmptyValue(b);
	if (isList(a) || isList(b)) {
		if (!isList(a) || !isList(b)) return false;
		return a.length === b.length && a.every((item, index) => item === b[index]);
	}
	if (typeof a === typeof b) return a === b;
	if (typeof a === "boolean" || typeof b === "boolean") return toBoolean(a) === toBoolean(b);
	// number vs string: compare numerically when the string is a number, else textually.
	const na = typeof a === "number" ? a : parseNumberText(a);
	const nb = typeof b === "number" ? b : parseNumberText(b);
	if (na !== null && nb !== null) return na === nb;
	return toText(a) === toText(b);
}

function compare(op: string, a: Value, b: Value): boolean {
	let ordering: number;
	if (typeof a === "string" && typeof b === "string") {
		const na = parseNumberText(a);
		const nb = parseNumberText(b);
		// Two numeric-looking strings compare numerically; otherwise lexically,
		// which is also the right answer for ISO dates.
		ordering = na !== null && nb !== null ? na - nb : a < b ? -1 : a > b ? 1 : 0;
	} else {
		ordering = toNumeric(a) - toNumeric(b);
	}
	switch (op) {
		case "<":
			return ordering < 0;
		case "<=":
			return ordering <= 0;
		case ">":
			return ordering > 0;
		default:
			return ordering >= 0;
	}
}

// --- functions -------------------------------------------------------------

interface FunctionDef {
	/** Minimum and maximum argument counts; `max: Infinity` means variadic. */
	min: number;
	max: number;
	call: (args: Value[]) => Value;
}

function numericArg(value: Value): number {
	if (value === null) fail("missing number");
	return toNumeric(value);
}

const FUNCTIONS: Record<string, FunctionDef> = {
	empty: { min: 1, max: 1, call: (a) => isEmptyValue(a[0]) },
	notempty: { min: 1, max: 1, call: (a) => !isEmptyValue(a[0]) },
	contains: {
		min: 2,
		max: 2,
		call: (a) => {
			const [haystack, needle] = a;
			if (isList(haystack)) return haystack.includes(toText(needle));
			if (haystack === null) return false;
			return toText(haystack).includes(toText(needle));
		},
	},
	length: {
		min: 1,
		max: 1,
		call: (a) => (isList(a[0]) ? a[0].length : toText(a[0]).length),
	},
	lower: { min: 1, max: 1, call: (a) => toText(a[0]).toLowerCase() },
	upper: { min: 1, max: 1, call: (a) => toText(a[0]).toUpperCase() },
	slice: {
		min: 2,
		max: 3,
		call: (a) => {
			const text = toText(a[0]);
			const start = Math.trunc(numericArg(a[1]));
			if (a.length < 3 || a[2] === null) return text.slice(start);
			return text.slice(start, Math.trunc(numericArg(a[2])));
		},
	},
	replaceall: {
		min: 3,
		max: 3,
		call: (a) => {
			// Literal replacement, NOT a regular expression: `replaceAll(s, ".", "-")`
			// replaces full stops, not every character. Notion's version takes a
			// regex; this one deliberately does not, so user text is never a pattern.
			const text = toText(a[0]);
			const find = toText(a[1]);
			if (find === "") return text;
			return text.split(find).join(toText(a[2]));
		},
	},
	format: { min: 1, max: 1, call: (a) => toText(a[0]) },
	tonumber: {
		min: 1,
		max: 1,
		call: (a) => {
			const value = a[0];
			if (value === null || isList(value)) return null;
			if (typeof value === "number") return value;
			if (typeof value === "boolean") return value ? 1 : 0;
			return parseNumberText(value);
		},
	},
	min: { min: 1, max: Infinity, call: (a) => pickExtreme(a, true) },
	max: { min: 1, max: Infinity, call: (a) => pickExtreme(a, false) },
	abs: { min: 1, max: 1, call: (a) => Math.abs(numericArg(a[0])) },
	round: { min: 1, max: 1, call: (a) => Math.round(numericArg(a[0])) },
	floor: { min: 1, max: 1, call: (a) => Math.floor(numericArg(a[0])) },
	ceil: { min: 1, max: 1, call: (a) => Math.ceil(numericArg(a[0])) },
	now: { min: 0, max: 0, call: () => toISODateTime(new Date()) },
	today: { min: 0, max: 0, call: () => toISODate(new Date()) },
	datebetween: {
		min: 3,
		max: 3,
		call: (a) => dateBetween(requireDate(a[0]), requireDate(a[1]), requireUnit(a[2])),
	},
	dateadd: {
		min: 3,
		max: 3,
		call: (a) => {
			const unit = requireUnit(a[2]);
			const shifted = dateShift(requireDate(a[0]), Math.trunc(numericArg(a[1])), unit);
			return renderDate(shifted, hasTime(a[0]) || unit === "hours" || unit === "minutes");
		},
	},
	datesubtract: {
		min: 3,
		max: 3,
		call: (a) => {
			const unit = requireUnit(a[2]);
			const shifted = dateShift(requireDate(a[0]), -Math.trunc(numericArg(a[1])), unit);
			return renderDate(shifted, hasTime(a[0]) || unit === "hours" || unit === "minutes");
		},
	},
	formatdate: { min: 2, max: 2, call: (a) => formatDateWith(requireDate(a[0]), toText(a[1])) },
};

function pickExtreme(args: Value[], wantMin: boolean): Value {
	let best: number | null = null;
	for (const arg of args) {
		if (arg === null) continue;
		const n = toNumeric(arg);
		if (best === null || (wantMin ? n < best : n > best)) best = n;
	}
	return best;
}

// --- evaluator -------------------------------------------------------------

interface Context {
	row: DatabaseRow;
	properties: PropertyDef[];
}

/** `{Name}` / `prop("Name")`: match by name first, then id, then case-insensitively. */
function lookupProperty(name: string, context: Context): Value {
	const wanted = name.trim();
	const lowered = wanted.toLowerCase();
	const properties = context.properties;
	const prop =
		properties.find((p) => p.name === wanted) ??
		properties.find((p) => p.id === wanted) ??
		properties.find((p) => p.name.toLowerCase() === lowered) ??
		properties.find((p) => p.id.toLowerCase() === lowered);
	if (!prop) return null;
	return normalizeStoredValue(context.row.values[prop.id]);
}

/** Row values are already coerced, but frontmatter is hand-edited: stay defensive. */
function normalizeStoredValue(raw: unknown): Value {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "number") return isFinite(raw) ? raw : null;
	if (typeof raw === "string" || typeof raw === "boolean") return raw;
	if (raw instanceof Date) return isNaN(raw.getTime()) ? null : toISODate(raw);
	if (Array.isArray(raw)) return raw.map((item) => (item === null || item === undefined ? "" : String(item)));
	return null;
}

function evaluate(node: Node, context: Context): Value {
	switch (node.type) {
		case "literal":
			return node.value;
		case "prop":
			return lookupProperty(node.name, context);
		case "unary": {
			if (node.op === "!") return !toBoolean(evaluate(node.operand, context));
			return -toNumeric(evaluate(node.operand, context));
		}
		case "binary": {
			// `and`/`or` short-circuit, so the unused side is never evaluated
			// (and never reports a type error).
			if (node.op === "and" || node.op === "&&") {
				return toBoolean(evaluate(node.left, context)) ? toBoolean(evaluate(node.right, context)) : false;
			}
			if (node.op === "or" || node.op === "||") {
				return toBoolean(evaluate(node.left, context)) ? true : toBoolean(evaluate(node.right, context));
			}
			return applyBinary(node.op, evaluate(node.left, context), evaluate(node.right, context));
		}
		case "call": {
			const name = node.name.toLowerCase();
			if (name === "if") {
				if (node.args.length !== 3) fail("if() takes 3 arguments");
				return toBoolean(evaluate(node.args[0], context))
					? evaluate(node.args[1], context)
					: evaluate(node.args[2], context);
			}
			if (name === "prop") {
				if (node.args.length !== 1) fail("prop() takes 1 argument");
				const arg = node.args[0];
				if (arg.type !== "literal" || typeof arg.value !== "string") {
					fail("prop() needs a literal property name");
				}
				return lookupProperty(arg.value, context);
			}
			const fn = FUNCTIONS[name];
			if (!fn) fail(`unknown function ${node.name}`);
			if (node.args.length < fn.min || node.args.length > fn.max) {
				fail(`${node.name}() got ${node.args.length} arguments`);
			}
			return fn.call(node.args.map((arg) => evaluate(arg, context)));
		}
	}
}

// --- entry point -----------------------------------------------------------

/**
 * Evaluate `expression` against one row. Returns `null` for anything that does
 * not produce a usable value: a syntax error, an unknown function, a type
 * mismatch, a division by zero, or input that busts the size/depth caps.
 */
export function runFormula(
	expression: string,
	row: DatabaseRow,
	properties: PropertyDef[]
): number | string | boolean | null {
	if (typeof expression !== "string") return null;
	const source = expression.trim();
	if (source.length === 0) return null;
	if (source.length > MAX_FORMULA_LENGTH) return null;
	try {
		const result = evaluate(parse(tokenize(source)), { row, properties });
		if (result === null) return null;
		if (isList(result)) return result.join(", ");
		if (typeof result === "number") {
			if (!isFinite(result)) return null;
			// Keep the old engine's 4-decimal tidy-up so 1/3 stays readable,
			// but never at a magnitude where the rounding trick loses precision.
			return Math.abs(result) < 1e15 ? Math.round(result * 10000) / 10000 : result;
		}
		return result;
	} catch {
		// Includes FormulaError and any RangeError a hostile input might provoke.
		return null;
	}
}
