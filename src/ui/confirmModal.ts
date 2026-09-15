import { App, Modal, Setting } from "obsidian";

export interface ConfirmOptions {
	title: string;
	body: string;
	/** Extra line in a quieter style, for consequences worth stating. */
	detail?: string;
	confirmText: string;
	cancelText?: string;
	/** Style the confirm button as destructive. */
	destructive?: boolean;
}

/**
 * A yes/no question, as a promise.
 *
 * Resolves false when dismissed, so a cancelled dialog and a closed one mean
 * the same thing to the caller and nothing happens by default.
 */
export function confirm(app: App, options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, options, resolve).open();
	});
}

export interface Choice {
	id: string;
	label: string;
	/** Style as the primary action. */
	cta?: boolean;
	destructive?: boolean;
}

export interface ChooseOptions {
	title: string;
	body: string;
	detail?: string;
	choices: Choice[];
}

/**
 * Ask a question with more than two answers.
 *
 * Resolves null when dismissed. That matters: a two-button confirm forces a
 * three-way question into "yes or the other thing", so closing the dialog
 * would pick one of them. Here, closing picks nothing.
 */
export function choose(app: App, options: ChooseOptions): Promise<string | null> {
	return new Promise((resolve) => {
		new ChooseModal(app, options, resolve).open();
	});
}

class ChooseModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private options: ChooseOptions,
		private resolve: (value: string | null) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createEl("p", { text: this.options.body });
		if (this.options.detail) {
			contentEl.createEl("p", { cls: "nfo-modal-hint", text: this.options.detail });
		}

		const footer = new Setting(contentEl);
		footer.addButton((button) => button.setButtonText("Cancel").onClick(() => this.answer(null)));
		for (const choice of this.options.choices) {
			footer.addButton((button) => {
				button.setButtonText(choice.label);
				if (choice.cta) button.setCta();
				if (choice.destructive) button.setWarning();
				button.onClick(() => this.answer(choice.id));
			});
		}
	}

	onClose(): void {
		// Dismissing chooses nothing at all, rather than defaulting to an answer.
		this.answer(null);
	}

	private answer(value: string | null): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(value);
		this.close();
	}
}

class ConfirmModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private options: ConfirmOptions,
		private resolve: (value: boolean) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("nfo-modal");
		contentEl.createEl("h2", { text: this.options.title });
		contentEl.createEl("p", { text: this.options.body });
		if (this.options.detail) {
			contentEl.createEl("p", { cls: "nfo-modal-hint", text: this.options.detail });
		}

		const footer = new Setting(contentEl);
		footer.addButton((button) =>
			button.setButtonText(this.options.cancelText ?? "Cancel").onClick(() => this.answer(false))
		);
		footer.addButton((button) => {
			button.setButtonText(this.options.confirmText).setCta();
			if (this.options.destructive) button.setWarning();
			button.onClick(() => this.answer(true));
		});
	}

	onClose(): void {
		// Dismissing without choosing is a "no", not a hung promise.
		this.answer(false);
	}

	private answer(value: boolean): void {
		if (this.answered) return;
		this.answered = true;
		this.resolve(value);
		this.close();
	}
}
