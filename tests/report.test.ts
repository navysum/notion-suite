/**
 * A way to tell us something is wrong.
 *
 * Three hundred people installed this and not one filed anything, which is not
 * evidence that nothing is broken: the collapsed table had been shipping for
 * eight releases before it was found, and it was found by looking rather than
 * by being told.
 *
 * The part worth testing is the line that makes a report actionable rather
 * than a riddle — the versions nobody can be expected to go and look up.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { environmentLine } from "../src/ui/report";

const app = (appVersion?: string) => ({ appVersion }) as never;

test("the line names both versions", () => {
	const line = environmentLine(app("1.13.7"), "1.8.0");
	assert.match(line, /Notion Suite 1\.8\.0/);
	assert.match(line, /Obsidian 1\.13\.7/);
});

/** A missing version must not produce "Obsidian undefined". */
test("an unknown Obsidian version says so rather than printing undefined", () => {
	const line = environmentLine(app(undefined), "1.8.0");
	assert.ok(!line.includes("undefined"), line);
	assert.match(line, /unknown/);
});

test("the platform is named", () => {
	const line = environmentLine(app("1.13.7"), "1.8.0");
	const parts = line.split(", ");
	assert.equal(parts.length, 3, line);
	assert.ok(parts[2].length > 0, "the platform was blank");
});
