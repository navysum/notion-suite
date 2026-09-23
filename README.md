# Notion Suite

Bring the parts of Notion you actually miss into Obsidian: the `/` menu, databases,
table / board / gallery / list / calendar / timeline views, inline property editing,
sub-items, relations, rollups, and charts built from your own data.

Everything stays plain markdown. There is no lock-in, no sync service, and no
account. If you uninstall this plugin tomorrow, every note you made is still a
normal `.md` file you can open in any editor.

---

## Table of contents

1. [The one idea you need first](#1-the-one-idea-you-need-first)
2. [Installing it](#2-installing-it)
3. [Your first database, step by step](#3-your-first-database-step-by-step)
4. [The slash menu](#4-the-slash-menu)
5. [Database views](#5-database-views)
6. [Getting around: the sidebar and full-page databases](#6-getting-around-the-sidebar-and-full-page-databases)
7. [Filtering and sorting](#7-filtering-and-sorting)
8. [Property types, relations and rollups](#8-property-types-relations-and-rollups)
9. [Sub-items, unique IDs, bulk editing and repeats](#9-sub-items-unique-ids-bulk-editing-and-repeats)
10. [Boards in depth](#10-boards-in-depth)
11. [Charts](#11-charts)
12. [Widgets](#12-widgets)
12b. [Properties on the page, saved views, and getting your data out](#12b-properties-on-the-page-saved-views-and-getting-your-data-out)
13. [Page furniture: icons, covers, contents, breadcrumbs, columns](#13-page-furniture-icons-covers-contents-breadcrumbs-columns)
14. [Coming from Notion](#14-coming-from-notion)
15. [What this plugin touches](#15-what-this-plugin-touches)
16. [Settings and commands](#16-settings-and-commands)
17. [Troubleshooting](#17-troubleshooting)
18. [Developing](#18-developing)

---

## 1. The one idea you need first

Notion stores your databases on Notion's servers, in a format only Notion understands.
Obsidian stores everything as markdown files in a folder on your computer.

So this plugin does not invent a new storage format. It reuses what Obsidian already has:

| In Notion | Here |
| --- | --- |
| A database | A **folder** |
| A row / page in that database | A **note** inside that folder |
| A property on that row | A line of **frontmatter** at the top of that note |
| A view (board, calendar…) | A small **code block** you paste into any note |

That's the whole model. Once it clicks, everything else follows.

Here's a row. It is just a note:

```markdown
---
status: In progress
priority: 3
due: 2026-03-14
tags:
  - Work
  - Urgent
---

Notes about this task go here, like any other Obsidian note.
```

That block between the `---` lines is **frontmatter**. Obsidian already understands it;
this plugin gives it a Notion-style interface. When you tick a checkbox or drag a card
between board columns, the plugin edits those frontmatter lines. Nothing else.

**Why this is worth knowing:** you can always edit a row by hand, in any text editor,
without the plugin. That is the escape hatch Notion never gave you.

---

## 2. Installing it

> **Requires Obsidian 1.13.0 or later.** The settings tab uses the declarative
> settings API, which is what puts your settings into Obsidian's own search.

### Option A — the community directory (recommended)

Settings → Community plugins → **Browse** → search for **Notion Suite** → Install
→ Enable.

Updates arrive through Obsidian itself from then on; there is nothing else to set up.

> If it doesn't appear in Browse, Obsidian is showing you a cached plugin list.
> Close and reopen the Browse dialog, or restart Obsidian, and search again.

### Option B — BRAT

BRAT installs a plugin straight from a GitHub repository. Useful if you want
releases the moment they are cut rather than when the directory catches up.

1. Install **BRAT** from Settings → Community plugins → Browse.
2. Run the command **BRAT: Plugins: Add a beta plugin for testing**.
3. Paste `https://github.com/navysum/notion-suite`, choose **Latest version**,
   and tick "enable after installing".

### Option C — build it yourself

You need [Node.js](https://nodejs.org).

```bash
git clone https://github.com/navysum/notion-suite
cd notion-suite
npm install
npm run build
```

That produces `main.js`. Copy `main.js`, `manifest.json` and `styles.css` into:

```
<your vault>/.obsidian/plugins/notion-suite/
```

Create that folder if it doesn't exist. (On macOS press `Cmd+Shift+.` in Finder
to reveal hidden folders; on Windows tick "Hidden items" in File Explorer's View
tab.) Then in Obsidian go to Settings → Community plugins, hit the reload icon,
and toggle **Notion Suite** on.

`main.js` is deliberately **not** committed to this repository — it is a build
artifact, published as a release asset. The community directory verifies that a
release was genuinely built from the committed source, and a stale checked-in
bundle is what that check exists to catch.

You should now see a database icon in the left ribbon.

---

## 3. Your first database, step by step

**Step 1.** Make a new note. Call it anything — `Dashboard` works well.

**Step 2.** In the body of the note, type `/database`.

A menu appears as soon as you type the `/`. Pick **Database — new**.

**Step 3.** Choose a starter. There are nine, including Task tracker, Projects, Goals,
Habit log, Reading list, Expenses and People/CRM. Pick **Task tracker** for now — it
comes with a Status property already set up, which is what makes a board work.

Leave "Add a few example rows" ticked so you have something to look at.

**Step 4.** Press **Create database**.

Two things just happened:

- A folder was created (`Databases/Tasks` by default), with three example notes in it.
- A small block was inserted into your note:

```notion-db
database: Tasks
view: board
group: status
```

**Step 5.** Switch the note out of edit mode (`Cmd/Ctrl+E`, or click away from the block).

You now have a working kanban board. Try these:

- **Drag a card** between columns. Open the note behind that card and you'll see its
  `status:` line has changed. That's the whole trick.
- **Click "+ New"** at the bottom of a column. It creates a note already tagged with
  that column's status.
- **Click the "Board" button** in the toolbar and switch to Table. Now you can click
  any cell and edit it in place.
- **Type in the search box.** It filters across the title and every property.
- **Click a row.** It opens beside the view rather than over it — Notion's "side peek",
  so you don't lose the board you were working in.

**Step 6.** Add a second view of the *same* data. Type `/database` again, pick
**Database — view**, choose Tasks, and choose Calendar.

You now have two live views of the same folder, both editable, both staying in sync.
That is the thing Notion does that plain markdown doesn't.

---

## 4. The slash menu

Type `/` anywhere in the editor. Type more letters to narrow it down, arrow keys to
move, `Enter` to insert, `Esc` to dismiss.

The `/` only triggers at the start of a line or after a space, so URLs (`https://`),
dates (`2026/03/14`) and phrases like `and/or` are left alone.

**Basic blocks** — Text, Heading 1/2/3, Bulleted list, Numbered list, To-do list,
Toggle list, **Toggle heading 1/2/3**, Quote, Divider, Code, Table, Columns

**Page structure** — Table of contents, Breadcrumb, Page icon and cover

**Callouts** — Callout, Tip, Warning, Danger, Success, Question

**Databases** — Database (new), Database view, Add item, Chart from database, Widget

**Inline** — Date (today), Date (tomorrow), Link to page, Embed page, Equation, Highlight

You don't have to type the exact name. Every command has aliases, so `/kanban` finds the
database view, `/graph` finds the chart, `/collapse` finds the toggle, `/checkbox`
finds the to-do, and `/banner` finds the page icon and cover.

Want a different trigger character? Settings → Notion Suite → Trigger character.

---

## 5. Database views

**You never have to write this by hand.** `/database` → **Database view** opens a
dialog for every setting. On any rendered view, the toolbar has a **⚙ Settings**
button that reopens it, pre-filled.

Switching view type is even quicker: click the view-type button in the toolbar
(**Table**, **Board**, …) and pick another. That choice is saved into the note,
so it sticks — it isn't just a preview.

### The six views

**Table** — a spreadsheet. Click any cell to edit it. Click a column header to sort,
hide it, or set a **footer calculation** (sum, average, percent checked…). Rows with
sub-items get a twisty to fold them away. Set **Group by** and the table splits
into foldable bands, each with its own count and its own totals.

**Board** — kanban. Drag cards between columns to change the grouping property. Empty
columns still show, so you can drag into them. Columns can carry totals as well as
counts. See [Boards in depth](#10-boards-in-depth).

**Gallery** — cards with cover images. Good for a reading list, recipes, or anything
visual.

**List** — a compact line per row. If the database has a checkbox property, it becomes a
tickable to-do list.

**Calendar** — a month grid. Hover a day and press `+` to create a row already dated to
that day. Arrows move between months.

> **Large databases.** A view draws a hundred rows and offers the rest — *"Showing
> 100 of 1,240"*, with **Show 100 more** and **Show all**. Drawing four thousand
> rows at once froze Obsidian for seconds; this keeps opening a view instant
> whatever the size. A view's own `limit:` still wins.

**Timeline** — a Gantt-style chart. Each row becomes a bar between a start and an end
date. Scale it by day, week or month.

<details>
<summary>The underlying syntax, if you ever want to read or hand-edit it</summary>

A view is a fenced code block tagged `notion-db`. The only required line is `database:`.

````markdown
```notion-db
database: Tasks
view: board
group: status
```
````

| Key | What it does | Example |
| --- | --- | --- |
| `database` | Which database to show. Required. | `database: Tasks` |
| `view` | `table`, `board`, `gallery`, `list`, `calendar` or `timeline`. Defaults to `table`. | `view: board` |
| `title` | A heading for this view. | `title: This week` |
| `group` | Board columns. Needs a select, status, multi-select or checkbox property. | `group: status` |
| `subgroup` | A second grouping that splits each board column. | `subgroup: priority` |
| `collapsed` | Board columns that start folded. | `collapsed: [Done]` |
| `limits` | Per-column card limits (WIP limits). | `limits: {Doing: 3}` |
| `limit_mode` | `soft` (default), `ask` or `strict` — what a limit does on a drop. | `limit_mode: ask` |
| `buckets` | Bucket a date grouping into overdue / today / this week / later. | `buckets: true` |
| `date` | Which date property the calendar uses. | `date: due` |
| `start` / `end` | The properties bounding each timeline bar. | `start: begins` |
| `scale` | Timeline scale: `day`, `week` or `month`. | `scale: week` |
| `cover` | Which property holds the card image (gallery/board). | `cover: cover` |
| `size` | Gallery card size: `small`, `medium`, `large`. | `size: large` |
| `properties` | Which properties to show, in this order. | `properties: [status, due]` |
| `hide` | Properties to hide **in this view only**. | `hide: [notes]` |
| `calculate` | Table footer calculations, per property. | `calculate: {hours: sum}` |
| `filter` | Which rows to show. See below. | `filter: [Status is not Done]` |
| `sort` | Row order. | `sort: due asc` |
| `limit` | Show at most this many rows. | `limit: 10` |

</details>

---

## 6. Getting around: the sidebar and full-page databases

Two views of a database are useful. Fifteen are a filing problem, which is why
Notion puts databases in a sidebar rather than only inside pages.

**The sidebar.** Click the database icon in the left ribbon, or run **Notion: Show
the databases sidebar**. Every database in the vault is listed with a live row
count. Click one to open it.

**Full-page databases.** A database opened from the sidebar fills a whole tab,
with no host note around it — the same views, the same toolbar, the same editing,
just not embedded in anything. Run **Notion: Open a database** to jump straight to
one.

Use inline blocks when a view belongs to a note ("this project's tasks"), and the
sidebar when the database *is* the thing you're working in.

---

## 7. Filtering and sorting

**You build a filter by clicking.** In any view's ⚙ Settings, each condition is
three controls — property, test, value — with **+ Add a condition** underneath
and an **all / any** switch on top. The tests offered follow the property's
type, so a checkbox only offers *is*, a number never offers *starts with*, and
choosing *is empty* removes the value box because there's nothing left to
compare. Sorting works the same way, and a second sort breaks ties rather than
replacing the first.

Underneath, a filter is still plain English, one per line — that's the storage
format, so anything you build can be read by hand and anything you write by hand
opens in the builder:

````markdown
```notion-db
database: Tasks
view: table
filter:
  - Status is not Done
  - Due is not empty
  - Priority >= 3
sort: due asc
```
````

Multiple filters are combined with **and** by default. For **or**, nest them under `any`:

````markdown
```notion-db
database: Tasks
filter:
  any:
    - Status is Blocked
    - Priority is Urgent
```
````

You can also write a group inline, and nest up to three levels deep:

```
filter:
  - Priority >= 3
  - (Status is Doing or Owner is me)
```

Brackets are the one thing the click-built rows can't express, so a nested
filter hands over to a text box rather than being silently flattened.

**Operators you can use:**

`is` · `is not` · `contains` · `does not contain` · `starts with` · `ends with` ·
`is empty` · `is not empty` · `before` · `after` · `on or before` · `on or after` ·
`>` · `>=` · `<` · `<=` · `=` · `!=`

**Two useful tricks:**

- `Due before today` — the word `today` works anywhere a date does, and re-evaluates
  every time the view renders.
- `Name contains report` — `Name` refers to the note's title, not a frontmatter key.

**Sorting:** `sort: due asc`, `sort: -priority` (the minus means descending), or a list
for tie-breaking:

```
sort:
  - priority desc
  - due asc
```

---

## 8. Property types, relations and rollups

| Type | Stored as | Editing |
| --- | --- | --- |
| `text` | a string | click to type |
| `number` | a number | click to type; formats as plain, percent or currency |
| `select` | a string | click for a menu of options |
| `status` | a string | like select, but options are bucketed into To-do / In progress / Done |
| `multiselect` | a list | click to tick several |
| `date` | `YYYY-MM-DD` | click for a date picker |
| `checkbox` | `true` / `false` | click the box |
| `url` / `email` / `phone` | a string | rendered clickable, pencil icon to edit |
| `person` | a list of names | click to tick several |
| `files` | a path or URL | used as the cover image in gallery and board |
| `relation` | a list of note titles | click to link rows in another database |
| `rollup` | computed | read-only, see below |
| `formula` | computed | read-only, see below |
| `uniqueid` | a number, with an optional prefix | assigned once, never reused |
| `created` / `updated` | from the file itself | read-only |

### Relations and rollups

This is the pair that makes a set of databases behave like one system, and it's
worth setting up once slowly so you see how the two halves fit.

A **relation** links a row to rows in another database. A **rollup** reaches
through that link and does maths on what it finds. Relations alone just give you
clickable links; rollups are what turn them into numbers.

**Worked example — Projects that total up their Tasks.**

Say you have a `Tasks` database with an `Hours` number property and a `Done`
checkbox, and a `Projects` database. You want each project to show its total
hours and how far along it is.

**Step 1 — add the relation.** Open a view of `Projects`, click **Properties →
New property…**. Name it `Tasks`, set the type to **Relation**, and choose
`Tasks` as the related database. Save.

You now have a Tasks cell on every project. Click one and tick the tasks that
belong to that project. Behind the scenes this writes a plain list of note
titles into the project's frontmatter:

```yaml
tasks:
  - Design the homepage
  - Build the homepage
```

**Step 2 — add the rollup.** **Properties → New property…** again. Name it
`Total hours`, type **Rollup**. Now three dropdowns appear, and they read as a
sentence:

- **Relation** → `Tasks` — *which link to follow*
- **Property** → `Hours` — *what to grab off each related row*
- **Calculate** → `Sum` — *how to squash those into one number*

Save. Every project now shows the total hours of its tasks, and it updates the
moment you change an hour count on any task.

**Step 3 — try a different calculation.** Add another rollup called `Progress`,
same relation, property `Done`, calculate **Percent checked**. That's a live
completion percentage per project, computed from the task notes themselves.

### What you can calculate

| Group | Functions |
| --- | --- |
| Show | `Show original` — lists the values rather than reducing them |
| Count | `Count all` (related rows), `Count values`, `Count unique values`, `Count empty`, `Count not empty`, `Percent empty`, `Percent not empty` |
| Numbers | `Sum`, `Average`, `Median`, `Min`, `Max`, `Range` |
| Dates | `Earliest date`, `Latest date`, `Date range (days)` |
| Checkboxes | `Checked`, `Unchecked`, `Percent checked`, `Percent unchecked` |

The same list powers **table footer calculations** — click a column header and pick
one to get a total under the column.

Two distinctions that trip people up:

- **`Count all` vs `Count values`** — `Count all` counts related *rows*. `Count
  values` counts the *values gathered*, which is larger when the property you're
  rolling up is a multi-select. Rolling up a `Tags` multi-select across 3 rows
  that carry 7 tags between them gives `Count all: 3`, `Count values: 7`.
- **Empty rows still count.** `Percent checked` divides by every gathered value,
  including unset ones, so a task with no `Done` value drags the percentage down
  rather than being ignored.

### Things worth knowing

- **Rollups are read-only.** They're computed when a view renders and never
  written to your notes, so nothing is duplicated and nothing can drift.
- **Rollups can feed formulas.** Rollups resolve first, so a formula like
  `{Total hours} * {Rate}` works and gives you a live project cost.
- **You can roll up a rollup.** The far side's rollups resolve before this one
  reads them.
- **Circular rollups won't hang.** If Projects rolls up Tasks and Tasks rolls
  back up into Projects, that has no stable answer — every value depends on
  itself. Rather than spinning forever, resolution stops after one level and
  those results aren't cached. You'll get a number, but treat it as approximate;
  it's better to avoid the loop.
- **Matching is by note title**, case-insensitive, and `[[Wikilinks]]`,
  `[[Links|with aliases]]` and bare text all work. If two notes in the target
  database share a title, the first one found wins.

### Formulas

Reference other properties in `{braces}` and use `+ - * / ( )`:

```
{Current} / {Target}
({Revenue} - {Cost}) / {Revenue}
{Hours} * 85
```

There's a good deal more than arithmetic:

| Group | Functions |
| --- | --- |
| Logic | `if(test, then, else)`, `switch(value, case, result, …, fallback)`, `empty(x)`, `notEmpty(x)` |
| Numbers | `round`, `floor`, `ceil`, `abs`, `min`, `max`, `toNumber` |
| Text | `length`, `lower`, `upper`, `slice`, `contains`, `replaceAll`, `format` |
| Dates | `today()`, `now()`, `dateAdd`, `dateSubtract`, `dateBetween`, `formatDate` |
| Bindings | `let name = …`, `const`, so a long formula can name its parts |

```
if({Done}, "✓", if(dateBetween({Due}, today(), "days") < 0, "Overdue", "On track"))
let rate = 85; {Hours} * rate
formatDate({Due}, "ddd") 
```

`replaceAll` takes a literal string, **not** a regular expression — `replaceAll(s, ".", "-")`
replaces full stops, not every character. Notion's version takes a regex; this one
deliberately doesn't, so your own text is never accidentally a pattern.

What it cannot do is run code. There's no `eval` anywhere near it — it's a hand-written
tokenizer and parser, which is why it's safe to evaluate automatically on every render.
Checkboxes count as `1` and `0`, a reference to a property that doesn't exist counts as
`0`, and division by zero gives an empty cell rather than an error.

---

## 9. Sub-items, unique IDs, bulk editing and repeats

### Sub-items

A row can be nested under another row. Add a property to hold the parent's title (**Properties → New property…**,
type **Text** or **Relation**), and turn on **Use as the parent link** in that
same dialog. Rows that name a parent appear indented underneath it, with a
twisty to fold them away.

Because the link is an ordinary property holding a title, the hierarchy is
visible and editable in the note itself — not hidden in plugin state.

Deleting a parent asks what to do with anything nested under it: take them too,
or leave them (they become top-level rows). Dismissing that dialog cancels the
delete outright.

### Unique IDs

Add a property of type **Unique ID** and every row gets a number that is assigned
once and never reused, optionally with a prefix — `TASK-1`, `TASK-2`. Deleting a
row does not free its number, which is the point: an ID you can quote in a
conversation has to keep meaning the same thing.

Already have rows? Run **Notion: Assign unique IDs to existing rows**.

### Bulk editing

Tick the box beside several rows in a table and a bar appears. It sets one
property across every ticked row at once — the fastest way to re-triage a
backlog. Deleting from that bar asks first, and tells you how many sub-items
are about to be orphaned so you can take them too.

### Repeating rows

"Water the plants, every Tuesday" is a task you want back the moment you've done
it. Set it up from a database's context menu → **Repeating rows…**: which text
property holds the rule, which date moves, and which checkbox ticking off means
done.

Ticking the row off creates the next one, copied from the one you finished, with
the tick cleared and the date moved on. Nothing appears until you finish the last
one — so a fortnight away doesn't leave you fourteen identical rows.

Rules are written the way you'd say them: `daily` · `weekly` · `fortnightly` ·
`monthly` · `quarterly` · `yearly` · `every 3 days` · `every other week` ·
`every Tuesday` · `weekdays`. Anything it can't read is ignored, so a text
property holding ordinary prose never starts creating rows.

---

## 10. Boards in depth

Boards are where most of Notion's day-to-day feel lives, so they carry the most
options. All of them are in the ⚙ Settings dialog.

- **Sub-grouping.** Split every column by a second property, so a Status board
  reads Priority-first inside each column.
- **Collapsible columns.** Fold a column you aren't working in. The state is
  saved into the block, so it stays folded.
- **WIP limits.** Give a column a card limit. What a limit *means* is yours to
  choose: `soft` colours the count and lets the drop through (the default — a
  limit is a signal, not a rule), `ask` confirms first, `strict` refuses.
- **Manual ordering.** Drag a card within its column to reorder it. The first
  time you do, the plugin offers to store positions in a hidden property; say no
  and it won't ask again that session.
- **Date buckets.** Group by a date property and the columns become **Overdue /
  Today / This week / Later** rather than one column per date.

---

## 11. Charts

This is the piece Notion charges for.

**You never have to write any of this by hand.** Type `/chart`, and you get a
dialog of dropdowns with a **live preview** — the chart redraws as you change
each setting, so you pick by looking rather than by remembering.

Once a chart is in your note, hover it and click **⚙ Edit chart** to change it.
Same dialog, pre-filled with what that chart currently does.

<details>
<summary>The underlying syntax, if you ever want to read or hand-edit it</summary>

Behind the scenes a chart is a code block. You can edit it directly if you
prefer, but the dialog writes every one of these keys for you.

````markdown
```notion-chart
database: Tasks
chart: donut
group: status
aggregate: count
title: Where my tasks are
```
````

| Key | What it does |
| --- | --- |
| `database` | Which database. Required. |
| `group` | The property whose values become bars or slices. Required. |
| `chart` | `column`, `bar`, `line`, `area`, `pie`, `donut`, `scatter`. Default `column`. |
| `aggregate` | `count`, `sum`, `average`, `median`, `min`, `max`, `count_unique`, `percent_checked`. |
| `value` | Which numeric property to aggregate. Not needed for `count`. A rollup counts as numeric here. |
| `series` | Split into multiple coloured series by a second property. |
| `stacked` | `true` to stack the series instead of placing them side by side. |
| `filter` | Same syntax as a view's filter. |
| `sort` | `value_desc` (default), `value`, `label` or `none`. |
| `limit` | Only chart the top N groups. |
| `height` | Chart height in pixels. Default 340. |
| `legend` / `values` | `false` to hide the legend or the data labels. |

</details>

**Some charts worth stealing** — paste these, or build them in the dialog:

Spending by category this year:

````markdown
```notion-chart
database: Expenses
chart: bar
group: category
value: amount
aggregate: sum
filter: [Date after 2026-01-01]
sort: value_desc
title: Where the money went
```
````

Tasks completed per month, split by priority:

````markdown
```notion-chart
database: Tasks
chart: column
group: due
series: priority
aggregate: count
stacked: true
filter: [Done is true]
```
````

Habit consistency:

````markdown
```notion-chart
database: Habit log
chart: line
group: date
value: completed
aggregate: percent_checked
sort: label
```
````

Charts re-draw whenever the underlying notes change, take their colours from your
Obsidian theme, and are drawn as plain SVG — no chart library, nothing loaded from the
internet. Hover any bar or slice for exact numbers.

Grouping by a date buckets into months automatically, since a chart with one bar per day
is unreadable.

---

## 12. Widgets

A chart answers "how is this distributed?". A widget answers "what's the one
number?" — the small, glanceable things a Notion dashboard is made of. Type
`/widget` and pick a kind.

| Kind | Shows |
| --- | --- |
| `metric` | A single figure: a count, a sum, an average, a percentage |
| `progress` | A bar: how much of a filtered set is done |
| `countdown` | Days until the next date in a property |
| `list` | The top few rows, as links |
| `button` | A button that adds a row with values already filled in |

````markdown
```notion-widget
kind: metric
database: Tasks
aggregate: count
filter: [Status is not Done]
label: Still open
```
````

Every kind takes `database`, `filter` and `label`; `metric` adds `aggregate`,
`value`, `prefix` and `suffix`; `progress` adds a `total` filter to divide by;
`countdown` takes a `date` property or a literal `target`; `list` takes a `limit`.

---

## 12b. Properties on the page, saved views, and getting your data out

### Properties on the page

Click a row and it opens beside the view. At the top of that note you now get the
same property controls the view has — a select opens its menu, a date opens a
picker, a relation opens its searchable list — instead of leaving you editing raw
frontmatter. Nothing is written into the note's body; the panel edits the
frontmatter that was already there.

A note belongs to the most specific database whose folder contains it, so with
both `Work` and `Work/Tasks` defined, a note in `Work/Tasks` is a task.

Turn it off under *Properties on the page*.

### Saved views

A view is a block of settings — a filter, a sort, which properties, which type —
and rebuilding "this week's work" every time is what saved views exist to stop.
From any view's **⋯** menu pick **Save this view…**, give it a name, and it
appears under its database in the sidebar. Clicking it opens a full page with the
filter and sort intact. Right-click to forget it.

### Row icons

A note that sets `icon:` in its frontmatter already gets a page banner from it.
That emoji now travels with the row: beside its title in a table and a list, on
its card in a board, and as a gallery card's cover when there's no image.

### CSV export

From a view's **⋯** menu, **Export to CSV** writes what that view is showing —
filter and sort included — to a file beside the note. From the sidebar's
right-click menu it exports the whole database. Values are written as they
display, so a rollup exports its number and a date exports the day you see.

---

## 13. Page furniture: icons, covers, contents, breadcrumbs, columns

### Icons and covers

Run **Notion: Set this note's icon and cover** (or `/cover`). Pick an emoji and a
cover image, and they appear above the note's title the way a Notion page header
does. Both are stored in the note's own frontmatter.

Turn the whole feature off, or change the cover height, in Settings.

### Table of contents and breadcrumbs

````markdown
```notion-toc
```
````

Builds a live list of the note's headings. `notion-breadcrumb` does the same for
the note's folder path, as clickable links.

### Toggle headings

A heading that folds the section underneath it — `/toggle heading 1`. Notion's
single most-used organising device, and markdown has no equivalent.

### Columns

Markdown has no side-by-side syntax, so this adds one. Separate the columns with a line
containing `===`:

````markdown
```notion-columns
### Today
- [ ] Ship the thing

===

### This week
- [ ] Plan the next thing
```
````

Each column is rendered as normal markdown, so links, embeds and even database views
work inside one. Columns collapse to a single stack on narrow screens.

---

## 14. Coming from Notion

**Export from Notion** as Markdown & CSV. You'll get a folder per database, with one
`.md` file per row and the properties already in frontmatter — exactly the shape this
plugin expects.

**Import it:** Settings → Notion Suite → **Import folder**. Point it at the
exported folder. It reads every note's frontmatter, guesses a property type for each key
it finds, and collects the distinct values of select properties into options.

Then drop a view block into any note and you're running.

**What carries over well:** properties, select options, dates, checkboxes, relations by
title, sub-items, page content, and nested pages.

**What differs, honestly:**

- **Formulas** cover logic, text, numbers and dates — `if`, `switch`, `dateBetween`,
  `formatDate` and the rest — but not Notion's full library, and `replaceAll` is
  literal rather than a regex. See [Formulas](#formulas).
- **Permissions, comments and sharing** are Notion-server features with no local
  equivalent.
- **Dependencies** between rows aren't modelled. Sub-items and repeats are.
- **The block-level drag handle** isn't reproduced; Obsidian's editor is text-first.
- **Synced blocks** have no equivalent. Embedding a note (`/embed`) is the nearest thing.

Everything else in this README works today.

---

## 15. What this plugin touches

Worth stating plainly, since the community directory publishes a behaviour
report for every listed plugin:

- **Your vault files.** It creates and edits notes in your database folders, and
  writes property values into their frontmatter. That is the entire point of it.
- **The network: only if you ask.** No telemetry, no accounts, no remote calls.
  Charts are drawn locally as SVG, with no charting library, and nothing is
  loaded from a CDN. The **one** exception is a page cover set to an `http(s)`
  address — common in Notion exports — which has to be fetched from that server
  to be shown, telling it your IP address and when you opened the note. That is
  **off by default**; turn it on under *Load covers from the web*. Covers stored
  in your vault always work and never touch the network.
- **Your clipboard: never.** Nothing is read from or written to it.
- **Code execution: never.** The formula engine is a hand-written parser, not
  `eval` — a build-failing test enforces that, and another fails the build if
  any network call appears in the source.

You do not have to take that on trust. The directory's review reports no
suspicious network patterns, no obfuscation, and reproduces the released
`main.js` byte-for-byte from this repository — so the code you can read here is
provably the code you are running.

---

## 16. Settings and commands

### Settings

- **Slash command menu** — turn the `/` menu on or off.
- **Trigger character** — use something other than `/`.
- **Page icons and covers** — show them above the note title, and set the cover height.
- **Properties on the page** — a row's properties, editable at the top of its note.
- **Load covers from the web** — off by default; see [What this plugin touches](#15-what-this-plugin-touches).
- **Notion typography** — Notion-like heading sizes, line spacing and callout styling.
- **Default folder** — where new databases get created. Default `Databases`.
- **Show the databases sidebar on startup**.
- **Open rows beside the view** — the side peek. Turn it off to open rows in place.
- **Compact rows** — tighter rows in table and list views.
- **Import an existing folder** — turn any folder of notes into a database.
- **Your databases** — copy a view block for any database, or remove a database
  definition. Removing only forgets the schema; **your notes are never deleted**.

### Commands

Bind any of these to a key in Settings → Hotkeys.

| Command | What it does |
| --- | --- |
| Show the databases sidebar | Opens the sidebar |
| Open a database | Jumps to a full-page database |
| New database | The create dialog |
| Insert database view | A view block in the current note |
| Insert chart from database | A chart block |
| Add item to a database | A new row, without leaving the note |
| Add a property to a database | The property dialog |
| Turn a folder into a database | Import |
| Set this note's icon and cover | The page header dialog |
| Toggle the checkbox property on the active row | Tick a to-do from inside the note |
| Assign unique IDs to existing rows | Backfills a Unique ID property |
| Toggle the slash menu | On/off without opening settings |
| Refresh all database views | When something looks stale |

---

## 17. Troubleshooting

**"No database called X"** — the name in `database:` must match the database name in
settings, not the folder name. Settings → Notion Suite lists them, and each has a
"Copy view block" button that gets it right for you.

**The block shows as raw text** — you're in edit mode. Press `Cmd/Ctrl+E`, or click
outside the block; Obsidian renders code blocks in reading mode and in live preview when
the cursor is elsewhere.

**A board says it needs a group property** — boards group by a `select`, `status`,
`multiselect` or `checkbox` property. Add one, then set `group: <property>`.

**A property isn't showing** — check the `id` matches the frontmatter key exactly
(case-sensitive). The key in the note is what's read; the property's `name` is only a
label.

**Changes not appearing** — run the command **Notion: Refresh all database views**.
Views normally update themselves when files change.

**Edits aren't saving** — the note is probably open in another pane with unsaved changes.
Close the duplicate pane.

**It's not in Browse** — Obsidian caches the plugin list. Close and reopen the
Browse dialog, or restart Obsidian.

---

## 18. Developing

```bash
npm install
npm run dev        # rebuild on save
npm run build      # typecheck, then a production bundle
npm test           # the full test suite
npm run lint       # eslint, including eslint-plugin-obsidianmd
npm run typecheck  # types only
```

For live development, symlink the project folder into
`<vault>/.obsidian/plugins/notion-suite` so `npm run dev` rebuilds straight into
your vault. The [Hot Reload plugin](https://github.com/pjeby/hot-reload) will then pick
up each rebuild without restarting Obsidian.

**Before you change anything, read [CONTRIBUTING.md](CONTRIBUTING.md).** It is not
style advice: every rule in it exists because the same bug shipped more than once,
and each is backed by a check that fails the build.

### How the code is laid out

```
src/
  main.ts            plugin entry: code blocks, commands, settings, lifecycle
  types.ts           the data model
  settings.ts        settings tab
  db/
    store.ts         schemas; folder-of-notes <-> rows; all frontmatter writes
    query.ts         filtering, sorting, grouping, date buckets
    value.ts         property coercion, formatting, comparison
    formula.ts       the formula language: tokenizer, parser, evaluator
    rollup.ts        gathering related values and collapsing them
    resolve.ts       rollup/formula resolution, with cycle protection
    calculate.ts     table footer calculations
    tree.ts          sub-items: building and walking the hierarchy
    order.ts         manual ordering positions
    recur.ts         repeating rows
    currency.ts      money values and currency formatting
    csv.ts           CSV export
  views/
    renderer.ts      toolbar, search, dispatch to a view
    context.ts       shared view context: guarded writes, opening a row
    viewState.ts     per-view state that has to survive a re-render
    table.ts board.ts gallery.ts list.ts calendar.ts timeline.ts
    cells.ts         the editable cell widgets
    config.ts        parses ```notion-db and ```notion-chart blocks
    blockEdit.ts     writing settings back into a note's code block
    sidebar.ts       the databases sidebar
    databaseView.ts  full-page databases
    pageBlocks.ts    table of contents and breadcrumbs
    columns.ts       the ```notion-columns block
  charts/
    aggregate.ts     rows -> chart data
    svg.ts           chart data -> inline SVG
  widgets/
    widget.ts        parsing ```notion-widget blocks
    render.ts        drawing them
  slash/
    commands.ts      the command catalogue and its matching
    suggest.ts       the / menu itself
  ui/
    modals.ts        create database, insert view, insert chart, import folder
    propertyModal.ts create/edit/delete a property, including rollups
    confirmModal.ts  confirm() and choose() dialogs
    bulkModal.ts     setting one property across many rows
    filterBuilder.ts click-to-build filters and sorts
    propertyPanel.ts a row's properties at the top of its own note
    relationModal.ts picking which rows a relation points at
    recurrenceModal.ts  setting up repeating rows
    saveViewModal.ts naming a view so it can be reopened
    templateModal.ts saving a row as a reusable template
    pageStyleModal.ts   page icon/cover starting points
    pageBanner.ts    page icons and covers
    templates.ts     the nine starter databases
  utils/
    async.ts         fire-and-forget work that reports its failures
    dates.ts         ISO YYYY-MM-DD date helpers
    dom.ts           element factory over Obsidian's createEl
    text.ts          turning unknown values into display text
```

### Tests

```
tests/
  logic.test.ts      query, chart, config and value engines
  rollup.test.ts     rollup aggregation, relation matching, cycle safety
  formula.test.ts    the formula language
  widget.test.ts     widget parsing and rendering
  roundtrip.test.ts  anything rendered to text and read back must survive it
  guards.test.ts     build-failing checks for mistakes this repo has made
  view.test.ts       views rendered into a real DOM and driven like a user
  interact.test.ts   dialogs, panes and drag-and-drop
  filterBuilder.test.ts  building filters by clicking
  propertyPanel.test.ts  properties at the top of a row's note
  relation.test.ts   the relation picker
  rename.test.ts     renaming a row and everything pointing at it
  recur.test.ts      repeating rows
  currency.test.ts   money
  csv.test.ts        CSV export
  guardgaps.test.ts  regression checks for fixes nothing else watched
  run.mjs            bundles the suite and runs it once per time zone (UTC, New York, Berlin)
  dom.ts             a DOM plus Obsidian's element helpers
  obsidian-stub.ts   a stand-in for the Obsidian API
```

`tests/dom.ts` gives the suite a real document and the helper methods Obsidian
adds to `HTMLElement`, so the plugin's actual renderers run in CI: a test can
type into the search box, press "next month", drop a card or dismiss a dialog and
then check what the user would be looking at. Every one of those tests was
written by reintroducing the original bug and watching it fail.

The harness is a *model* of Obsidian, though, and a wrong model passes its own
tests. What turns on Obsidian's real semantics — a real drag gesture, when a
post-processor re-runs — plus anything visual stays in
[docs/SMOKE.md](docs/SMOKE.md), which is the short manual checklist to walk
before a release that touches views or panes.

### Releasing

Publishing is driven by the version in `manifest.json`, not by tags:

```bash
npm version patch   # or minor / major
git push
```

`npm version` bumps `manifest.json` and `versions.json`, and the push triggers a
workflow that typechecks, lints, tests, builds, attests the build and publishes a
GitHub release whose tag matches the manifest version — which is what Obsidian's
updater reads. A push that does not change the version releases nothing.

---

## License

MIT
