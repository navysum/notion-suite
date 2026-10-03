/**
 * Talking to Obsidian's own Bases.
 *
 * Obsidian ships a database feature, and `registerBasesView` lets a plugin add
 * view types to it. The part worth testing here is the property addressing:
 * Bases names a property `<kind>.<name>`, and only a `note.` one is a real
 * frontmatter key. Getting that wrong means a dropped card either writes a key
 * nothing reads, or refuses a drop it could have made.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { parsePropertyId, writableKey } from "../src/bases/propertyId";

test("a frontmatter property parses to its key", () => {
	assert.deepEqual(parsePropertyId("note.status"), { kind: "note", name: "status" });
	assert.equal(writableKey("note.status"), "status");
});

/** A key may contain a dot of its own; only the first one separates. */
test("only the first dot separates the kind from the name", () => {
	assert.deepEqual(parsePropertyId("note.my.odd.key"), { kind: "note", name: "my.odd.key" });
	assert.equal(writableKey("note.my.odd.key"), "my.odd.key");
});

/**
 * A formula is computed and a file property belongs to the filesystem. Writing
 * either would plant a frontmatter key that nothing reads, so a board grouped
 * by one has to refuse the drop rather than appear to work.
 */
test("computed and file properties are not writable", () => {
	assert.equal(writableKey("formula.total"), null);
	assert.equal(writableKey("file.name"), null);
	assert.equal(writableKey("file.mtime"), null);
});

test("anything malformed is refused rather than guessed at", () => {
	for (const bad of ["", "status", ".status", "note.", "unknown.status", "."]) {
		assert.equal(parsePropertyId(bad), null, `"${bad}" parsed as a property`);
		assert.equal(writableKey(bad), null, `"${bad}" was treated as writable`);
	}
});
