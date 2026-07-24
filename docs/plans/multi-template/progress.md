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
| T1 — Index domain service 🔒 | 1 | worker | todo | — | — | 0 | **security-critical** — `safeRelPath` is the single rejection authority |
| T2 — `BatchGate` | 1 | worker | todo | — | — | 0 | pure promise gate, `vscode` type-only |
| T3 — Extract Create File flow (D12) | 1 | worker | todo | — | — | 0 | **pure refactor** — feature code in this diff is a rejection |
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
| — | — | — | — |

---

## Pre-dispatch review

Revision 1 was reviewed before any dispatch; eight defects (F1–F8) were fixed in
revision 2. See [`plan.md` §12](plan.md) for the finding table. **Do not
reintroduce them** — in particular: the serializer stays untouched (F1), the
runner never imports `preview.ts` (F4), and `preview.ts` must end this branch
smaller than it started (F5).
