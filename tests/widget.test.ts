import assert from "node:assert/strict";
import test from "node:test";

import {
	ButtonWidget,
	CountdownWidget,
	ListWidget,
	MetricWidget,
	ProgressWidget,
	buildWidgetConfig,
	countdownDays,
	formatFigure,
	isPercentAggregate,
	parseWidgetBlock,
	pickCountdownDate,
	progressPercent,
} from "../src/widgets/widget";

/** The single widget a block parsed to, or a failure with the parser's reason. */
function only(source: string) {
	const { config, error } = parseWidgetBlock(source);
	assert.ok(config, `expected a config, got: ${error ?? "nothing"}`);
	assert.equal(config.widgets.length, 1);
	return config.widgets[0];
}

function failure(source: string): string {
	const { config, error } = parseWidgetBlock(source);
	assert.equal(config, null, "expected this block to be rejected");
	assert.ok(error && error.length > 0, "expected an explanation");
	return error;
}

// --- metric ----------------------------------------------------------------

test("metric blocks read their aggregate, filter and affixes", () => {
	const widget = only(
		[
			"widget: metric",
			"database: Tasks",
			"value: Points",
			"aggregate: sum",
			"filter: Status is Done",
			"label: Points shipped",
			"suffix: pts",
		].join("\n")
	) as MetricWidget;

	assert.equal(widget.kind, "metric");
	assert.equal(widget.database, "Tasks");
	assert.equal(widget.value, "Points");
	assert.equal(widget.aggregate, "sum");
	assert.equal(widget.label, "Points shipped");
	assert.equal(widget.suffix, "pts");
	assert.deepEqual(widget.filter, {
		conjunction: "and",
		rules: [{ property: "Status", operator: "is", value: "Done" }],
	});
});

test("metric defaults to counting every row", () => {
	const widget = only("widget: metric\ndatabase: Tasks") as MetricWidget;
	assert.equal(widget.aggregate, "count_all");
	assert.equal(widget.value, undefined);
	assert.equal(widget.filter, undefined);
});

test("metric aggregates are spelled out, and spaces are tolerated", () => {
	const widget = only("widget: metric\ndatabase: Tasks\naggregate: count unique") as MetricWidget;
	assert.equal(widget.aggregate, "count_unique");
});

test("an unknown aggregate is explained rather than silently ignored", () => {
	const error = failure("widget: metric\ndatabase: Tasks\naggregate: mode");
	assert.match(error, /mode/);
	assert.match(error, /count_all/);
});

test("a metric without a database says so", () => {
	assert.match(failure("widget: metric\nvalue: Points"), /database/);
});

// --- progress --------------------------------------------------------------

test("progress blocks take a done filter and an optional denominator", () => {
	const widget = only(
		[
			"widget: progress",
			"database: Tasks",
			"filter: Status is Done",
			"total_filter: Sprint is 12",
			"label: Sprint 12",
		].join("\n")
	) as ProgressWidget;

	assert.equal(widget.kind, "progress");
	assert.equal(widget.label, "Sprint 12");
	assert.deepEqual(widget.filter?.rules, [
		{ property: "Status", operator: "is", value: "Done" },
	]);
	assert.deepEqual(widget.totalFilter?.rules, [
		{ property: "Sprint", operator: "is", value: 12 },
	]);
});

test("progress without a total filter measures every row", () => {
	const widget = only("widget: progress\ndatabase: Tasks\nfilter: Done? is true") as ProgressWidget;
	assert.equal(widget.totalFilter, undefined);
});

test("progress insists on knowing what counts as done", () => {
	assert.match(failure("widget: progress\ndatabase: Tasks"), /filter/);
});

// --- countdown -------------------------------------------------------------

test("a countdown to a literal date normalises the date", () => {
	const widget = only("widget: countdown\ndate: 2026-12-25\nlabel: Christmas") as CountdownWidget;
	assert.equal(widget.date, "2026-12-25");
	assert.equal(widget.database, undefined);
	assert.equal(widget.label, "Christmas");
});

test("a countdown can read the soonest date out of a database", () => {
	const widget = only(
		[
			"widget: countdown",
			"database: Launches",
			"date_property: Ship date",
			"filter: Status is not Shipped",
		].join("\n")
	) as CountdownWidget;

	assert.equal(widget.database, "Launches");
	assert.equal(widget.dateProperty, "Ship date");
	assert.deepEqual(widget.filter?.rules, [
		{ property: "Status", operator: "is_not", value: "Shipped" },
	]);
});

test("a countdown with neither a date nor a database is rejected", () => {
	assert.match(failure("widget: countdown\nlabel: Someday"), /date/);
});

test("a countdown on a database still needs the date property", () => {
	assert.match(failure("widget: countdown\ndatabase: Launches"), /date_property/);
});

test("an unreadable date literal is explained", () => {
	assert.match(failure("widget: countdown\ndate: next tuesday"), /date/i);
});

// --- list ------------------------------------------------------------------

test("list blocks default to five rows", () => {
	const widget = only("widget: list\ndatabase: Tasks") as ListWidget;
	assert.equal(widget.limit, 5);
	assert.equal(widget.sorts, undefined);
});

test("list blocks take a sort, a limit and a property to show", () => {
	const widget = only(
		["widget: list", "database: Tasks", "sort: -Due", "limit: 3", "show: Due"].join("\n")
	) as ListWidget;

	assert.equal(widget.limit, 3);
	assert.equal(widget.show, "Due");
	assert.deepEqual(widget.sorts, [{ property: "Due", direction: "desc" }]);
});

test("a nonsense limit is rejected rather than rounded away", () => {
	assert.match(failure("widget: list\ndatabase: Tasks\nlimit: soon"), /limit/);
	assert.match(failure("widget: list\ndatabase: Tasks\nlimit: 0"), /limit/);
});

// --- button ----------------------------------------------------------------

test("button blocks carry the values they will set", () => {
	const { config, error } = buildWidgetConfig({
		widget: "button",
		database: "Tasks",
		label: "Log a task",
		name: "New task",
		set: { Status: "Not started", Points: 1 },
	});

	assert.ok(config, error);
	const widget = config.widgets[0] as ButtonWidget;
	assert.equal(widget.kind, "button");
	assert.equal(widget.label, "Log a task");
	assert.equal(widget.rowName, "New task");
	assert.deepEqual(widget.set, { Status: "Not started", Points: 1 });
});

test("a button with no set: still works, and gets a default label", () => {
	const { config } = buildWidgetConfig({ widget: "button", database: "Tasks" });
	const widget = config?.widgets[0] as ButtonWidget;
	assert.equal(widget.label, "New item");
	assert.deepEqual(widget.set, {});
});

test("a set: that is not a map is explained", () => {
	const { config, error } = buildWidgetConfig({
		widget: "button",
		database: "Tasks",
		set: ["Status: Done"],
	});
	assert.equal(config, null);
	assert.match(error ?? "", /set/);
});

// --- block-level shapes ----------------------------------------------------

test("a block with no widget: lists the kinds available", () => {
	const error = failure("database: Tasks");
	assert.match(error, /widget/);
	assert.match(error, /countdown/);
});

test("an unknown widget kind is explained", () => {
	assert.match(failure("widget: sparkline\ndatabase: Tasks"), /sparkline/);
});

test("malformed YAML never throws", () => {
	assert.doesNotThrow(() => parseWidgetBlock("\t: : :"));
	assert.doesNotThrow(() => parseWidgetBlock(""));
	assert.equal(parseWidgetBlock("").config, null);
});

test("a widgets: list renders several cards from one block", () => {
	const { config, error } = buildWidgetConfig({
		widgets: [
			{ widget: "metric", database: "Tasks", aggregate: "count_all", label: "Open" },
			{ widget: "progress", database: "Tasks", filter: "Status is Done" },
			{ widget: "countdown", date: "2026-01-01" },
		],
	});

	assert.ok(config, error);
	assert.deepEqual(
		config.widgets.map((w) => w.kind),
		["metric", "progress", "countdown"]
	);
	assert.equal((config.widgets[0] as MetricWidget).label, "Open");
});

test("a bad entry in a widgets: list names the entry that is wrong", () => {
	const { config, error } = buildWidgetConfig({
		widgets: [{ widget: "metric", database: "Tasks" }, { widget: "metric" }],
	});
	assert.equal(config, null);
	assert.match(error ?? "", /Widget 2/);
	assert.match(error ?? "", /database/);
});

test("widgets: must be a non-empty list", () => {
	assert.equal(buildWidgetConfig({ widgets: "metric" }).config, null);
	assert.match(buildWidgetConfig({ widgets: [] }).error ?? "", /empty/);
});

// --- pure computation ------------------------------------------------------

const noon = (iso: string): Date => {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d, 12, 0, 0);
};

test("countdown day maths reads across past, present and future", () => {
	const now = new Date(2026, 4, 10, 9, 30);
	assert.equal(countdownDays(noon("2026-05-10"), now), 0);
	assert.equal(countdownDays(noon("2026-05-11"), now), 1);
	assert.equal(countdownDays(noon("2026-05-17"), now), 7);
	assert.equal(countdownDays(noon("2026-05-09"), now), -1);
	assert.equal(countdownDays(noon("2026-04-10"), now), -30);
});

test("countdown day maths ignores the time of day", () => {
	const target = new Date(2026, 4, 11, 0, 1);
	assert.equal(countdownDays(target, new Date(2026, 4, 10, 23, 59)), 1);
	assert.equal(countdownDays(target, new Date(2026, 4, 10, 0, 1)), 1);
});

test("countdown day maths survives a daylight-saving boundary", () => {
	// Late March and late October are where a naive millisecond division
	// drifts by an hour and rounds to the wrong day.
	assert.equal(countdownDays(noon("2026-03-30"), noon("2026-03-27")), 3);
	assert.equal(countdownDays(noon("2026-10-28"), noon("2026-10-24")), 4);
});

test("a countdown picks the soonest date that has not passed", () => {
	const now = new Date(2026, 4, 10);
	const dates = [noon("2026-04-01"), noon("2026-05-20"), noon("2026-06-01")];
	assert.equal(pickCountdownDate(dates, now)?.getMonth(), 4);
	assert.equal(pickCountdownDate(dates, now)?.getDate(), 20);
});

test("a countdown counts today as upcoming, not past", () => {
	const now = new Date(2026, 4, 10, 18, 0);
	const picked = pickCountdownDate([noon("2026-05-10"), noon("2026-05-12")], now);
	assert.equal(countdownDays(picked as Date, now), 0);
});

test("with every date behind us a countdown falls back to the most recent", () => {
	const now = new Date(2026, 4, 10);
	const picked = pickCountdownDate([noon("2026-01-01"), noon("2026-04-30")], now);
	assert.equal(countdownDays(picked as Date, now), -10);
});

test("a countdown with no dates at all has no target", () => {
	assert.equal(pickCountdownDate([], new Date()), null);
});

test("progress percentages round, clamp and survive a zero denominator", () => {
	assert.equal(progressPercent(0, 0), 0);
	assert.equal(progressPercent(3, 0), 0);
	assert.equal(progressPercent(1, 3), 33.33);
	assert.equal(progressPercent(2, 4), 50);
	assert.equal(progressPercent(4, 4), 100);
	// A done-filter wider than the denominator cannot push the bar past full.
	assert.equal(progressPercent(9, 4), 100);
	assert.equal(progressPercent(-1, 4), 0);
});

test("figures fall back to a dash rather than printing null", () => {
	assert.equal(formatFigure(null), "—");
	assert.equal(formatFigure(undefined), "—");
	assert.equal(formatFigure(Number.NaN), "—");
	assert.equal(formatFigure([]), "—");
	assert.equal(formatFigure(12.345), "12.35");
	assert.equal(formatFigure("2026-01-01"), "2026-01-01");
	assert.equal(formatFigure(["Alpha", "Bravo"]), "Alpha, Bravo");
	assert.equal(formatFigure(true), "Yes");
});

test("percentage aggregates are the ones that get a % sign", () => {
	assert.equal(isPercentAggregate("percent_checked"), true);
	assert.equal(isPercentAggregate("percent_not_empty"), true);
	assert.equal(isPercentAggregate("sum"), false);
	assert.equal(isPercentAggregate("count_all"), false);
});
