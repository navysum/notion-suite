# Smoke checklist

The unit tests cover the parts of the plugin that are pure: parsing, filtering,
formulas, rollups, aggregation, ordering. They cannot cover the parts that only
exist while Obsidian is running — panes, element lifecycles, drag handlers and
the editor's DOM — and four of the six bugs found in the last audit were in
exactly those paths.

This is the list for those. It is short on purpose: each item is one of the
places a bug has actually been found, not an exhaustive tour. Walk it before a
release that touches views, panes or drag-and-drop.

Each step says what to do and **what would be wrong**, so a failure is
recognisable without knowing the code.

## State that has to survive a refresh

1. Open a database view, type into the search box, keep typing.
   *Wrong:* the box empties itself, or the results stop narrowing.
2. Switch to calendar, press **next month** three times.
   *Wrong:* the title snaps back to this month.
3. Switch to timeline, press **next**, then **Today**.
   *Wrong:* the window does not move, or does not come back.
4. Collapse a row with sub-items, then edit a value in another row.
   *Wrong:* the collapsed row springs open again.
5. Tick three rows for a bulk edit, then change a value elsewhere in the view.
   *Wrong:* the ticks clear.
6. Do 1–5 again in a **full-page** database (open one from the sidebar).
   This is a separate surface with its own host element, and it is where the
   search box last broke.

## Panes

7. Click a row. It should open beside the view, not over it.
8. Pin a note in the **left** sidebar, then click a row.
   *Wrong:* the pinned note is replaced.
9. Click several rows in a row.
   *Wrong:* panes stack up instead of one being reused.
10. Ctrl/Cmd-click a row — it should open in a new tab instead.

## Drag and drop

11. Drag a card between board columns. The other values on the card must be
    unchanged — open it and check.
12. Drag a card **within** one column to reorder it. It should land where it was
    dropped, not one position off.
13. Decline the "switch to manual ordering?" prompt, then drag again.
    *Wrong:* it asks a second time.
14. Drag a card into a column that is at its WIP limit.
    *Wrong:* it fails silently, or the card disappears.

## Editor DOM

15. Open a note with an icon and a cover. Both should appear above the title.
16. Switch that note to source mode and back.
    *Wrong:* two banners, or none.
17. Close and reopen the tab.
    *Wrong:* the banner is gone, or duplicated.

## Destructive actions

18. Delete a row that has sub-items. Press **Escape** at the dialog.
    *Wrong:* anything at all is deleted.
19. Do it again and choose "delete the sub-items too" — they should all go.
20. Do it again and choose to keep them — they should remain, un-nested.

## Filters

21. Build a filter with an **or** in it. Save. Reopen the settings dialog and
    press Save again without touching anything.
    *Wrong:* the rows that match change. (This one is covered by
    `tests/roundtrip.test.ts` now, but it is worth eyes on: it was silent.)
