# Smoke checklist

## What no longer needs a human

`tests/dom.ts` gives the test suite a real document and the element helpers
Obsidian adds to it, so the plugin's actual renderers run in CI and can be driven
the way a user drives them. 312 tests cover search state, calendar and timeline
navigation, collapsed and ticked rows, pane reuse, drag-and-drop payloads,
dialog dismissal, filter round trips, the relation picker, grouped tables, the
property panel, CSV writing, and every recurrence rule.

Every bug fixed in this project was put back, one at a time, to confirm a test
notices — 22 for 22. Anything below is here because a test genuinely cannot
reach it.

## What still needs you

The harness is a *model* of Obsidian, and a wrong model passes its own tests. The
checks below turn on Obsidian's real semantics, a real mouse gesture, or what the
thing actually looks like.

Twenty minutes. Work top-down: the first section can change your notes, the rest
cannot.

---

### 1. Renaming a row — do this one first, and carefully

This is the only change in 1.7.0 that **rewrites other notes**, so confirm it on
a database you can afford to be wrong about before trusting it on a real one.

1. In a database with sub-items, rename a parent row (click its title, type,
   Enter).
   **Right:** its sub-items stay nested underneath it.
   **Wrong:** they jump to the top level as if they had no parent.
2. Open one of those sub-item notes and look at its parent property.
   **Right:** it now names the new title.
3. Do the same for a row that something *relates* to. Open the relating row.
   **Right:** the relation chip shows the new name and still clicks through.
4. Rename a row whose parent link is written as `[[Wikilink]]`.
   **Right:** still a wikilink, pointing at the new name.
5. Rename a row **in the file explorer** rather than in a view.
   **Right:** the same repointing happens.
6. Rename a row to the name of another row in the same database.
   **Right:** a notice says the name is taken; the title reverts.
   **Wrong:** nothing happens and you are left guessing.
7. Rename a row to blank, or to `///`.
   **Right:** refused with a reason.
   **Wrong:** the row is renamed to "Untitled".

### 2. Deleting

8. Tick several rows in a table, click **Delete** in the bulk bar.
   **Right:** a dialog appears *before* anything is deleted.
   **Wrong:** they vanish immediately. (This is the 1.6.x behaviour.)
9. Press **Escape** at that dialog.
   **Right:** nothing at all is deleted.
10. Tick a parent whose sub-items are *not* ticked and delete.
    **Right:** the dialog counts the sub-items and offers to take them too, and
    each button does exactly what it says.

### 3. Repeating rows

11. Set one up: right-click a database in the sidebar → **Repeating rows…**.
    You need a text property for the rule, a date, and a checkbox.
12. Put `weekly` in the rule property of a row with a due date, then tick the
    row off.
    **Right:** a new row appears, same name, date a week on, not ticked, and the
    rest of its properties carried over — the rule included.
    **Wrong:** the new row arrives already ticked, or without the rule (so it
    repeats exactly once), or dated in the past.
13. Try `every Tuesday` and `weekdays`.
    **Right:** the next date is a Tuesday / a weekday.
14. Put ordinary prose in the rule property and tick a row off.
    **Right:** nothing is created.

### 4. The new UI

15. Open any view's **⚙ Settings**. The filter is now rows of dropdowns.
    Build `Status is not Done`. Save.
    **Right:** the view filters. Reopen Settings — the condition is still there,
    as rows.
16. Switch a condition's property from a text one to a checkbox.
    **Right:** the test changes to something valid and the value box becomes
    checked/unchecked.
17. Add a second condition and flip **all** to **any**.
    **Right:** more rows match, not fewer.
18. Open Settings on a view whose filter has brackets in it.
    **Right:** a text box with the filter intact, and a note about brackets.
    **Wrong:** the brackets are gone and the filter now matches differently.
19. Click a relation cell.
    **Right:** a searchable list of *every* row in the related database, with a
    count at the bottom. Type to narrow it.
20. Set a table's **Group by**.
    **Right:** foldable bands with counts. Folding one sticks after an edit
    elsewhere.
21. Click a row to open it.
    **Right:** its properties appear at the top of the note, editable — a select
    opens its menu, a date opens a picker.
    **Wrong:** two panels, or one left behind from the previous note when you
    switch notes in the same pane.
22. Switch that note to source mode and back, then close and reopen the tab.
    **Right:** exactly one panel, below the banner if there is one.

### 5. Large databases

23. Open a database with more than a hundred rows.
    **Right:** it opens instantly, shows 100, and says *"Showing 100 of N"*.
24. Click **Show 100 more**, then **Show all**.
    **Right:** the footer disappears at the end.
25. Type in the search box.
    **Right:** no stutter; the count restarts at 100 for the new search.

### 6. Exporting

26. From a view's **⋯** menu, **Export to CSV**.
    **Right:** a .csv lands beside the note with only the rows that view shows.
    Open it in a spreadsheet: columns line up, dates read correctly.
27. Save a view (**⋯** → **Save this view…**), then look in the sidebar.
    **Right:** it is listed under its database and opens with its filter intact.

### 7. Real gestures and looks

28. Drag a card between board columns with the mouse. Open the card afterwards.
    **Right:** only its column changed.
29. Drag a card within one column to reorder it.
    **Right:** it lands where you dropped it, not one position off.
30. Open a board, gallery, calendar and timeline; switch light/dark theme;
    narrow the pane until it scrolls.
    **Right:** nothing overlapping, clipped or unreadable.

### 8. If you are not in the UK

31. Set a row's date to today and look at a board grouped by that date with
    buckets on.
    **Right:** it sits in **Today**.
    **Wrong:** **Overdue**. (This was broken for everyone west of Greenwich
    before 1.7.0. In the UK it looked fine either way, so it is only visible
    from a timezone behind UTC.)
