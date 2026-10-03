/**
 * Relations that point both ways.
 *
 * A relation stores titles, which makes it readable and portable but strictly
 * one-way: link a task to a project and the project has no idea, so every
 * rollup on the project side has nothing to roll up.
 *
 * The deciding is what gets subtly wrong -- a title removed twice, a link
 * added that was already there, a list whose wikilinks get flattened on the
 * way through -- so it is pure, and tested on its own.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { diffLinks, hasLink, linkList, withLink, withoutLink } from "../src/db/relations";

test("a relation cell reads as the titles it points at", () => {
	assert.deepEqual(linkList(["Alpha", "Beta"]), ["Alpha", "Beta"]);
	assert.deepEqual(linkList("Alpha"), ["Alpha"]);
	assert.deepEqual(linkList(null), []);
	assert.deepEqual(linkList([]), []);
});

test("wikilinks, aliases and headings all read as the note they name", () => {
	assert.deepEqual(linkList(["[[Alpha]]", "[[Beta|the second]]", "[[Gamma#Scope]]"]), [
		"Alpha",
		"Beta",
		"Gamma",
	]);
});

/** The same note listed twice is one link, not two. */
test("a duplicate entry counts once", () => {
	assert.deepEqual(linkList(["Alpha", "[[Alpha]]", "alpha"]), ["Alpha"]);
});

test("a diff says what was linked and what was let go", () => {
	const change = diffLinks(["Alpha", "Beta"], ["Beta", "Gamma"]);
	assert.deepEqual(change.added, ["Gamma"]);
	assert.deepEqual(change.removed, ["Alpha"]);
});

test("changing nothing produces no work", () => {
	const change = diffLinks(["Alpha"], ["[[Alpha]]"]);
	assert.deepEqual(change.added, []);
	assert.deepEqual(change.removed, [], "rewriting a link as a wikilink was read as a change");
});

test("linking the first one, and unlinking the last", () => {
	assert.deepEqual(diffLinks(null, ["Alpha"]).added, ["Alpha"]);
	assert.deepEqual(diffLinks(["Alpha"], null).removed, ["Alpha"]);
});

/**
 * The other side of a relation is somebody's note. Adding to it must not
 * rewrite how they chose to write what is already there.
 */
test("mirroring preserves how the existing entries were written", () => {
	const current = ["[[Alpha]]", "Beta"];
	assert.deepEqual(withLink(current, "Gamma"), ["[[Alpha]]", "Beta", "Gamma"]);
	assert.deepEqual(withoutLink(current, "Beta"), ["[[Alpha]]"]);
	assert.deepEqual(withoutLink(current, "Alpha"), ["Beta"], "a wikilink was not matched");
});

test("adding a link that is already there changes nothing", () => {
	assert.deepEqual(withLink(["[[Alpha]]"], "Alpha"), ["[[Alpha]]"]);
	assert.deepEqual(withLink(["Alpha"], "alpha"), ["Alpha"], "case was treated as a different note");
});

test("removing a link that is not there changes nothing", () => {
	assert.deepEqual(withoutLink(["Alpha"], "Beta"), ["Alpha"]);
	assert.deepEqual(withoutLink(null, "Beta"), []);
});

test("a single value, not a list, is handled either way", () => {
	assert.deepEqual(withLink("Alpha", "Beta"), ["Alpha", "Beta"]);
	assert.deepEqual(withoutLink("Alpha", "Alpha"), []);
});

/** Used to skip a write that would change nothing, and so a visible flicker. */
test("hasLink answers without caring how the link was written", () => {
	assert.equal(hasLink(["[[Alpha|an alias]]"], "Alpha"), true);
	assert.equal(hasLink(["Alpha"], "ALPHA"), true);
	assert.equal(hasLink(["Alpha"], "Alph"), false);
	assert.equal(hasLink(null, "Alpha"), false);
});

/** A round trip: link, then unlink, and the note is as it started. */
test("linking and unlinking leaves the list where it began", () => {
	const start: unknown[] = ["[[Alpha]]"];
	const linked = withLink(start, "Beta");
	const unlinked = withoutLink(linked, "Beta");
	assert.deepEqual(unlinked, start);
});

/* ------------------------------------------------- writing the other side */

import { installDom } from "./dom";

installDom();

import { DatabaseStore } from "../src/db/store";
import { DatabaseSchema } from "../src/types";

const tasks: DatabaseSchema = {
	id: "tasks",
	name: "Tasks",
	folder: "Tasks",
	createdAt: 0,
	views: [],
	properties: [
		{
			id: "project",
			name: "Project",
			type: "relation",
			relationDatabaseId: "projects",
			reverseProperty: "tasks",
		},
		{ id: "oneway", name: "Loose link", type: "relation", relationDatabaseId: "projects" },
	],
};

const projects: DatabaseSchema = {
	id: "projects",
	name: "Projects",
	folder: "Projects",
	createdAt: 0,
	views: [],
	properties: [{ id: "tasks", name: "Tasks", type: "relation", relationDatabaseId: "tasks" }],
};

/** A vault of frontmatter, enough for the write path to work on. */
function vault(files: Record<string, Record<string, unknown>>) {
	const writes: string[] = [];
	const file = (path: string) => ({
		path,
		basename: path.split("/").pop()!.replace(/\.md$/, ""),
		extension: "md",
		stat: { ctime: 0, mtime: 0 },
	});
	const app = {
		vault: { getAbstractFileByPath: (p: string) => (files[p] ? file(p) : null) },
		metadataCache: { getFileCache: (f: { path: string }) => ({ frontmatter: files[f.path] }) },
		fileManager: {
			processFrontMatter: async (
				f: { path: string },
				mutate: (fm: Record<string, unknown>) => void
			) => {
				files[f.path] = files[f.path] ?? {};
				mutate(files[f.path]);
				writes.push(f.path);
			},
		},
	};
	const store = new DatabaseStore(app as never, async () => undefined);
	store.load([tasks, projects]);
	Object.assign(store, {
		getFile: (p: string) => (files[p] ? file(p) : null),
		folderFiles: (folder: string) =>
			Object.keys(files).filter((p) => p.startsWith(`${folder}/`)).map(file),
		invalidate: () => undefined,
	});
	return { store, files, writes };
}

test("linking a task to a project puts the task on the project", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": {},
		"Projects/Launch.md": {},
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Launch"]);

	assert.deepEqual(files["Tasks/Ship it.md"].project, ["Launch"]);
	assert.deepEqual(files["Projects/Launch.md"].tasks, ["Ship it"], "the project was not told");
});

test("unlinking takes it off again", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": { project: ["Launch"] },
		"Projects/Launch.md": { tasks: ["Ship it"] },
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", []);

	assert.equal(files["Projects/Launch.md"].tasks, undefined, "the stale link was left behind");
});

test("moving a task from one project to the other updates both", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": { project: ["Launch"] },
		"Projects/Launch.md": { tasks: ["Ship it"] },
		"Projects/Rewrite.md": {},
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Rewrite"]);

	assert.equal(files["Projects/Launch.md"].tasks, undefined);
	assert.deepEqual(files["Projects/Rewrite.md"].tasks, ["Ship it"]);
});

/** The other side is somebody's note; a link already there is left as written. */
test("an existing wikilink on the other side is not rewritten", async () => {
	const { store, files, writes } = vault({
		"Tasks/Ship it.md": {},
		"Projects/Launch.md": { tasks: ["[[Ship it]]"] },
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Launch"]);

	assert.deepEqual(files["Projects/Launch.md"].tasks, ["[[Ship it]]"]);
	assert.deepEqual(
		writes.filter((p) => p.startsWith("Projects/")),
		[],
		"a note that already said the right thing was rewritten anyway"
	);
});

/** A one-way relation must stay one-way, as every relation was before this. */
test("a relation with no mirror set leaves the other side alone", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": {},
		"Projects/Launch.md": {},
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "oneway", ["Launch"]);

	assert.equal(files["Projects/Launch.md"].tasks, undefined);
});

test("linking to a row that does not exist is quietly skipped", async () => {
	const { store, files } = vault({ "Tasks/Ship it.md": {}, "Projects/Launch.md": {} });
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Launch", "Does not exist"]);

	assert.deepEqual(files["Tasks/Ship it.md"].project, ["Launch", "Does not exist"]);
	assert.deepEqual(files["Projects/Launch.md"].tasks, ["Ship it"]);
});

test("several links at once all land", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": {},
		"Projects/Launch.md": {},
		"Projects/Rewrite.md": {},
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Launch", "Rewrite"]);

	assert.deepEqual(files["Projects/Launch.md"].tasks, ["Ship it"]);
	assert.deepEqual(files["Projects/Rewrite.md"].tasks, ["Ship it"]);
});

/** A project with other tasks keeps them. */
test("mirroring adds to the other side rather than replacing it", async () => {
	const { store, files } = vault({
		"Tasks/Ship it.md": {},
		"Projects/Launch.md": { tasks: ["Something else"] },
	});
	await store.setValue(tasks, "Tasks/Ship it.md", "project", ["Launch"]);

	assert.deepEqual(files["Projects/Launch.md"].tasks, ["Something else", "Ship it"]);
});
