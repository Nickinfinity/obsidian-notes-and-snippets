# Jira tickets — AI Agents Config

Project: **VSX** (`dexsys.atlassian.net`). The Atlassian connector is **unauthorized** in this
environment, so this file is the deliverable — tickets are created in one pass afterwards. Keys stay
`<KEY>` until created; never fabricate a key. Backfill real keys into commit subjects, the PR
description, and this file after creation (`CREATING_A_PLAN.md §8`).

> **Created 2026-07-23** in project **VSX** via the authorized Rovo connector:
> Epic **[VSX-130](https://dexsys.atlassian.net/browse/VSX-130)** ·
> **[VSX-131](https://dexsys.atlassian.net/browse/VSX-131)** ·
> **[VSX-132](https://dexsys.atlassian.net/browse/VSX-132)** ·
> **[VSX-133](https://dexsys.atlassian.net/browse/VSX-133)** ·
> Bug **[VSX-134](https://dexsys.atlassian.net/browse/VSX-134)** (follow-up).

Docs-only work (H1-docs, and the `docs/` deletion) needs **no** ticket.

---

## Epic — `VSX-130` — AI Agents Config: provider/model/version + create form

**Summary:** Make the `agent` artifact a first-class create-form type and add three agent-only
frontmatter keys (`provider`, `model`, `version`) that round-trip through the parser and serializer.

**Description:** The `agent`/`AgentsConf` type exists but has no create form and no AI-provenance
metadata. Mirror the template-only `extension` precedent: add `provider/model/version` to the
frontmatter types, the parser's string-key set, the serializer's key order + emission (single-line
enforced), and three free-text create-form inputs rendered only for `agent`. Update
`ARTIFACT_FILE_FORMAT.md`. No `package.json` or agent insert-behaviour change.

**Acceptance criteria:**
- Creating an Agents Config via the palette writes an `AgentsConf/*.md` whose frontmatter carries
  `provider/model/version` in order `type · title · description · language · extension · provider · model · version · tags · env · target`.
- A hand-authored agent file with those keys round-trips (`parse(serialize(x))` preserves them).
- Non-agent create forms show none of the three inputs; existing form-html snapshots are byte-identical.
- Full gate green: `rm -rf dist && npm test && npx tsc --noEmit`.

---

## Story 1 — `VSX-131` — Round-trip provider/model/version (parser + serializer)

**Parent:** `VSX-130` · **Plan tasks:** H0-types, T1, T2 · **Estimate:** 2 pts

**Description:** Add the three optional agent-only fields to `ParsedFrontmatter` and
`ArtifactFormModel`; read them via `STRING_FRONTMATTER_KEYS`; emit them in `FRONTMATTER_KEY_ORDER`
(D3 position) and `serializeFrontmatter`, each routed through `safeYamlValue`.

**Acceptance criteria:**
- `parseFromContent` reads `provider/model/version` off an agent file.
- `serializeArtifact` emits them in D3 order when non-empty, omits them when empty.
- **Security:** a value containing a newline is single-lined — no injected frontmatter key on re-parse
  (hostile-input test present; reviewer trace passed).
- New tests: `test/agent-parse.test.ts`, `test/agent-serialize.test.ts`; `frontmatter-keys.test.ts` still green.

---

## Story 2 — `VSX-132` — Agent create form + fields

**Parent:** `VSX-130` · **Plan tasks:** H0-constants, H0-guards, T3, T4 · **Estimate:** 3 pts

**Description:** Give `agent` `createForm:true` + a `form` config (`language.free`, `multiBlock:true`,
label `agent config`); flip the guard tests that pinned "agent has no form"; render three
`escHtml`-seeded free-text inputs via `buildAgentFieldsSection` (agent-only); read/post them in
`form.clientJs`.

**Acceptance criteria:**
- "Create Agents Config" appears in the create QuickPick (derived from `getCreateFormTypes()`).
- The agent form shows Provider/Model/Version inputs; snippet/command/template forms do not.
- Existing form-html snapshots unchanged; a new `agent-single-block.html` snapshot is added.
- F5 click-path (plan §6) passes end-to-end.

---

## Story 3 — `<KEY-S3>` — Round-trip verification

**Parent:** `VSX-130` · **Plan tasks:** T5 · **Estimate:** 1 pt

**Description:** Add `test/agent-roundtrip.test.ts` asserting `parse(serialize(agentModel))` preserves
`provider/model/version` and the D3 key order, for both populated and empty-field models.

**Acceptance criteria:**
- Round-trip test green; empty fields omitted (not emitted empty); populated fields preserved in order.
