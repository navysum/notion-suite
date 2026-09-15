import { App, Modal, Notice, Setting, TFile } from "obsidian";

/** A handful of starting points, so the picker is not an empty text box. */
const SUGGESTED = ["📄", "✅", "🚀", "🎯", "📚", "💸", "🗓️", "🧠", "🔥", "💡", "📌", "🏷️"];

/**
 * Set a note's icon and cover.
 *
 * Both are ordinary frontmatter keys, so they survive without the plugin and
 * can be edited by hand. This dialog exists because typing `cover:` and a
 * vault-relative path is exactly the kind of thing nobody should have to
 * remember.
 */
export class PageStyleModal extends Modal {
	private icon = "";
	private cover = "";

	constructor(app: App, private file: TFile) {
		super(app);
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		this.icon = typeof frontmatter?.icon === "string" ? frontmatter.icon : "";
		this.cover = typeof frontmatter?.cover === "string" ? frontmatter.cover : "";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: "Page icon and cover" });

		let iconField: { setValue: (value: string) => void } | null = null;

		new Setting(contentEl)
			.setName("Icon")
			.setDesc("An emoji shown above the note's title.")
			.addText((text) => {
				iconField = text;
				text.setValue(this.icon).setPlaceholder("🚀").onChange((value) => (this.icon = value.trim()));
			});

		const picker = contentEl.createDiv({ cls: "nfo-emoji-picker" });
		for (const emoji of SUGGESTED) {
			const button = picker.createDiv({ cls: "nfo-emoji-option", text: emoji });
			button.addEventListener("click", () => {
				this.icon = emoji;
				iconField?.setValue(emoji);
			});
		}

		new Setting(contentEl)
			.setName("Cover image")
			.setDesc("A vault path, a wikilink, or a URL. Leave blank for none.")
			.addText((text) =>
				text
					.setValue(this.cover)
					.setPlaceholder("Attachments/banner.jpg")
					.onChange((value) => (this.cover = value.trim()))
			);

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Remove both")
				.setWarning()
				.onClick(() => void this.save("", ""))
		);
		footer.addButton((b) =>
			b
				.setButtonText("Save")
				.setCta()
				.onClick(() => void this.save(this.icon, this.cover))
		);
	}

	private async save(icon: string, cover: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(
			this.file,
			(frontmatter: Record<string, unknown>) => {
				if (icon) frontmatter.icon = icon;
				else delete frontmatter.icon;
				if (cover) frontmatter.cover = cover;
				else delete frontmatter.cover;
			}
		);
		new Notice(icon || cover ? "Page style updated." : "Icon and cover removed.");
		this.close();
	}
}
