# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branching and pull requests

**Work happens on `feature/<slug>`. Pull requests always target `develop` — never
`main`.**

`main` is the release branch and is protected (PR required, one code-owner
approval, no force-pushes). It receives changes only by promoting `develop`, not
from feature branches directly. Opening a feature PR against `main` is the wrong
base even when the diff is correct, and neither way out is free:

- **Revert the merge.** Respects protection, but leaves those commits as
  ancestors of `main` — so a later `develop` → `main` promotion sees them as
  already merged and **silently does not reapply them**. Recovering needs a
  revert-of-the-revert on the promoting PR.
- **Rewind `main`.** Clean, and leaves no trap, but requires an admin to lift
  `allow_force_pushes`, force-push, and restore protection. Capture the full
  protection payload *before* lifting it and diff it back afterwards — the
  GitHub API takes a whole-object `PUT`, so a partial payload silently drops
  settings.

This happened once (PR #7, rewound on 2026-08-18). Check the base before opening
the PR; it costs nothing then.

```
feature/<slug>  ──PR──▶  develop  ──PR──▶  main
```

Everything else in `CREATING_A_PLAN.md` still holds — per-wave commits, ticket
ids leading the subject, `git rm -r docs` before the PR.

---

## Commands

```bash
pnpm install           # Install deps (no node_modules by default — run after clone)
npm run compile        # One-off TypeScript build (outputs to dist/)
npm run watch          # Watch mode for development (preferred during active development)
npm run lint           # ESLint check (runs against src/)
npm run test           # Compile + lint + run all tests (754 passing)
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

**Obsidian Artifacts: AI Snippets & Tools** bridges an Obsidian vault and VS Code, letting developers insert vault content — snippets, templates, commands, agent configs, AI prompts, and variables — directly into the editor or terminal without leaving VS Code.

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
│   ├── create.command.ts             # Create-artifact flow + editor-selection capture
│   └── migrate.command.ts            # obsidian-artifacts.migrateFrontmatter — dry-run, then apply
├── services/                         # Domain logic. Panels/commands stay thin wiring.
│   ├── artifact-type-config.service.ts   # THE ARTIFACTS reader — getEntry, getAllTypes, getFormConfig…
│   ├── config.service.ts                 # THE settings reader — CONFIG_SECTION, getVaultPath(RootUri)
│   ├── artifact-serializer.service.ts    # THE .md emitter — serializeArtifact
│   ├── parser.service.ts                 # THE .md reader — parse*, extractVars, resolveVars, VK_TOKEN_RE
│   ├── flags.service.ts                  # THE %%oa:start%%/%%oa:end%% syntax — extractFlaggedRegions
│   ├── frontmatter-migration.service.ts  # THE `type:` → `artifactType:` rewrite — planMigration/applyMigration
│   ├── filename.service.ts               # THE slug — slugify, deriveFileName, validate* guards
│   ├── template.service(.helpers).ts     # Whole-file types (template + agent) — resolveOutputFileName,
│   │                                     # validateSingleBlock; helpers = path-injection/ext rules
│   ├── artifact-patcher.service.ts       # Surgical in-place .md edits
│   ├── artifact-writer.service.ts        # Atomic writes + isPathWithin path-escape guard
│   ├── vault.service.ts · context.service.ts     # Vault validation/detection; context keys
│   ├── language-map.service.ts · render.service.ts  # mapLanguageId; renderCode(Rows)Html
│   ├── varset.service.ts                 # Scanner, score, extractSubSets, applyVarSet, buildVarSetModel
│   ├── multi-index.service.ts            # THE index link syntax + safeRelPath — buildIndexPlan,
│   │                                     # buildDestCandidates, applyCarryOver (vscode-free)
│   └── preview-mode.service.ts · temp-document.service.ts
├── ui/
│   ├── panels/
│   │   ├── artifactPicker.panel.ts   # Re-export shim (back-compat for insert.command.ts)
│   │   ├── artifactPicker/           # Parts table under Architecture. navigator · codeBlock ·
│   │   │                             # preview(.render/.clientJs/.helpers/.createFile/.batch) ·
│   │   │                             # blockEditor · fullEditor · varSetController · varSetDiff ·
│   │   │                             # multiIndex(.dest) · webviewSnippets · shared
│   │   │                             # (+ *.helpers.ts siblings)
│   │   ├── artifactForm/             # panel(.helpers) · form.html · form.blocks ·
│   │   │                             # form.clientJs · form.helpers · shared
│   │   └── settings.panel.ts · varsetPicker.panel.ts · destFolderPicker.panel.ts
│   ├── base.css                      # Global reset + bare h1/hr/button — EVERY panel links this
│   └── settings.css · picker.css · form.css · hljs.css · code-block.css · varset.css
├── types/
│   ├── constants.ts                  # ARTIFACTS · LANG_ALIAS · LANG_FENCE · LANG_EXT
│   ├── parsed-artifact.types.ts      # ArtifactType union, ParsedArtifactFile, ParsedBlock, ParsedVar
│   ├── multi-index.types.ts          # IndexStep · IndexPlan · DestCandidate · CarryOver · BatchOutcome
│   └── artifact.types.ts · artifact-form.types.ts · varset.types.ts · webview-messages.types.ts
├── utils/
│   ├── helpers.ts                    # getNonce() — CSPRNG-backed
│   ├── html.ts                       # THE escHtml (& < > " ') + styleLinkTags
│   └── path-containment.ts           # THE containment rule — isPathWithin(root, candidate)
├── features/ · providers/            # (empty) reserved
test/                                 # 754 tests. fixtures/ + snapshots/
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
| `<VK-xxx>` regex | `parser.service.ts` — `VK_TOKEN_RE` (matches `</VK-xxx>` too) | `utils-html.test.ts` (shared-instance `lastIndex` reuse) · `vk-closing-tag.test.ts` binds the webview `vkWrap` twin |
| Language tables | `types/constants.ts` — `LANG_ALIAS` / `LANG_FENCE` / `LANG_EXT` | `language-consistency.test.ts` |
| Context-menu surfaces | `types/constants.ts` — each `ARTIFACTS` entry's `contexts` | `package-menus.test.ts` — pins `package.json` menus to `ARTIFACTS` |
| Write-a-file vs insert | `types/constants.ts` — `writesFile`, read via `writesWholeFile` | `artifact-type-config.test.ts` — answer must equal the flag, every type |
| Single-block restriction | `types/constants.ts` — `form.multiBlock`, read via `canMultiBlock` / `forcesSingleBlock` | `artifact-type-config.test.ts` — mirrors the flag, every create-form type |
| Whole-file naming | `template.service.ts` — `resolveOutputFileName` | `template.service.test.ts` — agent `target:` verbatim vs template D3 chain |
| Flag syntax (`%%oa:…%%`) | `flags.service.ts` — `extractFlaggedRegions` | `flags.service.test.ts` — no other `src/` file may spell the marker |
| Index link + path syntax | `multi-index.service.ts` — `safeRelPath` (the sole rejection authority) | `multi-index.service.test.ts` — hostile inputs asserted through **both** callers |
| Read-side-only frontmatter keys | `parser.service.ts` — `BOOLEAN_FRONTMATTER_KEYS` / `ARRAY_FRONTMATTER_KEYS`, absent from the serializer's `FRONTMATTER_KEY_ORDER` | `frontmatter-keys.test.ts` — the D11 guard: `index` / `paths` must never be emitted |
| `artifactType` frontmatter key — single key, exact-case PascalCase, no legacy `type:` read (D1) | `parser.service.ts` — `applyFrontmatterField` / `VALID_TYPES`; `artifact-serializer.service.ts` — `FRONTMATTER_KEY_ORDER[0]` | `frontmatter-keys.test.ts` — "artifactType key — T1 migration" suite |
| Path containment (`isPathWithin`) | `utils/path-containment.ts` — the **one** prefix-with-separator rule, previously spelled out three times | `path-containment.test.ts` — no other `src/` file may spell `endsWith(path.sep)` |
| Create-form client-JS payload shape | `artifactForm/form.clientJs.ts` — `extractModel()` | `test/form-clientjs-model-shape.test.ts` — binds the webview's posted keys to `ArtifactFormModel`; added after the webview posted `type:` while the extension read `artifactType`, which compiled clean |

**Context menus are driven by `constants.ts`, always.** An artifact's
`contexts` field is the single source for *where* its command shows (editor /
terminal / explorer / `all`). Everything runtime derives from it — command
registration, context keys, `*HasMultiple` counts. `package.json`'s
`contributes.commands` + `contributes.menus` are the one static mirror (VS Code
reads them before activation, so they cannot derive at runtime); they must
match `ARTIFACTS`, and `package-menus.test.ts` fails loudly if they drift — a
new artifact wired in constants but missing from `package.json` shows **no
menu entry, no error** without it.

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
`artifactType: Variables`, else an unfenced `vars:` section after the code), and
`blocks` — `## ` headings each followed by a fence. An empty `blocks` array
signals a single-block file. Tokens are auto-detected by `extractVars`; a
section whose **first** fence is ` ```vks ` is a pure sub-set, while a code
fence *followed by* one gets defaults merged via `mergeVarDefaults` (code order
kept, vks-only keys appended, unmatched detected vars keep `''`).

The body is read one of **two** ways, chosen in a single line of
`parseFromContent`: `readFlaggedPayload` when the file carries flags (see above),
`readFencedPayload` — the classic behaviour, unchanged — otherwise.
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
`artifactCommandId(dir)` and must match `package.json`. A type declaring
**both** `'editor'` and `'terminal'` in `contexts` (only `AIPrompt` today) also
registers `artifactTerminalCommandId(dir)` — `<base>.terminal` — a second
command the terminal menus point at; see **Insert target** below.

**Adding a new artifact type** — two source edits, both in `src/types/`:
1. Add the entry to `ARTIFACTS` in `src/types/constants.ts`.
2. Add the literal to the `ArtifactType` union in `parsed-artifact.types.ts`.
   Skipping this is a **compile error**, by design — an unrecognised type must
   never silently downgrade to `'Snippet'`.

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

**Insert target — the invocation surface, not focus.** `AIPrompt` is the first
type declaring both `'editor'` and `'terminal'` in `contexts`, so it is the
first type that has to decide, at insert time, which one to write to.
"Resolve it from whichever has focus" is not implementable: VS Code exposes no
terminal-focus predicate — `vscode.window.activeTerminal` is documented as
"has focus **or most recently had focus**" and never goes back to `undefined`
on blur, so a focus-based implementation would send every `AIPrompt` to the
terminal as soon as one had ever been opened. Instead the target is captured
**statically**, from which command fired: `registerInsertCommands`
(`insert.command.ts`) registers a base command (routed to `'editor'`) and,
only for both-context types, a second `artifactTerminalCommandId` command
(routed to `'terminal'`) that the terminal context menus point at in
`package.json` — the menu the user actually clicked *is* the answer, always
correct, no live state to read. `resolveInsertTarget(type, invocationSurface)`
(`artifactPicker/preview.helpers.ts`) applies the resulting three-row rule:
`contexts: ['terminal']` (`Command`) always resolves `'terminal'`; both
contexts declared resolves to whichever surface invoked it; anything else
(including `Variables`'s `['all']`) always resolves `'editor'`.

**🔒 Terminal send — one paste, not a line of keystrokes.**
`terminal.sendText(content, false)` suppresses only the *trailing* newline;
every embedded newline still reaches the shell as if the user pressed Enter
after that line. That is correct for `Command` — running it is the whole point
— and wrong for `AIPrompt`, whose payload is multi-line flagged markdown by
design, comes from the vault (untrusted by this codebase's standing rule), and
routinely carries a fenced ` ```bash ` block that would otherwise execute
verbatim.

`wrapForTerminal(type, content)` (`artifactPicker/preview.helpers.ts`) wraps a
multi-line payload in **bracketed-paste markers** (`ESC[200~` … `ESC[201~`) —
the same mechanism a real terminal paste uses. The receiving program treats
everything between them as literal text, so the newlines become part of the
input instead of submitting it: the prompt lands as one block, the way
Shift+Enter behaves in a CLI agent, and nothing runs until the user presses
Enter. No trailing newline is added. Wrapping is skipped for single-line
content and for any type not declaring **both** contexts, so `Command` is
byte-identical to before — pinned by a test, because "a `Command` still
executes line by line" is exactly what a well-meaning refactor would break.

Support cannot be detected from the extension host (a shell with bracketed
paste disabled would show the markers literally and still act on each line), so
the confirmation stays as the backstop: `needsTerminalConfirmation(type,
content)` is `true` only when the target is `'terminal'` **and** the content is
multi-line **and** the type declares both contexts — so `Command` never
prompts. A `true` result opens a modal with the line count and a truncated
preview; Cancel or Escape sends nothing.

### Vault directory logic (`constants.ts` + `vault.service.ts`)

Each `ARTIFACTS` entry drives directory creation/detection, context keys, and
command registration. `default: true` (`Snippets`, `AIAgentsConf`, `AIPrompts`)
are auto-created on first vault selection; `default: false` (`Commands`,
`Templates`, `Variables`) are detected but never auto-created.

### Templates and AI Agents Config — one flow, two rows in the table

`Template` and `AIAgentsConfig` are the two **whole-file** artifact types:
invoking one from the Explorer writes a new file into the workspace (primary
button reads **Create File**) instead of inserting at the cursor. Everything
except *where the filename comes from* is literally the same code — treat any
new `artifactType === 'Template'` or `artifactType === 'AIAgentsConfig'`
literal as a bug.

**How they differ** — only in three registry fields and the filename rule:

| | `Template` (`Templates/`) | `AIAgentsConfig` (`AIAgentsConf/`) |
|---|---|---|
| `ARTIFACTS` row | `writesFile: true`, `multiBlock: false`, `default: false` | `writesFile: true`, `multiBlock: true`, `default: true` |
| Type-only frontmatter | `extension:` | `provider:` / `model:` / `version:` |
| Output filename | D3 precedence: typed → `extension:` → fence language | `target:` **verbatim** (`CLAUDE.md`, `.cursorrules`) — never extension-appended |

**Shared path, file by file:**

- `types/constants.ts` — `writesFile` and `form.multiBlock` are the *only*
  declarations of this behaviour. Both flags are read through
  `artifact-type-config.service.ts` (`writesWholeFile`, `forcesSingleBlock`,
  `canMultiBlock`), never re-derived. `getEntry` stays the sole `ARTIFACTS`
  traversal — the new accessors go through it too.
- `services/template.service.ts` — owns both filename rules and the shared D1
  single-block guard. Callers use **`resolveOutputFileName(artifact)`**, which
  dispatches to `resolveAgentFileName` / `resolveTemplateFileName`; the panel
  never branches on type. `validateSingleBlock(parsed, label)` is shared, the
  human label passed in from `getTypeSingular(type)`.
- `services/template.service.helpers.ts` — the rules *both* resolvers need:
  `assertNoPathInjection` (hostile `target:`/`extension:` **throws**, never
  sanitised), `carriesExtension`, `stripTrailingDots`.
- `ui/panels/artifactPicker/preview.ts` — `handleInsert` branches once on
  `writesWholeFile(type)` into the shared `handleCreateFile`;
  `preview.render.ts` labels the button from the same call, so label and
  behaviour cannot drift. `navigator.ts` routes 2+ block files with
  `forcesSingleBlock(type)`, so a malformed multi-block template lands on the
  single preview where the D1 error surfaces.
- `parser.service.ts` / `artifact-serializer.service.ts` — the type-only keys are
  just entries in `STRING_FRONTMATTER_KEYS` + `FRONTMATTER_KEY_ORDER`, all
  emitted through `safeYamlValue` (single-line, so a newline cannot inject a
  sibling key). Details: [`ARTIFACT_FILE_FORMAT.md` §5.2](ARTIFACT_FILE_FORMAT.md).
- `ui/panels/artifactForm/form.html.ts` — `buildExtensionField` and
  `buildAgentFieldsSection` both render through **`buildOptionalTextField`**, so
  the markup and its `escHtml` seeding exist once. `form.clientJs.ts` reads all
  four keys from one `TYPE_FIELD_IDS` list (absent input → `''`).

Adding a third whole-file type is therefore a `constants.ts` row plus one branch
in `resolveOutputFileName` — nothing else.

### Template indexes — batch scaffolding (`services/multi-index.service.ts`)

A **template index** is an ordinary whole-file artifact carrying `index: true`
whose body links sibling artifacts; one run scaffolds every linked file. Format,
link syntaxes, rejection list and carry-over semantics:
[`ARTIFACT_FILE_FORMAT.md` §8](ARTIFACT_FILE_FORMAT.md) — **authoritative**.

**Additive by construction.** No new artifact type, vault directory, command or
menu entry, and the two frontmatter keys are read-side only — so
`package.json`, `types/constants.ts` and `artifact-serializer.service.ts` are
absent from the feature's diff. That absence *is* the design proof; a change
that needs to touch them is a different feature.

| File | Owns |
|---|---|
| `services/multi-index.service.ts` | **THE** link syntax + `safeRelPath`. Pure, `vscode`-free: `isIndexArtifact`, `extractIndexLinks`, `resolveLinkTarget`, `buildIndexPlan`, `buildDestCandidates`, `applyCarryOver`, `summariseRun` |
| `types/multi-index.types.ts` | `IndexStep` · `RejectedEntry` · `IndexPlan` · `DestCandidate` · `CarryOver` · `BatchOutcome` · `RunTally` — no `vscode` import (the runner's callback bag needs `Uri`, so it lives beside the runner) |
| `artifactPicker/multiIndex.ts` | `MultiIndexRunner` — the **only** file doing I/O for the feature |
| `artifactPicker/multiIndex.dest.ts` | `chooseStepDestination` — QuickPick over the candidates + a `Browse…` row deferring to `pickDestFolder` |
| `artifactPicker/preview.batch.ts` | `BatchGate` — the one-shot promise the sequencer awaits |
| `artifactPicker/preview.createFile.ts` | `runCreateFileFlow` — the Create File flow, extracted so one path serves single and batch writes |

**The runner never imports `preview.ts`.** The preview step arrives as the
`previewStep` callback in its bag, so the runner is testable without an
extension host — the same callback-bag rule the picker's controllers follow.
`navigator.ts` composes both, in **one** branch in the accept handler
(`isIndexArtifact` → `runIndex`), placed between the parse and the multi-block
check.

**Non-obvious invariants:**
- `BatchGate.settle()` nulls its resolver **before** calling it, because a
  write, a cancel and a panel disposal can all fire for one step and only the
  first may decide the outcome.
- `runIndex` guards no-workspace and a cancelled destination **before** hiding
  the QuickPick, or a cancelled palette invocation leaves the picker hidden with
  no run behind it.
- Every step runs inside its own try/catch: one bad link degrades to a skip with
  a warning. Only an explicit `aborted` (the user closed the preview panel)
  stops the run.
- An index can never be written verbatim: the picker routes it to a run, and
  `handleInsert` refuses a Create File click on a merely-hovered index.

**🔒 Security — the one thing to re-check when touching this.** This is the
extension's first recursive `createDirectory` into the user's *workspace*,
driven by *vault*-authored text. Two containment assertions guard it and both
sit immediately before the I/O they protect: the resolved link target must stay
inside the index's own vault directory (before any read), and the chosen
destination must stay inside the workspace folder (before `createDirectory`).
Both assertions route through `isPathWithin` (`utils/path-containment.ts` —
**THE** containment authority, see the single-sources-of-truth table above),
via the `isWithinRoot(rootUri, candidateUri)` adapter `multiIndex.ts` imports
from `destFolderPicker.panel.ts`; it never re-implements the
prefix-with-separator check itself, and neither do the other two former copies
of that check (`artifact-writer.service.ts`'s own local adapter, and the
frontmatter migration's symlink-aware wrapper) — one rule, three thin callers.
The workspace check also covers the mirrored candidate, which is safe by
construction and never re-validated. This is a **different, earlier** guard
than `safeRelPath` (`multi-index.service.ts`):
`safeRelPath` rejects a hostile link-target or `paths:` *string* before it is
ever turned into a filesystem path (no `..`, no absolute path, no drive
letter/URI scheme, …); `isPathWithin` then checks the *resolved* path actually
lands inside the trusted root. Both **reject and never sanitise**, and neither
decodes, so an encoded traversal stays an inert literal segment at either
layer. The IDE analyser does no taint analysis here; a manual trace is the
only check.

### Flags — plain-markdown payloads (`services/flags.service.ts`)

A vault note is already markdown, so an artifact whose payload *is* markdown —
an agent config, or an **`AIPrompt`** (`AIPrompts/`, ARTIFACT_FILE_FORMAT.md
§5.3) — has nothing to wrap it in: a fence is wrong because the payload may
contain fences. **Flags** mark where the artifact starts and ends, using
Obsidian's own comment syntax so they are invisible in reading view:

```md
notes that are not part of the artifact

%%oa:start Dev%%
Review <VK-repo>.

```bash
npm test
```
%%oa:end%%
```

- **`flags.service.ts` owns the syntax — nothing else may spell it.**
  `extractFlaggedRegions(body)` is the whole API; `flags.service.test.ts` fails
  if any other `src/` file contains the marker, doc comments included (point at
  the service by name instead).
- **Type-agnostic by design.** The parser applies it to every file, so
  `AIPrompt` landed as an `ARTIFACTS` row with **no extraction code** — it
  reuses the same `extractFlaggedRegions` an agent config already used.
- **Flags beat fences**, and are purely additive: a file with no flags parses
  exactly as before. `parser.service.ts` picks between `readFlaggedPayload` and
  `readFencedPayload` in one line.
- One region → single-block file; **named regions → `ParsedBlock`s** keyed by the
  name, reusing the multi-block picker with no new UI.
- **`***` inside a region is chrome.** Flags are invisible in Obsidian, so
  authors bracket a region with `***` to see the block — the visual job a fence
  does for a snippet. Every `***` line between Start and End is dropped;
  **outside a region, and in flag-less files, it is content**. `---` is never
  special (ambiguous with frontmatter and setext H2).
- **Flags are optional for whole-file types.** Precedence is flags → code fence
  → bare body, and the bare-body fallback fires **only** for `writesFile` types
  with nothing fenced, so `Snippet`/`Command` behaviour is untouched. `AIPrompt`
  is **not** a whole-file type, so it never gets that fallback: a prompt with
  no flags and no fence parses to an empty `code` — accepted behaviour, not a
  bug (ARTIFACT_FILE_FORMAT.md §5.3).
- Scanning **skips fenced regions** (a prompt documenting the syntax in a
  ` ```md ` sample must not terminate itself) and defaults `language` to
  `markdown`, which is what makes `extForLang` yield `.md` downstream.
- The whole-file path needed **zero changes**: region content lands in `code`, so
  `validateSingleBlock` and `resolveOutputFileName` apply unaltered.
- **Tokens in an unfenced payload need a render-safe spelling.** `<VK-repo>` is
  a legal HTML tag name, so Obsidian renders it as an unclosed custom element
  that swallows every block below it (this is what broke the ` ```vks ` fence in
  the vault examples). `<VK-repo></VK-repo>`, a lone `</VK-repo>`, or a name
  with `_` all render fine — and all mean the **same variable**
  ([`ARTIFACT_FILE_FORMAT.md` §4.1](ARTIFACT_FILE_FORMAT.md)).

Rules, edge cases, and the vars interaction: [`ARTIFACT_FILE_FORMAT.md` §7](ARTIFACT_FILE_FORMAT.md).

### One runtime dependency

`highlight.js` — imported by `render.service.ts` for code-preview highlighting,
and the only entry in `dependencies`. Everything else is the VS Code API and
Node `fs`/`path`. Keep it that way; the ladder is reuse → stdlib → native
before any new dep.

*(This section previously claimed "no third-party packages" while `highlight.js`
was already in `dependencies` — the same stale-invariant failure the Invariants
section below is about. Corrected rather than left to mislead.)*

**Packaging caveat.** `npx vsce ls` fails on this repo with `npm error
ELSPROBLEMS`: `vsce` shells out to `npm list --production`, which cannot read
pnpm's `node_modules` layout and walks `highlight.js`'s own devDependencies.
Use **`npx vsce ls --no-dependencies`** for the `.vscodeignore` check below.
A real `vsce package` will need this resolved — either an npm-compatible
install or `--no-dependencies` with the dependency bundled another way.

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

> The on-disk `.md` structure (single-block, multi-block, `artifactType: Variables`),
> the per-artifact variations table and the `<VK-xxx>` syntax live in
> [`ARTIFACT_FILE_FORMAT.md`](ARTIFACT_FILE_FORMAT.md) — **authoritative**, and
> what the parser implements and `parse(serialize(x)) ≅ x` must satisfy. If it
> and the code disagree, that is a bug to reconcile, not a judgement call — and
> the reconciliation extends the shared code to match the spec, never the
> reverse.

---

## Writing a Plan — and running one

**Two different jobs, two different files. Do not confuse them.**

> **Writing a plan → read [`CREATING_A_PLAN.md`](CREATING_A_PLAN.md) first.**
> A multi-phase feature breakdown, a multi-agent dispatch, or anything that lands
> under `docs/plans/`. It is the **authoring** authority; a plan under
> `docs/plans/<feature-slug>/` is one instance of it.
>
> It owns: where plan files live and why they never merge (`git rm -r docs` is
> the last commit before the PR), the orchestrator/reviewer/worker topology and
> their prompt templates, the dispatch mechanics (workers `sonnet`, reviewer and
> orchestrator `opus`, named on **every** spawn), the mandatory skills, the task
> spec, the gate command, the ledger format, and the plan's definition of done.

> **Running a plan → read the plan, and nothing else.**
> **Every plan in this repo is self-contained by construction**
> (`CREATING_A_PLAN.md` §5.2): it ends with an **execution appendix** carrying the
> role prompt templates verbatim, the dispatch mechanics, the gate, the review
> loop, the commit-and-push policy, the skills table and the static-analysis rule.
> An orchestrator that has never opened `CREATING_A_PLAN.md` can run it.
>
> **Do not send an executing agent to `CREATING_A_PLAN.md`.** It is ~550 lines of
> guidance about a job that is already finished, and it invites re-deriving
> decisions the plan has already made and recorded. If something needed to execute
> is missing from the plan, that is a **bug in the plan** — fix it there. The only
> agent that opens the authoring file after authoring is one whose task is to edit
> it.
>
> A plan's three files — `plan.md`, `progress.md`, `jira-tickets.md` — are one
> document in three projections (specification · ledger · external contract). All
> three are read before dispatch, and a change to one propagates to all three;
> `docs/` is gitignored, so no diff or CI will ever catch a divergence.
>
> Two standing rules from it that bind work outside a plan too:
> **static analysis runs through the *SonarQube for IDE* (SonarLint) VS Code
> extension** — its `<ide_diagnostics>` arrive on their own after every
> `Edit`/`Write` and are fixed, not filed; never invoke `sonar-analyze`, the
> `mcp__sonarqube__*` tools, or the `sonar` CLI (§3.1). And the IDE analyser
> does **no taint analysis**, so on subprocess, filesystem, and webview
> surfaces a manual security trace is the only check that exists.

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
| [`CREATING_A_PLAN.md`](CREATING_A_PLAN.md) | **Authoritative** plan-writing process — agent topology, prompt templates, task spec, gate, ledger. Read before writing any plan or dispatching agents. |

---

## VS Code Extension Notes

- `activationEvents: []` in `package.json` — the extension activates on every window open. Narrow this to specific command events once commands stabilise.
- Compiled output goes to `dist/` and is **gitignored**. Run `npm run compile` after cloning.
- `media/` ships in the packaged extension. `src/`, `test/`, and `dist/test/` are excluded via `.vscodeignore` — **except `!src/ui/*.css`**, which must stay a glob. The webviews load stylesheets from source, so a named exception silently ships a CSS-less extension when a sheet is added or renamed, and the suite stays green because tests run from source. Verify with `npx vsce ls --no-dependencies | grep css`, which must list all
seven sheets. The `--no-dependencies` flag is not optional here — see the
packaging caveat above; without it `vsce` exits non-zero and `grep` finds
nothing, which reads exactly like a missing-CSS failure.
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
