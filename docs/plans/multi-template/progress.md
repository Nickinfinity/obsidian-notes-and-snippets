# Progress — Multi-Template / Multi-Agent-Config

Ledger for [`plan.md`](plan.md) (revision 2), which is the authority.
**Maintained by the orchestrator only** — a worker never edits this file, or two
workers race on it.

Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with the reason).

**Record the test count on every gate run.** A silent drop means a test was
deleted; per `CLAUDE.md` that is allowed only loudly, with the relocated
assertion named in the commit.

**Baseline: 675 passing** (per `CLAUDE.md`) — confirm on the Wave 0 gate and
correct this line if the real number differs.

---

## Tasks

| Task | Wave | Owner | Status | Test count | Gate | Review rounds | Notes |
|------|------|-------|--------|-----------|------|---------------|-------|
| O1 — Freeze contract types | 0 | orchestrator | done | 675 | pass | n/a | `multi-index.types.ts` + `index?: boolean` + `paths?: string[]`; no `vscode` in `src/types/` |
| O2 — Parser reads `index:` / `paths:` | 0 | orchestrator | done | 675 → 679 | pass | n/a | shared `parseInlineArray`; **D11 guard proven red** by temporarily emitting `index` (msg: *"read-side only (plan D11)…"*), then reverted |
| T1 — Index domain service 🔒 | 1 | worker | done | 679 → 739 | pass | 0 (APPROVE) | 60 tests; hostile inputs asserted through **both** callers; reviewer's trace confirms one `safeRelPath`, no decode step. Orchestrator hardening: `CONTROL_CHAR_RE` widened to C1 (`\x7F-\x9F`) |
| T2 — `BatchGate` | 1 | worker | done | 739 → 746 | pass | 0 (APPROVE) | `import type { Uri }` verified; `settle` nulls the resolver **before** resolving, so idempotence holds |
| T3 — Extract Create File flow (D12) | 1 | worker | done | 746 → 746 | pass | 0 (APPROVE) | `preview.ts` **427 → 320**; goldens byte-identical; reviewer read every JSDoc hunk and confirmed comment-only |
| T4 — Preview batch hooks | 2 | worker | todo | — | — | 0 | includes the index-guard hole (F7); F5 pass |
| T5 — Destination chooser (D9) | 2 | worker | todo | — | — | 0 | reuses `pickDestFolder`; F5 pass |
| T6 — `MultiIndexRunner` 🔒 | 2 | worker | todo | — | — | 0 | **security-critical**; owns its own integration test (F3) |
| T7 — Navigator routing | 3 | worker | todo | — | — | 0 | must hide the QuickPick first (F6); F5 pass |
| T8 — Docs | 4 | worker | todo | — | — | 0 | docs-only — no ticket, no ticket prefix |

---

## Gate log

| When | Wave | Command | Result | Test count | Notes |
|------|------|---------|--------|-----------|-------|
| 2026-07-24 | — | `rm -rf dist && npm test && npx tsc --noEmit` | pass | **675** | baseline confirmed — matches `CLAUDE.md` |
| 2026-07-24 | 0 | `rm -rf dist && npm test && npx tsc --noEmit` | pass | **679** (+4) | O1 + O2 integrated; 4 new tests in `frontmatter-keys.test.ts` |
| 2026-07-24 | 1 | `rm -rf dist && npm test && npx tsc --noEmit` | pass | **746** (+67) | T1 +60, T2 +7, T3 ±0; reviewer re-ran the gate independently |

---

## F5 manual passes

| Task | Click path | Run at | Result |
|------|-----------|--------|--------|
| T3 | plan §6 T3 steps 1–2 — refactor is behaviour-preserving (write / Overwrite / Rename / Cancel) | — | — |
| T4 | plan §6 T4 steps 1–2 — unarmed single-file flow unchanged | — | — |
| T4 | plan §6 T4 step 3 — **index guard**: mouse-click Create File on a hovered index writes nothing | — | — |
| T5 | plan §6 T5 steps 1–4 — suggestion first, declared path, Browse…, Escape skips | — | — |
| T6 | plan §6 T6 — covered by `test/multi-index-runner.test.ts`, no F5 required | — | — |
| T7 | plan §6 T7 steps 1–5 — routing, picker hidden, palette entry, non-index unaffected, no workspace | — | — |

---

## Jira keys

Created 2026-07-24 in project `VSX` on `https://dexsys.atlassian.net`.

| Plan item | Ticket | Key |
|---|---|---|
| Feature | Epic | `VSX-135` |
| Wave 0 | Story 1 — frontmatter contract (read-side only) | `VSX-136` |
| Wave 1 | Story 2 — index domain service 🔒 | `VSX-137` |
| Wave 1 | Story 3 — batch gate | `VSX-138` |
| Wave 1 | Story 4 — extract the Create File flow | `VSX-139` |
| Wave 2 | Story 5 — preview batch hooks + index guard | `VSX-140` |
| Wave 2 | Story 6 — destination suggestions | `VSX-141` |
| Wave 2 | Story 7 — multi-index runner 🔒 | `VSX-142` |
| Wave 3 | Story 8 — navigator routing | `VSX-143` |
| Wave 4 | *(docs — exempt, no ticket)* | — |

**Wave commit prefixes:** Wave 0 → `VSX-136`; Wave 1 → `VSX-137 VSX-138 VSX-139`;
Wave 2 → `VSX-140 VSX-141 VSX-142`; Wave 3 → `VSX-143`; Wave 4 → none (docs).

---

## Decisions taken during execution

Orchestrator arbitration, `ESCALATE` resolutions, and any deviation from
`plan.md`. Recorded the moment it happens, not at the end.

| When | Task | Decision | Why |
|------|------|----------|-----|
| 2026-07-24 | T4 (forward) | `preview.ts` landed at **exactly 320/320** after T3, leaving 20 lines for T4's ≤340 budget. T4 is told: the budget **stands**; if the hooks do not fit, push helper bodies into `preview.createFile.ts` (which T4 also owns) rather than raise it. | The budget is the point of D12 — the PR checklist asserts `preview.ts` ends the branch smaller than it started (427). Raising it to fit would undo the task that was run to avoid exactly that. |
| 2026-07-24 | T1 | Orchestrator widened `CONTROL_CHAR_RE` to `[\x00-\x1F\x7F-\x9F]` after the reviewer's APPROVE named C1 controls as passing. | §3.1 says "a NUL or **other** control character"; C1 is a control range. Unexploitable (the value only becomes a Uri segment), so it was a one-character spec-conformance fix, not a re-dispatch. |
| 2026-07-24 | Wave 1+ dispatch | Workers run **sequentially within a wave**, not in parallel. Wave boundaries, task ownership and the review loop are unchanged. | The gate is not concurrency-safe in this repo: `dist/` is one shared output dir (`rm -rf dist` mid-run breaks a sibling) and `.vscode-test.mjs` pins a single `--user-data-dir=/tmp/oa-vsct`, so two extension hosts collide. Parallel authoring with a deferred gate would cost each worker its TDD red→green proof, which is the more valuable half. |

---

## Pre-dispatch review

Revision 1 was reviewed before any dispatch; eight defects (F1–F8) were fixed in
revision 2. See [`plan.md` §12](plan.md) for the finding table. **Do not
reintroduce them** — in particular: the serializer stays untouched (F1), the
runner never imports `preview.ts` (F4), and `preview.ts` must end this branch
smaller than it started (F5).
