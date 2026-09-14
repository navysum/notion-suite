# Changelog

All notable changes to this plugin are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
