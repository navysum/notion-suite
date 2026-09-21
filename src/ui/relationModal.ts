import { App, Modal, Setting } from "obsidian";
import { DatabaseRow, DatabaseSchema } from "../types";
import { linkTarget } from "../utils/text";

/**
 * Pick which rows a relation points at.
 *
 * This replaces a context menu of the first fifty rows. The menu had no search,
 * no scroll worth the name, and -- worst of it -- no sign that it had stopped
 * early: on a database of three hundred tasks, the last two hundred and fifty
 * simply could not be linked to, and nothing said so.
 *
 * Closing keeps what you ticked. There is no Cancel, because the list is a set
 * of toggles rather than a form: every change is visible as you make it, and a
 * dialog that discards visible changes on Escape is its own kind of trap.
 */
export class RelationPickerModal extends Modal {
	private chosen: Set<string>;
	private search = "";
	private listEl: HTMLElement | null = null;

	constructor(
		app: App,
		private related: DatabaseSchema,
		private rows: DatabaseRow[],
		current: string[],
		private onDone: (names: string[]) => void
	) {
		super(app);
		// Stored values may be wikilinks; compare on the title they point at.
		this.chosen = new Set(current.map((name) => linkTarget(name)).filter(Boolean));
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal", "nfo-relation-modal");
		contentEl.createEl("h2", { text: `Link to ${this.related.name}` });

		new Setting(contentEl).addText((text) => {
			text.setPlaceholder("Search…").onChange((value) => {
				this.search = value.trim().toLowerCase();
				this.drawList();
			});
			text.inputEl.focus();
		});

		this.listEl = contentEl.createDiv({ cls: "nfo-relation-list" });
		this.drawList();

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("Done")
				.setCta()
				.onClick(() => this.close())
		);
	}

	onClose(): void {
		this.onDone([...this.chosen]);
		this.contentEl.empty();
	}

	private drawList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();

		const matches = this.rows.filter((row) =>
			this.search ? row.name.toLowerCase().includes(this.search) : true
		);

		if (matches.length === 0) {
			list.createDiv({
				cls: "nfo-relation-empty",
				text: this.rows.length === 0 ? "This database has no rows yet." : "Nothing matches.",
			});
			return;
		}

		// Ticked rows first, so what you have chosen stays in front of you while
		// you search for the next one.
		const ordered = [...matches].sort((a, b) => {
			const on = Number(this.chosen.has(b.name)) - Number(this.chosen.has(a.name));
			return on !== 0 ? on : a.name.localeCompare(b.name);
		});

		for (const row of ordered) {
			const item = list.createDiv({ cls: "nfo-relation-item" });
			const box = item.createEl("input", { type: "checkbox" });
			box.checked = this.chosen.has(row.name);
			item.createSpan({ cls: "nfo-relation-name", text: row.name });

			const toggle = (): void => {
				if (this.chosen.has(row.name)) this.chosen.delete(row.name);
				else this.chosen.add(row.name);
				box.checked = this.chosen.has(row.name);
				item.toggleClass("nfo-relation-on", box.checked);
			};
			item.toggleClass("nfo-relation-on", box.checked);
			box.addEventListener("click", (evt) => evt.stopPropagation());
			box.addEventListener("change", toggle);
			item.addEventListener("click", toggle);
		}

		const count = this.chosen.size;
		list.createDiv({
			cls: "nfo-relation-count",
			text: `${count} linked · ${matches.length.toLocaleString()} of ${this.rows.length.toLocaleString()} shown`,
		});
	}
}
