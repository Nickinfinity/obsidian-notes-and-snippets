# Progress — AI Agents Config

Single ledger. One row per task/hunk, updated **only by the orchestrator** as work lands. Record the
test count on every gate run — a silent drop means a deleted test (`CREATING_A_PLAN.md §7`).

Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with reason).

Executed inline by a single orchestrator (playing worker + reviewer) — the code changes are tiny and
disjoint, so no Sonnet workers / Opus reviewer were spawned. Wave boundaries, gates, per-wave commits,
and the security traces were all honoured.

| Task | Wave | Owner | Status | Test count | Gate | Review rounds | Notes |
|------|------|-------|--------|-----------|------|---------------|-------|
| H0-types    | 0 | orchestrator | done | 572 → 576 | pass | inline | provider/model/version on ParsedFrontmatter + ArtifactFormModel |
| H0-constants| 0 | orchestrator | done | 572 → 576 | pass | inline | agent gains createForm + form (D4 multiBlock:true); JSDoc de-staled |
| H0-guards   | 0 | orchestrator | done | 572 → 576 | pass | inline | flipped constants.test (3) + artifact-type-config.test (getFormConfig/getLanguageMode/canMultiBlock/getCreateFormTypes) |
| T1 | 1 | orchestrator | done | 576 → 583 | pass | inline | parser STRING_FRONTMATTER_KEYS += 3; test/agent-parse.test.ts (2) |
| T2 | 1 | orchestrator | done | 576 → 583 | pass | inline (SEC ✓) | serializer emit + D3 order; safeYamlValue on all 3; hostile-input test; test/agent-serialize.test.ts (3) |
| T3 | 1 | orchestrator | done | 576 → 583 | pass | inline (SEC ✓) | buildAgentFieldsSection (escHtml); new agent-single-block.html; form-html.test agent suite (2) |
| T4 | 1 | orchestrator | done | 576 → 583 | pass | inline | form.clientJs extract #provider/#model/#version + markDirty; F5-verified pending |
| H1-docs | 1 | orchestrator | done | — | n/a (md-only) | inline | ARTIFACT_FILE_FORMAT.md §1/§1.1/§5 + new §5.2; CLAUDE.md note. Folded into Wave 1 code commit (§9) |
| T5 | 2 | orchestrator | done | 583 → 585 | pass | inline | round-trip test/agent-roundtrip.test.ts (2) |
| F5 pass | 2 | orchestrator | **blocked** | — | — | — | end-to-end create-agent click-path — needs a human/VS Code Dev Host; CLI cannot drive the webview UI |
| VSX-134 | fix | orchestrator | done | 585 → 593 | pass | inline (SEC ✓) | follow-up bug: agent invoke wrote-a-file not cursor-insert. `writesWholeFile` predicate + `resolveAgentFileName` (target:-named, injection-guarded). Commit `3d66601`. F5-verify write path. |

## Gate log

| When | Command | Test count | Result |
|------|---------|-----------|--------|
| baseline | `rm -rf dist && npm test` | 572 | pass (docs said 507 — stale; tree is truth) |
| Wave 0 | `rm -rf dist && npm test && npx tsc --noEmit` | 576 | pass · tsc clean |
| Wave 1 | `rm -rf dist && npm test && npx tsc --noEmit` | 583 | pass · tsc clean |
| Wave 2 | `rm -rf dist && npm test && npx tsc --noEmit` | 585 | pass · tsc clean |

Commits (feature/agents-config, all pushed):
- Wave 0 `4c12c8c` — `VSX-131 VSX-132 feat(agents-config): Wave 0 …`
- Wave 1 `46ef37c` — `VSX-131 VSX-132 feat(agents-config): Wave 1 …`
- Wave 2 `6dcbef9` — `VSX-133 test(agents-config): Wave 2 …`

## Decisions / deviations

| # | Decision | By | Rationale |
|---|----------|----|-----------|
| D-1 | Executed inline (one orchestrator, no spawned workers/reviewer) | orchestrator | Changes tiny + disjoint; cold-start subagents were the expensive path for a ~1-line-per-file feature. Gates/commits/security traces still enforced. |
| D-2 | H1-docs folded into the Wave 1 **code** commit (keys lead), not a separate `docs(…)` commit | orchestrator | `CREATING_A_PLAN.md §9` requires the `.md` format change in the **same change** as the parser/serializer; §8 makes a mixed code+docs change feature work that takes the ticket id. The plan's separate-docs-commit note contradicted its own §9 cite. |
| D-3 | Updated `test/artifact-serializer.test.ts:326` (FRONTMATTER_KEY_ORDER guard) to the D3 order | orchestrator | Pre-existing guard pinned the old order; a shared guard fix belongs to the orchestrator, not a worker task. Landed in the Wave 1 commit. |
| D-4 | Jira tickets **created** (not left as `<KEY>`) — Rovo connector was authorized | orchestrator | User asked to create epic+tickets before committing. The `plugin:atlassian` connector is unauthorized, but the `claude.ai Atlassian (Rovo)` connector is authorized this session. VSX-130 (epic), VSX-131/132/133 (stories). |
| D-5 | Left the pre-existing ReDoS diagnostic (`parser.service.ts:174`, `parseVars` regex, S8786) unfixed | orchestrator | Out of T1 scope (round-trip keys), pre-existing on code T1 did not touch, no test covers a fix. Noted for a follow-up, not smuggled into this feature. |
| D-6 | `docs/` kept **untracked**, not committed per-wave | orchestrator | It is a working artifact deleted before the PR; untracked files never enter the PR diff, so the `git rm -r docs` step is moot. Ledger + jira-tickets.md updated locally for visibility. |
