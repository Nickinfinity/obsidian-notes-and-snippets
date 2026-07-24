# AI Agents Config — provider / model / version + create form

**This file is the plan and the single entry point.** Its companion files derive from it:

- `progress.md` — the ledger. One row per task, updated **only by the orchestrator** as work lands.
- `jira-tickets.md` — ready-to-create epic + story specs (Atlassian connector is unauthorized in
  this environment, so the markdown **is** the deliverable; keys stay `<KEY>` until created).

The **process** authority is [`CREATING_A_PLAN.md`](../../../CREATING_A_PLAN.md); this plan is one
instance of it. The `.md` structure authority is
[`ARTIFACT_FILE_FORMAT.md`](../../../ARTIFACT_FILE_FORMAT.md). The role templates
(orchestrator / reviewer / worker) live **only** in `CREATING_A_PLAN.md §2` — this plan never
re-copies them; it appends the instance parameters below.

> **Authoring ≠ execution.** This plan is authored, not started. Do **not** land Wave 0, dispatch
> any worker, or run the gate until the user explicitly says "run it" / "go" / "execute".

---

## 1. What we are building

The `agent` artifact type (`AgentsConf` dir) already exists but has **no create form** and
carries none of the AI-provenance fields. This feature makes it a first-class create-form type
(like `template`) and adds three **agent-only** frontmatter keys:

```yaml
---
type: agent
title: Code reviewer
provider: Claude
model: Opus
version: "4.8"
---
```

Two user decisions, locked:

- **D1 — Scope:** full create form **+** round-trip. `agent` gains `createForm:true` + a `form`
  config; the three keys thread through parser → serializer → types so hand-authored files also
  round-trip. Agent insert/target-file write behaviour is **unchanged**.
- **D2 — Field type:** three **free-text** inputs (no curated dropdowns, no new table to maintain),
  mirroring the template-only `extension` field exactly.

Two authoring decisions this plan makes (flip before execution if wrong):

- **D3 — Key order:** `FRONTMATTER_KEY_ORDER` becomes
  `type · title · description · language · extension · provider · model · version · tags · env · target`.
  Rationale: the type-specific keys (`extension` = template, `provider/model/version` = agent) group
  after `language`, before the generic `tags`; reserved `env/target` stay last.
- **D4 — Multi-block:** `agent` create form is `multiBlock: true` — reuses the existing multi-block
  form machinery for free and matches the current `ARTIFACT_FILE_FORMAT.md §5` agent row
  (multi-block: yes). Flip to `false` for a template-like single-block form (also updates the §5 row
  and the `canMultiBlock('agent')` expectation).

### The precedent to imitate

`extension` is a **template-only** frontmatter key. Everything `provider/model/version` needs
already exists for `extension` and is copied one-for-one:

| Concern | `extension` (template) lives in | `provider/model/version` (agent) mirror |
|---|---|---|
| Interface field | `ParsedFrontmatter`, `ArtifactFormModel` | same two interfaces |
| Parser reads it | `STRING_FRONTMATTER_KEYS` (generic string path) | add 3 entries — no other parser change |
| Serializer emits it | `FRONTMATTER_KEY_ORDER` + `serializeFrontmatter` (single-line via `safeYamlValue`) | same, 3 keys |
| Form input | `buildExtensionField` (renders only for `template`) | new `buildAgentFieldsSection` (renders only for `agent`) |
| Client extract | `form.clientJs` reads `#extension`, posts it | read `#provider/#model/#version`, post them |
| Drift guard | `frontmatter-keys.test.ts` (auto — iterates both lists) | **no edit** — passes once both lists carry the 3 keys |

**No `package.json` change.** The create flow is a single palette command
(`obsidian-artifacts.create`) whose QuickPick is driven by `getCreateFormTypes()`; adding
`createForm:true` surfaces "Create Agents Config" automatically. `contexts` is unchanged, so
`package-menus.test.ts` is untouched.

**No `panel.ts` / `panel.helpers.ts` change.** `handleSave` serializes `{...model}` — new keys pass
through. `provider/model/version` are optional → no save-time validation. `defaultModel` needs no
edit — the form seeds inputs from `model.provider ?? ''`, exactly as it does for `extension`.

---

## 2. Orchestrator protocol

**Read order to start:** this file → `CREATING_A_PLAN.md` (role templates + review loop, one read) →
`progress.md`. Nothing else is needed to begin.

**Per-wave review loop** (`CREATING_A_PLAN.md §2`): orchestrator lands its own hunks → dispatches the
wave's workers in parallel → passes each `task block + worker report + diff` to the **one** reviewer
for that wave (continued via SendMessage) → `CHANGES` go back to the same worker (max 2 rounds, then
`ESCALATE` to the orchestrator) → all `APPROVE` → integrate hunks → gate the integrated tree →
commit → push → ledger → next wave.

**Commit policy:** orchestrator commits **once per wave** after a green integrated gate; workers
never commit. **Ticket id(s) lead the subject** (`<KEY>` until created — never fabricated). Docs-only
commits (the `ARTIFACT_FILE_FORMAT.md` / `CLAUDE.md` hunk) take a plain `docs(...)` subject, **no**
`<KEY>` (`CREATING_A_PLAN.md §8`). **Push the feature branch after every wave commit.**

**Red gate stops all dispatch.** Nothing half-gated is pushed.

**Human-gate points (stop and ask):** (a) before landing Wave 0 — the user's explicit go-ahead;
(b) the Wave 2 F5 manual pass — the orchestrator runs the click-path itself (VS Code-coupled code has
no automated test) and reports the result before declaring done.

### Instance parameters (append to the `CREATING_A_PLAN.md §2` role templates)

- **Repo:** `/Users/nick/D3v/Dexsys/Extensions_Plugins/ObsidianArtifacts/obsidian-artifacts-snippets_and_tools-vscode`
- **Branch:** `feature/agents-config` (off `develop`)
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`  *(`npm test` = compile + lint + suite; `rm -rf dist` is mandatory — stale `dist/*.js` inflates the count)*
- **Forbidden files** (no task may write these):
  - `package.json` — no menu/command change is needed; a diff here is a scope error.
  - `test/snapshots/varset/**` and the existing `test/snapshots/form-html/{snippet-single-block,snippet-multi-block,command-single-block,template-*}.html` — byte-exact goldens; the agent field renders `''` for every non-agent type, so these **must not change**.
  - `CREATING_A_PLAN.md` — the role templates are authority; never edited by a task.
  - Any file not in the acting task's **Owns**.
- **Report caps:** worker report ≤ 15 lines (template format). Reviewer verdict terse.
- **Static analysis:** SonarLint `<ide_diagnostics>` arrive automatically after each `Edit`/`Write` —
  fix, don't file. **Never** invoke `sonar-analyze` / `mcp__sonarqube__*` / the `sonar` CLI
  (`CREATING_A_PLAN.md §3.1`). The IDE analyser does **no taint analysis** — the reviewer's manual
  trace is the only check on the webview/serializer surfaces (T2, T3).

---

## 3. Wave plan

| Wave | Tasks | Orchestrator integration hunks | Gate |
|---|---|---|---|
| **0 — foundation** | *(none — orchestrator lands directly)* | H0-types, H0-constants, H0-guards | gate green → commit → push |
| **1 — round-trip + form** | T1, T2, T3, T4 (parallel, disjoint) | H1-docs (`ARTIFACT_FILE_FORMAT.md`, `CLAUDE.md`) at wave close | gate green → commit → push |
| **2 — verification** | T5 (round-trip test) | — | gate green → commit → push → **F5 human-gate** |

Wave 0 is pure orchestrator foundation: it widens the shared type interfaces and the `ARTIFACTS`
registry row, plus the three guard tests that pin that row. Every Wave 1 worker **Reads** these but
none modifies them. No same-wave dependencies exist; each Wave 1 task depends only on Wave 0. T5
depends on T1 + T2 and therefore lives in Wave 2.

---

## 4. Wave 0 — orchestrator foundation (no workers)

The orchestrator lands these three hunks itself (shared types + registry table + their guards), gates,
commits, pushes.

**H0-types** — add the three optional, agent-only fields.
- `src/types/parsed-artifact.types.ts`: add `provider?`, `model?`, `version?` to `ParsedFrontmatter`
  with JSDoc "`type: agent` only" (mirror the `extension` field's doc).
- `src/types/artifact-form.types.ts`: add the same three optional fields to `ArtifactFormModel`.
- Optional (no field, docs), all agent-only.

**H0-constants** — `src/types/constants.ts`, the `agent` entry gains:
```ts
createForm: true,
form: {
    language: { mode: 'free', default: '' },
    label: { singular: 'agent config' },
    multiBlock: true,          // D4
},
```
`contexts` stays `['explorer']`. This alone surfaces "Create Agents Config" in the create QuickPick.

**H0-guards** — flip the three assertions that pin the old "agent has no form" fact:
- `test/constants.test.ts:104` — `agent: createForm !== true` → `=== true`.
- `test/artifact-type-config.test.ts:45` — `getFormConfig('agent')` no longer throws → assert it
  returns `{ language: { mode:'free', default:'' }, label:{singular:'agent config'}, multiBlock:true }`.
- `test/artifact-type-config.test.ts:76` — `getLanguageMode('agent')` → `=== 'free'`.
- `test/artifact-type-config.test.ts:124` — `canMultiBlock('agent')` → `=== true`.
- `test/artifact-type-config.test.ts:136` — `getCreateFormTypes()` sorted list gains `'agent'`.

**Gate:** the full suite must be green after H0 (existing `frontmatter-keys.test.ts` still passes —
no new keys emitted yet). If any other test pins the old agent behaviour, the orchestrator fixes it
here and records it in the ledger.

---

## 5. Wave 1 — round-trip + form (workers)

All four tasks are disjoint in files **and** test files. T1/T2/T3 are `vscode`-free (unit + snapshot
tested). T4 is `vscode`-coupled (webview runtime) → F5 pass in Wave 2.

### T1 — Parser reads provider / model / version

- **Owns:** `src/services/parser.service.ts`, `test/agent-parse.test.ts`
- **Reads:** `src/types/parsed-artifact.types.ts`, `ARTIFACT_FILE_FORMAT.md`
- **Depends on:** Wave 0
- **Test first:** `test/agent-parse.test.ts` — `parseFromContent` of an agent `.md` carrying
  `provider: Claude` / `model: Opus` / `version: "4.8"` yields
  `fm.provider === 'Claude'` (fails today — key is dropped by the generic path because it is not in
  `STRING_FRONTMATTER_KEYS`).
- **Done when:** `frontmatter.provider/model/version` are read for an agent file; the three keys are
  the **only** parser change (add to `STRING_FRONTMATTER_KEYS`).
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

### T2 — Serializer emits provider / model / version *(security-critical)*

- **Owns:** `src/services/artifact-serializer.service.ts`, `test/agent-serialize.test.ts`
- **Reads:** `src/types/artifact-form.types.ts`, `ARTIFACT_FILE_FORMAT.md`
- **Depends on:** Wave 0
- **Test first:** `test/agent-serialize.test.ts` — two assertions that fail today:
  1. `serializeArtifact(agentModel).includes('provider: Claude')` and the keys appear in the D3
     order (`language` … `provider` before `tags`).
  2. **Hostile input:** a `provider` value containing `"x\ntype: command"` must be single-lined by
     `safeYamlValue` so the re-parsed frontmatter has **no** injected second key
     (`parseFromContent(serializeArtifact(m)).frontmatter.type === 'agent'`).
- **Done when:** `FRONTMATTER_KEY_ORDER` carries the three keys in D3 position; `serializeFrontmatter`
  emits each when non-empty, routed through `safeYamlValue` exactly like `title`/`description`/`extension`.
- **Security surface:** frontmatter values cross the webview boundary and are written verbatim into a
  YAML block; an unstripped newline injects a frontmatter key on re-parse. The single-line
  enforcement is the mitigation — the **reviewer's manual trace confirms every one of the three keys
  goes through `safeYamlValue`**, no exceptions (`CREATING_A_PLAN.md §2.5`).
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit` + reviewer security trace.

### T3 — Create-form agent fields *(webview-escaping)*

- **Owns:** `src/ui/panels/artifactForm/form.html.ts`, `test/form-html.test.ts`,
  `test/snapshots/form-html/agent-single-block.html` *(new golden)*
- **Reads:** `src/types/artifact-form.types.ts`, `src/services/artifact-type-config.service.ts`
- **Depends on:** Wave 0
- **Test first:** in `test/form-html.test.ts`, a new `buildFormHtml — agent` suite (copy the
  `— template` suite shape) asserting an agent model with provider/model/version renders
  `id="provider"` seeded `value="Claude"` (etc.), and that a snippet form contains no `id="provider"`.
  Fails today (no field). Generate `agent-single-block.html` with `UPDATE_SNAPSHOTS=1`.
- **Done when:** a new `buildAgentFieldsSection(model)` returns `''` unless `model.type === 'agent'`,
  renders three `escHtml`-seeded text inputs, and is spliced into `buildFrontmatterSection` adjacent
  to `${buildExtensionField(model)}` so **existing snapshots stay byte-identical**.
- **Security surface:** seeds are interpolated into webview HTML → every value through `escHtml`
  (mirror `buildExtensionField`). Reviewer confirms.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`; existing form-html snapshots unchanged.

### T4 — Client-side model extraction for agent fields

- **Owns:** `src/ui/panels/artifactForm/form.clientJs.ts`
- **Reads:** `src/ui/panels/artifactForm/form.html.ts` (element ids)
- **Depends on:** Wave 0
- **Test first:** `vscode`-coupled webview runtime — no unit test; verified by the **Wave 2 F5
  click-path**. (Per `CREATING_A_PLAN.md §6`, webview client JS is F5-verified; the plan names the
  click-path in §6 below.)
- **Done when:** `extractModel()` reads `#provider/#model/#version` (each `null` for non-agent → `''`,
  exactly as `#extension` is handled) and includes them in the posted model; each input gets a
  `markDirty` listener.
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit` (compile/lint only for this file) + the
  Wave 2 F5 pass.

### H1-docs — orchestrator integration hunk (docs-only, no ticket)

At Wave 1 close, before the commit, the orchestrator updates the format authority in the **same
change** as the parser/serializer (`CREATING_A_PLAN.md §9`):
- `ARTIFACT_FILE_FORMAT.md`: add `provider/model/version` to the §1 recognised-keys list; update the
  §1.1 / §5.1 key order to D3; add an agent subsection (mirror §5.1 extension) documenting the three
  agent-only keys; note them in the §5 agent row.
- `CLAUDE.md` (optional, one line): note the agent create form + the three keys under the
  single-sources-of-truth / per-artifact-variations section.
- Commit subject: `docs(agents-config): document provider/model/version + agent create form` (no `<KEY>`).

---

## 6. Wave 2 — verification

### T5 — Round-trip test

- **Owns:** `test/agent-roundtrip.test.ts`
- **Reads:** `src/services/parser.service.ts`, `src/services/artifact-serializer.service.ts`
- **Depends on:** T1, T2 (hence Wave 2 — a same-wave dependency is forbidden)
- **Test first:** `parseFromContent(serializeArtifact(agentModel), path, root).frontmatter` deep-equals
  the model's `{ provider, model, version }` and the emitted key order matches D3. Fails if either
  direction drifts.
- **Done when:** the round-trip assertion passes for a fully-populated agent model **and** for one
  with empty fields (keys omitted, not emitted empty).
- **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`

### F5 human-gate — end-to-end create flow (orchestrator runs, reports, then done)

Click-path (verifies T3 + T4 together, the only check on the webview surface):
1. Command Palette → **Obsidian Artifacts: Create** → pick **Create Agents Config**.
2. Form shows Title, Description, **Provider / Model / Version** text inputs, Tags, one code block.
3. Enter title + `provider: Claude`, `model: Opus`, `version: 4.8` + some code → **Save** → name the file.
4. Open the written `AgentsConf/*.md`: frontmatter carries `type: agent`, `provider: Claude`,
   `model: Opus`, `version: 4.8` in D3 order.
5. Reopen it via the picker → the three values round-trip.
6. Confirm a **Create Snippet** form shows **no** provider/model/version inputs.

---

## 7. Security summary

Threat model inherited from `CLAUDE.md` / `CREATING_A_PLAN.md §4`. The new surface is narrow: three
free-text frontmatter scalars entering from the webview.

- **T2 (serializer) — key-injection via newline.** `provider`/`model`/`version` are written into the
  YAML frontmatter; an embedded `\n` would inject a sibling key on re-parse. Mitigation: route all
  three through `safeYamlValue` (single-line). Hostile-input test required; reviewer trace mandatory.
- **T3 (form.html) — HTML injection.** Seeds interpolated into webview HTML must pass `escHtml`
  (mirror `buildExtensionField`). Reviewer confirms.
- T1, T4, T5 touch no new sink (plain-string parse; DOM value reads; test-only).

Neither value reaches a subprocess or influences a filesystem path (the written filename derives from
the title, not these fields), so no `execFile`/path-containment surface is added.

---

## 8. Definition of done (this plan)

- [x] Every phase names the **existing** authority it extends (the `extension` precedent; `ARTIFACTS`;
      `FRONTMATTER_KEY_ORDER`/`STRING_FRONTMATTER_KEYS`), not a new parallel one.
- [x] Every task has all six §5 fields.
- [x] Each wave's tasks own disjoint file sets — test files and snapshots included; `package.json` is forbidden.
- [x] No task depends on a task in its own wave (T5 → Wave 2).
- [x] Companion files named; this plan declared their authority; orchestrator protocol + instance
      parameters present; role templates referenced, never re-copied.
- [x] Shared-file wire-ups (type interfaces, `ARTIFACTS` row, its guard tests, `ARTIFACT_FILE_FORMAT.md`)
      are orchestrator hunks (H0-*, H1-docs), not worker tasks.
- [x] The untrusted-input task (T2) is marked security-critical, its Test-first includes a hostile
      input, and its Gate names the reviewer's manual trace — not `sonar-analyze`.
- [x] `vscode`-free tasks name a test file + first failing assertion; the `vscode`-coupled task (T4)
      names its F5 click-path (§6).
- [x] The `.md` format change updates `ARTIFACT_FILE_FORMAT.md` in the same change (H1-docs, Wave 1).
- [x] `progress.md` exists with every task at `todo`.
- [x] Per-wave commit **and push** encoded; ticket id leads code commits, docs commit is `<KEY>`-free.
- [x] Not executed on creation — awaits explicit go-ahead.
- [ ] PR checklist requires the PR description to list the affected Jira tickets (epic + stories).
- [ ] PR checklist ends with `git rm -r docs`.

## 9. PR checklist (for branch close)

- [ ] All waves green on the gate; `progress.md` fully `done` with test counts.
- [ ] `ARTIFACT_FILE_FORMAT.md` reflects provider/model/version + the agent create form (durable facts promoted).
- [ ] PR description lists the affected Jira tickets — the epic and every story delivered.
- [ ] Real Jira keys (project **VSX**) backfilled into commit subjects and `jira-tickets.md`.
- [ ] **Last commit before opening the PR:** `git rm -r docs` — the PR diff contains no `docs/` path.
