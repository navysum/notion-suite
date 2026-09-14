import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
	setIcon,
} from "obsidian";
import { CURSOR, SlashCommand, scoreCommand, slashCommands } from "./commands";

export interface SlashHost {
	app: App;
	runAction: (action: NonNullable<SlashCommand["action"]>, editor: Editor) => void;
	isEnabled: () => boolean;
	triggerCharacter: () => string;
}

/**
 * The `/` menu.
 *
 * Obsidian's EditorSuggest gives us the popup, keyboard navigation and
 * positioning for free; the work here is deciding when a slash is a command
 * trigger rather than a literal slash (a URL, a date, a path) and applying the
 * chosen snippet cleanly.
 */
export class SlashSuggest extends EditorSuggest<SlashCommand> {
	private commands: SlashCommand[] = slashCommands();
	private lastGroup: string | null = null;

	constructor(private host: SlashHost) {
		super(host.app);
		this.setInstructions([
			{ command: "↑↓", purpose: "navigate" },
			{ command: "↵", purpose: "insert" },
			{ command: "esc", purpose: "dismiss" },
		]);
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile | null
	): EditorSuggestTriggerInfo | null {
		if (!this.host.isEnabled()) return null;

		const trigger = this.host.triggerCharacter() || "/";
		const line = editor.getLine(cursor.line);
		const beforeCursor = line.slice(0, cursor.ch);
		const triggerIndex = beforeCursor.lastIndexOf(trigger);
		if (triggerIndex === -1) return null;

		// Only fire at the start of a line or after whitespace, so that
		// `https://`, `and/or` and `2024/05/01` are left alone.
		const charBefore = triggerIndex === 0 ? "" : beforeCursor[triggerIndex - 1];
		if (charBefore !== "" && !/\s/.test(charBefore)) return null;

		const query = beforeCursor.slice(triggerIndex + trigger.length);
		// A space ends the command; multi-word commands are matched by alias.
		if (/\s/.test(query)) return null;
		if (query.length > 24) return null;

		return {
			start: { line: cursor.line, ch: triggerIndex },
			end: cursor,
			query,
		};
	}

	getSuggestions(context: EditorSuggestContext): SlashCommand[] {
		const query = context.query.trim();
		const scored: Array<{ command: SlashCommand; score: number }> = [];
		for (const command of this.commands) {
			const score = scoreCommand(command, query);
			if (score === null) continue;
			scored.push({ command, score });
		}
		// Stable ordering: best match first, then the authored order within a tie.
		scored.sort((a, b) => b.score - a.score);
		this.lastGroup = null;
		return scored.map((entry) => entry.command).slice(0, 40);
	}

	renderSuggestion(command: SlashCommand, node: HTMLElement): void {
		node.addClass("nfo-slash-item");

		// Group headers are drawn inside the first item of each group, since
		// EditorSuggest has no notion of section rows.
		if (command.group !== this.lastGroup) {
			node.createDiv({ cls: "nfo-slash-group", text: command.group });
			this.lastGroup = command.group;
		}

		const row = node.createDiv({ cls: "nfo-slash-row" });
		const iconBox = row.createDiv({ cls: "nfo-slash-icon" });
		setIcon(iconBox, command.icon);

		const textBox = row.createDiv({ cls: "nfo-slash-text" });
		textBox.createDiv({ cls: "nfo-slash-title", text: command.title });
		textBox.createDiv({ cls: "nfo-slash-desc", text: command.description });
	}

	selectSuggestion(command: SlashCommand): void {
		const context = this.context;
		if (!context) return;
		const { editor, start, end } = context;

		if (command.action) {
			editor.replaceRange("", start, end);
			editor.setCursor(start);
			this.host.runAction(command.action, editor);
			this.close();
			return;
		}

		const snippet = command.insert ?? "";
		const cursorOffset = snippet.indexOf(CURSOR);
		const text = snippet.split(CURSOR).join("");

		editor.replaceRange(text, start, end);

		if (cursorOffset === -1) {
			editor.setCursor({ line: start.line, ch: start.ch + text.length });
		} else {
			// Translate the marker's offset into a line/ch position, since the
			// snippet may span several lines.
			const before = text.slice(0, cursorOffset);
			const lineBreaks = before.split("\n").length - 1;
			const lastLine = before.slice(before.lastIndexOf("\n") + 1);
			editor.setCursor({
				line: start.line + lineBreaks,
				ch: lineBreaks === 0 ? start.ch + lastLine.length : lastLine.length,
			});
		}
		this.close();
	}
}
