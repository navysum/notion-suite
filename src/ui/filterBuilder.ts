import { setIcon } from "obsidian";
import {
	DatabaseSchema,
	FilterGroup,
	FilterOperator,
	FilterRule,
	PropertyDef,
	SortRule,
	isFilterGroup,
} from "../types";
import { filterToText, parseFilterLines, parseSortShorthand } from "../views/config";
import { asText } from "../utils/text";

/**
 * Build a filter by clicking, not by typing.
 *
 * Every other setting in this plugin became a dropdown a long time ago; filters
 * stayed a textarea of English sentences, which meant the one setting people
 * touch most was the one that asked them to remember a syntax. A condition is
 * three choices -- which property, which test, which value -- so it should be
 * three controls.
 *
 * The typed form is still underneath, and still the storage format: the builder
 * reads it on open and writes it on every change, so a filter written by hand
 * opens in the builder and a filter built here can be read by hand. Nesting is
 * the one thing the rows cannot express; a filter with brackets in it hands over
 * to the text box rather than silently flattening what someone wrote.
 */

/** Which tests make sense for a property, in the order they should be offered. */
const OPERATORS_FOR: Record<string, FilterOperator[]> = {
	text: ["is", "is_not", "contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
	number: ["is", "is_not", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty"],
	select: ["is", "is_not", "is_empty", "is_not_empty"],
	status: ["is", "is_not", "is_empty", "is_not_empty"],
	multiselect: ["contains", "not_contains", "is_empty", "is_not_empty"],
	date: ["is", "is_not", "before", "after", "on_or_before", "on_or_after", "is_empty", "is_not_empty"],
	checkbox: ["is"],
	person: ["contains", "not_contains", "is_empty", "is_not_empty"],
	relation: ["contains", "not_contains", "is_empty", "is_not_empty"],
};

const OPERATOR_LABELS: Record<FilterOperator, string> = {
	is: "is",
	is_not: "is not",
	contains: "contains",
	not_contains: "does not contain",
	starts_with: "starts with",
	ends_with: "ends with",
	is_empty: "is empty",
	is_not_empty: "is not empty",
	gt: "is greater than",
	gte: "is at least",
	lt: "is less than",
	lte: "is at most",
	before: "is before",
	after: "is after",
	on_or_before: "is on or before",
	on_or_after: "is on or after",
};

/** Operators that are complete on their own, with nothing to compare against. */
const NO_VALUE: FilterOperator[] = ["is_empty", "is_not_empty"];

function operatorsFor(prop: PropertyDef | undefined): FilterOperator[] {
	if (!prop) return OPERATORS_FOR.text;
	return OPERATORS_FOR[prop.type] ?? OPERATORS_FOR.text;
}

/** Properties a filter can sensibly test. Derived values are fair game; they read fine. */
function filterable(schema: DatabaseSchema): PropertyDef[] {
	return schema.properties.filter((p) => !p.hidden);
}

export class FilterBuilder {
	private group: FilterGroup;
	private nested: boolean;
	private rowsEl: HTMLElement | null = null;

	constructor(
		private container: HTMLElement,
		private schema: DatabaseSchema,
		initial: string,
		private onChange: (text: string) => void
	) {
		const parsed = parseFilterLines(initial);
		this.group = parsed ?? { conjunction: "and", rules: [] };
		this.nested = this.group.rules.some((node) => isFilterGroup(node));
		this.draw();
	}

	private emit(): void {
		this.onChange(filterToText(this.group.rules.length > 0 ? this.group : undefined));
	}

	private draw(): void {
		this.container.empty();
		this.container.addClass("nfo-filter-builder");

		if (this.nested) {
			this.drawNestedNotice();
			return;
		}

		this.drawConjunction();
		this.rowsEl = this.container.createDiv({ cls: "nfo-filter-rows" });
		this.drawRows();

		const add = this.container.createDiv({ cls: "nfo-filter-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "Add a condition" });
		add.addEventListener("click", () => {
			const first = filterable(this.schema)[0];
			if (!first) return;
			this.group.rules.push({
				property: first.name,
				operator: operatorsFor(first)[0],
				value: defaultValueFor(first),
			});
			this.drawRows();
			this.emit();
		});
	}

	/**
	 * A bracketed filter cannot be shown as a flat list of rows without changing
	 * what it means, so it is handed to the text box intact rather than quietly
	 * rewritten.
	 */
	private drawNestedNotice(): void {
		const note = this.container.createDiv({ cls: "nfo-filter-nested" });
		note.createSpan({
			text: "This filter has brackets in it, so it is edited as text.",
		});
		const flatten = note.createSpan({ cls: "nfo-filter-link", text: "Start again with rows" });
		flatten.addEventListener("click", () => {
			this.group = { conjunction: "and", rules: [] };
			this.nested = false;
			this.draw();
			this.emit();
		});

		const area = this.container.createEl("textarea", { cls: "nfo-filter-text" });
		area.value = filterToText(this.group);
		area.rows = 4;
		area.addEventListener("input", () => {
			const parsed = parseFilterLines(area.value);
			this.group = parsed ?? { conjunction: "and", rules: [] };
			this.onChange(area.value);
		});
	}

	private drawConjunction(): void {
		const bar = this.container.createDiv({ cls: "nfo-filter-conj" });
		bar.createSpan({ cls: "nfo-filter-conj-label", text: "Show rows where" });
		for (const [value, label] of [
			["and", "all"],
			["or", "any"],
		] as const) {
			const btn = bar.createSpan({ cls: "nfo-filter-conj-btn", text: label });
			btn.toggleClass("nfo-filter-conj-on", this.group.conjunction === value);
			btn.addEventListener("click", () => {
				this.group.conjunction = value;
				this.draw();
				this.emit();
			});
		}
		bar.createSpan({ cls: "nfo-filter-conj-label", text: "of these match:" });
	}

	private drawRows(): void {
		const host = this.rowsEl;
		if (!host) return;
		host.empty();

		if (this.group.rules.length === 0) {
			host.createDiv({ cls: "nfo-filter-empty", text: "No conditions — every row is shown." });
			return;
		}

		this.group.rules.forEach((node, index) => {
			if (isFilterGroup(node)) return;
			this.drawRow(host, node, index);
		});
	}

	private drawRow(host: HTMLElement, rule: FilterRule, index: number): void {
		const line = host.createDiv({ cls: "nfo-filter-row" });
		const props = filterable(this.schema);
		const current = findProp(this.schema, rule.property);

		const propSel = line.createEl("select", { cls: "nfo-filter-prop" });
		for (const prop of props) {
			const option = propSel.createEl("option", { text: prop.name });
			option.value = prop.name;
		}
		propSel.value = current?.name ?? rule.property;
		propSel.addEventListener("change", () => {
			const next = findProp(this.schema, propSel.value);
			rule.property = propSel.value;
			// The old test may be meaningless for the new type -- "starts with"
			// on a checkbox -- so fall back to that type's first operator.
			if (!operatorsFor(next).includes(rule.operator)) {
				rule.operator = operatorsFor(next)[0];
			}
			rule.value = defaultValueFor(next);
			this.drawRows();
			this.emit();
		});

		const opSel = line.createEl("select", { cls: "nfo-filter-op" });
		for (const op of operatorsFor(current)) {
			const option = opSel.createEl("option", { text: OPERATOR_LABELS[op] });
			option.value = op;
		}
		opSel.value = rule.operator;
		opSel.addEventListener("change", () => {
			rule.operator = opSel.value as FilterOperator;
			if (NO_VALUE.includes(rule.operator)) delete rule.value;
			else if (rule.value === undefined) rule.value = defaultValueFor(current);
			this.drawRows();
			this.emit();
		});

		if (!NO_VALUE.includes(rule.operator)) {
			this.drawValue(line, rule, current);
		}

		const remove = line.createSpan({ cls: "nfo-filter-remove" });
		setIcon(remove, "x");
		remove.setAttribute("aria-label", "Remove this condition");
		remove.addEventListener("click", () => {
			this.group.rules.splice(index, 1);
			this.drawRows();
			this.emit();
		});
	}

	/** The value control follows the property's type, so there is nothing to recall. */
	private drawValue(line: HTMLElement, rule: FilterRule, prop: PropertyDef | undefined): void {
		const type = prop?.type;

		if (type === "checkbox") {
			const sel = line.createEl("select", { cls: "nfo-filter-value" });
			for (const [value, label] of [
				["true", "checked"],
				["false", "unchecked"],
			] as const) {
				const option = sel.createEl("option", { text: label });
				option.value = value;
			}
			sel.value = String(rule.value === true || rule.value === "true");
			sel.addEventListener("change", () => {
				rule.value = sel.value === "true";
				this.emit();
			});
			return;
		}

		if ((type === "select" || type === "status") && prop?.options?.length) {
			const sel = line.createEl("select", { cls: "nfo-filter-value" });
			for (const option of prop.options) {
				const el = sel.createEl("option", { text: option.name });
				el.value = option.name;
			}
			sel.value = asText(rule.value) || prop.options[0].name;
			sel.addEventListener("change", () => {
				rule.value = sel.value;
				this.emit();
			});
			return;
		}

		const input = line.createEl("input", { cls: "nfo-filter-value" });
		input.type = type === "number" ? "number" : type === "date" ? "date" : "text";
		input.value = asText(rule.value);
		if (type === "date") input.placeholder = "today";
		input.addEventListener("input", () => {
			rule.value = type === "number" ? Number(input.value) : input.value;
			this.emit();
		});
	}
}

function findProp(schema: DatabaseSchema, name: string): PropertyDef | undefined {
	const needle = name.trim().toLowerCase();
	return schema.properties.find(
		(p) => p.name.toLowerCase() === needle || p.id.toLowerCase() === needle
	);
}

function defaultValueFor(prop: PropertyDef | undefined): string | number | boolean | undefined {
	if (!prop) return "";
	if (prop.type === "checkbox") return true;
	if (prop.type === "number") return 0;
	if ((prop.type === "select" || prop.type === "status") && prop.options?.length) {
		return prop.options[0].name;
	}
	return "";
}

/**
 * The same idea for sorting: which property, and which way round.
 */
export class SortBuilder {
	private sorts: SortRule[];

	constructor(
		private container: HTMLElement,
		private schema: DatabaseSchema,
		initial: string,
		private onChange: (text: string) => void
	) {
		this.sorts = initial
			.split("\n")
			.map((line) => parseSortShorthand(line))
			.filter((rule): rule is SortRule => rule !== null);
		this.draw();
	}

	private emit(): void {
		this.onChange(
			this.sorts
				.map((rule) => `${rule.property}${rule.direction === "desc" ? " desc" : " asc"}`)
				.join("\n")
		);
	}

	private draw(): void {
		this.container.empty();
		this.container.addClass("nfo-filter-builder");

		const rows = this.container.createDiv({ cls: "nfo-filter-rows" });
		if (this.sorts.length === 0) {
			rows.createDiv({ cls: "nfo-filter-empty", text: "No sort — rows stay in file order." });
		}

		this.sorts.forEach((rule, index) => {
			const line = rows.createDiv({ cls: "nfo-filter-row" });

			const propSel = line.createEl("select", { cls: "nfo-filter-prop" });
			for (const prop of filterable(this.schema)) {
				const option = propSel.createEl("option", { text: prop.name });
				option.value = prop.name;
			}
			propSel.value = rule.property;
			propSel.addEventListener("change", () => {
				rule.property = propSel.value;
				this.emit();
			});

			const dirSel = line.createEl("select", { cls: "nfo-filter-op" });
			for (const [value, label] of [
				["asc", "A → Z / oldest first"],
				["desc", "Z → A / newest first"],
			] as const) {
				const option = dirSel.createEl("option", { text: label });
				option.value = value;
			}
			dirSel.value = rule.direction;
			dirSel.addEventListener("change", () => {
				rule.direction = dirSel.value as "asc" | "desc";
				this.emit();
			});

			const remove = line.createSpan({ cls: "nfo-filter-remove" });
			setIcon(remove, "x");
			remove.setAttribute("aria-label", "Remove this sort");
			remove.addEventListener("click", () => {
				this.sorts.splice(index, 1);
				this.draw();
				this.emit();
			});
		});

		const add = this.container.createDiv({ cls: "nfo-filter-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: this.sorts.length === 0 ? "Sort by a property" : "Then sort by" });
		add.addEventListener("click", () => {
			const first = filterable(this.schema)[0];
			if (!first) return;
			this.sorts.push({ property: first.name, direction: "asc" });
			this.draw();
			this.emit();
		});
	}
}
