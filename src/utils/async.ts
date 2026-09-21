import { Notice } from "obsidian";

/**
 * Run work that cannot be awaited, and say so if it fails.
 *
 * Click handlers, drop handlers and command callbacks all return immediately,
 * so anything they start runs detached. Detached used to mean silent: a
 * rejected promise went nowhere, the UI simply did not change, and the only
 * trace was an unhandled rejection in a console nobody had open.
 *
 * `what` completes the sentence "Could not …", so pass a plain verb phrase:
 * "add a row", "save that template".
 */
export function runDetached(what: string, work: () => Promise<unknown>): void {
	work().catch((error: unknown) => {
		console.error(`Notion Suite: ${what} failed`, error);
		new Notice(`Could not ${what}.`);
	});
}
