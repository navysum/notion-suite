# Smoke checklist

## What no longer needs a human

Most of this file used to be a list of things only a person clicking through
Obsidian could check. `tests/dom.ts` gives the test suite a real DOM and the
element helpers Obsidian adds to it, so the plugin's actual renderers now run in
CI and can be driven the way a user drives them — typing into the search box,
pressing "next month", dropping a card, dismissing a dialog.

Covered by `tests/view.test.ts` and `tests/interact.test.ts`:

- The search box keeps what you typed, and keeps narrowing.
- Calendar and timeline navigation advance, and "Today" comes back.
- A collapsed row stays collapsed, and ticked rows stay ticked, across a refresh.
- A side peek reuses its own pane and never takes over the left sidebar.
- Ctrl-click opens a tab instead.
- A card dragged between columns writes the column it landed in **and nothing
  else**.
- Dismissing the delete dialog deletes nothing; each answer deletes exactly what
  it says, sub-items included.
- Every filter shape survives a round trip through both readers
  (`tests/roundtrip.test.ts`).

Each of those was verified by reintroducing the original bug and watching the
test fail. They are not decorative.

## What still needs you

These turn on things the harness cannot honestly model: Obsidian's real
semantics, a real drag gesture, and what the thing actually looks like. The test
suite's Obsidian is a model, and a wrong model passes its own tests.

Twenty minutes, before a release that touches views, panes or the editor.

### Real gestures

1. Drag a card between columns with the mouse. It should land where you dropped
   it. (The handler is tested; the browser's drag gesture reaching it is not.)
2. Drag a card **within** one column to reorder it.
   *Wrong:* it lands one position off.
3. Decline the "switch to manual ordering?" prompt, then drag again.
   *Wrong:* it asks a second time.
4. Drag a card into a column already at its WIP limit. It should go, with the
   count coloured — a limit is a signal, not a rule.

### The editor's DOM

5. Open a note with an icon and a cover. Both appear above the title.
6. Switch to source mode and back.
   *Wrong:* two banners, or none.
7. Close and reopen the tab.
   *Wrong:* the banner is gone, or duplicated.

### It has to look right

8. Open a board, a gallery, a calendar and a timeline. Nothing overlapping,
   clipped or unreadable.
9. Switch between light and dark theme.
10. Narrow the pane until it scrolls horizontally.

### The install itself

11. Update from the previous version and open an existing database. Its schema,
    views and rows are intact.
