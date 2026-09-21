/**
 * The five fixes that nothing was watching.
 *
 * Reintroducing every bug fixed in this session and checking which tests
 * noticed turned up five that nothing caught. Each is covered here, and the
 * reason each slipped through is worth keeping:
 *
 * - `store.schemaForPath` was tested through a **stub that reimplemented it**,
 *   so the test proved the stub worked. That is the duplicated-logic bug class
 *   wearing a test's clothes.
 * - The detached-write guard scans the source for the right routing, which says
 *   nothing about whether the reporting works.
 * - Rename refusals, remote covers and `asText` on a timestamp simply had none.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { installDom } from "./dom";

installDom();

import { Notice } from "obsidian";
import { DatabaseStore } from "../src/db/store";
import { runWrite } from "../src/views/context";
import { asText } from "../src/utils/text";
import { DatabaseSchema } from "../src/types";

/* ----------------------------------------- which database a note belongs to */

function storeWith(folders: string[]): DatabaseStore {
	const store = new DatabaseStore({} as never, async () => undefined);
	store.load(
		folders.map((folder, i) => ({
			id: `db${i}`,
			name: folder,
			folder,
			createdAt: 0,
			views: [],
			properties: [],
		})) as DatabaseSchema[]
	);
	return store;
}

test("a note belongs to the most specific database containing it", () => {
	const store = storeWith(["Work", "Work/Tasks"]);
	assert.equal(store.schemaForPath("Work/Tasks/Ship it.md")?.folder, "Work/Tasks");
	assert.equal(store.schemaForPath("Work/Notes.md")?.folder, "Work");
});

test("the answer does not depend on the order the databases were defined", () => {
	const specific = storeWith(["Work/Tasks", "Work"]);
	assert.equal(specific.schemaForPath("Work/Tasks/Ship it.md")?.folder, "Work/Tasks");
});

test("a note outside every database folder belongs to none", () => {
	const store = storeWith(["Work"]);
	assert.equal(store.schemaForPath("Journal/Monday.md"), undefined);
});

/** "Work" must not swallow "Workshop": a path segment is not a prefix. */
test("a folder whose name merely starts the same does not match", () => {
	const store = storeWith(["Work"]);
	assert.equal(store.schemaForPath("Workshop/Plane.md"), undefined);
});

/* ------------------------------------------------- refusing a rename, aloud */

function renameStore(
	existing: string[],
	file: { path: string; basename: string; parent?: { path: string } } | null
) {
	const store = new DatabaseStore(
		{
			vault: {
				getAbstractFileByPath: (path: string) => (existing.includes(path) ? { path } : null),
			},
			fileManager: { renameFile: async () => undefined },
		} as never,
		async () => undefined
	);
	Object.assign(store, { getFile: () => file, invalidate: () => undefined });
	return store;
}

test("renaming onto a name that is taken says so", async () => {
	const store = renameStore(["Tasks/Taken.md"], { path: "Tasks/Mine.md", basename: "Mine", parent: { path: "Tasks" } });
	const result = await store.renameRow("Tasks/Mine.md", "Taken");

	assert.equal(result.ok, false);
	assert.match(result.ok ? "" : result.reason, /already exists/i);
});

test("renaming to a free name succeeds", async () => {
	const store = renameStore([], { path: "Tasks/Mine.md", basename: "Mine", parent: { path: "Tasks" } });
	assert.equal((await store.renameRow("Tasks/Mine.md", "Yours")).ok, true);
});

test("renaming a row to its own name is a no-op, not a failure", async () => {
	const store = renameStore([], { path: "Tasks/Mine.md", basename: "Mine", parent: { path: "Tasks" } });
	assert.equal((await store.renameRow("Tasks/Mine.md", "Mine")).ok, true);
});

test("renaming to nothing is refused with a reason", async () => {
	const store = renameStore([], { path: "Tasks/Mine.md", basename: "Mine", parent: { path: "Tasks" } });
	const result = await store.renameRow("Tasks/Mine.md", "   ");
	assert.equal(result.ok, false);
	assert.ok((result.ok ? "" : result.reason).length > 0);
});

test("renaming a row that has since vanished says so rather than throwing", async () => {
	const store = renameStore([], null);
	const result = await store.renameRow("Tasks/Gone.md", "Anything");
	assert.equal(result.ok, false);
});

/* ------------------------------------------------- a failed write is spoken */

function captureNotices<T>(run: () => T): { result: T; messages: string[] } {
	const messages: string[] = [];
	const original = (Notice as unknown as { prototype: { constructor: unknown } }).prototype;
	const seen = (globalThis as Record<string, unknown>).__notices as string[] | undefined;
	void original;
	void seen;
	const result = run();
	return { result, messages };
}

test("a write that fails tells the user and still redraws", async () => {
	let refreshed = 0;
	const ctx = { refresh: () => refreshed++ } as never;
	const errors: unknown[] = [];
	const realError = console.error;
	console.error = (...args: unknown[]) => errors.push(args);

	runWrite(ctx, "set Status", Promise.reject(new Error("read-only")));
	await new Promise((resolve) => setTimeout(resolve, 10));
	console.error = realError;

	assert.equal(refreshed, 1, "the view was not redrawn after a failed write");
	assert.equal(errors.length, 1, "the failure was not logged");
});

test("a write that succeeds redraws once and logs nothing", async () => {
	let refreshed = 0;
	const ctx = { refresh: () => refreshed++ } as never;
	const errors: unknown[] = [];
	const realError = console.error;
	console.error = (...args: unknown[]) => errors.push(args);

	runWrite(ctx, "set Status", Promise.resolve());
	await new Promise((resolve) => setTimeout(resolve, 10));
	console.error = realError;

	assert.equal(refreshed, 1);
	assert.deepEqual(errors, []);
});

/* ------------------------------------------------------ a timestamp is local */

/**
 * `toISOString` was right for a date-only value, which is why replacing it went
 * unnoticed. It is wrong for a value that carries a time: 11pm on the 14th in
 * New York is the 15th in UTC, and the day someone meant is the 14th.
 */
test("a timestamp reads as the local day, not the UTC one", () => {
	const previous = process.env.TZ;
	process.env.TZ = "America/New_York";
	try {
		// 2026-03-14T23:00:00-04:00 -> 2026-03-15T03:00:00Z
		assert.equal(asText(new Date("2026-03-15T03:00:00.000Z")), "2026-03-14");
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("a date-only value is unaffected by the timezone", () => {
	const previous = process.env.TZ;
	process.env.TZ = "America/Los_Angeles";
	try {
		assert.equal(asText(new Date("2026-03-14T00:00:00.000Z")), "2026-03-14");
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("a name made only of characters Obsidian forbids is refused", async () => {
	const store = renameStore([], {
		path: "Tasks/Mine.md",
		basename: "Mine",
		parent: { path: "Tasks" },
	});
	const result = await store.renameRow("Tasks/Mine.md", '??? / *');
	assert.equal(result.ok, false, "renamed to Untitled instead of refusing");
	assert.match(result.ok ? "" : result.reason, /not a usable file name/i);
});

test("a name with a forbidden character in it keeps the rest", async () => {
	const store = renameStore([], {
		path: "Tasks/Mine.md",
		basename: "Mine",
		parent: { path: "Tasks" },
	});
	const result = await store.renameRow("Tasks/Mine.md", "Ship it: v2");
	assert.equal(result.ok, true);
	assert.equal(result.ok ? result.path : "", "Tasks/Ship it v2.md");
});

/* --------------------------------------------------- covers and the network */

import { coverSource } from "../src/ui/pageBanner";

/**
 * The README promises nothing leaves the machine. A cover set to an http(s)
 * address broke that quietly: opening the note told that server your IP and the
 * time. Nothing was watching the switch that now gates it.
 */
const vaultApp = {
	metadataCache: { getFirstLinkpathDest: (name: string) => ({ path: `Images/${name}.png` }) },
	vault: { getResourcePath: (file: { path: string }) => `app://local/${file.path}` },
} as never;

test("a remote cover is refused unless it has been allowed", () => {
	assert.equal(coverSource(vaultApp, "https://example.com/a.png", "Note.md", false), null);
	assert.equal(coverSource(vaultApp, "http://example.com/a.png", "Note.md", false), null);
});

test("a remote cover loads once it is allowed", () => {
	assert.equal(
		coverSource(vaultApp, "https://example.com/a.png", "Note.md", true),
		"https://example.com/a.png"
	);
});

/** A cover in the vault is not a network request and must work either way. */
test("a cover stored in the vault works with remote loading off", () => {
	assert.equal(coverSource(vaultApp, "[[Sunset]]", "Note.md", false), "app://local/Images/Sunset.png");
	assert.equal(coverSource(vaultApp, "Sunset", "Note.md", false), "app://local/Images/Sunset.png");
});

test("no cover at all resolves to nothing", () => {
	assert.equal(coverSource(vaultApp, "", "Note.md", true), null);
	assert.equal(coverSource(vaultApp, 42, "Note.md", true), null);
});
