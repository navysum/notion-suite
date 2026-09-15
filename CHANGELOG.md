# Changelog

All notable changes to this plugin are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
