import { PropertyDef } from "../types";
import { autoColor } from "../utils/dom";

export interface DatabaseTemplate {
	id: string;
	name: string;
	icon: string;
	description: string;
	properties: PropertyDef[];
	/** The view block inserted into the note after creation. */
	defaultView: "table" | "board" | "gallery" | "list" | "calendar";
	groupBy?: string;
	sampleRows?: Array<{ name: string; values: Record<string, unknown> }>;
}

function select(id: string, name: string, options: string[]): PropertyDef {
	return {
		id,
		name,
		type: "select",
		options: options.map((option) => ({ name: option, color: autoColor(option) })),
	};
}

function multi(id: string, name: string, options: string[]): PropertyDef {
	return {
		id,
		name,
		type: "multiselect",
		options: options.map((option) => ({ name: option, color: autoColor(option) })),
	};
}

/** Starter databases mirroring the templates Notion offers on a new page. */
export function databaseTemplates(): DatabaseTemplate[] {
	return [
		{
			id: "blank",
			name: "Blank",
			icon: "📄",
			description: "One text property. Add the rest as you go.",
			defaultView: "table",
			properties: [{ id: "notes", name: "Notes", type: "text" }],
		},
		{
			id: "tasks",
			name: "Task tracker",
			icon: "✅",
			description: "Status board with due dates and priorities.",
			defaultView: "board",
			groupBy: "status",
			properties: [
				select("status", "Status", ["Not started", "In progress", "Blocked", "Done"]),
				select("priority", "Priority", ["Low", "Medium", "High", "Urgent"]),
				{ id: "due", name: "Due", type: "date" },
				multi("tags", "Tags", ["Work", "Personal", "Admin"]),
				{ id: "done", name: "Done", type: "checkbox" },
			],
			sampleRows: [
				{ name: "Set up my first database", values: { status: "In progress", priority: "High" } },
				{ name: "Try the board view", values: { status: "Not started", priority: "Medium" } },
				{ name: "Read the plugin README", values: { status: "Done", priority: "Low", done: true } },
			],
		},
		{
			id: "projects",
			name: "Projects",
			icon: "🚀",
			description: "Track projects with owners, dates and progress.",
			defaultView: "table",
			groupBy: "stage",
			properties: [
				select("stage", "Stage", ["Idea", "Planning", "Active", "Paused", "Shipped"]),
				{ id: "owner", name: "Owner", type: "person" },
				{ id: "start", name: "Start", type: "date" },
				{ id: "target", name: "Target", type: "date" },
				{ id: "progress", name: "Progress", type: "number", numberFormat: "percent" },
				{ id: "link", name: "Link", type: "url" },
			],
		},
		{
			id: "goals",
			name: "Goals",
			icon: "🎯",
			description: "Quarterly goals with a completion percentage.",
			defaultView: "list",
			groupBy: "quarter",
			properties: [
				select("quarter", "Quarter", ["Q1", "Q2", "Q3", "Q4"]),
				select("area", "Area", ["Health", "Career", "Learning", "Money", "Relationships"]),
				{ id: "target_value", name: "Target", type: "number" },
				{ id: "current_value", name: "Current", type: "number" },
				{
					id: "completion",
					name: "Completion",
					type: "formula",
					formula: "{Current} / {Target}",
					numberFormat: "percent",
				},
				{ id: "achieved", name: "Achieved", type: "checkbox" },
			],
		},
		{
			id: "habits",
			name: "Habit log",
			icon: "🔁",
			description: "One row per day, charted over time.",
			defaultView: "calendar",
			properties: [
				{ id: "date", name: "Date", type: "date" },
				select("habit", "Habit", ["Exercise", "Read", "Meditate", "Journal"]),
				{ id: "completed", name: "Completed", type: "checkbox" },
				{ id: "minutes", name: "Minutes", type: "number" },
			],
		},
		{
			id: "reading",
			name: "Reading list",
			icon: "📚",
			description: "Gallery of books with covers and ratings.",
			defaultView: "gallery",
			groupBy: "status",
			properties: [
				select("status", "Status", ["To read", "Reading", "Finished", "Abandoned"]),
				{ id: "author", name: "Author", type: "text" },
				{ id: "cover", name: "Cover", type: "files" },
				{ id: "rating", name: "Rating", type: "number" },
				multi("genre", "Genre", ["Fiction", "Non-fiction", "Technical", "Biography"]),
				{ id: "finished", name: "Finished", type: "date" },
			],
		},
		{
			id: "crm",
			name: "People / CRM",
			icon: "👥",
			description: "Contacts with company, status and last touch.",
			defaultView: "table",
			groupBy: "status",
			properties: [
				select("status", "Status", ["Lead", "In conversation", "Customer", "Dormant"]),
				{ id: "company", name: "Company", type: "text" },
				{ id: "email", name: "Email", type: "email" },
				{ id: "phone", name: "Phone", type: "phone" },
				{ id: "last_contact", name: "Last contact", type: "date" },
				multi("tags", "Tags", ["VIP", "Newsletter", "Referral"]),
			],
		},
		{
			id: "expenses",
			name: "Expenses",
			icon: "💸",
			description: "Spending by category, ready to chart.",
			defaultView: "table",
			groupBy: "category",
			properties: [
				{ id: "date", name: "Date", type: "date" },
				{ id: "amount", name: "Amount", type: "number", numberFormat: "currency" },
				select("category", "Category", [
					"Rent",
					"Groceries",
					"Transport",
					"Eating out",
					"Subscriptions",
					"Other",
				]),
				select("method", "Method", ["Card", "Cash", "Transfer"]),
				{ id: "reimbursable", name: "Reimbursable", type: "checkbox" },
			],
		},
		{
			id: "notes",
			name: "Meeting notes",
			icon: "🗒️",
			description: "Dated notes with attendees and follow-ups.",
			defaultView: "list",
			properties: [
				{ id: "date", name: "Date", type: "date" },
				{ id: "attendees", name: "Attendees", type: "person" },
				multi("topics", "Topics", ["Planning", "Review", "1:1", "Retro"]),
				{ id: "follow_up", name: "Follow-up needed", type: "checkbox" },
			],
		},
	];
}
