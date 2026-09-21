/**
 * Renaming a row, and everything pointing at it.
 *
 * Relations and sub-item links hold a note's **title**, because a title is what
 * survives a vault sync and what a human would type. The cost is that renaming
 * a row breaks every link into it: Obsidian rewrites `[[wikilinks]]` on rename,
 * but a bare title is a string it has no reason to touch. Nothing errored --
 * the link simply stopped matching, and sub-items quietly became top-level rows.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { installDom } from "./dom";

installDom();

import { DatabaseStore } from "../src/db/store";
import { DatabaseSchema, PropertyDef } from "../src/types";

const props: PropertyDef[] = [
	{ id: "parent", name: "Parent", type: "text" },
	{ id: "blocks", name: "Blocks", type: "relation", relationDatabaseId: "db" },
	{ id: "notes", name: "Notes", type: "text" },
];

const schema: DatabaseSchema = {
	id: "db",
	name: "Tasks",
	folder: "Tasks",
	createdAt: 0,
	views: [],
	parentProperty: "parent",
	properties: props,
};

/** A vault of frontmatter, enough for the store's rename path to work on. */
function vault(files: Record<string, Record<string, unknown>>) {
	const written: string[] = [];
	const app = {
		vault: {
			getAbstractFileByPath: (path: string) => {
				if (path === "Tasks") {
					return Object.assign(Object.create({ constructor: { name: "TFolder" } }), {
						children: Object.keys(files).map((p) => fileFor(p)),
					});
				}
				return files[path] ? fileFor(path) : null;
			},
		},
		metadataCache: {
			getFileCache: (file: { path: string }) => ({ frontmatter: files[file.path] }),
		},
		fileManager: {
			processFrontMatter: async (
				file: { path: string },
				mutate: (fm: Record<string, unknown>) => void
			) => {
				mutate(files[file.path]);
				written.push(file.path);
			},
		},
	};
	function fileFor(path: string) {
		return {
			path,
			basename: path.split("/").pop()!.replace(/\.md$/, ""),
			extension: "md",
			stat: { ctime: 0, mtime: 0 },
		};
	}
	return { app, files, written };
}

/**
 * The store walks the folder with `instanceof TFolder`, which a plain stub
 * cannot satisfy. Reaching in for the private walker keeps the test on the real
 * relink logic rather than on a reimplementation of it.
 */
function storeFor(app: unknown, files: Record<string, unknown>): DatabaseStore {
	const store = new DatabaseStore(app as never, async () => undefined);
	store.load([schema]);
	(store as unknown as { folderFiles: (folder: string) => unknown[] }).folderFiles = () =>
		Object.keys(files).map((path) => ({
			path,
			basename: path.split("/").pop()!.replace(/\.md$/, ""),
			extension: "md",
			stat: { ctime: 0, mtime: 0 },
		}));
	return store;
}

test("a bare parent link follows the row it points at", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/Draft copy.md": { parent: "Launch" },
	});
	const store = storeFor(app, files);

	await store.relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.equal(files["Tasks/Draft copy.md"].parent, "Go live");
});

test("a wikilink stays a wikilink", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/Draft copy.md": { parent: "[[Launch]]" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.equal(files["Tasks/Draft copy.md"].parent, "[[Go live]]");
});

test("an alias and a heading survive the move", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { parent: "[[Launch|the big one]]" },
		"Tasks/B.md": { parent: "[[Launch#Scope]]" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.equal(files["Tasks/A.md"].parent, "[[Go live|the big one]]");
	assert.equal(files["Tasks/B.md"].parent, "[[Go live#Scope]]");
});

test("a relation list repoints only the entry that moved", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { blocks: ["Launch", "Something else", "[[Launch]]"] },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.deepEqual(files["Tasks/A.md"].blocks, ["Go live", "Something else", "[[Go live]]"]);
});

test("matching ignores case, the way relation resolution does", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { parent: "launch" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.equal(files["Tasks/A.md"].parent, "Go live");
});

/** Rewriting a note that mentions nothing is a needless write and a needless risk. */
test("notes that reference nothing are left untouched", async () => {
	const { app, files, written } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { parent: "Something else", notes: "Launch is mentioned here" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.deepEqual(written, [], "rewrote a note it had no business touching");
	assert.equal(files["Tasks/A.md"].notes, "Launch is mentioned here");
});

test("a property that merely contains the name is not a link", async () => {
	const { app, files } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { parent: "Launch party" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Tasks/Go live.md");

	assert.equal(files["Tasks/A.md"].parent, "Launch party", "matched on a substring");
});

test("a rename that changes nothing does nothing", async () => {
	const { app, files, written } = vault({
		"Tasks/Launch.md": {},
		"Tasks/A.md": { parent: "Launch" },
	});
	await storeFor(app, files).relinkRenamed("Tasks/Launch.md", "Elsewhere/Launch.md");

	assert.deepEqual(written, []);
	assert.equal(files["Tasks/A.md"].parent, "Launch");
});
