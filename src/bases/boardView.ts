import {
	BasesEntry,
	BasesEntryGroup,
	BasesPropertyId,
	BasesView,
	Menu,
	Notice,
	Plugin,
	QueryController,
	TFile,
	setIcon,
} from "obsidian";
import { writableKey } from "./propertyId";
import { autoColor, pill } from "../utils/dom";
import { runDetached } from "../utils/async";

/**
 * A kanban board as a view type inside Obsidian's own Bases.
 *
 * Obsidian ships a database feature now. Its query engine does what this
 * plugin's does -- filters, formulas, properties, grouping -- but it has no
 * board, and `registerBasesView` is an open door for one. So rather than
 * compete with the thing every Obsidian user already has, the views that are
 * actually this plugin's own work get offered on top of it: open any Base,
 * pick Board from the view menu, and drag.
 *
 * This deliberately does not reuse the code-block board. That one is built
 * around this plugin's own schemas and store; a Base brings its own data,
 * grouping and ordering, so the job here is to draw what Bases hands over and
 * write back the one property a drop changes. Sharing the renderer would mean
 * one of the two pretending to be the other.
 */
export const BASES_BOARD_VIEW = "notion-suite-board";

export class BasesBoardView extends BasesView {
	type = BASES_BOARD_VIEW;

	constructor(
		controller: QueryController,
		private root: HTMLElement
	) {
		super(controller);
	}

	onDataUpdated(): void {
		this.draw();
	}

	onunload(): void {
		this.root.empty();
	}

	private draw(): void {
		this.root.empty();
		this.root.addClass("nfo-view", "nfo-bases-board");

		const groups = this.data?.groupedData ?? [];
		const groupBy = this.config.getAsPropertyId("groupBy");

		if (!groupBy) {
			this.root.createDiv({
				cls: "nfo-callout-error",
				text: "A board needs a property to group by. Choose one under “Group by” in this view's settings.",
			});
			return;
		}

		// Only a frontmatter property can be written, so a board grouped by a
		// formula is readable but not draggable. Saying so beats a drag that
		// silently does nothing.
		const key = writableKey(groupBy);
		const board = this.root.createDiv({ cls: "nfo-board" });
		if (!key) {
			this.root.createDiv({
				cls: "nfo-board-note",
				text: `Grouped by ${this.config.getDisplayName(groupBy)}, which is computed — cards can be read here but not dragged.`,
			});
		}

		for (const group of groups) {
			this.drawColumn(board, group, groupBy, key);
		}
	}

	private drawColumn(
		board: HTMLElement,
		group: BasesEntryGroup,
		groupBy: BasesPropertyId,
		key: string | null
	): void {
		const label = group.hasKey() ? (group.key?.toString() ?? "") : "";
		const column = board.createDiv({ cls: "nfo-board-column" });

		const header = column.createDiv({ cls: "nfo-board-header" });
		if (label) pill(header, label, autoColor(label));
		else header.createSpan({ cls: "nfo-pill nfo-color-default", text: "No value" });
		header.createSpan({ cls: "nfo-board-count", text: String(group.entries.length) });

		const list = column.createDiv({ cls: "nfo-board-cards" });

		if (key) {
			list.addEventListener("dragover", (evt) => {
				evt.preventDefault();
				list.addClass("nfo-drop-active");
			});
			list.addEventListener("dragleave", () => list.removeClass("nfo-drop-active"));
			list.addEventListener("drop", (evt) => {
				evt.preventDefault();
				list.removeClass("nfo-drop-active");
				const path = evt.dataTransfer?.getData("text/nfo-row");
				if (!path) return;
				// The label is the value: a column headed "Doing" holds the rows
				// whose property reads Doing, so dropping there means that.
				this.move(path, key, label || null);
			});
		}

		for (const entry of group.entries) this.drawCard(list, entry, key);

		const add = column.createDiv({ cls: "nfo-board-add" });
		setIcon(add.createSpan(), "plus");
		add.createSpan({ text: "New" });
		add.addEventListener("click", () => {
			runDetached("add a row", () =>
				this.createFileForView(label || undefined, (frontmatter: Record<string, unknown>) => {
					// A row created in a column belongs in that column.
					if (key && label) frontmatter[key] = label;
				})
			);
		});
	}

	private drawCard(list: HTMLElement, entry: BasesEntry, key: string | null): void {
		const card = list.createDiv({ cls: "nfo-card" });
		const title = card.createDiv({ cls: "nfo-card-title", text: entry.file.basename });
		void title;

		// Bases knows how to render its own values -- a date as a date, a list
		// as chips -- so hand each one back to it rather than stringifying.
		for (const prop of this.data?.properties ?? []) {
			if (prop === key) continue;
			const value = entry.getValue(prop);
			if (!value) continue;
			const text = value.toString();
			if (!text) continue;
			const line = card.createDiv({ cls: "nfo-card-prop" });
			line.createSpan({ cls: "nfo-card-prop-name", text: this.config.getDisplayName(prop) });
			line.createSpan({ cls: "nfo-card-prop-value", text });
		}

		if (key) {
			card.setAttribute("draggable", "true");
			card.addEventListener("dragstart", (evt) => {
				evt.dataTransfer?.setData("text/nfo-row", entry.file.path);
				card.addClass("nfo-card-dragging");
			});
			card.addEventListener("dragend", () => card.removeClass("nfo-card-dragging"));
		}

		card.addEventListener("click", () => {
			void this.app.workspace.getLeaf(false).openFile(entry.file);
		});
		card.addEventListener("contextmenu", (evt) => {
			evt.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Open in a new tab")
					.setIcon("file-text")
					.onClick(() => void this.app.workspace.getLeaf("tab").openFile(entry.file))
			);
			menu.showAtMouseEvent(evt);
		});
	}

	/** Write the grouping property, which is the whole of what a drop means. */
	private move(path: string, key: string, value: string | null): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		runDetached("move that card", async () => {
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter: Record<string, unknown>) => {
					if (value === null) delete frontmatter[key];
					else frontmatter[key] = value;
				}
			);
		});
	}
}

/**
 * Offer the board to Bases, if this Obsidian has Bases at all.
 *
 * `registerBasesView` arrived in 1.10 and the plugin's floor is 1.13, so it
 * should always be there -- but a missing method must not take the whole
 * plugin down with it, and a future Obsidian could rename this.
 */
export function registerBasesBoard(plugin: Plugin): boolean {
	const register = (
		plugin as unknown as {
			registerBasesView?: (id: string, registration: unknown) => boolean;
		}
	).registerBasesView;
	if (typeof register !== "function") return false;

	try {
		return (
			register.call(plugin, BASES_BOARD_VIEW, {
				name: "Board",
				icon: "layout-dashboard",
				factory: (controller: QueryController, container: HTMLElement) =>
					new BasesBoardView(controller, container),
			}) ?? false
		);
	} catch (error) {
		console.error("Notion Suite: could not register the board with Bases", error);
		return false;
	}
}
