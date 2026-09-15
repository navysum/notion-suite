# Contributing

Nothing here is style advice. Every rule below exists because the same bug
shipped, or nearly shipped, more than once — and each one is backed by a check
that fails the build, so it cannot quietly come back.

## The checks

```bash
npm run typecheck   # tsc
npm run lint        # eslint, including eslint-plugin-obsidianmd
npm test            # unit tests + tests/guards.test.ts
npm run build       # what the release workflow publishes
```

CI runs all four on every push and pull request, and the release workflow runs
them again before it publishes. A release cannot be cut from a tree that fails
any of them.

## Rules

### 1. Per-view state is keyed on a stable host, never on an element a render creates

**Shipped three times.** Calendar navigation never advanced a month. The "add
option" prompt attached itself to the first view on the page. The full-page
database cleared its own search box as you typed in it. Same shape every time:
state stored against an element that the next render throws away.

There is now exactly one element-keyed map in the plugin, in
`src/views/viewState.ts`. `renderDatabaseView` resolves it once against the
surface's stable host and passes the resulting `SurfaceState` down as an
ordinary typed parameter. Renderers below that point are handed state and have
no element to mis-key.

Need to remember something across a re-render? Add a field to `SurfaceState`.
Do not add a second map, and do not pass an element to a renderer so it can hang
state on it.

*Enforced by:* `element-keyed state lives only in viewState.ts` and
`no renderer takes a 'stateHost' element`.

### 2. Anything rendered to text and read back gets a round-trip test

**Nearly shipped twice**, in the same dialog. The filter editor once wrote a
nested filter across several lines with a leading connective, so re-reading it
turned `and (...)` into a rule about a property called "and". Then the textarea
was read one line at a time by the flat-rule parser, so `(A or B) and C` came
back as one nonsense rule about a property called "(A" — and a plain
`Status is Doing or Priority > 4` came back as an AND of two broken rules.

Both were silent. Opening the settings dialog and pressing Save without touching
anything changed which rows the view matched.

A text form is a serialisation format. Test it as one: render, re-parse through
**every** reader, and assert the result selects the same rows — not that the
string looks right.

*Enforced by:* `tests/roundtrip.test.ts`.

### 3. One implementation of shared logic

**Shipped once.** The widgets grew their own copy of the rollup aggregation, and
the copy drifted: empty lists dropped out of the denominator, so "percent not
empty" read 100%. The original had already been fixed for exactly that.

`collapse` and `gatherValues` live in `src/db/rollup.ts`. Call them.

*Enforced by:* `rollup aggregation is not reimplemented`.

### 4. Dismissing a dialog never does anything

**Caught mid-fix.** The first version of the "delete a row with sub-items"
dialog asked a three-way question through a two-button confirm, so closing the
window would have deleted the parent.

`confirm()` resolves `false` when dismissed. `choose()` resolves `null` — not a
default answer. A question with more than two answers uses `choose()`, and the
`null` branch must do nothing at all.

### 5. Write it, wire it, or delete it

**Shipped four times.** `renameRow`, `descendantsOf`, `isNumericRollup` and
`clearChildren` were each written, exported, and never called — while the
feature they were written for did the wrong thing or nothing.

*Enforced by:* `no export is written and then never used`.

### 6. Never evaluate a string as code

The formula engine is a hand-written tokenizer, Pratt parser and evaluator
precisely so that the plugin never needs `eval` or `new Function`. The community
directory's review rejects plugins that do.

*Enforced by:* `nothing evaluates a string as code`.

### 7. Behaviour that only runs in Obsidian is tested in a DOM, not by hand

Four of the six bugs in the last audit were in code that only ran inside
Obsidian — element lifecycles, panes, drag handlers — so the only check was a
human clicking through the app, which is the check that kept missing them.

`tests/dom.ts` installs a DOM (happy-dom) and the element helpers Obsidian bolts
onto `HTMLElement`, so the plugin's real renderers run in CI. A test can type
into the search box, press "next month", drop a card or dismiss a dialog and
then look at what the user would be looking at. New behaviour in a view, a pane
or a handler gets a test there.

Every such test was written by reintroducing the original bug and watching it
fail. Do that with a new one too — a test that has never failed has not been
tested.

## What the checks still cannot see

The harness is a *model* of Obsidian, and a wrong model passes its own tests.
What turns on Obsidian's real semantics — how `rightSplit` resolves, when a
post-processor re-runs, what a real drag gesture carries — plus anything visual,
stays in `docs/SMOKE.md`. That list is now eleven items rather than twenty-one.
Walk it before a release that touches views, panes or the editor.

## Releasing

Bump `version` in `manifest.json`, `package.json` and `versions.json`, then push
to `main`. The release workflow reads the manifest, verifies the tree and
publishes the matching GitHub release with `main.js`, `manifest.json` and
`styles.css`. A push that does not change the version publishes nothing.
