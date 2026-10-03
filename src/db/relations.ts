import { linkTarget } from "../utils/text";

/**
 * Relations that point both ways.
 *
 * A relation stores the titles of the notes it points at, which makes it
 * readable and portable but strictly one-way: link a task to a project and the
 * project has no idea. Every rollup on the project side then has nothing to
 * roll up, and keeping both lists in step by hand is exactly the bookkeeping a
 * database is supposed to remove.
 *
 * A two-way relation names a property on the other database to mirror into. The
 * mirror is still an ordinary list of titles in ordinary frontmatter -- nothing
 * here invents a hidden link table -- so a vault opened without this plugin
 * still shows both sides, and a note edited by hand stays correct.
 *
 * Everything in this file is pure. Deciding what should change is separable
 * from writing it, and it is the deciding that gets subtly wrong: a title
 * removed twice, a link that was already there added again, a list whose
 * wikilinks get flattened on the way through.
 */

/** Read a relation cell as the list of titles it points at. */
export function linkList(value: unknown): string[] {
	const entries = Array.isArray(value) ? (value as unknown[]) : value ? [value] : [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		const title = linkTarget(entry);
		if (!title) continue;
		const key = title.toLowerCase();
		// The same note listed twice is one link, not two.
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(title);
	}
	return out;
}

export interface LinkChange {
	/** Titles linked by this edit that were not linked before. */
	added: string[];
	/** Titles that were linked before and are not any more. */
	removed: string[];
}

/** What changed between two states of a relation cell. */
export function diffLinks(before: unknown, after: unknown): LinkChange {
	const was = linkList(before);
	const now = linkList(after);
	const wasKeys = new Set(was.map((t) => t.toLowerCase()));
	const nowKeys = new Set(now.map((t) => t.toLowerCase()));
	return {
		added: now.filter((t) => !wasKeys.has(t.toLowerCase())),
		removed: was.filter((t) => !nowKeys.has(t.toLowerCase())),
	};
}

/**
 * Add a title to a relation cell, leaving the rest of it exactly as written.
 *
 * The existing entries are returned untouched -- a `[[Wikilink]]` stays a
 * wikilink -- because the other side of a relation is somebody's note, and
 * rewriting how they chose to write it is not this feature's business.
 */
export function withLink(current: unknown, title: string): unknown[] {
	const entries = Array.isArray(current) ? [...(current as unknown[])] : current ? [current] : [];
	// The title is normalised too. These used to compare a normalised entry
	// against a raw title, so passing `[[Zeta]]` appended it and then could
	// never match it again: the link went in and could not be taken out.
	const wanted = linkTarget(title).toLowerCase();
	if (!wanted) return entries;
	const already = entries.some((entry) => linkTarget(entry).toLowerCase() === wanted);
	if (already) return entries;
	return [...entries, title];
}

/** Remove a title from a relation cell, leaving the rest as written. */
export function withoutLink(current: unknown, title: string): unknown[] {
	const entries = Array.isArray(current) ? (current as unknown[]) : current ? [current] : [];
	const wanted = linkTarget(title).toLowerCase();
	if (!wanted) return entries;
	return entries.filter((entry) => linkTarget(entry).toLowerCase() !== wanted);
}

/**
 * Whether a relation cell already points at a title.
 *
 * Used to skip a write that would change nothing: mirroring is triggered by
 * edits, and an edit that is already reflected on the other side must not
 * touch that note's file at all.
 */
export function hasLink(current: unknown, title: string): boolean {
	const wanted = linkTarget(title).toLowerCase();
	if (!wanted) return false;
	return linkList(current).some((t) => t.toLowerCase() === wanted);
}
