# Multi-Template / Multi-Agent-Config — Index-Driven Batch Scaffolding

**Feature branch:** `feature/multi-template` (off `develop`)
**Slug:** `multi-template`
**Revision:** 2 — destination suggestions added; review findings folded in (§12).

This file is the **single entry point and the authority** for this feature. Its
companions derive from it and never contradict it:

| File | Role |
|---|---|
| `docs/plans/multi-template/plan.md` | **This file.** Phases, waves, task specs, contracts, gates, decisions. |
| `docs/plans/multi-template/progress.md` | The ledger — one row per task, maintained **by the orchestrator only**. |
| `docs/plans/multi-template/jira-tickets.md` | Epic + story specs, ready to create. `<KEY>` placeholders until the connector is authorized. |

**Process authority:** [`CREATING_A_PLAN.md`](../../../CREATING_A_PLAN.md). The
orchestrator reads it **once, first**, before anything else. The §2 role prompt
templates (orchestrator · reviewer · worker) live **only** there — this plan
supplies the instance parameters that get appended to them (§9) and never
re-copies a template.

> **This plan is not executed on creation.** Authoring stopped here. No Wave 0
> dispatch, no code, no gate run until the user says "run it" / "go" / "execute
> the plan".

---

## 1. What is being built

A **template index** is an ordinary vault artifact — a `type: template` or
`type: agent` `.md` file — carrying a new frontmatter key `index: true`, whose
body is a **list of links to sibling artifacts in the same vault folder tree**.
Invoking it from the Explorer scaffolds **every linked file in one run**.

### The vault side

```
Templates/
└── react-feature/
    ├── index.md                        type: template, index: true
    ├── dir_1/
    │   └── barrel.md
    └── dir_2/
        └── subdir1/
            ├── Button.md               extension: tsx
            └── Button.test.md          extension: test.tsx
```

`Templates/react-feature/index.md`:

```md
---
type: template
title: React feature scaffold
index: true
paths: [src/components, packages/ui/src]
tags: [react, scaffold]
---

Scaffolds a component, its test, and the barrel export.

1. [[dir_2/subdir1/Button]]
2. [Button test](dir_2/subdir1/Button.test.md)
3. [[dir_1/barrel]]
```

### The workspace side

Right-click `src/app` in the Explorer → **Insert Template** → navigate to
`react-feature/index.md` → Enter. Then, **per link, in document order**:

1. **Suggest a destination.** A QuickPick opens with the mirrored folder
   pre-selected — the link's directory relative to the index file
   (`src/app/dir_2/subdir1`) — followed by every path the index declared in
   `paths:`, then **Browse…**. Enter accepts the suggestion; the user is never
   forced into it.
2. **Create the folder chain** for whatever was chosen, if it does not exist.
3. **Run the existing, unmodified Create File flow** for that one artifact — the
   same preview popup, the same variable inputs, the same **Create File** button,
   the same filename prompt — with the destination pinned to the chosen folder.
4. **Record the submitted variable values** into an in-memory carry-over map.
5. **Advance.** The next file's variable inputs are pre-filled from the
   carry-over map: a `VK-language` the user set to `java` on file 1 shows `java`
   on file 2 **even though file 2's own `vks` default says `javascript`**. The
   carry-over changes only the *default shown* — the user still decides.

```
per file:  [dest QuickPick] Enter  →  [preview] fill vars, Create File  →  [filename] Enter
```

Result, accepting every suggestion:

```
src/app/
├── dir_1/barrel.ts
└── dir_2/subdir1/
    ├── Button.tsx
    └── Button.test.tsx
```

The run closes with one notification: `Multi-Template: 3 files written, 0 skipped.`

---

## 2. Decisions

Confirmed with the user before authoring. Each is binding; a worker that
disagrees files a one-line note for the orchestrator, it does not re-decide.

| # | Decision | Rationale |
|---|---|---|
| **D1** | An index is marked by a new frontmatter key **`index: true`** on an otherwise ordinary `template` / `agent` file. **No new `ArtifactType`, no new `ARTIFACTS` row, no new command, no `package.json` change.** | The index must live in the *same* folder tree as the files it links — that is what makes "relative to the index" meaningful. A separate vault dir would force `../` links and a second base-path rule. Filename-only detection (`index.md`) was rejected: a template that legitimately *emits* `index.ts` is naturally named `index.md`. |
| **D2** | `index` is a **real boolean** (`index?: boolean`), read via a new `BOOLEAN_FRONTMATTER_KEYS` set in `parser.service.ts`. | A stringly-typed `'true'` leaks into every downstream check. The boolean path is ~3 lines. |
| **D3** | Both link syntaxes are accepted: `[[wiki/link]]` and `[text](md/link.md)`. Order is **document order**. Non-link lines are ignored, so the index stays a readable Obsidian note. | Obsidian's autocomplete writes wikilinks; VS Code's `Ctrl+K` writes markdown links. Supporting one silently drops entries authored with the other tool. |
| **D4** | Links resolve **relative to the index file's own directory only** — not Obsidian's vault-wide shortest-path resolution. A link leaving that subtree is **rejected and skipped**, never sanitised. | Vault-wide resolution needs a full note index and has no unambiguous answer for duplicate basenames. The subtree restriction is required by the feature spec anyway and is therefore *also* the traversal guard — one rule, two jobs. Carries a `ponytail:` comment naming vault-wide resolution as the upgrade path. |
| **D5** | **Cancel skips that one file and the run continues.** Closing the preview panel aborts the run. A summary notification reports written / skipped. | Matches the common case with no extra modal; the panel-close abort is the escape hatch for a long index, obtained free from a lifecycle event that must be handled anyway (an unhandled dispose would hang the run's pending promise forever). |
| **D6** | A linked file that is **not** a `writesFile` type, or that fails `validateSingleBlock`, is **skipped with a warning**; the run continues. | An index of templates that accidentally links a snippet must not abort a 12-file scaffold. |
| **D7** | The per-file **filename prompt is kept**, exactly as in the single-file flow. In batch mode the written file is **not** opened in an editor tab. | The user asked for "all as always". Opening N tabs is the one part that does not scale; suppressing it is a single `if`. |
| **D8** | The run **reuses `writeTemplateFile` unmodified**. Directory creation happens in the runner, before delegating, after its own containment assertion. | `template-writer.service.ts` documents "creates no directory" as a deliberate contract for the single-file flow. One `createDirectory` call in the runner does not change it. |
| **D9** | **The destination is a suggestion, never a decree.** Every step opens a destination QuickPick: the mirrored folder first (pre-selected, marked *Suggested*), then each `paths:` entry, then **Browse…** which reuses the existing `pickDestFolder` rooted at the **workspace folder**. Escape skips that file. | The user's requirement verbatim. Always showing it costs exactly one Enter for the default case and needs no webview change. Browse is rooted at the workspace folder rather than the clicked folder so the user really can put a file anywhere in the project — still containment-guarded. |
| **D10** | `paths:` is an **inline array frontmatter key** (`paths: [src/components, packages/ui/src]`), **workspace-folder-relative**, **file-level** — it offers the same candidate list to every link in the index. | Reuses the exact `tags` parsing shape, so it costs one shared helper and no new syntax. Per-link path hints are an explicit non-goal (§2 non-goals) — file-level covers "a list of possible paths" as asked, and the user picks per file anyway. |
| **D11** | `index:` and `paths:` are **read-side only**: the parser reads them, the **serializer never emits them**. | Exactly the precedent `ARTIFACT_FILE_FORMAT.md` §7.4 sets for flags. The create form does not author indexes, so emission would mean plumbing two keys through `ArtifactFormModel` that nothing sets. Guarded by a test that fails if either key is added to `FRONTMATTER_KEY_ORDER` without the form-model plumbing (§6 O2). |
| **D12** | `preview.ts` (427 lines, already over `CLAUDE.md`'s ~400 soft limit) gets its **Create File flow extracted** to `preview.createFile.ts` before this feature adds to it. | `CLAUDE.md`: "Notice a file crossed 400 lines while finishing a feature → propose the split in that PR, not later." The feature touches exactly that flow, the seam is the one the folder already uses, and the golden net for a behaviour-preserving refactor exists (`preview-render-golden` + `template-writer.test.ts` + F5). Result: ~300 lines before the feature adds ~15. |

### Explicit non-goals

- No new context-menu entry, no new vault directory, no `ARTIFACTS` row (D1).
  **`package.json` and `src/types/constants.ts` are forbidden files** — a diff
  touching them means the design drifted.
- No **per-link** path hints (D10). File-level `paths:` only.
- No **nested indexes**. A linked index is written verbatim as an ordinary artifact.
- No carry-over persistence beyond the run. In-memory, per-run, dies with the
  runner. Variable Sets already cover durable bundles.
- No "**use this folder for all remaining files**" option on the destination
  QuickPick. Named upgrade path, not built (YAGNI until a 12-file index exists).
- No serializer emission of the two new keys (D11).
- No new webview HTML. The batch flow renders the *existing* `renderPreviewHtml`.

---

## 3. Threat model

Artifact `.md` content is **untrusted input** (`CLAUDE.md`). This feature adds a
new class of it: **strings from a vault note that become filesystem paths on both
sides** — a vault read path and a workspace write path — and the extension's
**first recursive `createDirectory` into the user's workspace**.

The IDE analyser performs **no taint analysis** (`CREATING_A_PLAN.md` §3.1), so on
these surfaces the reviewer's manual §5 trace is not a second opinion; it is the
only check that exists.

Non-negotiable construction rules:

1. **One rejection rule, two callers.** `safeRelPath()` in
   `multi-index.service.ts` is the *single* authority for what a vault-authored
   path may contain. Both link targets (D4) and `paths:` entries (D10) go through
   it. Rejected, never sanitised: any `..` segment, a leading `/` or `\`, a
   Windows drive prefix, a NUL or other control character, a URI scheme.
   **Percent-decoding is deliberately not performed**, so an encoded traversal
   sequence stays a literal filename and cannot be decoded back into a traversal.
2. **Vault containment.** The resolved target URI is asserted inside the index
   file's own directory with `isWithinRoot` **before any read**.
3. **Workspace containment.** The chosen destination directory — whether a
   suggestion, a `paths:` entry, or a Browse result — is asserted inside the
   workspace folder with `isWithinRoot` **before `createDirectory`**.
   `writeTemplateFile` then re-asserts both the directory and the final file path
   before the write. The second check is **not redundant**: it is the backstop
   for the name the user types at the filename prompt.
4. **Filename.** Unchanged: `resolveOutputFileName` throws on a hostile
   `target:` / `extension:`, `validateTargetFileName` guards the typed name, and
   the throw is caught **per step** → that file is skipped, the run continues (D6).
5. **No new webview HTML.** Every interpolated value already goes through
   `escHtml`. A task adding webview markup has left this plan's scope.

Tasks **T1** and **T6** are marked **security-critical**. Their `Test first`
fields name hostile inputs; their `Gate` names the reviewer's manual security
trace. A `SEC:` finding is fixed before every other finding and never expires on
a round cap.

---

## 4. Architecture

### Existing authorities — extended, never paralleled

| Fact | Existing owner |
|---|---|
| Frontmatter key sets | `parser.service.ts` `STRING_FRONTMATTER_KEYS` (+ new `BOOLEAN_FRONTMATTER_KEYS`, `ARRAY_FRONTMATTER_KEYS`) |
| Inline-array frontmatter parsing | `parser.service.ts` — new shared `parseInlineArray`, used by **both** `tags` and `paths` |
| Write-a-file vs insert | `artifact-type-config.service.ts` `writesWholeFile` |
| Single-block restriction | `template.service.ts` `validateSingleBlock` |
| Output filename | `template.service.ts` `resolveOutputFileName` |
| Path containment | `destFolderPicker.panel.ts` `isWithinRoot` |
| Folder browsing + inline folder creation | `destFolderPicker.panel.ts` `pickDestFolder` |
| Workspace write | `template-writer.service.ts` `writeTemplateFile` (**unmodified** — D8) |
| Filename validation | `filename.service.ts` `validateTargetFileName` |
| Preview HTML | `preview.render.ts` `renderPreviewHtml` (**unmodified**) |
| Vault `.md` parsing | `parser.service.ts` `parseFromContent` |

### New files

```
src/types/multi-index.types.ts                     # NEW  the vscode-free contract        (Wave 0)
src/services/multi-index.service.ts                # NEW  pure domain: links, paths, candidates, carry-over
src/ui/panels/artifactPicker/preview.batch.ts      # NEW  BatchGate — one-shot promise gate
src/ui/panels/artifactPicker/preview.createFile.ts # NEW  the Create File flow, extracted (D12)
src/ui/panels/artifactPicker/multiIndex.dest.ts    # NEW  destination QuickPick (D9)
src/ui/panels/artifactPicker/multiIndex.ts         # NEW  MultiIndexRunner — the I/O sequencer
```

Line budget after the D12 extraction: `preview.ts` ≈ 300 + ~15 = **~315**
(currently 427). Every new file is well under 400.

### `src/types/multi-index.types.ts` — the contract

`vscode`-free (`CLAUDE.md`: no `vscode` imports in `src/types/`). This is why the
runner's callback-bag interface lives in `multiIndex.ts` and **not** here — it
needs `Uri`, exactly as `PreviewCallbacks` lives in `preview.ts` today.

```ts
/** One resolved entry of a template index, in document order. */
export interface IndexStep {
    /** Raw link text as written in the index body — used in messages. */
    readonly raw: string;
    /** Vault path of the target, relative to the index file's own directory. POSIX. */
    readonly relPath: string;
    /** Directory part of `relPath`; '' when the target sits beside the index. POSIX. */
    readonly relDir: string;
}

/** A link or declared path that will not be used, and why. */
export interface RejectedEntry {
    readonly raw: string;
    readonly reason: string;
}

/** Result of scanning an index: the steps to run and everything refused. */
export interface IndexPlan {
    readonly steps: readonly IndexStep[];
    readonly rejected: readonly RejectedEntry[];
}

/** One offered destination folder, workspace-folder-relative (POSIX, '' = workspace root). */
export interface DestCandidate {
    readonly relPath: string;
    /** QuickPick label — the path as shown, or '/' for the workspace root. */
    readonly label: string;
    /** QuickPick detail — 'Suggested — mirrors the index' or 'From the index'. */
    readonly detail: string;
}

/** Variable values carried between steps. Keys are full `VK-xxx` names. */
export type CarryOver = Readonly<Record<string, string>>;

/** How one step finished. */
export type BatchOutcome =
    | { readonly kind: 'written'; readonly vars: Record<string, string>; readonly filePath: string }
    | { readonly kind: 'skipped' }
    | { readonly kind: 'aborted' };

/** Tally for the closing notification. */
export interface RunTally {
    readonly written: number;
    readonly skipped: number;
    readonly aborted: boolean;
}
```

### `src/services/multi-index.service.ts` — pure domain

`vscode`-free, fully unit-testable. **The single owner of the index link syntax**,
in the same spirit as `flags.service.ts` owning the flag syntax.

| Export | Contract |
|---|---|
| `safeRelPath(raw)` | `{ ok: true; relPath } \| { ok: false; reason }`. **The one rejection authority** (§3.1). Normalises to POSIX. Never throws, never sanitises. |
| `isIndexArtifact(fm)` | `fm.index === true` **and** `writesWholeFile(fm.type)`. A `snippet` carrying `index: true` is not an index — a run can only write files. |
| `extractIndexLinks(body)` | Both syntaxes (D3), document order, duplicates preserved. Alias (`[[a\|b]]`) and anchor (`[[a#h]]`) suffixes stripped. |
| `resolveLinkTarget(link)` | `safeRelPath` + `.md` appended when absent. |
| `buildIndexPlan(body)` | `extractIndexLinks` → `resolveLinkTarget` per link → steps + rejected, order preserved. The single call the runner makes. |
| `buildDestCandidates({ mirroredRelDir, clickedRelPath, indexPaths })` | The D9 list, **workspace-folder-relative**: mirrored folder first (`clickedRelPath` + `mirroredRelDir`), then each `safeRelPath`-accepted `indexPaths` entry in declaration order. Deduped by `relPath`, first occurrence wins. Rejected entries are dropped (the runner reports them once from `buildIndexPlan`). |
| `applyCarryOver(vars, carry)` | New array; a var whose `name` is a key of `carry` gets that value as its `defaultValue`. Exact, case-sensitive match on the full `VK-xxx` token — the same rule Variable Sets use. |
| `summariseRun(tally)` | The closing notification text. Pure, so it is asserted rather than eyeballed. |

> **Why not reuse `mergeVarDefaults`?** It is private to `parser.service.ts` and
> takes `ParsedVar[]` on both sides. `applyCarryOver` is two lines against a
> `Record<string,string>`; exporting a parser internal to reach it costs more than
> it saves. Recorded so the reviewer does not re-litigate it.

### `src/ui/panels/artifactPicker/preview.batch.ts` — `BatchGate`

The reason the runner can `await` a webview. One armed slot, one resolution,
`vscode` imported **type-only** so its tests need no extension host.

```ts
class BatchGate {
    arm(destDir: Uri): Promise<BatchOutcome>;  // rejects if already armed
    settle(outcome: BatchOutcome): void;       // resolves + disarms; second call is a no-op
    get isArmed(): boolean;
    get destDir(): Uri | undefined;
}
```

`settle` being idempotent is **load-bearing**: a successful write, a cancel, and
panel disposal can all fire for one step, and only the first may decide.

### `src/ui/panels/artifactPicker/preview.createFile.ts` — the extracted flow (D12)

Moved verbatim out of `preview.ts` (`handleCreateFile`, `askFileName`,
`writeWithCollisionHandling`), behaviour unchanged, re-expressed as one entry
point taking explicit arguments instead of reaching into the controller:

```ts
export async function runCreateFileFlow(args: {
    artifact: ParsedArtifactFile;
    code: string;
    vars: Record<string, string>;
    /** Pinned destination (batch mode); when undefined the interactive resolver runs. */
    destDir: Uri | undefined;
    /** Explorer URI for the interactive resolver. */
    destUri: Uri | undefined;
    /** false in batch mode — N tabs do not scale (D7). */
    openAfterWrite: boolean;
}): Promise<{ kind: 'written'; filePath: string } | { kind: 'cancelled' } | { kind: 'error' }>;
```

`preview.ts`'s `handleCreateFile` becomes ~10 lines of routing.

### `src/ui/panels/artifactPicker/preview.ts` — the hook points

1. `previewOnce(artifact, destDir): Promise<BatchOutcome>` — arms the gate, shows
   the preview, reveals the panel, returns the gate's promise.
2. `handleInsert` — **index guard**: when the artifact is an index and the gate is
   not armed, show `This is a template index — press Enter in the picker to run
   it.` and return. Without this, a user can mouse-click **Create File** on the
   hover preview and write `index.md` verbatim.
3. `handleCreateFile` — delegates to `runCreateFileFlow` with
   `destDir: this.batch.destDir`, `openAfterWrite: !this.batch.isArmed`; on
   success while armed, `settle({ kind: 'written', … })` and **return** — no
   `dispose`, no `closePicker`.
4. `cancel` → `settle({ kind: 'skipped' })` when armed, else the existing
   `dispose()`. `onDidDispose` → `settle({ kind: 'aborted' })` (D5).

The single-file flow takes the unarmed branch everywhere and behaves
byte-identically. `test/fixtures/preview-render-golden/` is the tripwire.

### `src/ui/panels/artifactPicker/multiIndex.dest.ts` — the chooser (D9)

```ts
export async function chooseStepDestination(args: {
    workspaceRoot: Uri;
    candidates: readonly DestCandidate[];
    /** Target file name, shown in the QuickPick title so the user knows what they are placing. */
    targetName: string;
}): Promise<Uri | undefined>;
```

QuickPick over `candidates` (first item active, so Enter accepts the suggestion)
plus a trailing `$(folder-opened) Browse…` that defers to the existing
`pickDestFolder(workspaceRoot)`. Escape → `undefined` → the runner skips that
file, consistent with D5.

### `src/ui/panels/artifactPicker/multiIndex.ts` — `MultiIndexRunner`

The only file doing I/O for this feature. Composed by the navigator through a
callback bag, matching the `PreviewPanelController` / `FullEditController` idiom
(`CLAUDE.md`: "callback bags, never reaching inward"). **It does not import
`preview.ts`** — the preview step arrives as a callback, so the two are
independently buildable and independently testable.

```ts
export interface MultiIndexCallbacks {
    indexDirUri: Uri;      // vault dir the index sits in — vault containment root
    workspaceRoot: Uri;    // workspace folder — workspace containment root
    clickedRelPath: string;// clicked folder, workspace-relative POSIX ('' = root)
    vaultRootFs: string;   // artifact root, for parseFromContent's relativePath
    chooseDestination: (step: IndexStep, candidates: readonly DestCandidate[]) => Promise<Uri | undefined>;
    previewStep:       (artifact: ParsedArtifactFile, destDir: Uri) => Promise<BatchOutcome>;
    closePicker:  () => void;
    disposePreview: () => void;
}
```

`run(indexArtifact)`, in order:

1. `buildIndexPlan(indexArtifact.code)` — `parseFromContent` already normalised
   the body, however it was delimited (bare markdown, a fence, or flags).
2. Warn **once** for `plan.rejected`, naming each refused entry and its reason.
3. Per step, each inside its own `try` so one bad link cannot kill the run:
   a. `targetUri = Uri.joinPath(indexDirUri, step.relPath)`; assert
      `isWithinRoot(indexDirUri, targetUri)` → else skip.
   b. read + `parseFromContent`; `writesWholeFile(type)` → else skip (D6).
   c. `candidates = buildDestCandidates({ mirroredRelDir: step.relDir, clickedRelPath, indexPaths })`.
   d. `destDir = await chooseDestination(step, candidates)` → `undefined` → skip.
   e. assert `isWithinRoot(workspaceRoot, destDir)` → else skip.
   f. `await vscode.workspace.fs.createDirectory(destDir)` — recursive, idempotent.
      *(`ponytail:` a folder created for a step the user then cancels is left
      behind; `pickDestFolder`'s "New folder here" already behaves this way.
      Upgrade path: create lazily inside the writer.)*
   g. `artifact.vars = applyCarryOver(artifact.vars, carry)`.
   h. `const outcome = await previewStep(artifact, destDir)`.
   i. `written` → `Object.assign(carry, outcome.vars)`; `skipped` → next;
      `aborted` → break.
4. `showInformationMessage(summariseRun(tally))`, `disposePreview()`, `closePicker()`.

### `src/ui/panels/artifactPicker/navigator.ts` — the wiring

In `handleAccept`, after `getOrParse` and **before** `isMultiBlockNav`:

```ts
if (isIndexArtifact(artifact.frontmatter)) { await this.runIndex(artifact); return; }
```

`runIndex` must **hide the QuickPick first** — `keepPopupOnHide = true; this.qp.hide();`
— exactly as `handoffToPreview` does. Without it the picker keeps focus while the
preview panel needs interaction and the run is unusable. It then resolves the
destination root via the existing `resolveDestination(this.destUri)`, derives
`workspaceRoot` with `vscode.workspace.getWorkspaceFolder`, computes
`clickedRelPath`, and constructs `MultiIndexRunner` with
`previewStep: (a, d) => this.preview.previewOnce(a, d)` and
`chooseDestination: (step, c) => chooseStepDestination({ … })`.

---

## 5. Waves

Every wave ends with the gate (§7). Wave `n+1` is never dispatched while wave `n`
is running or red.

| Wave | Tasks | Owner | Notes |
|---|---|---|---|
| **0** | O1 · O2 | **Orchestrator only** | Shared registries + the frozen contract. No worker dispatch. |
| **1** | T1 · T2 · T3 | 3 workers, parallel | Pure domain, the gate, and the D12 extraction. Disjoint files and test files. |
| **2** | T4 · T5 · T6 | 3 workers, parallel | `vscode` edges. Parallel because the runner takes its preview step as a **callback**, not an import (§12 F4). |
| **3** | T7 | 1 worker | Navigator wiring. **Human gate** after the wave: all F5 passes. |
| **4** | T8 | 1 worker | Docs only — no Jira ticket, plain `docs(...)` commit subject (`CREATING_A_PLAN.md` §8). |

**Orchestrator integration hunks:** none beyond Wave 0. The new files are
self-contained and T7 *is* the wiring task, owning `navigator.ts` alone in its wave.

---

## 6. Tasks

### Wave 0 — orchestrator only

#### O1 — Freeze the contract types

- **Owns:** `src/types/multi-index.types.ts` (new) · `src/types/parsed-artifact.types.ts`
- **Reads:** `ARTIFACT_FILE_FORMAT.md`, this plan §4
- **Depends on:** none
- **Test first:** none (type-only; `npx tsc --noEmit` is the check).
- **Done when:** `multi-index.types.ts` exports `IndexStep`, `RejectedEntry`, `IndexPlan`, `DestCandidate`, `CarryOver`, `BatchOutcome`, `RunTally` exactly as §4 spells them and imports **no** `vscode`. `ParsedFrontmatter` gains `index?: boolean` and `paths?: string[]`, each JSDoc'd as valid only on the whole-file types and as **read-side only** (D11). `npx tsc --noEmit` clean.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

#### O2 — Read `index:` and `paths:` in the parser (registry edit)

- **Owns:** `src/services/parser.service.ts` · `test/frontmatter-keys.test.ts`
- **Reads:** `src/services/artifact-serializer.service.ts` (read only — **not** edited, D11), `ARTIFACT_FILE_FORMAT.md` §1.1
- **Depends on:** O1
- **Test first:** `test/frontmatter-keys.test.ts` — two new assertions, both failing before the change:
  1. `parseFromContent('---\ntype: template\nindex: true\npaths: [a/b, c]\n---\n…').frontmatter` has `index === true` and `paths` deep-equal `['a/b','c']` *(currently both keys are dropped)*.
  2. **The D11 guard:** `assert.ok(!FRONTMATTER_KEY_ORDER.includes('index') && !FRONTMATTER_KEY_ORDER.includes('paths'))` with the message *"read-side only (plan D11) — emitting these needs ArtifactFormModel plumbing first"*. Prove it fails by temporarily adding `index` to the order array.
- **Done when:** `parser.service.ts` exports `BOOLEAN_FRONTMATTER_KEYS` (`{'index'}`) and `ARRAY_FRONTMATTER_KEYS` (`{'tags','paths'}`); `applyFrontmatterField` routes through them; **`tags` and `paths` share one extracted `parseInlineArray(raw)` helper** — the inline-array split exists exactly once (§12 F2). `index: false` and any non-`true` value yield `false`. The serializer is **untouched** and every byte golden stays green.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit` — `test/snapshots/varset/tags.md` green is the proof `tags` parsing was refactored without changing emission.

### Wave 1 — parallel workers

#### T1 — Index domain service 🔒 **SECURITY-CRITICAL**

- **Owns:** `src/services/multi-index.service.ts` · `test/multi-index.service.test.ts`
- **Reads:** `src/types/multi-index.types.ts`, `src/services/flags.service.ts` (the "one owner of a syntax" shape), `src/services/artifact-type-config.service.ts`
- **Depends on:** O1
- **Test first:** `test/multi-index.service.test.ts` — first failing assertion:
  ```ts
  assert.deepStrictEqual(
      extractIndexLinks('1. [[dir_2/subdir1/Button]]\n2. [T](dir_2/subdir1/Button.test.md)'),
      ['dir_2/subdir1/Button', 'dir_2/subdir1/Button.test.md'],
  );
  ```
  **Hostile inputs required in the same file**, each asserted as `{ ok: false }` with a reason and never a rewritten path — and asserted **through both callers** (`resolveLinkTarget` *and* `buildDestCandidates`), which is what proves `safeRelPath` is the single authority: a parent-directory traversal sequence, an absolute POSIX path, a Windows drive-letter path, a backslash-separated path, a NUL/control character, a `file:` URI, and a percent-encoded traversal sequence (asserted to remain a **literal filename**, proving no decode step exists).
- **Done when:** every §4 export exists with its stated contract, **including `summariseRun` and `buildDestCandidates`**; `buildIndexPlan` preserves document order and returns each refused entry with a reason; `buildDestCandidates` puts the mirrored folder first, dedupes by `relPath` keeping first occurrence, and drops rejected `paths:` entries; `applyCarryOver` overrides only exact `VK-xxx` matches and mutates neither input; `isIndexArtifact` is `false` for a `snippet` carrying `index: true`.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit` **plus the reviewer's manual security trace** of every vault-authored string from `body` / `paths:` to a resolved path. Not `sonar-analyze` — this repo cannot run it (`CREATING_A_PLAN.md` §3.1), and it performs no taint analysis regardless.
- **Note:** carry a `ponytail:` comment on the resolver naming the ceiling (subtree-relative resolution only) and the upgrade path (vault-wide shortest-path resolution behind a note index) — D4.

#### T2 — `BatchGate` one-shot promise gate

- **Owns:** `src/ui/panels/artifactPicker/preview.batch.ts` · `test/preview-batch.test.ts`
- **Reads:** `src/types/multi-index.types.ts`
- **Depends on:** O1
- **Test first:** `test/preview-batch.test.ts` — first failing assertion:
  ```ts
  const gate = new BatchGate();
  assert.strictEqual(gate.isArmed, false);
  const p = gate.arm(destUri);
  gate.settle({ kind: 'skipped' });
  assert.deepStrictEqual(await p, { kind: 'skipped' });
  ```
  Plus: settling twice with different outcomes resolves to the **first**; `arm` while armed rejects; `destDir` is `undefined` once settled.
- **Done when:** all four assertions pass and the module imports `vscode` **type-only** (`import type { Uri } from 'vscode'`), so the suite runs without an extension host.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

#### T3 — Extract the Create File flow out of `preview.ts` (D12)

- **Owns:** `src/ui/panels/artifactPicker/preview.createFile.ts` (new) · `src/ui/panels/artifactPicker/preview.ts`
- **Reads:** `template-writer.service.ts`, `template-destination.service.ts`, `template.service.ts`, `filename.service.ts`
- **Depends on:** none
- **Test first:** **behaviour-preserving refactor — the golden net comes first** (`CREATING_A_PLAN.md` §4). Before editing: confirm `test/fixtures/preview-render-golden/` and `test/template-writer.test.ts` are green and record the count. No new unit test; the F5 pass is the behavioural check:
  1. F5 → right-click a workspace folder → **Insert Template** → pick an ordinary single template → **Create File** → file written, tab **opens**, panel closes, picker closes.
  2. Repeat, choosing **Overwrite** on a colliding name, then **Rename**, then **Cancel** — all three branches behave exactly as before.
- **Done when:** `handleCreateFile` / `askFileName` / `writeWithCollisionHandling` live in `preview.createFile.ts` behind the single `runCreateFileFlow` entry point of §4; `preview.ts` is **≤ 320 lines**; **zero behaviour change** — the `preview-render-golden` fixture is byte-identical and the test count is unchanged.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`
- **Note:** this task adds **no feature code**. A diff here that references `index`, `batch`, or `carry` is scope creep and an instant `CHANGES`.

### Wave 2 — parallel workers

#### T4 — Batch hooks in the preview controller

- **Owns:** `src/ui/panels/artifactPicker/preview.ts` · `src/ui/panels/artifactPicker/preview.createFile.ts`
- **Reads:** `preview.batch.ts`, `preview.render.ts`, `multi-index.service.ts`, `multi-index.types.ts`
- **Depends on:** T2, T3
- **Test first:** `vscode`-coupled — **F5 click path** (the existing `preview-render-golden` fixture is the regression net for the unarmed flow and is a forbidden file for this task):
  1. Ordinary single template → **Create File** → written, tab opens, panel + picker close. *(Unarmed path unchanged.)*
  2. Ordinary single template → **Cancel** → panel disposes as before.
  3. Hover an index file in the picker (do **not** press Enter) and mouse-click **Create File** in the preview panel → expect the message *"This is a template index — press Enter in the picker to run it."* and **no file written** (§12 F7).
- **Done when:** `previewOnce` arms the gate, shows the preview, reveals the panel and returns the gate's promise; `handleInsert` carries the index guard; `handleCreateFile` passes `destDir: this.batch.destDir` and `openAfterWrite: !this.batch.isArmed` into `runCreateFileFlow`; on success while armed it settles `written` and returns **without** `dispose` / `closePicker`; `cancel` settles `skipped` while armed; `onDidDispose` settles `aborted`. `preview.ts` **≤ 340 lines**.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`. The reviewer additionally confirms the armed path still routes its write through `writeTemplateFile` — containment intact (§3.3).

#### T5 — Destination chooser (D9)

- **Owns:** `src/ui/panels/artifactPicker/multiIndex.dest.ts`
- **Reads:** `destFolderPicker.panel.ts` (`pickDestFolder`, `isWithinRoot`), `multi-index.types.ts`
- **Depends on:** O1, T1
- **Test first:** `vscode`-coupled — the pure list-building it renders is T1's `buildDestCandidates`, already unit-tested. **F5 click path:**
  1. Run an index whose frontmatter declares `paths: [src/components, packages/ui/src]` → the QuickPick shows the mirrored folder **first and pre-selected**, then both declared paths, then **Browse…**; Enter accepts the suggestion.
  2. Choose a declared path → the file lands there, not in the mirrored folder.
  3. Choose **Browse…** → the existing folder picker opens **rooted at the workspace folder**, "New folder here" works, and the chosen folder is used.
  4. Press Escape on the QuickPick → that file is skipped, the run continues.
- **Done when:** `chooseStepDestination` matches §4's signature; the QuickPick title names the target file; the first candidate is the active item; **`pickDestFolder` is reused, not reimplemented** — no second folder navigator exists in `src/`.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

#### T6 — `MultiIndexRunner` 🔒 **SECURITY-CRITICAL**

- **Owns:** `src/ui/panels/artifactPicker/multiIndex.ts` · `test/multi-index-runner.test.ts` · `test/fixtures/multi-index/**` (new)
- **Reads:** `multi-index.service.ts`, `multi-index.types.ts`, `destFolderPicker.panel.ts` (`isWithinRoot`), `parser.service.ts`, `artifact-type-config.service.ts`, `template.service.ts`, `shared.ts`
- **Depends on:** O1, T1
- **Test first:** `test/multi-index-runner.test.ts`, driving the runner **through its callback bag** — stubbed `chooseDestination` (returns the first candidate) and stubbed `previewStep` (returns `written` with fixed vars) — against a temp workspace directory. This is exactly why the bag exists: **no extension-host UI interaction is required** (§12 F3). First failing assertion:
  ```ts
  const plan = buildIndexPlan(indexArtifact.code);
  assert.deepStrictEqual(plan.steps.map(s => s.relDir),
      ['dir_2/subdir1', 'dir_2/subdir1', 'dir_1']);
  ```
  Then, over a full `run()`: the three files exist at their nested paths; the folder chain was created; **the carry-over reached step 2** (step 2's var default equals step 1's submitted value); a `skipped` outcome on step 2 leaves step 3 running; an `aborted` outcome on step 2 means step 3 never runs; and — the **hostile fixture** — an index whose list mixes a parent-directory traversal link and an absolute path yields both in `plan.rejected` and writes **nothing outside the temp workspace dir**.
- **Done when:** `run()` follows §4's ordered steps exactly; **both containment assertions precede their respective I/O**; every per-step failure is caught per step; `aborted` breaks the loop; the closing notification comes from `summariseRun`. The runner **does not import `preview.ts`**.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit` **plus the reviewer's manual security trace**: link string → `targetUri` (vault containment, before read) → chosen `destDir` (workspace containment, before `createDirectory`) → `writeTemplateFile` (both checks again, before write). The reviewer names the new attack surface — the extension's first recursive workspace `createDirectory` — in its verdict **even on APPROVE**.

### Wave 3 — worker

#### T7 — Navigator routing

- **Owns:** `src/ui/panels/artifactPicker/navigator.ts`
- **Reads:** `multiIndex.ts`, `multiIndex.dest.ts`, `multi-index.service.ts`, `template-destination.service.ts`
- **Depends on:** T4, T5, T6
- **Test first:** `vscode`-coupled — **F5 click path**:
  1. Right-click `src/app` → **Insert Template** → hover `index.md` → the ordinary single-artifact preview renders (its link list as the body).
  2. Enter → **the QuickPick closes** and the batch run starts; the preview panel has focus and is usable. *(This is the §12 F6 regression — without the hide, the picker keeps focus and the run is unusable.)*
  3. Command palette → **Insert Template** with no clicked folder → the destination folder picker opens first, then the run proceeds relative to the chosen folder.
  4. An ordinary (non-index) template is unaffected in all three entry paths.
  5. No workspace open → a clean error message, no run, no exception in the output channel.
- **Done when:** the single `isIndexArtifact` branch sits between `getOrParse` and `isMultiBlockNav`; `runIndex` sets `keepPopupOnHide = true` and hides the QuickPick **before** starting the run; it derives `workspaceRoot` via `vscode.workspace.getWorkspaceFolder` and `clickedRelPath` from it; `previewStep` and `chooseDestination` are supplied as callbacks; `navigator.ts` stays **under 400 lines**.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

> **Human gate — stop and ask after Wave 3.** The orchestrator runs the F5 passes
> from T3, T4, T5, T6 and T7, reports the results verbatim, and **waits** for the
> user before dispatching Wave 4.

### Wave 4 — docs

#### T8 — Document the format and the flow

- **Owns:** `ARTIFACT_FILE_FORMAT.md` · `CLAUDE.md`
- **Reads:** the whole shipped diff
- **Depends on:** T7
- **Test first:** none (docs). `CREATING_A_PLAN.md` §8 exempts docs-only changes from a ticket **and** from the ticket-id commit prefix — commit as `docs(multi-index): …`.
- **Done when:**
  - `ARTIFACT_FILE_FORMAT.md` gains **§8 Template indexes**: the `index: true` key (valid only on `writesFile` types), the `paths:` inline array (workspace-relative, file-level, suggestion only), both link syntaxes and document order, subtree-relative resolution with the full rejection list, linked-file requirements (whole-file type, single block), the destination-suggestion flow, carry-over semantics, and — mirroring §7.4 for flags — an explicit **"read-side only; the serializer never emits these keys"** paragraph. §5's per-type table gains an `index` note.
  - `CLAUDE.md` gains a **Template indexes** section after "Templates and AI Agents Config"; the single-sources-of-truth table gains two rows (*Index link + path syntax → `multi-index.service.ts` `safeRelPath` → `multi-index.service.test.ts`*; *Read-side-only frontmatter keys → the D11 guard in `frontmatter-keys.test.ts`*); the folder-structure listing names the six new files.
  - Anything from this plan worth keeping is promoted **before** the `git rm -r docs` commit.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

---

## 7. The gate

```bash
rm -rf dist && npm test && npx tsc --noEmit
```

`rm -rf dist` is **required**, not hygiene — `tsc` leaves orphaned output, so a
renamed or deleted test keeps running from stale `dist/` and inflates the count
into a phantom green. `npx tsc --noEmit` is the type truth; IDE diagnostics go
stale.

**Baseline: 675 passing** (per `CLAUDE.md`). The orchestrator confirms this on the
Wave 0 gate and records the real number as row zero of the ledger. Every gate run
records its count; a silent drop means a test was deleted, which is allowed only
loudly, with the relocated assertion named in the commit.

`vscode`-coupled code is verified by the **F5 manual pass** only, per the exact
click paths in T3 / T4 / T5 / T7. "F5 and check it works" is not a test.

---

## 8. Orchestrator protocol

**Read order, once, at start:** `CREATING_A_PLAN.md` → this file → `CLAUDE.md` →
`ARTIFACT_FILE_FORMAT.md`. Nothing else is required to begin.

1. **Load skills first** via the Skill tool: `caveman`, `ponytail`,
   `mastering-typescript`. They do not auto-load in subagents — every dispatch
   prompt begins with them or the dispatch is buggy.
2. **Wave 0 is yours alone.** Land O1 and O2 yourself. Fix the IDE's Sonar
   diagnostics on your own diff — the standard you enforce applies to you.
3. **Dispatch** each wave's workers in parallel: worker template
   (`CREATING_A_PLAN.md` §2) + the task block **verbatim** + §9's instance
   parameters, model `sonnet`.
4. **Review loop.** One reviewer per **wave**, model `opus`, continued across the
   wave's tasks via SendMessage so it accumulates sibling context. Pass it the
   task block + worker report + diff. `CHANGES` → back to the **same** worker via
   SendMessage; **max 2 rounds**; a third failure is `ESCALATE` and you resolve it
   yourself, recording which in the ledger's decisions table. **`SEC:` findings
   are fixed first and never expire on the round cap.**
5. **Security dispatch.** T1 and T6 are security-critical (§3). Name the surface
   explicitly in the reviewer dispatch. **Never merge either on a worker's
   self-report alone.**
6. **Integrate → gate → commit → push → ledger → next wave.** Commit **once per
   wave**, after the integrated gate is green. Workers never commit. Subject: the
   affected ticket id(s) first, then the conventional-commit summary —
   `<KEY> feat(multi-index): Wave 1 — pure domain`. Use `<KEY>` until the Jira
   keys exist and backfill; **never fabricate a key**. Push the feature branch
   after each wave's commit. The docs-only Wave 4 commit carries **no** prefix.
7. **A red gate stops all dispatch.** Nothing half-gated is committed or pushed.
8. **Human gates — stop and ask:**
   - Before **Wave 0**: the user's explicit go-ahead on this plan (standing rule).
   - After **Wave 3**: run the F5 passes, report verbatim, wait.
9. **Scope.** Hold every worker to its Owns list. Scope creep is rejected, not
   merged. A diff touching a forbidden file is instant `CHANGES`. T3 in particular
   is a **pure refactor** — feature code in that diff is a rejection.

---

## 9. Instance parameters

Appended to the `CREATING_A_PLAN.md` §2 role templates on every dispatch.

| Parameter | Value |
|---|---|
| **Repo path** | `/Users/nick/D3v/Dexsys/Extensions_Plugins/ObsidianArtifacts/obsidian-artifacts-snippets_and_tools-vscode` |
| **Branch** | `feature/multi-template` (off `develop`) |
| **Gate command** | `rm -rf dist && npm test && npx tsc --noEmit` |
| **Static analysis** | *SonarQube for IDE* (SonarLint) `<ide_diagnostics>` only — **never** invoke `sonar-analyze`, `mcp__sonarqube__*`, or the `sonar` CLI (`CREATING_A_PLAN.md` §3.1). Findings are fixed, not filed. |
| **Report cap** | ≤ 15 lines, per the worker template. |
| **Baseline test count** | 675 (confirm on the Wave 0 gate) |

**Forbidden files — no task may edit these:**

```
package.json                                  # D1: no new command, no new menu entry
src/types/constants.ts                        # D1: no new ARTIFACTS row
src/services/artifact-serializer.service.ts   # D11: the new keys are read-side only
src/services/template-writer.service.ts       # D8: contract stays "creates no directory"
src/services/template.service.ts              # naming + single-block rules unchanged
src/ui/panels/destFolderPicker.panel.ts       # pickDestFolder / isWithinRoot are consumed, never modified
test/snapshots/varset/*.md                    # byte-exact goldens
test/snapshots/form-html/*.html               # byte-exact goldens
test/fixtures/preview-render-golden/*         # the single-file preview tripwire (T3, T4)
docs/plans/multi-template/progress.md         # orchestrator-only
```

A diff touching any of them is an instant `CHANGES` on the contract check — the
first and cheapest rejection in the reviewer's order.

---

## 10. PR checklist

- [ ] Every wave committed with the affected ticket id(s) leading the subject, and pushed.
- [ ] Gate green on the final integrated tree, test count recorded in `progress.md`.
- [ ] F5 manual passes for T3, T4, T5, T6, T7 executed and recorded in the ledger.
- [ ] Hostile-input coverage executed: the T6 fixture asserts nothing is written outside the workspace dir, and the T4 index-guard pass asserts `index.md` is never written verbatim.
- [ ] `ARTIFACT_FILE_FORMAT.md` §8 and the `CLAUDE.md` sections landed (T8) — the format doc and the parser agree.
- [ ] `package.json`, `src/types/constants.ts` and `artifact-serializer.service.ts` are **absent from the diff** (D1 + D11 proof).
- [ ] `preview.ts` is smaller than it was before this branch (D12).
- [ ] Jira epic + every story created; **the PR description lists the epic and all story keys** (`CREATING_A_PLAN.md` §8). A `<KEY>` placeholder is a blocker to merge.
- [ ] Anything from `docs/` worth keeping promoted into `CLAUDE.md` / `ARTIFACT_FILE_FORMAT.md` / a JSDoc block.
- [ ] **`git rm -r docs` is the last commit before the PR opens.** The PR diff contains no `docs/` path.

---

## 11. Definition of done (`CREATING_A_PLAN.md` §9)

- [x] Every phase names the **existing** authority it extends (§4 table), not a new parallel one.
- [x] Every task has all six §5 fields.
- [x] Every wave's tasks own disjoint file sets — test files included.
- [x] No task depends on a task in its own wave.
- [x] The plan names its companion files, declares itself their authority, carries the orchestrator protocol (§8) and the instance parameters (§9) — and never re-copies a role template.
- [x] Shared-file wire-ups (`STRING_FRONTMATTER_KEYS`, the type contract) are Wave 0 orchestrator tasks.
- [x] T1 and T6 are marked security-critical; their Test-first fields name hostile inputs and their Gates name the **reviewer's manual security trace**, not `sonar-analyze`.
- [x] Every `vscode`-free task names a test file and a first failing assertion (O2, T1, T2, T6).
- [x] Every `vscode`-coupled task names its F5 click path (T3, T4, T5, T7).
- [x] Deliberate simplifications carry a `ponytail:` comment naming the ceiling and upgrade path (D4 resolver; the empty-folder-on-cancel note in §4).
- [x] The `.md` format change updates `ARTIFACT_FILE_FORMAT.md` in the same change (T8, before the docs deletion).
- [x] `progress.md` exists with every task at `todo`.
- [x] Per-wave commit **and push** encoded (§8.6), with the docs-only Wave 4 exemption stated.
- [x] The plan is **not executed on creation**.
- [x] The PR checklist requires the PR description to list the affected Jira tickets.
- [x] The PR checklist ends with `git rm -r docs`.

---

## 12. Review log — findings folded into this revision

Revision 1 was reviewed against DRY / KISS / DDD / TDD before any dispatch. Eight
defects were found and fixed here. Recorded so the reviewer does not re-derive
them and the orchestrator does not reintroduce them.

| # | Finding | Fix in this revision |
|---|---|---|
| **F1** | **Wrong — serializer emission.** Rev 1 added `index` to `FRONTMATTER_KEY_ORDER`. But the serializer builds from `ArtifactFormModel`, not `ParsedFrontmatter`, so emission would have required plumbing two keys the create form never sets. Worse, `frontmatter-keys.test.ts`'s second assertion iterates `STRING_FRONTMATTER_KEYS`, so a *boolean* key in the order array would have demanded a bogus string-set entry. | **D11**: read-side only, exactly the flags precedent (`ARTIFACT_FILE_FORMAT.md` §7.4). The serializer is now a **forbidden file**, and O2 adds a guard that fails if either key is ever emitted without the form-model plumbing. |
| **F2** | **DRY.** `paths:` was about to copy `tags`'s inline-array parsing into a second branch. | O2 extracts `parseInlineArray(raw)`; `tags` and `paths` both call it. The split exists exactly once. Also, rev 1 had *two* independent path-rejection rules (links, then later `paths:`); §3.1 now names **`safeRelPath` as the single authority**, and T1's tests assert the hostile inputs **through both callers**. |
| **F3** | **TDD violated.** The runner — security-critical — had **no** automated test; coverage sat in a separate later-wave task, i.e. merged-then-tested. | The integration test is now **inside T6**, written first by the same worker, driven through the callback bag so it needs no extension host. The separate coverage task is gone. |
| **F4** | **Coupling.** The runner imported `previewOnce` from `preview.ts`, forcing an orchestrator stub task (O3) purely to unblock parallelism, and a third serial edit to `preview.ts`. | The preview step is a **callback in the runner's own bag** (dependency inversion at the domain edge — the idiom the codebase already uses for `PreviewCallbacks`). **O3 deleted**: one fewer task, one fewer `preview.ts` edit, and T5/T6 are independent for free. |
| **F5** | **File-size rule broken.** `preview.ts` is already **427** lines — over `CLAUDE.md`'s ~400 limit — and rev 1 added to it while waiving the rule with "stays under 450". `CLAUDE.md` requires proposing the split in the same PR. | **D12 / T3**: extract the Create File flow to `preview.createFile.ts` first (behaviour-preserving; the golden net already exists). `preview.ts` lands at ~300 before the feature adds ~15, and the PR checklist asserts the file ends **smaller** than it started. |
| **F6** | **Bug.** `runIndex` never hid the QuickPick, so the picker would keep focus while the preview panel needed interaction — the run would have been unusable. `handoffToPreview` already shows the correct shape. | T7's Done-when requires `keepPopupOnHide = true; qp.hide()` **before** the run starts, and its F5 step 2 checks it explicitly. |
| **F7** | **Hole.** An index previewed on hover renders a live **Create File** button. A mouse click would have written `index.md` verbatim into the workspace. | Index guard in `handleInsert` (T4), with a dedicated F5 step asserting the message and that no file is written. |
| **F8** | **Under-specified.** `summariseRun` appeared in the architecture table but in no task's Done-when; `buildDestCandidates` did not exist at all. | Both are named explicitly in T1's Done-when and covered by its test file. |
