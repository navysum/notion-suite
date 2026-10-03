import { App, Notice, Platform } from "obsidian";

/**
 * A way to tell us something is wrong.
 *
 * Three hundred people installed this and not one filed anything, which is not
 * evidence that nothing is broken -- the collapsed table had been shipping for
 * eight releases before it was found, and it was found by looking, not by
 * being told. Somebody who hits a bug will shrug and uninstall unless
 * reporting it is easier than that.
 *
 * So the version numbers nobody can be expected to go and look up are filled
 * in already. What comes back is then worth reading, instead of starting with
 * three rounds of "which version are you on?".
 */

const ISSUES = "https://github.com/navysum/notion-suite/issues/new";

export interface ReportContext {
	pluginVersion: string;
}

/** The environment line that makes a report actionable rather than a riddle. */
export function environmentLine(app: App, pluginVersion: string): string {
	const obsidian = (app as unknown as { appVersion?: string }).appVersion ?? "unknown";
	const platform = describePlatform();
	return `Notion Suite ${pluginVersion}, Obsidian ${obsidian}, ${platform}`;
}

function describePlatform(): string {
	// Platform is not available in every context the tests run in.
	const p = Platform as Partial<typeof Platform> | undefined;
	if (!p) return "unknown";
	if (p.isAndroidApp) return "Android";
	if (p.isIosApp) return "iOS";
	if (p.isMacOS) return "macOS";
	if (p.isWin) return "Windows";
	if (p.isLinux) return "Linux";
	if (p.isMobile) return "mobile";
	return "desktop";
}

/**
 * Open a prefilled bug report.
 *
 * GitHub's issue form reads these from the query string, so the versions
 * arrive already answered. Everything else is left blank: a prefilled
 * description would only be deleted, and worse, might be submitted as-is.
 */
export function openBugReport(app: App, context: ReportContext): void {
	const url = new URL(ISSUES);
	url.searchParams.set("template", "bug.yml");
	url.searchParams.set("versions", environmentLine(app, context.pluginVersion));
	try {
		window.open(url.toString(), "_blank");
	} catch (error) {
		console.error("Notion Suite: could not open the issue page", error);
		new Notice("Could not open the browser. The issue tracker is at github.com/navysum/notion-suite.");
	}
}
