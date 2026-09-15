import { App, Modal, Setting } from "obsidian";
import { PropertyDef } from "../types";

/** Ask for a single value to apply across every selected row. */
export class BulkValueModal extends Modal {
	private value = "";

	constructor(
		app: App,
		private prop: PropertyDef,
		private onSubmit: (value: unknown) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: `Set ${this.prop.name}` });

		new Setting(contentEl).setName(this.prop.name).addText((text) => {
			text.onChange((value) => (this.value = value));
			text.inputEl.type = this.prop.type === "number" ? "number" : this.prop.type === "date" ? "date" : "text";
			text.inputEl.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") this.submit();
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
		footer.addButton((b) =>
			b
				.setButtonText("Clear the value")
				.onClick(() => {
					this.onSubmit(null);
					this.close();
				})
		);
		footer.addButton((b) => b.setButtonText("Apply").setCta().onClick(() => this.submit()));
	}

	private submit(): void {
		const text = this.value.trim();
		if (this.prop.type === "number") {
			const n = Number(text);
			this.onSubmit(text === "" || isNaN(n) ? null : n);
		} else if (this.prop.type === "multiselect" || this.prop.type === "person") {
			this.onSubmit(text ? text.split(",").map((v) => v.trim()).filter(Boolean) : []);
		} else {
			this.onSubmit(text || null);
		}
		this.close();
	}
}
