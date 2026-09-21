import { App, MarkdownView, Plugin, TFile } from "obsidian";
import { linkTarget } from "../utils/text";

/**
 * Page icons and covers.
 *
 * An emoji and a banner read as "Notion" more than any single database
 * feature does, and both are just frontmatter: `icon: 🚀` and a `cover:`
 * pointing at an image in the vault or a URL. Nothing here changes the note's
 * content -- the banner is injected into the view and disappears with it.
 */

const BANNER_CLASS = "nfo-banner";
const ICON_CLASS = "nfo-page-emoji";

export interface BannerSettings {
	/** Whether a cover set to an http(s) URL may be fetched. */
	allowRemoteCovers: boolean;
	showBanners: boolean;
	bannerHeight: number;
}

/** Resolve a cover value to something an <img> can load. */
export function coverSource(
	app: App,
	value: unknown,
	sourcePath: string,
	allowRemote: boolean
): string | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text) return null;
	// Fetching a cover from the web hands that server the reader's IP address
	// and the moment they opened the note. Everything else this plugin does
	// stays on the machine, so this asks first rather than assuming.
	if (/^https?:\/\//.test(text)) return allowRemote ? text : null;

	const linkText = linkTarget(text);
	const file = app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
	return file ? app.vault.getResourcePath(file) : null;
}

/**
 * Draw (or clear) the banner for one markdown view.
 *
 * Existing banners are removed first so switching notes in a pane cannot leave
 * the previous note's cover behind.
 */
export function applyBanner(app: App, view: MarkdownView, settings: BannerSettings): void {
	const container = view.contentEl;
	for (const stale of Array.from(container.querySelectorAll(`.${BANNER_CLASS}, .${ICON_CLASS}`))) {
		stale.remove();
	}
	if (!settings.showBanners) return;

	const file: TFile | null = view.file;
	if (!file) return;
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) return;

	const cover = coverSource(
		app,
		frontmatter.cover ?? frontmatter.banner,
		file.path,
		settings.allowRemoteCovers
	);
	const icon = typeof frontmatter.icon === "string" ? frontmatter.icon.trim() : "";
	if (!cover && !icon) return;

	// Insert above whichever surface this view is currently showing, so the
	// banner appears in reading view, live preview and source mode alike.
	const host =
		container.querySelector(".markdown-preview-sizer") ??
		container.querySelector(".cm-sizer") ??
		container.firstElementChild;
	if (!host) return;

	if (cover) {
		const banner = createDiv({ cls: BANNER_CLASS });
		banner.style.height = `${settings.bannerHeight}px`;
		const img = banner.createEl("img", { cls: "nfo-banner-img" });
		img.src = cover;
		host.prepend(banner);
	}

	if (icon) {
		const badge = createDiv({ cls: ICON_CLASS, text: icon });
		if (cover) badge.addClass("nfo-page-emoji-over");
		host.prepend(badge);
	}
}

/** Keep every open markdown view's banner in step with its frontmatter. */
export function registerBanners(plugin: Plugin, settings: () => BannerSettings): void {
	const refreshAll = (): void => {
		for (const leaf of plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) applyBanner(plugin.app, view, settings());
		}
	};

	plugin.registerEvent(plugin.app.workspace.on("file-open", () => refreshAll()));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", () => refreshAll()));
	// Editing the frontmatter should change the banner without a reload.
	plugin.registerEvent(plugin.app.metadataCache.on("changed", () => refreshAll()));
	plugin.app.workspace.onLayoutReady(refreshAll);
}
