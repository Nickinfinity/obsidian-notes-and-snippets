# Jira tickets — Multi-Template / Multi-Agent-Config

Derived from [`plan.md`](plan.md) (revision 2), which is the authority. Specs are
listed **in creation order**: the epic first, then each story with the epic key as
`parent`.

- **Site:** `https://dexsys.atlassian.net` · **cloudId:** `fe305cae-3ffb-44ba-b746-64405f8f0c4b`
- **Project:** `VSX` — *VSCode Ext: Obsidian Artifacts* (team-managed)
- **Story → Epic link:** pass the epic key as `parent` on `createJiraIssue`.

> **Created 2026-07-24.** Real keys are recorded below and in `progress.md`.

> **WAF gotcha:** Cloudflare blocks `createJiraIssue` when a description contains
> literal path-injection payloads. Every hostile-input requirement below is
> therefore written **in prose** ("parent-directory traversal sequences", "NUL
> control characters") and must stay that way when the tickets are created.

> **Wave 4 (docs) has no ticket.** `CREATING_A_PLAN.md` §8 exempts
> documentation-only changes from the epic/story requirement and from the
> ticket-id commit prefix.

---

## Epic — `VSX-135`

**Summary:** Multi-Template / Multi-AI-Agent-Config — index-driven batch scaffolding

**Description:**
A template index is an ordinary vault artifact (`type: template` or `type: agent`)
carrying a new `index: true` frontmatter key, whose body lists links to sibling
artifacts in the same vault folder tree. Invoking it from the Explorer scaffolds
every linked file in one run.

Per link, in document order, the extension suggests a destination folder — by
default the link's own directory relative to the index file, mirrored under the
clicked workspace folder, plus any candidate paths the index declares in a `paths:`
frontmatter list, plus a Browse option. The suggestion is never forced: the user
accepts it with one keypress or chooses somewhere else. The chosen folder chain is
created if missing, then the existing Create File flow runs for that one artifact —
same preview, same variable inputs, same button, same filename prompt.

Variable values the user submits are carried forward in memory for the rest of the
run: a variable set on an earlier file pre-fills the same-named variable on a later
one, overriding that file's own default. The user always retains the final choice —
only the default shown changes.

Deliberately additive: no new artifact type, no new vault directory, no new command
and no new context-menu entry. The two new frontmatter keys are read-side only, so
the serializer is untouched as well. `package.json`, `src/types/constants.ts` and
`artifact-serializer.service.ts` are absent from the diff, which is the design proof.

**Acceptance criteria:**
- An index file scaffolds every linked artifact in document order.
- Each file's destination defaults to the link's index-relative folder, mirrored
  under the clicked folder; paths declared in the index are offered alongside it;
  a browse option allows any folder in the workspace; the user's choice wins.
- Missing destination folders are created, including intermediate levels.
- Variable values carry forward across steps as defaults; later files may override.
- Cancelling one file skips it and the run continues; closing the preview panel
  aborts the run; a summary notification reports written / skipped.
- Links or declared paths that leave their allowed root are refused by name and
  nothing is written outside the workspace folder.
- An index file can never be written to disk verbatim as an artifact.
- Ordinary templates, agent configs, snippets and commands behave exactly as before.
- `ARTIFACT_FILE_FORMAT.md` documents the format in the same branch.
- `preview.ts` ends the branch smaller than it started.

**Estimate:** 11 points (8 stories across 4 waves + a docs wave)

---

## Story 1 — `VSX-136` · parent `VSX-135`

**Summary:** Frontmatter contract — `index:` and `paths:`, read-side only

**Description:**
Wave 0, orchestrator-owned. Introduce the shared contract and teach the parser two
new frontmatter keys.

- New `src/types/multi-index.types.ts` exporting the index step, rejection,
  plan, destination-candidate, carry-over, outcome and tally types. No `vscode`
  imports — the runner's callback bag needs a URI type and therefore lives with the
  runner, matching how the preview controller already declares its own bag.
- `ParsedFrontmatter` gains a boolean `index` and a string-array `paths`.
- The parser gains a boolean key set and an array key set; the inline-array
  splitting used by `tags` is **extracted into one shared helper** and reused by
  `paths`, so that parsing rule exists exactly once.
- **The serializer is deliberately not changed.** These keys are read-side only,
  the same posture the format spec already documents for flag-delimited payloads:
  the create form does not author indexes, so emitting them would mean plumbing two
  keys through the form model that nothing sets.

**Acceptance criteria:**
- A hand-authored index file parses with `index` true and its declared paths as an
  ordered string array; a non-`true` value yields false.
- A guard test asserts neither key appears in the serializer's key order, with a
  message naming the read-side-only decision — so a later contributor who adds
  emission without the form-model plumbing fails loudly.
- The shared inline-array helper has exactly one definition.
- Existing byte-exact snapshots stay green, proving the `tags` refactor changed
  parsing only, never emission.
- Gate green: clean rebuild, full suite, type check.

**Estimate:** 1 point

---

## Story 2 — `VSX-137` · parent `VSX-135` 🔒 security-critical

**Summary:** Index domain service — links, path safety, destination candidates, carry-over

**Description:**
Wave 1. New `src/services/multi-index.service.ts`: the **single owner of the index
link syntax**, in the same spirit as the flags service owning the flag syntax. Pure
and free of VS Code APIs.

Exports: a path-safety function that is the **one rejection authority** for every
vault-authored path in this feature; an index detector; a link extractor accepting
both wiki and markdown link forms in document order with alias and anchor suffixes
stripped; a link resolver; a plan builder; a destination-candidate builder; a
carry-over overlay; and the run summary text.

**Security.** Link strings and declared paths come from an untrusted vault file and
become filesystem paths. The rejection function returns a refusal result — it never
throws and never sanitises — for parent-directory traversal sequences, absolute
paths, Windows drive-letter prefixes, backslash separators, NUL and other control
characters, and URI schemes. Percent-decoding is deliberately **not** performed, so
an encoded traversal sequence stays a literal filename and cannot be decoded back
into a traversal.

Links resolve relative to the index file's own directory only — not vault-wide
shortest-path resolution. That restriction is required by the feature anyway and
doubles as the traversal guard; the code carries a comment naming vault-wide
resolution as the upgrade path.

**Acceptance criteria:**
- Unit tests cover both link forms, mixed lists, document order, and prose lines
  being ignored.
- One hostile-input case per rejection class, each asserted **through both callers**
  (link resolution and destination-candidate building) — that is what proves a
  single rejection authority rather than two drifting copies.
- The destination-candidate builder puts the mirrored folder first, appends declared
  paths in declaration order, dedupes keeping the first occurrence, and drops
  refused entries.
- The carry-over overlay matches only exact, case-sensitive full variable tokens and
  mutates neither input.
- The index detector is false for a non-file-writing type carrying the key.
- Gate green, **plus** the reviewer's manual security trace from vault text to
  resolved path. (Static analysis here runs through the SonarQube for IDE extension
  and performs no taint analysis, so that trace is the only check on this surface.)

**Estimate:** 2 points

---

## Story 3 — `VSX-138` · parent `VSX-135`

**Summary:** BatchGate — one-shot promise gate for a batch preview step

**Description:**
Wave 1. New `preview.batch.ts` holding the small state machine that lets the
sequencer await a webview interaction: arm, settle, armed flag, pinned destination.

Settling must be idempotent. Three independent events can fire for one step — a
successful write, a cancel, and the panel being disposed — and only the first may
decide the outcome. Unhandled disposal would otherwise leave the run's pending
promise hanging forever.

The module imports VS Code types only, so its tests run without an extension host.

**Acceptance criteria:**
- Tests assert: not armed initially; arming returns a pending promise resolved by
  settling; settling twice with different outcomes resolves to the first; arming
  while armed rejects; the pinned destination is cleared once settled.
- Gate green.

**Estimate:** 1 point

---

## Story 4 — `VSX-139` · parent `VSX-135`

**Summary:** Extract the Create File flow out of the preview controller

**Description:**
Wave 1. A **pure, behaviour-preserving refactor with no feature code**, required
before the feature touches this file: the preview controller is already past the
project's file-size limit, and the project rule is to propose the split in the same
PR rather than defer it.

The whole-file write flow — destination resolution, the filename prompt, and the
collision loop with its overwrite/rename/cancel branches — moves into a new
`preview.createFile.ts` behind one entry point taking explicit arguments, including
a pinned-destination argument and an open-after-write flag that the batch flow will
use later. The preview controller keeps only the routing.

The golden net exists already: the preview render fixture and the workspace-writer
suite must stay green and byte-identical.

**Acceptance criteria:**
- The three moved functions live in the new file behind a single entry point.
- The preview controller drops below the agreed line budget.
- Zero behaviour change: the render fixture is byte-identical and the test count is
  unchanged.
- Manual pass confirms write, overwrite, rename and cancel all behave as before.
- A diff referencing index, batch or carry-over concepts is out of scope for this
  story.

**Estimate:** 2 points

---

## Story 5 — `VSX-140` · parent `VSX-135`

**Summary:** Preview controller batch hooks + index-file guard

**Description:**
Wave 2. Add the batch entry point and three settle points to the preview controller:

- a one-shot preview method that arms the gate, shows the artifact, reveals the
  panel and returns a promise the sequencer awaits;
- the Create File handler prefers the armed batch destination over the interactive
  resolver, so no folder prompt appears twice, and suppresses the editor tab in
  batch mode;
- cancel settles as skipped while armed; panel disposal settles as aborted.

Also closes a hole found in review: an index file previewed on hover renders a live
Create File button, so a mouse click would have written the index itself into the
workspace verbatim. The insert router now refuses that with a message pointing the
user at the picker.

Everything else in the controller is untouched. The single-file flow takes the
unarmed branch everywhere and must stay byte-identical — the preview render fixture
is the tripwire and is off-limits for this story.

**Acceptance criteria:**
- Manual pass: the ordinary single-template flow still writes, opens the tab, and
  closes both surfaces; cancel still disposes.
- Manual pass: mouse-clicking Create File on a hovered index shows the guard message
  and writes nothing.
- The armed path still routes its write through the workspace writer, so both
  containment checks remain in force.
- The controller stays within its line budget.
- Gate green with the render fixture untouched.

**Estimate:** 2 points

---

## Story 6 — `VSX-141` · parent `VSX-135`

**Summary:** Destination suggestions — per-file folder chooser

**Description:**
Wave 2. New `multiIndex.dest.ts`: a thin QuickPick over the candidate list the
domain service builds. The mirrored folder is first and pre-selected, so accepting
the suggestion costs one keypress; every path declared in the index follows; a
browse entry defers to the **existing** folder picker, rooted at the workspace
folder so the user really can place a file anywhere in the project while staying
contained. Escape skips that one file, consistent with the run's cancel rule.

No second folder navigator is written — the existing picker, including its inline
new-folder creation, is reused as-is.

**Acceptance criteria:**
- Manual pass with an index declaring two candidate paths: the mirrored folder is
  first and active; both declared paths are listed; a browse entry is last.
- Choosing a declared path places the file there rather than in the mirrored folder.
- Browse opens the existing picker rooted at the workspace folder, its new-folder
  action works, and the chosen folder is used.
- Escape skips that file and the run continues.
- The QuickPick title names the file being placed.
- Only one folder-navigator implementation exists in the source tree.
- Gate green.

**Estimate:** 2 points

---

## Story 7 — `VSX-142` · parent `VSX-135` 🔒 security-critical

**Summary:** MultiIndexRunner — the sequencer that drives a whole index run

**Description:**
Wave 2. New `multiIndex.ts`, the only file doing I/O for this feature. Composed by
the navigator through a callback bag, matching the existing controller idiom. It
**does not import the preview controller** — the preview step and the destination
chooser both arrive as callbacks, which is what keeps this story independently
buildable and, more importantly, independently testable without an extension host.

Per step, in order: assert the resolved target stays inside the index's own vault
directory **before reading it**; parse it and skip anything that is not a whole-file
artifact type; build the destination candidates; ask the chooser; assert the chosen
folder stays inside the workspace folder **before creating it**; create the folder
chain; overlay the carry-over values onto the artifact's variable defaults; await
the preview step; merge the submitted values into the carry-over map. Every failure
is caught per step so one bad link cannot kill the run. An abort breaks the loop.
The run closes with a summary notification.

**Security.** This introduces the extension's first recursive directory creation
inside the user's workspace. The containment assertion precedes it, and the
workspace writer re-asserts both the directory and the final file path before
writing — the second check is the backstop for the name typed at the filename
prompt, not a redundancy.

**Acceptance criteria:**
- An integration test drives a full run through the callback bag against a temporary
  workspace directory, with no extension-host UI interaction, and asserts: the
  expected steps and their relative directories in order; all files written at their
  nested paths; the folder chain created; the carry-over reaching a later step; a
  skipped step not stopping the run; an aborted step stopping it.
- A hostile fixture whose list mixes a traversal link and an absolute path yields
  both as refusals and writes nothing outside the temporary workspace directory.
- Gate green, **plus** the reviewer's manual security trace across both containment
  boundaries; the reviewer names the new directory-creation attack surface in its
  verdict even when approving.

**Estimate:** 3 points

---

## Story 8 — `VSX-143` · parent `VSX-135`

**Summary:** Navigator routing — start a run from the picker

**Description:**
Wave 3. One branch in the navigator's accept handler, between the parse and the
multi-block check: an index artifact starts a run instead of the single Create File
flow.

Includes a bug found in review: the run must **hide the QuickPick first**, exactly
as the existing hand-off to interactive preview does. Without it the picker keeps
focus while the preview panel needs interaction and the run is unusable.

The destination root comes from the existing destination resolver, so a
command-palette invocation still opens the folder picker first. Hovering an index
still previews it as an ordinary artifact.

**Acceptance criteria:**
- Manual pass: Explorer entry; the picker closes and the preview panel is usable;
  palette entry prompts for a folder first; an ordinary template is unaffected in
  both entry paths; no workspace open produces a clean error and no exception.
- The navigator stays within its line budget.
- Gate green.
- **Human gate:** all manual pass results reported and confirmed before the docs wave.

**Estimate:** 2 points
