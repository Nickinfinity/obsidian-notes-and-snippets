# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install           # Install deps (no node_modules by default — run after clone)
npm run compile        # One-off TypeScript build (outputs to dist/)
npm run watch          # Watch mode for development (preferred during active development)
npm run lint           # ESLint check (runs against src/)
npm run test           # Compile + lint + run all tests (507 passing)
rm -rf dist && npm test # REQUIRED after any file delete or rename — see below
npx tsc --noEmit       # Type-check only — IDE diagnostics can be stale; use this to verify
```

**Clean-rebuild rule.** `tsc` does not remove orphaned output, so a deleted
test's stale compiled artifact keeps running and *inflates* the pass count into
a phantom green. `rm -rf dist` after any delete or rename.

**macOS socket-path caveat.** `.vscode-test.mjs` pins
`--user-data-dir=/tmp/oa-vsct` because macOS caps unix socket paths at 103 chars
and the default under a deep repo path overflows it (`listen EINVAL … .sock`).
Seeing that does not mean the suite is broken — never fall back to a partial gate.

Press **F5** in VS Code to launch the Extension Development Host.

---

## What This Extension Does

**Obsidian Artifacts: AI Snippets & Tools** bridges an Obsidian vault and VS Code, letting developers insert vault content — snippets, templates, commands, agent configs, and variables — directly into the editor or terminal without leaving VS Code.

- **Settings panel** — pick and validate the vault root, toggle artifact directories.
- **Artifact picker** — a `vscode.QuickPick` hierarchical navigator with a
  side-by-side **interactive preview**: editable code area (line numbers, hljs,
  `<VK-xxx>` spans) plus variable inputs. **Insert** resolves variables to the
  cursor or terminal; **Edit .md** opens the real vault file.
- **Create form** — a webview form that writes new artifacts into the vault.
- **Variable Sets** — reusable `<VK-xxx>` default bundles, applied with a diff
  preview or saved from current values.

---

## Folder Structure

```
src/
├── extension.ts                      # Entry point — activate() / deactivate()
├── commands/
│   ├── openSettings.command.ts       # Registers obsidian-artifacts.settings
│   ├── insert.command.ts             # One insert command per artifact (loop over ARTIFACTS)
│   └── create.command.ts             # Create-artifact flow + editor-selection capture
├── services/                         # Domain logic. Panels/commands stay thin wiring.
│   ├── artifact-type-config.service.ts   # THE ARTIFACTS reader — getEntry, getAllTypes, getFormConfig…
│   ├── config.service.ts                 # THE settings reader — CONFIG_SECTION, getVaultPath(RootUri)
│   ├── artifact-serializer.service.ts    # THE .md emitter — serializeArtifact
│   ├── parser.service.ts                 # THE .md reader — parse*, extractVars, resolveVars, VK_TOKEN_RE
│   ├── filename.service.ts               # THE slug — slugify, deriveFileName, validate* guards
│   ├── artifact-patcher.service.ts       # Surgical in-place .md edits
│   ├── artifact-writer.service.ts        # Atomic writes + isWithinRoot path-escape guard
│   ├── vault.service.ts · context.service.ts     # Vault validation/detection; context keys
│   ├── language-map.service.ts · render.service.ts  # mapLanguageId; renderCode(Rows)Html
│   ├── varset.service.ts                 # Scanner, score, extractSubSets, applyVarSet, buildVarSetModel
│   └── preview-mode.service.ts · temp-document.service.ts
├── ui/
│   ├── panels/
│   │   ├── artifactPicker.panel.ts   # Re-export shim (back-compat for insert.command.ts)
│   │   ├── artifactPicker/           # Parts table under Architecture. navigator · codeBlock ·
│   │   │                             # preview(.render/.clientJs/.helpers) · blockEditor ·
│   │   │                             # fullEditor · varSetController · varSetDiff ·
│   │   │                             # webviewSnippets · shared   (+ *.helpers.ts siblings)
│   │   ├── artifactForm/             # panel(.helpers) · form.html · form.blocks ·
│   │   │                             # form.clientJs · form.helpers · shared
│   │   └── settings.panel.ts · varsetPicker.panel.ts · destFolderPicker.panel.ts
│   ├── base.css                      # Global reset + bare h1/hr/button — EVERY panel links this
│   └── settings.css · picker.css · form.css · hljs.css · code-block.css · varset.css
├── types/
│   ├── constants.ts                  # ARTIFACTS · LANG_ALIAS · LANG_FENCE · LANG_EXT
│   ├── parsed-artifact.types.ts      # ArtifactType union, ParsedArtifactFile, ParsedBlock, ParsedVar
│   └── artifact.types.ts · artifact-form.types.ts · varset.types.ts · webview-messages.types.ts
├── utils/
│   ├── helpers.ts                    # getNonce() — CSPRNG-backed
│   └── html.ts                       # THE escHtml (& < > " ') + styleLinkTags
├── features/ · providers/            # (empty) reserved
test/                                 # 507 tests. fixtures/ + snapshots/
├── snapshots/varset/*.md             # Byte-exact var-set emission goldens — NEVER edit
├── snapshots/form-html/*.html        # Form-panel HTML snapshots
└── drift guards: language-consistency · frontmatter-keys · constants · webview-snippets
```

---

## Architecture

### Activation flow (`src/extension.ts`)

`activate()` registers the settings/insert/create commands, then **awaits**
`refreshVaultContext()` — without the await the context keys land late and the
first right-click shows no items. If no vault path is stored, the Settings panel
opens automatically. An `onDidChangeConfiguration` listener watches the section
(via `CONFIG_SECTION`) and re-creates enabled-but-missing directories on Settings
Sync — **create only, never auto-delete.**

### Settings panel (`src/ui/panels/settings.panel.ts`)

On folder pick: `validateObsidianVault()` (requires `.obsidian/`) →
`detectVaultDirs()` → auto-create the `default: true` entries → persist path and
feature flags to `obsidianArtifacts.*` (Settings Sync). It is the **only writer**
of that config section; it sources the section name from `CONFIG_SECTION`.

### Single sources of truth

Each of these is the **only** place its fact lives. Re-implementing one is the
regression this list exists to prevent; each is held by a named guard test.

| Fact | Sole owner | Guard |
|---|---|---|
| Artifact types | `artifact-type-config.service.ts` — `getEntry` / `getAllTypes` | `constants.test.ts` — parser accepts every `ARTIFACTS` type |
| Settings section | `config.service.ts` — `CONFIG_SECTION`, `getVaultPath`, `getVaultRootUri` | — (thin `vscode` wrapper; covered via callers) |
| `.md` emission | `artifact-serializer.service.ts` — `serializeArtifact` | `varset-serialize.test.ts` byte goldens + `frontmatter-keys.test.ts` |
| `.md` parsing | `parser.service.ts` | `frontmatter-keys.test.ts` binds it to the serializer |
| HTML escaping | `utils/html.ts` — `escHtml` (all five of `&<>"'`) | `webview-snippets.test.ts` — webview `esc` must match it |
| Webview `esc`/`lbl` | `artifactPicker/webviewSnippets.ts` — `WEBVIEW_ESC_LBL_JS` | `webview-snippets.test.ts` — defined exactly once per bundle |
| Slugs | `filename.service.ts` — `slugify` | `filename.service.test.ts` |
| `<VK-xxx>` regex | `parser.service.ts` — `VK_TOKEN_RE` | `utils-html.test.ts` (shared-instance `lastIndex` reuse) |
| Language tables | `types/constants.ts` — `LANG_ALIAS` / `LANG_FENCE` / `LANG_EXT` | `language-consistency.test.ts` |

**Never write `ARTIFACTS.find(...)`, a second `escHtml`, or a second slug.**
Never call `vscode.workspace.getConfiguration('obsidianArtifacts')` outside
`config.service.ts`.

### Artifact picker (`src/ui/panels/artifactPicker/`)

The legacy `artifactPicker.panel.ts` is a 1-line re-export shim kept for
back-compat with `commands/insert.command.ts`.

| File | Owns |
|---|---|
| `navigator.ts` (+ `.helpers.ts`) | `ArtifactNavigator`, `openArtifactPicker`, parse cache, hierarchical browsing, accept/active routing |
| `codeBlock.ts` | Editable code-area HTML (`buildCodeBlockHtml`) + `CODE_BLOCK_CLIENT_JS` (caret preservation, debounced re-render, paste/Enter intercept). Also carries `WEBVIEW_ESC_LBL_JS`. |
| `preview.ts` | `PreviewPanelController` — popup lifecycle + message routing. **Controller only.** |
| `preview.render.ts` | `renderPreviewHtml`, `renderMultiBlockPreviewHtml`, `renderPopupEmptyHtml`, `mergeVarsWithDefaults` |
| `preview.clientJs.ts` | `PREVIEW_CLIENT_JS` — the popup's webview-side script |
| `blockEditor.ts` (+ `.helpers.ts`) | `BlockEditController` — one block to a temp file; `normalizeLangId` / `resolveLangId` / `extForLang` |
| `fullEditor.ts` (+ `.helpers.ts`) | `FullEditController` — real `.md` in an editor tab; save → `fileUpdated`, change (500 ms) → `updateVars` |
| `varSetController.ts` · `varSetDiff.ts` | Variable-set apply/save routing and diff HTML |
| `webviewSnippets.ts` | `WEBVIEW_ESC_LBL_JS` — shared client-JS `esc`/`lbl` |
| `shared.ts` | Single `out` OutputChannel |

`openArtifactPicker(dir, name)` validates the vault and artifact directory, then hands off to `ArtifactNavigator.run()`. There is no WebviewPanel — the entire picker is a `vscode.QuickPick`.

**Controller composition — callback bags, never reaching inward.**
`ArtifactNavigator` constructs `PreviewPanelController` with
`{ extensionUri, rootFs, targetEditor, setCache, onDispose, closePicker }`;
that controller owns `FullEditController` with
`{ rootFs, getCurrentArtifact, setCurrentArtifact, setCache, postMessage }`.
The full-editor never touches the navigator. `parseCache` lives on the
navigator; others write through `setCache`. **Imitate this shape** when adding a
sub-controller.

**Client-script assembly.** `renderPreviewHtml` injects
`buildCodeBlockHtml(renderCodeRowsHtml(code, lang))` and concatenates the client
scripts inside **one** outer IIFE, so they share the single
`acquireVsCodeApi()` — which may be called **once per webview**.

**Non-obvious invariants** (per-method detail is in each file's JSDoc — read the
source rather than a second copy of it here):
- `onDidChangeActive` is debounced 120 ms; the code area re-renders locally in
  the webview on a 150 ms debounce with **no** round-trip to the extension.
- `CODE_BLOCK_CLIENT_JS` exposes
  `window.__codeBlock = { extractCode, renderRows, flushPendingRender, setCode }`.
  Insert must call `flushPendingRender()` **before** `extractCode()`, or it reads
  stale text.
- `FullEditController.teardown()` **must** run before `panel.dispose()`, or the
  watchers post into a disposed webview.

**Code preview rendering (`src/services/render.service.ts`):**
- `renderCodeHtml(code, fenceLang?)` returns a full `.code-block-wrapper` block;
  `renderCodeRowsHtml` returns only the inner rows — use it when the caller
  supplies its own wrapper (the editable code area) to avoid double-nesting.
- One `.code-line-row` per line → `.line-number` (`contenteditable="false"`, so
  it survives an editable wrapper) + `.code-content` (`pre-wrap`/`break-all`,
  no horizontal scroll).
- `<VK-xxx>` tokens are protected from hljs splitting via `__VK0__` placeholders
  before highlighting, then restored as `.vk-var` spans after.
- All colours use VS Code CSS variables, so light/dark work automatically.

**Module-level helpers (`preview.helpers.ts` unless noted):** `blockAsArtifact`
(ParsedBlock → ParsedArtifactFile; re-exported from `preview.ts` for one import
site) · `performInsert` (cursor, terminal for `command` type, clipboard
fallback) · `labelForVar` (**canonical** — the `WEBVIEW_ESC_LBL_JS` twin is
test-pinned to it) · `popupShell` (`cssUri` takes one URI or an ordered array) ·
`buildItem` / `relFsPath` (`navigator.helpers.ts`).

**Two variable-name conventions — do not conflate:**
- QuickPick descriptions strip the `VK-` prefix **only**: `VK-api_key` → `api_key`.
- Preview/form labels apply full `labelForVar`: `VK-api_key` → `Api key`.

**Insert-time var resolution is three-tier:** user input → `v.defaultValue` →
otherwise the `<VK-xxx>` token is left in the output literally.

### Parser service (`src/services/parser.service.ts`)

Seven exports: `parseArtifactFile` (sync, reads from disk), `parseFromContent`
(pre-read string — used by the picker's async reads), `parseBlocks`,
`extractVars`, `resolveVars`, plus two the drift guards bind:
`VK_TOKEN_RE` (carries `/g` — use only with `matchAll`/`replaceAll`, or reset
`lastIndex`) and `STRING_FRONTMATTER_KEYS`. The parse functions extract:
frontmatter (`---` fences), the ` ```code ` block, vars (a ` ```vks ` fence for
`type: variables`, else an unfenced `vars:` section after the code), and
`blocks` — `## ` headings each followed by a fence. An empty `blocks` array
signals a single-block file. Tokens are auto-detected by `extractVars`; a
section whose **first** fence is ` ```vks ` is a pure sub-set, while a code
fence *followed by* one gets defaults merged via `mergeVarDefaults` (code order
kept, vks-only keys appended, unmatched detected vars keep `''`).
**`ARTIFACT_FILE_FORMAT.md` is the authority on all of this** — read it before
touching the parser, the serializer, or any fixture.

### Insert commands (`src/commands/insert.command.ts`)

`registerInsertCommands(context)` loops over `ARTIFACTS` and registers **one
command per artifact**, all handled by the same `openArtifactPicker`. One loop,
one handler, zero hardcoded names — the per-artifact command IDs exist only
because of a hard VS Code constraint:

> A context-menu item's label comes **exclusively** from the `title` of the
> matching `contributes.commands` entry. Per-item overrides in
> `contributes.menus` are silently ignored.

IDs follow `obsidian-artifacts.insert.<dir.toLowerCase()>` via
`artifactCommandId(dir)` and must match `package.json`.

**Adding a new artifact type** — two source edits, both in `src/types/`:
1. Add the entry to `ARTIFACTS` in `src/types/constants.ts`.
2. Add the literal to the `ArtifactType` union in `parsed-artifact.types.ts`.
   Skipping this is a **compile error**, by design — an unrecognised type must
   never silently downgrade to `'snippet'`.

Everything else derives: command registration, context keys, parser acceptance
and the type-config accessors. Then, for menu presentation only:
3. Add a matching `contributes.commands` entry in `package.json` with the correct title.
4. Add `contributes.menus` entries for the relevant context surfaces.

**Menu presentation.** `Variables` has `contexts: ['all']`, appears everywhere,
and is labelled **"See/Edit Variables"** (browse/edit, not insert); it sits in
`package.json` group `"2_variables@1"` while others use `"1_insert@N"`, so VS
Code's group separator keeps it last. Each surface shows direct entries when one
artifact is active there, or an "Obsidian Artifacts" submenu when two or more
are (`*HasMultiple` context keys, maintained by `context.service.ts`).

### Vault directory logic (`constants.ts` + `vault.service.ts`)

Each `ARTIFACTS` entry drives directory creation/detection, context keys, and
command registration. `default: true` (`Snippets`, `AgentsConf`) are auto-created
on first vault selection; `default: false` (`Commands`, `Templates`, `Variables`)
are detected but never auto-created.

### No runtime dependencies

Only the VS Code API and Node `fs`/`path` — no third-party packages. Keep it
that way; the ladder is reuse → stdlib → native before any new dep.

---

## Interactive Preview Panel

On Enter, the picker closes and the popup webview becomes the interaction
surface: an editable code area (line numbers `contenteditable="false"`, hljs
highlighting, `<VK-xxx>` spans), one `<input>` per token pre-filled from
`vars:`, and **Insert** / **Edit .md** / **Cancel**.

**CSP requirement:** the popup is **always** created with `enableScripts: true`.
Creating it once with `false` (e.g. after hovering a multi-block file) silently
blocks every button handler with no error.

**Webview ↔ extension message protocol** (both the picker popup and the
variable-set flow — one table, not two):

| Direction | Command | Payload |
|---|---|---|
| webview → ext | `insert` | `{ code, vars: Record<string,string> }` |
| webview → ext | `fullEdit` / `editBlock` / `cancel` | — (whole `.md` · block temp file · close) |
| webview → ext | `codeChanged` | `{ code: string }` |
| webview → ext | `pickVarSet` / `saveAsVarSet` | `{ values: Record<string,string> }` |
| webview → ext | `confirmApply` / `cancelApply` | — |
| webview → ext | `clearVarSource` | `{ name: string }` |
| ext → webview | `updateRows` | `{ html: string }` — re-rendered highlighted rows |
| ext → webview | `updateVars` | `{ vars: ParsedVar[] }` |
| ext → webview | `fileUpdated` | `{ code, vars }` — after `.md` save |
| ext → webview | `switchMode` | `{ mode: 'preview' \| 'edit' }` |
| ext → webview | `showVarSetDiff` | `{ html: string, subSetName: string }` |
| ext → webview | `varSetApplied` | `{ values, subSetName, varNames }` |
| ext → webview | `varSetCancelled` | — |

---

## Vault File Format & Variable Syntax

> The on-disk `.md` structure (single-block, multi-block, `type: variables`),
> the per-artifact variations table and the `<VK-xxx>` syntax live in
> [`ARTIFACT_FILE_FORMAT.md`](ARTIFACT_FILE_FORMAT.md) — **authoritative**, and
> what the parser implements and `parse(serialize(x)) ≅ x` must satisfy. If it
> and the code disagree, that is a bug to reconcile, not a judgement call — and
> the reconciliation extends the shared code to match the spec, never the
> reverse.

---

## Variable Sets

Reusable bundles of `<VK-xxx>` defaults applied to any artifact at insert time,
stored in the vault's `Variables/` directory (shape:
[`ARTIFACT_FILE_FORMAT.md` §6](ARTIFACT_FILE_FORMAT.md)).

**Scoring:** `score = matchRatio * 0.7 + (tagMatches / totalArtifactTags) * 0.3`.
Vars match on exact `name` (full `VK-xxx` token, case-sensitive); tags match
against the artifact's frontmatter `tags`.

**Apply flow:** **[Apply Variable Set]** → QuickPick of every sub-set across
every variable file, score-sorted → `applyVarSet(currentValues, subSet.vars)`
posts `changes[]` as a diff preview (`renderVarSetDiffHtml`) → **Apply** commits
or **Cancel** reverts. Applied inputs gain a `from: <setName>` badge; editing an
input clears it. Sets **stack** — later sets override overlapping vars, earlier
non-overlapping ones persist.

**Save-as flow:**

- The variables section also exposes **[Save as Variable Set]**, visible only when at least one input has a non-empty value.
- On click the extension prompts for title and (optional) description, then
  builds a model with `buildVarSetModel` (`varset.service.ts`) and emits it
  through **`serializeArtifact`** — there is no bespoke var-set file builder.
  The slug comes from `filename.service.slugify`; tags are copied from the
  active artifact. Byte output is locked by `test/snapshots/varset/*.md`.
- The shared `VarSetScanner` cache is invalidated after the write so the next pick run sees the new file.

**Source tracking:** `PreviewModeController.varSources` holds
`varName → setName` so the badge survives extension-side re-renders; the webview
posts `clearVarSource` when the user edits an input.

**Module map:** `services/varset.service.ts` (`VarSetScanner` cached recursive
scan, `scoreVarSet`, `extractSubSets`, `applyVarSet`, `buildVarSetModel` — pure
parts unit-tested in `test/varset-*.test.ts`) · `panels/varsetPicker.panel.ts`
(`pickVarSet`, `getVarSetScanner` for cache invalidation) ·
`artifactPicker/varSetDiff.ts` (`renderVarSetDiffHtml`) ·
`artifactPicker/varSetController.ts` (composed by `PreviewPanelController`) ·
`types/varset.types.ts`.

Messages are in the single protocol table above.

---

## Key Config Files

| File | Purpose |
|---|---|
| `tsconfig.json` | Strict mode, `ES2022` target, `Node16` module resolution, `rootDir: "."`, output to `dist/` |
| `package.json` | `"main": "./dist/src/extension.js"` — mirrors the `rootDir: "."` output path |
| `eslint.config.mjs` | Enforces naming conventions, curly braces, `===` equality, semicolons |
| `.vscode/launch.json` | Debug launch with `--extensionDevelopmentPath`; other extensions disabled in the host |
| `.vscode/tasks.json` | `npm watch` is the default build task (runs automatically on F5) |
| `.vscode-test.mjs` | Test runner looks for compiled tests at `dist/test/**/*.test.js` |
| [`ARTIFACT_FILE_FORMAT.md`](ARTIFACT_FILE_FORMAT.md) | **Authoritative** artifact `.md` structure spec — parser/serializer contract. Read before touching vault files, fixtures, parser, or any writer. |

---

## VS Code Extension Notes

- `activationEvents: []` in `package.json` — the extension activates on every window open. Narrow this to specific command events once commands stabilise.
- Compiled output goes to `dist/` and is **gitignored**. Run `npm run compile` after cloning.
- `media/` ships in the packaged extension. `src/`, `test/`, and `dist/test/` are excluded via `.vscodeignore` — **except `!src/ui/*.css`**, which must stay a glob. The webviews load stylesheets from source, so a named exception silently ships a CSS-less extension when a sheet is added or renamed, and the suite stays green because tests run from source. Verify with `npx vsce ls | grep css`.
- All imports use explicit `.js` extensions (e.g. `'./helpers.js'`) — required by `Node16` module resolution even for `.ts` source files.
- Webview `localResourceRoots` is restricted to `extensionUri/src/ui` — all webview assets must live in `src/ui/`.

---

## Code Style

### ⚠️ File complexity limits (READ FIRST)

**Never grow a file into a god-object.** One extra import line is cheap; a
1000-line file is paid for on every read.
- A `.ts` file stays under **~400 lines**. Plan a split at ~500. **Past 700, split before adding.**
- A function stays under **~50 lines** (ESLint caps cognitive complexity at 15, `S3776`).
- A class owns **one concern** — if you need a `// ── Section X ──` banner to
  navigate inside it, that section wants its own file.

**Splitting pattern:** a domain feature gets a folder, not a file — one `*.ts`
per concern, a sibling `*.helpers.ts` for its pure functions, and a `shared.ts`
for cross-concern singletons.

**Worked examples.** The picker was one 1182-line `artifactPicker.panel.ts`; it
was split by concern into the folder above, controllers composing via callback
bags. Later `preview.ts` hit 595 lines and was cut on the seam `artifactForm/`
already used — **controller** (`preview.ts`) · **renderers**
(`preview.render.ts`) · **webview script constant** (`preview.clientJs.ts`) ·
**pure helpers** (`preview.helpers.ts`) — landing at 300 with no behaviour
change. Use that seam for a panel file before inventing another.

**Reaching for a file that is already large?** Different concern → new sibling
file. Stateless/pure → its `*.helpers.ts`. Service/cross-cutting →
`src/services/`, never the panel. Only if all three are "no" with a reason does
it go in the existing file. Notice a file crossed 400 lines while finishing a
feature → propose the split in that PR, not later.

### Invariants (each cost a real bug here)

**An invariant stated in a comment is not an invariant.** Two comments here
asserted contracts that had *already* broken: `artifact-type-config.service.ts`
claimed nothing else traversed `ARTIFACTS` (six sites did), and `constants.ts`
said "keep the two directions consistent" about language tables that had drifted
— with the effect that **no Objective-C fence worked at all**. → Every
cross-file invariant gets a **test**, and the comment names it.

**Any list enumerating a domain set is derived, or drift-guarded.**
`VALID_TYPES` was a hand-copy of the `ARTIFACTS` types; a missing entry silently
downgraded to `'snippet'` — wrong behaviour, no error.

**A guard test that cannot fail is decoration.** Prove each new guard by
reintroducing the exact bug, watching it go red, then restoring. This caught a
guard here that passed against the very drift it was written for.

**"Duplicate" is a claim about behaviour, not shape.** Diff the bodies before
collapsing: the webview `esc` "copies" escaped 5, 4, 3 and **0** characters, and
the one that escaped nothing was writing unescaped user values into HTML
attributes.

**Webview client JS cannot import — so it gets one shared exported snippet
string, never a copy-paste** (`WEBVIEW_ESC_LBL_JS`, carried by
`CODE_BLOCK_CLIENT_JS` so consumers inherit it exactly once).

**Data crossing a webview message is untrusted.** Keep its guard (`panel.ts`'s
`getEntry` try/catch) and escape everything interpolated into webview HTML.

### Comments
- Every function and interface must have a JSDoc block that includes: a concise description, `@param` tags, a `@returns` tag, and at least one `@example`.
- Add inline section comments (e.g. `// ── Section name ───`) to visually group logical blocks within longer functions.
- Comments should explain **why**, not **what** — well-named identifiers already describe what the code does.

### File organisation
Domain logic in `services/`, shared pure helpers in `utils/`, constants in
`types/constants.ts`, types in `types/` (**no `vscode` imports there** — adapt at
the edges), webview HTML + message handling in `ui/panels/`. Commands and panels
stay thin wiring.

### ESLint gotchas
- Use `RegExp.exec(str)` not `str.match(re)` — rule `S6594`.
- Use `str.startsWith(x)` not `/^x/.test(str)` — rule `S6557`.
- No nested template literals — extract inner expression to a variable first — rule `S4624`.
- Cognitive complexity limit is 15 per function (`S3776`) — extract sub-methods when approaching it.
