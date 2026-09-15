# Changelog

All notable changes to this plugin are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## 1.6.5

No change to how the plugin behaves. The parts of it that only ran inside
Obsidian are now tested.

Four of the six bugs found in the last audit were in code that only exists while
Obsidian is running -- element lifecycles, panes, drag handlers. Nothing could
reach them from a test, so the only check was a person clicking through the app,
which is precisely the check that kept missing them.

### Added

- `tests/dom.ts`: a DOM, plus the element helpers Obsidian adds to it, so the
  plugin's real renderers run in CI and can be driven the way a user drives
  them.
- `tests/view.test.ts` and `tests/interact.test.ts`: the search box keeps what
  you typed and keeps narrowing; calendar and timeline navigation advance and
  come back; collapsed rows and ticked rows survive a refresh; a side peek
  reuses its own pane and never takes over the left sidebar; a card dragged
  between columns writes the column it landed in and nothing else; dismissing
  the delete dialog deletes nothing.

  Every one of these was written by reintroducing the original bug and watching
  the test fail.
- The Obsidian stub's dialogs are now real enough to answer: a test can press a
  named button or dismiss the dialog outright.

### Changed

- `docs/SMOKE.md` is down from twenty-one manual checks to eleven -- the ones
  that turn on Obsidian's own semantics, a real drag gesture, or what the thing
  actually looks like.

## 1.6.4

Two silent filter bugs, and a set of checks so that this class of bug cannot
come back quietly.

### Fixed

- **Opening a view's settings and pressing Save could change which rows it
  showed, without touching anything.** The filter textarea was read one line at
  a time by the single-rule parser, but it is filled by the renderer, which
  writes anything with an `or` in it as one line: `Status is Doing or Priority >
  4`. That line came back as a single rule about a property called "Status" with
  the value "Doing or Priority > 4", which matches nothing. Nested filters
  degraded the same way. Both readers now share one parser.
- **Two unused imports** that the linter had been warning about.

### Changed

- Per-view state — the search box, collapsed sub-items, ticked rows, the
  calendar's month, the timeline's window — now lives in one place
  (`src/views/viewState.ts`) and is passed down as a typed value. Three separate
  shipped bugs came from state keyed on an element that the next render threw
  away; there is now no element for a renderer to get wrong.

### Added

- `tests/guards.test.ts`: build-failing checks for the mistakes this codebase
  has actually made — element-keyed state, dead exports, duplicated aggregation,
  `eval`.
- `tests/roundtrip.test.ts`: every filter shape is rendered to text and read back
  through both readers, and has to still select the same rows.
- `CONTRIBUTING.md`, documenting each rule alongside the bug that motivated it
  and the check that enforces it, and `docs/SMOKE.md`, the manual checklist for
  the paths that only exist while Obsidian is running.

## 1.6.3

A pass over the whole codebase looking for bugs rather than adding features.
Six found and fixed.

### Fixed

- **A full-page database forgot itself constantly.** Its search box, collapsed
  sub-items and ticked rows were stored against an element the view rebuilt on
  every refresh — so typing a letter into the search box destroyed the thing
  holding the search box's contents.
- **Opening a row could hijack a pane in the left sidebar.** "Reuse an existing
  side pane" matched any pane outside the main editor, which includes the left
  sidebar, so glancing at a row could replace whatever you had pinned there.
- **Assigning unique IDs to a large database appeared to hang.** Each row
  re-resolved every row in the database and saved the plugin's data to disk, so
  the work grew with the square of the row count. It now counts up in memory and
  saves once.
- **Column limits counted rows the board was hiding.** On a filtered board a
  column could refuse a card while visibly holding two, because the limit was
  counting cards the filter had removed.
- **Deleting a row silently orphaned its sub-items.** They were left pointing at
  a note that no longer existed and quietly became top-level rows. Deleting a
  row with sub-items now says how many, and offers to take them too — and
  dismissing that dialog cancels rather than choosing for you.
- Removed a helper nothing used.

## 1.6.2

### Fixed

- **Dragging a card between columns no longer asks about ordering.** Moving a
  card from To do to Doing is about its status; being asked whether you want a
  position property afterwards was a non sequitur. The offer now appears only
  when you drag a card *within* a column, which is the only time you were
  asking about order at all.
- **Declining that offer is remembered.** It used to ask again on the very next
  drag, and the one after that. It now takes no for an answer until Obsidian
  restarts.
- **A failed card move now says so.** The work after a drop runs detached,
  because a drop handler cannot wait, so any failure vanished silently and the
  card just snapped back with no explanation.

## 1.6.1

Both trade-offs from 1.6.0 turned into choices rather than constraints.

### Changed

- **Dragging cards into an order now sets itself up.** Manual ordering still
  keeps each position in the note, because that is the only durable place on a
  folder-of-notes model — but the first drag offers to add the property for
  you, in one click, instead of failing silently until you found the setting.
  The property is hidden, since a position is presentation rather than content,
  and existing rows are given spaced positions so the first drop has gaps to
  aim at.
- **Column limits no longer have one fixed meaning.** What to do when a drop
  would exceed a limit is a judgement only you can make, so a board offers all
  three: colour the count and allow it (the default), ask first, or hold the
  line. Set it from the column menu.

## 1.6.0

Notion Suite stops being a set of code blocks and starts being a workspace.

### Added

- **A databases sidebar.** Every database in one place, with a live row count,
  opening on click. Until now a database only existed where you had pasted a
  block, so forgetting which note held it effectively lost it.
- **Full-page databases.** Open one as its own tab, with a view switcher across
  the top and no code block anywhere. Blocks keep their job of embedding a view
  inside a note; they stop being the only way in.
- **Page icons and covers.** `icon: 🚀` and `cover:` in a note's frontmatter,
  set from a dialog rather than typed. Probably the single biggest reason
  Notion *looks* like Notion.
- **Nested filters** — `Status is not Done and (Priority is High or Urgent)`,
  three levels deep, written inline or as `any`/`all` objects.
- **Sub-items.** Rows nest under a parent, with a fold arrow. The parent link
  is an ordinary relation property, so the hierarchy lives in the note.
- **Bulk editing.** Tick rows, set one property across all of them at once.
- **Unique IDs** — `TASK-1`, `TASK-2`, assigned at creation and stable for the
  row's life, with a command to backfill rows that predate the property.
- **Per-view hidden properties.** Hiding a property in one view no longer hides
  it everywhere.
- **Board sub-grouping**, **collapsible columns**, **column limits** that colour
  the count when exceeded, **date bucketing** (Overdue / Today / This week /
  Next week / Later), and **manual card order** you can drag within a column.
- **Table of contents** and **breadcrumb** blocks, **toggle headings**, and
  commands for page style and toggling a row's checkbox.

## 1.5.0

The biggest release so far: real formulas, a timeline view, column footers, a
status property, row templates, side peek and dashboard widgets.

### Added

- **A real formula language.** Previously arithmetic only, which could not
  express "days until due" or "overdue?" — most of what anyone writes a formula
  for. Now: `if`, comparisons, `and`/`or`/`not`, string functions, `prop()`,
  `dateBetween`, `dateAdd`, `dateSubtract`, `formatDate`, `now`, `today`,
  `empty`, `contains`, `length`, `min`/`max`/`round`/`abs`, and more. Still no
  `eval` and no `Function` constructor: a formula is data a user typed, so it
  must never become code. Input length, token count and nesting depth are all
  capped, since this runs on the UI thread on every render.
- **Timeline view.** Bars across a time axis at day, week or month scale. Rows
  without an end date become single-day markers; rows with no date at all get an
  "Unscheduled" section instead of vanishing.
- **Calculate footers.** A row under each table where any column can show a sum,
  average, min, percent checked and so on. It aggregates the rows the *view* is
  showing, so it can never contradict the numbers above it.
- **Status property.** Options belong to a to-do, in-progress or complete stage,
  and boards order their columns by that stage rather than by the order options
  happen to be listed in.
- **Row templates.** Set a row up the way you like, right-click it, and save it
  as a template. The "New" button then offers it — and only shows a chevron when
  a database actually has templates.
- **Side peek.** Clicking a row opens its note beside the view instead of over
  it, reusing an existing side pane. Losing your board every time you glance at
  a row was the main reason a row-per-file database felt heavy.
- **Dashboard widgets** via a ```notion-widget block: `metric` (one big number),
  `progress` (a bar with n of m), `countdown` (days to a date), `list` (recent or
  soonest rows) and `button` (one click creates a pre-filled row). Several can
  sit side by side as a card row.

## 1.4.0

Adding and naming rows no longer takes you out of the view you are working in.

### Changed

- **A row's title is edited in the grid.** Click it and type. Previously the
  only way to name a row was to open its note and rename the file — which is
  the main reason databases felt heavier here than in Notion.
- **"+ New" stays put.** It adds the row and puts the cursor in its title,
  instead of navigating away from your board or table to the new note. Opening
  the note is now its own button on the row, always visible rather than
  appearing on hover.
- **Add a property from the table header.** A `+` sits at the end of the header
  row, where your eye already is, instead of only in the Properties menu.

## 1.3.0

Clears every item in the community directory's review. Needs Obsidian 1.13.0
or later — see below.

### Changed

- **Settings now appear in Obsidian's settings search.** The settings tab is
  declared through `getSettingDefinitions()` rather than drawn by hand, which is
  what lets Obsidian index it. Each setting also carries search aliases, so
  "kanban", "density" or "migrate" find the right one.
- **The default-folder setting is now a folder picker** with autocomplete,
  rather than a free-text box.
- **The trigger character now rejects bad input** with an inline message instead
  of silently rewriting what you typed.
- **Your databases are a proper list** with a delete affordance and an add
  button, and each row can jump straight to adding a property.

### Removed

- **Clipboard access.** "Copy view block" and "Copy link" were the only two
  uses, and both are now redundant: views are inserted and edited through
  dialogs, and Obsidian's own file menu copies links. The plugin no longer
  touches your clipboard at all.

### Requirements

`minAppVersion` is now **1.13.0**. The declarative settings API and the
non-deprecated destructive-button style both arrived in 1.13.0, and there is no
way to adopt either on an older build. If you are below 1.13.0, stay on 1.2.1 —
it is functionally identical apart from the settings tab.

## 1.2.1

Pre-submission pass against `eslint-plugin-obsidianmd`, the linter the Obsidian
community directory's review is based on. It found a real bug.

### Fixed

- **Deleting a row crashed on Obsidian 1.5.0 through 1.6.5.** The manifest
  claimed support from 1.5.0, but row deletion uses `FileManager.trashFile`,
  which only exists from 1.6.6. `minAppVersion` is now 1.6.6, which is what the
  plugin has actually required all along.
- **Values that were not plain text rendered as `[object Object]`.** Frontmatter
  and block YAML are hand-written, so a key meant to hold a scalar can come back
  as a map or nested list. Twenty-eight places converted such values with
  `String()`, which would show, filter on, or chart that placeholder. They now
  read as empty, which every caller already handles as "no value".
- Two navigation calls could reject unobserved; a calendar click handler
  returned a promise into a slot that ignored it.

### Changed

- `npm run lint` runs the directory's review rules, and CI runs it on every
  push, so a regression cannot reach a release.
- Dropped the `builtin-modules` dependency for the Node built-in it wrapped.
- Settings headings use Obsidian's own heading control rather than raw `<h2>`.

## 1.2.0

You should not have to memorise a configuration syntax to use a chart. This
release makes every setting a control, the way Notion does.

### Added

- **Chart settings dialog with a live preview.** Every key a chart block
  understands now has a control — type, grouping, measure, series, stacking,
  filter, order, limit, title, height, legend, data labels — and the chart
  redraws as you change them. You choose by looking, not by remembering.
- **Edit any chart in place.** Hover a rendered chart and click **Edit chart**
  to reopen that dialog, pre-filled with what the chart currently does.
- **Settings button on every database view**, likewise pre-filled, now covering
  cover image, card size, visible properties, limit and heading as well as the
  filter and sort it already had.
- **Switching view type sticks.** Picking Board or Calendar from the toolbar
  writes that choice into the note instead of resetting on reload.

### Fixed

- Editing a view no longer discards settings the old dialog could not show.
  Filters are round-tripped back into the editor as the same English you typed,
  which is covered by a test.

## 1.1.1

Fixes found by an adversarial review of the 1.1.0 rollup code. No behaviour
changes you have to act on; if you are on 1.1.0, take this one.

### Fixed

- **Rollup cycles made every render slower, not just the cyclic part.** A single
  circular rollup anywhere disabled result caching for every database resolved
  in that pass, so each rollup re-read its target folder from disk and the cost
  grew as 2^depth. A twelve-deep chain took 8,191 folder walks; it now takes 14,
  and the common Projects/Tasks pair no longer re-reads on every render.
- **A derived value could be written into a note.** Creating a row from a view
  filtered on a rollup or formula (or a board grouped by one) persisted that
  computed value into the note's frontmatter, where it went stale immediately.
  Rollups and formulas are now never written to disk.
- **"Percent not empty" read 100% over mostly-blank rows.** A related row whose
  list property was empty contributed nothing at all and so vanished from the
  denominator. It now counts as one empty value.
- **Deleting a relation sometimes left orphaned rollups.** The cascade keyed off
  the type currently shown in the editor's dropdown rather than the type the
  property actually had, so merely opening the dropdown could skip it.
- **Stale dropdowns could save a broken configuration.** If a relation's target
  database or a rollup's property had been deleted, the editor displayed the
  first option while silently keeping the dangling id.
- `Min`, `Max`, `Range` and the date aggregations crashed the view outright on
  very large gathers (roughly 125,000+ values).
- Date aggregations pointed at a number property reported a confident
  `1970-01-01`; they now report nothing.
- The same note listed twice in one relation is counted once, as in Notion.

## 1.1.0

### Added

- **Rollups.** A relation could link rows but not compute anything from them.
  A rollup follows a relation, gathers one property off every related row and
  collapses those values into one — 21 calculations across show, count, number,
  date and checkbox groups.
- **Property editor.** Create, edit and delete properties from Properties →
  New property, from a table column header, or from a command. Relations and
  rollups had no way to be configured before this.
- Rollups can be read by formulas (`{Total hours} * {Rate}`), sorted
  numerically, and used as the value of a chart.

### Fixed

- Circular rollups (A rolls up B while B rolls up A) no longer recurse without
  end. Resolution stops after one level, and results computed inside a cycle
  are not cached so they cannot leak into a later read.
- Deleting a relation now also removes any rollup that followed it, instead of
  leaving a permanently blank column.

## 1.0.0

Initial release.

- Slash command menu with 30 commands across blocks, callouts, databases and
  inline insertions.
- Databases backed by folders of notes, with table, board, gallery, list and
  calendar views, inline cell editing and kanban drag-and-drop.
- Filter and sort language (`Status is not Done`, `Due before today`).
- Charts with seven chart kinds and eight aggregations, drawn as inline SVG.
- Side-by-side columns.
- Nine starter database templates and a folder importer for Notion exports.
