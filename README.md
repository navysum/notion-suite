# Notion Suite

Bring the parts of Notion you actually miss into Obsidian: the `/` menu, databases,
table / board / gallery / list / calendar views, inline property editing, relations,
rollups, and charts built from your own data.

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
6. [Filtering and sorting](#6-filtering-and-sorting)
7. [Property types, relations and rollups](#7-property-types-relations-and-rollups)
8. [Charts](#8-charts)
9. [Columns](#9-columns)
10. [Coming from Notion](#10-coming-from-notion)
11. [Settings](#11-settings)
12. [Troubleshooting](#12-troubleshooting)
13. [Developing](#13-developing)

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
> settings API, which is what puts your settings in Obsidian's search. If you
> are on an older build, version 1.2.1 is functionally identical apart from
> that.


### Option A — BRAT (recommended until the directory listing lands)

BRAT installs a plugin straight from a GitHub repository and keeps it updated,
which is exactly what you want while this is pre-directory.

1. In Obsidian, install **BRAT** from Settings → Community plugins → Browse.
2. Run the command **BRAT: Plugins: Add a beta plugin for testing**.
3. Paste `https://github.com/navysum/notion-suite`, choose **Latest version**,
   and tick "enable after installing".

That's it. BRAT will pull each new release automatically from then on.

### Option B — build it yourself

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
tab.) Then in Obsidian go to Settings → Community plugins, turn off restricted
mode if it's on, hit the reload icon, and toggle **Notion Suite** on.

`main.js` is deliberately **not** committed to this repository — it is a build
artifact, published as a release asset. The community directory verifies that a
release was genuinely built from the committed source, and a stale checked-in
bundle is what that check exists to catch.

### Option C — the community directory

Once listed, this will be installable from Settings → Community plugins →
Browse, with updates handled by Obsidian itself.

You should now see a database icon in the left ribbon.

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
Toggle list, Quote, Divider, Code, Table, Columns

**Callouts** — Callout, Tip, Warning, Danger, Success, Question

**Databases** — Database (new), Database view, Add item, Chart from database

**Inline** — Date (today), Date (tomorrow), Link to page, Embed page, Equation, Highlight

You don't have to type the exact name. Every command has aliases, so `/kanban` finds the
database view, `/graph` finds the chart, `/collapse` finds the toggle, and `/checkbox`
finds the to-do.

Want a different trigger character? Settings → Notion Suite → Trigger character.

---

## 5. Database views

**You never have to write this by hand either.** `/database` → **Database view**
opens a dialog for every setting. On any rendered view, the toolbar has a
**⚙ Settings** button that reopens it, pre-filled.

Switching view type is even quicker: click the view-type button in the toolbar
(**Table**, **Board**, …) and pick another. That choice is saved into the note,
so it sticks — it isn't just a preview.

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

### Every option

| Key | What it does | Example |
| --- | --- | --- |
| `database` | Which database to show. Required. | `database: Tasks` |
| `view` | `table`, `board`, `gallery`, `list` or `calendar`. Defaults to `table`. | `view: board` |
| `group` | Board columns. Needs a select, multi-select or checkbox property. | `group: status` |
| `date` | Which date property the calendar uses. | `date: due` |
| `cover` | Which property holds the card image (gallery/board). | `cover: cover` |
| `properties` | Which properties to show, in this order. | `properties: [status, due]` |
| `filter` | Which rows to show. See below. | `filter: [Status is not Done]` |
| `sort` | Row order. | `sort: due asc` |
| `limit` | Show at most this many rows. | `limit: 10` |
| `size` | Gallery card size: `small`, `medium`, `large`. | `size: large` |
| `title` | A heading for this view. | `title: This week` |

</details>

### The five views

**Table** — a spreadsheet. Click any cell to edit it. Click a column header to sort or
hide it.

**Board** — kanban. Drag cards between columns to change the grouping property. Empty
columns still show, so you can drag into them.

**Gallery** — cards with cover images. Good for a reading list, recipes, or anything
visual.

**List** — a compact line per row. If the database has a checkbox property, it becomes a
tickable to-do list.

**Calendar** — a month grid. Hover a day and press `+` to create a row already dated to
that day. Arrows move between months.

---

## 6. Filtering and sorting

Filters are written the way you'd say them out loud — in the settings dialog's
**Filter** box, one per line. This is the one place you do type something, and
it's deliberately English rather than syntax.

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

## 7. Property types, relations and rollups

| Type | Stored as | Editing |
| --- | --- | --- |
| `text` | a string | click to type |
| `number` | a number | click to type; formats as plain, percent or currency |
| `select` | a string | click for a menu of options |
| `multiselect` | a list | click to tick several |
| `date` | `YYYY-MM-DD` | click for a date picker |
| `checkbox` | `true` / `false` | click the box |
| `url` / `email` / `phone` | a string | rendered clickable, pencil icon to edit |
| `person` | a list of names | click to tick several |
| `files` | a path or URL | used as the cover image in gallery and board |
| `relation` | a list of note titles | click to link rows in another database |
| `rollup` | computed | read-only, see below |
| `formula` | computed | read-only, see below |
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

This is deliberately a small language. It does arithmetic and nothing else — it cannot
run code, which is why it's safe to have it evaluate automatically on every render.
Checkboxes count as `1` and `0`, and a reference to a property that doesn't exist counts
as `0`. Division by zero gives an empty cell rather than an error.

---

## 8. Charts

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

## 9. Columns

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

## 10. Coming from Notion

**Export from Notion** as Markdown & CSV. You'll get a folder per database, with one
`.md` file per row and the properties already in frontmatter — exactly the shape this
plugin expects.

**Import it:** Settings → Notion Suite → **Import folder**. Point it at the
exported folder. It reads every note's frontmatter, guesses a property type for each key
it finds, and collects the distinct values of select properties into options.

Then drop a view block into any note and you're running.

**What carries over well:** properties, select options, dates, checkboxes, relations by
title, page content, and nested pages.

**What differs, honestly:**

- **Formulas** are arithmetic only. Notion's `if()`, `dateBetween()` and string functions
  aren't here. Rollups, though, are fully supported — see
  [Relations and rollups](#relations-and-rollups).
- **Permissions, comments and sharing** are Notion-server features with no local
  equivalent.
- **Sub-items and dependencies** aren't modelled as first-class features.
- **The block-level drag handle** isn't reproduced; Obsidian's editor is text-first.

Everything else in this README works today.

---

## 10b. What this plugin touches

Worth stating plainly, since the community directory publishes a behaviour
report for every listed plugin:

- **Your vault files.** It creates and edits notes in your database folders, and
  writes property values into their frontmatter. That is the entire point of it.
- **The network: never.** No telemetry, no accounts, no remote calls, no
  external assets. Charts are drawn locally as SVG, with no charting library.
- **Your clipboard: never.** Nothing is read from or written to it.

You do not have to take that on trust. The directory's review reports no
suspicious network patterns, no obfuscation, and reproduces the released
`main.js` byte-for-byte from this repository — so the code you can read here is
provably the code you are running.

## 11. Settings

- **Slash command menu** — turn the `/` menu on or off.
- **Trigger character** — use something other than `/`.
- **Notion typography** — Notion-like heading sizes, line spacing and callout styling.
- **Default folder** — where new databases get created. Default `Databases`.
- **Compact rows** — tighter rows in table and list views.
- **Import an existing folder** — turn any folder of notes into a database.
- **Your databases** — copy a view block for any database, or remove a database
  definition. Removing only forgets the schema; **your notes are never deleted**.

## Releasing (for maintainers)

Publishing is driven by the version in `manifest.json`, not by tags:

```bash
npm version patch   # or minor / major
git push
```

`npm version` bumps `manifest.json` and `versions.json`, and the push triggers a
workflow that typechecks, tests, builds, attests the build and publishes a
GitHub release whose tag matches the manifest version — which is what Obsidian's
updater reads. A push that does not change the version releases nothing.

---

## 12. Troubleshooting

**"No database called X"** — the name in `database:` must match the database name in
settings, not the folder name. Settings → Notion Suite lists them, and each has a
"Copy view block" button that gets it right for you.

**The block shows as raw text** — you're in edit mode. Press `Cmd/Ctrl+E`, or click
outside the block; Obsidian renders code blocks in reading mode and in live preview when
the cursor is elsewhere.

**A board says it needs a group property** — boards group by a `select`, `multiselect` or
`checkbox` property. Add one, then set `group: <property>`.

**A property isn't showing** — check the `id` matches the frontmatter key exactly
(case-sensitive). The key in the note is what's read; the property's `name` is only a
label.

**Changes not appearing** — run the command **Notion: Refresh all database views**.
Views normally update themselves when files change.

**Edits aren't saving** — the note is probably open in another pane with unsaved changes.
Close the duplicate pane.

---

## 13. Developing

```bash
npm install
npm run dev        # rebuild on save
npm run build      # typecheck, then a production bundle
npm test           # run the logic test suite
npm run typecheck  # types only
```

For live development, symlink the project folder into
`<vault>/.obsidian/plugins/notion-suite` so `npm run dev` rebuilds straight into
your vault. The [Hot Reload plugin](https://github.com/pjeby/hot-reload) will then pick
up each rebuild without restarting Obsidian.

### How the code is laid out

```
src/
  main.ts            plugin entry: code blocks, commands, settings, lifecycle
  types.ts           the data model
  settings.ts        settings tab
  db/
    store.ts         schemas; folder-of-notes <-> rows; all frontmatter writes
    query.ts         filtering, sorting, grouping
    value.ts         property coercion, formatting, comparison, formulas
    rollup.ts        gathering related values and collapsing them
    resolve.ts       rollup/formula resolution, with cycle protection
  views/
    renderer.ts      toolbar, search, dispatch to a view
    table.ts board.ts gallery.ts list.ts calendar.ts
    cells.ts         the editable cell widgets
    config.ts        parses ```notion-db and ```notion-chart blocks
    columns.ts       the ```notion-columns block
  charts/
    aggregate.ts     rows -> chart data
    svg.ts           chart data -> inline SVG
  slash/
    commands.ts      the command catalogue and its matching
    suggest.ts       the / menu itself
  ui/
    modals.ts        create database, insert view, insert chart, import folder
    propertyModal.ts create/edit/delete a property, including rollups
    templates.ts     the nine starter databases
tests/
  logic.test.ts      the query, chart, config and value engines
  rollup.test.ts     rollup aggregation, relation matching, cycle safety
```

The tests cover the parts that don't need a running Obsidian: value coercion, the filter
and sort engine, grouping, chart aggregation, block config parsing, formulas, rollups and
date handling. `tests/obsidian-stub.ts` stands in for the Obsidian API so they run in
plain Node.

## License

MIT
