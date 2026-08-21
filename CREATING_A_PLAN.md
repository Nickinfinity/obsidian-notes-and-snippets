# CREATING_A_PLAN.md

How a multi-agent feature plan is **written** in this repository. This file is the
**authoring process**; a plan under `docs/plans/` is one **instance** of it.

> ## Read this file to *write* a plan. Never to *run* one.
>
> **An authored plan is self-contained: running it requires reading nothing but the
> plan and its two companions.** That is a hard requirement on every plan this file
> produces (§5.2), not a nicety — an agent told to execute a plan that points back
> here spends its context on 500 lines of authoring guidance about a job already
> finished, and is invited to re-derive decisions the plan has already made and
> recorded.
>
> So: the three role prompt templates in §2 are **copied into the plan** at
> authoring time, along with the gate, the review loop, the commit policy, the
> skills table and the static-analysis rule. The plan carries them in an
> **execution appendix**; this file is the *source* they are copied from, not a
> runtime dependency of the result.
>
> The only agent that reads this file after authoring is one whose task is to
> **edit** it.

> **Authoring never rolls straight into execution.** Writing a plan and running it are two
> separate acts. When a plan is freshly created, **stop** — present it and wait. Do **not**
> dispatch Wave 0, land any code, or run the gate until the user explicitly says to start
> (e.g. "run it", "go", "execute the plan"). This holds even when the plan is complete and
> green-lit by its own definition of done; the definition of done gates *readiness to run*,
> not *permission to run*. The user gives that permission out loud.

> Filename note: requested as `crating_A_PLAN.md`; spelled `CREATING_A_PLAN.md` here to match
> the other root-level caps docs (`CLAUDE.md`, `ARTIFACT_FILE_FORMAT.md`). Rename if
> the literal spelling was intended.

---

## 1. Where plan files live, and why they never merge

```
docs/plans/<feature-slug>/
├── plan.md          # the plan: phases, tasks, contracts, gates
├── progress.md      # the ledger: one row per task, updated as work lands
└── jira-tickets.md  # ready-to-create epic + story specs
```

`docs/` is a **working artifact of one feature branch**. It is not shipped documentation and
it does not belong on `develop` or `main`.

**Rules:**

1. Plan files are created on the feature branch only, never on `develop`/`main`.
2. `git rm -r docs` is the **last commit on the branch before the PR is opened** — the PR
   diff must contain no `docs/` path. Add it to the PR checklist; it is not optional.
3. Anything from the plan worth keeping permanently gets promoted into `CLAUDE.md`,
   `ARTIFACT_FILE_FORMAT.md`, or a JSDoc block **before** the delete commit. If a
   fact only exists in `docs/`, it is lost by design.
4. `.gitignore` is *not* the mechanism — it does not stop already-tracked files from merging.
   The delete commit is the mechanism.

Rationale: plan documents rot faster than code and read as authority when they are actually
stale. `CLAUDE.md`'s standing rule applies — **trust the tree over any plan or ledger.**

---

## 2. Agent topology

Three roles: one **orchestrator** (Opus — senior TypeScript tech lead + project manager), one
**reviewer** (Opus — senior TypeScript tech lead, review only), N **workers** (Sonnet) in
parallel. Full prompt templates for all three are at the end of this section — copy them
verbatim per dispatch and append the plan's instance parameters.

### 2.0 Prompt composition — three blocks, written once each

A dispatch prompt is **A + B + C + instance parameters**, in that order. They are
separate because they change at different rates, and because writing them once
each is what keeps three role prompts from drifting into three half-copies of the
same paragraph.

| Block | Scope | Changes when |
|---|---|---|
| **A — Domain** (§2.1) | this repo; identical in all three roles | the stack changes |
| **B — Discipline** (§2.2) | the craft bar; identical in all three roles | the standard changes |
| **C — Role** (§2.3) | orchestrator · reviewer · worker | the process changes |
| Instance parameters | one plan | every plan |

A prompt that opens with the role and never states the domain yields correct
TypeScript against the wrong platform — the expensive kind of wrong: it compiles,
it passes review on types, and it fails at F5.

### 2.1 Block A — Domain. Verbatim in all three roles.

> **You build VS Code extensions in TypeScript.** You have shipped them, so you know
> this platform fails *silently*: a contribution that renders nothing, a message
> posted into a webview that no longer exists, an asset excluded from the `.vsix`
> behind a green suite. You check `@types/vscode` before assuming a property exists.
>
> Held knowledge, each item having cost someone a day:
>
> - `contributes.*` is read **before activation** — it cannot derive at runtime. It
>   is a static mirror of what the code derives, so it drifts, so it gets a guard
>   test, not a comment.
> - A menu item's label comes **only** from its `contributes.commands` `title`.
>   Overrides in `contributes.menus` are silently ignored.
> - A `when` that is false hides a thing **completely**. All views hidden ⇒ the
>   container leaves the activity bar, taking any `viewsWelcome` with it.
> - Webviews are a trust boundary: CSP + per-render nonce, every interpolation
>   escaped, `localResourceRoots` covering the assets, nothing from `node_modules`
>   (outside those roots *and* outside the package).
> - `acquireVsCodeApi()` — **once per webview**. Concatenated scripts share one call
>   in one IIFE or the second silently kills every handler.
> - `WebviewView` ≠ `WebviewPanel`: resolves lazily on first reveal, **cannot receive
>   messages while hidden** (even with `retainContextWhenHidden`), and hiding it
>   disposes it — so "disposed" ≠ "the user cancelled".
> - `$(codicon)` renders in QuickPick and `TreeItem` labels only. In webview HTML it
>   is literal text; a real icon needs the font shipped as an asset.
> - Disposables have an order: watchers go before the target they post into.
> - `.vscodeignore` decides what ships. Tests run from source and will not notice a
>   missing asset — an excluded stylesheet is an unstyled panel behind a green suite.
> - Content from disk is untrusted — vault files, workspace files, their **names**,
>   the clipboard. Contain paths immediately before the I/O they protect. Hostile
>   input is **rejected, never sanitised**.
> - Some state is unreadable: no terminal-selection API exists, and `activeTerminal`
>   means "has focus *or most recently had*" — never returning to `undefined`. When
>   the platform cannot answer, the **design** changes.
>
> **`as any` against the `vscode` namespace is a defect.** Absent from the stable
> typings ⇒ absent at runtime. This repo already shipped one dead branch built that
> way.

### 2.2 Block B — Discipline. Verbatim in all three roles.

> **Load first, via the Skill tool: `caveman`, `ponytail`, `mastering-typescript`.**
> They do not auto-load in subagents.
>
> - **TDD** — the failing test comes first and fails for the *right reason*. A test
>   that passes against an empty implementation is not a test.
> - **DRY** — one authority per fact. Find the existing helper, table or type before
>   writing a sibling. Extending an authority beats creating one.
> - **KISS / ponytail** — the smallest thing that passes. No interface with one
>   implementation, no config for a constant, no abstraction for a single caller.
> - **Types are the design tool** — narrowed unions over `any`, `satisfies` to keep
>   tables honest, guards over casts, `readonly` where mutation is not the point. An
>   assertion that silences the compiler instead of narrowing is a defect.
> - **Security is never traded away.** The IDE analyser does **no taint analysis**,
>   so on filesystem, subprocess and webview surfaces the manual trace is the only
>   check that exists.
> - **Static analysis** — SonarLint diagnostics arrive on their own after each
>   `Edit`/`Write`, rule-tagged, and are **fixed, not filed**. Never invoke
>   `sonar-analyze`, `mcp__sonarqube__*`, or the `sonar` CLI: no server, no token,
>   they cannot run here.
> - **`CLAUDE.md` binds you** — ESLint gotchas, `.js` import suffixes, file ≤ ~400
>   lines, function ≤ ~50, JSDoc with `@param`/`@returns`/`@example`.
> - **Gate:** `rm -rf dist && npm test && npx tsc --noEmit`. `rm -rf dist` is
>   required — `tsc` leaves orphaned output that inflates the pass count into a
>   phantom green. `vscode`-coupled code is verified by the F5 click-path the task
>   names; "F5 and check it works" is not a test.
> - **Report in `caveman` register**: findings, not narration. Prose is the thing
>   the cap is spent on.
### Orchestrator — owns

- The task graph, wave boundaries, and which tasks may run concurrently.
- **Every edit to a shared file.** Registry tables (`src/types/languages.ts`,
  `src/types/constants.ts`, `src/services/test-envs/env.registry.ts`) are single-writer:
  parallel agents editing the same table produce conflicts that cost more than the
  parallelism saved. The orchestrator lands those rows itself, then fans out.
- The gate run after each wave, and `progress.md`.
- Merging worker output and resolving contradictions between workers.
- **Integration hunks.** A worker's feature usually ends in a one-line wire-up inside a shared
  file (a `register()` call, a table row, an import). Workers deliver their sibling files; the
  orchestrator lands the wire-up at wave close. Two workers "each adding one line" to the same
  file is still a collision.
- **Stub-widening.** When a serial task widens a shared union (`LangId` and every
  `Record<LangId, …>` behind it), that task also lands compiling stubs that preserve the old
  fallback behaviour. Otherwise the tree is red between the widening and the real
  implementations — and parallel successors are forced back into the shared file.

### Worker — owns

- **Disjoint files.** A task that cannot name a file set no other in-flight task touches is
  not ready to dispatch; split it or serialize it.
- Its own tests, written **before** its implementation.
- Running the gate on its own slice before reporting done.
- Answering the reviewer's CHANGES by **fixing, not debating** — disagreement is a one-line
  note the orchestrator arbitrates.

### Reviewer — owns

- The **verdict on every worker task** before it may integrate: `APPROVE`, `CHANGES`
  (numbered, actionable findings), or `ESCALATE`.
- Nothing else. The reviewer **never edits code, never commits, never touches the ledger** —
  it returns findings the orchestrator enforces. A reviewer that fixes things silently
  destroys the audit trail the review exists to create.
- One reviewer instance per **wave**, not per task — continued across the wave's tasks via
  SendMessage so its context (what the sibling tasks did) accumulates. That context is the
  point of a same-wave reviewer: it catches two tasks solving the same problem twice.

### Dispatch mechanics — the models are not a preference, and they are not the default

**The role table above is only true if each dispatch says so explicitly.** A subagent
spawned without a model parameter **inherits the parent's model**, so an Opus
orchestrator that omits it silently runs its whole wave of workers on Opus: the plan
reads `sonnet`, the topology says `sonnet`, and nothing anywhere reports the
substitution. It is invisible in the transcript, in the ledger, and in the diff. Name
the model on **every** spawn.

| Role | Spawn | Notes |
|---|---|---|
| Worker | `Agent({ subagent_type: "general-purpose", model: "sonnet", run_in_background: true, description: "<T-id> <short title>", prompt: <worker template + task block verbatim + instance parameters> })` | One call per task, all of a wave's calls issued in a **single message** so they run in parallel. Backgrounded, so the user can interject while the wave runs. |
| Reviewer | `Agent({ subagent_type: "general-purpose", model: "opus", description: "review <wave>", prompt: <reviewer template + first task block + worker report + diff> })`, then **`SendMessage`** to that same agent for every later task in the wave | One reviewer per wave. A second `Agent` call starts a cold reviewer and throws away the sibling-task context that is the whole reason the reviewer is per-wave. |
| Orchestrator | the session itself | It implements only orchestrator-tagged rows and integration hunks — never a worker's task, and never "just this small one" because a worker is slow. |

**`subagent_type: "fork"` is forbidden for workers.** A fork *always* inherits the
parent model and ignores the `model` parameter entirely, which is precisely the silent
Opus-substitution above with no way to override it.

**Skills do not inherit.** Each subagent starts cold, so the plan's mandatory-skills row
(§3) is repeated inside every worker and reviewer prompt — a worker that was never told
to load `ponytail` will over-build, and the reviewer will correctly reject work the
dispatch caused.

**The instance parameters travel with the prompt, not with the session.** Repo path,
branch, gate command, forbidden files, shared files, and the report cap go into every
worker prompt verbatim. A worker that does not know the gate command will invent one.

### Wave discipline — the review loop

1. Orchestrator does its own rows and integration hunks, then dispatches every worker task in
   the wave in parallel.
2. As each worker reports, the orchestrator passes task block + worker report + diff to the
   reviewer.
3. `CHANGES` → findings go back to the **same** worker (SendMessage — context intact), worker
   fixes, reviewer re-checks. **Maximum 2 rounds per task**; a third failure is `ESCALATE` and
   the orchestrator resolves it itself — fix directly, or revert the slice and re-dispatch
   fresh — recording which in the decisions table.
4. All tasks `APPROVE` → orchestrator integrates hunks → gate on the integrated tree →
   **commit → push the feature branch** → ledger (statuses, counts, review rounds) → next wave.
5. Never dispatch a wave whose inputs a still-running wave is producing. A red gate stops all
   dispatch.

**Commit and push policy (every wave):**

- The orchestrator commits **once per wave**, after the integrated gate is green; workers never
  commit.
- **The affected ticket id(s) begin the commit subject** — every story/epic key the wave
  touched, before anything else, then the conventional-commit summary. Example:
  `VSX-130 VSX-131 feat(templates): Wave 1 — pure domain`. When keys do not exist yet (Jira
  connector unauthorized, §8), use the `<KEY>` placeholder in the same position and backfill the
  real keys into the messages once created — never fabricate a key.
- **Push the feature branch after each wave's commit**, so the remote always reflects the last
  green wave and review can follow along. A red gate stops the wave before its commit — nothing
  half-gated is ever pushed.

### 2.3 Block C — Role. One per role; append to A + B.

Then append the plan's instance parameters (repo, branch, gate, forbidden files,
shared files, caps) and — for a worker — its task block verbatim.

**Orchestrator (Opus) — the session itself:**

> You are the ORCHESTRATOR: tech lead and PM for this plan. You direct. You implement
> **only** orchestrator-tagged rows and integration hunks — never a worker's task, not
> even a small one because a worker is slow.
>
> - **Architecture** — hold the plan's decisions against drift. Land every shared-file
>   wire-up yourself at wave close. Arbitrate worker↔reviewer disagreements; your call
>   is final and goes in the decisions table.
> - **Security is yours to guarantee, not delegate.** The plan marks the tasks 🔒; name
>   that surface in the reviewer's dispatch, and never merge one on a worker's
>   self-report.
> - **Ledger is yours alone** — statuses, gate log with test counts, review rounds,
>   ticket keys, deviations logged the moment they happen.
> - **Commit once per wave** after the integrated gate is green, ticket id(s) leading
>   the subject, then **push**. Workers never commit. A red gate stops all dispatch.
> - **Stop and ask** at every human gate, and never start a freshly authored plan
>   until the user says to.
> - **Dispatch** — worker: `Agent({subagent_type:"general-purpose", model:"sonnet",
>   run_in_background:true})`, a whole wave's spawns in **one message**. Reviewer:
>   `Agent({… model:"opus"})` once per wave, continued via `SendMessage` — never a
>   fresh call. **Name `model` every time**; omitted, it inherits yours, and
>   `subagent_type:"fork"` ignores it outright. Either way the wave silently runs on
>   the wrong model and nothing reports it.
> - Hold every worker to its `Owns` list. Scope creep is rejected, not merged.

**Reviewer (Opus) — one per wave:**

> You are the REVIEWER. You return a verdict; you never edit code, never commit,
> never touch the ledger. Most defects hide in what a diff *doesn't* do — the missing
> guard, the untested branch, the unescaped value.
>
> Order, cheapest rejection first — **except security, always completed**, and
> reported in the same verdict even when an earlier check already failed:
> 1. **Contract** — only `Owns` touched; forbidden files and golden tests untouched.
>    Violation = instant `CHANGES`.
> 2. **TDD** — a test that fails without the change, asserting something real. Not
>    `length === 8`, which eight wrong entries also satisfy.
> 3. **Types** — no `any`, no unchecked casts, `vscode` types at the edges only.
> 4. **Over-engineering** — speculative abstraction, a reinvented `utils/` helper,
>    files over the size limits. Flag for deletion, not discussion.
> 5. **Security — unwaivable.** Trace each untrusted value to its sink: paths
>    contained immediately before the write, webview values escaped with CSP/nonce
>    intact, parses guarded, rejection never softened into sanitisation. Name any
>    widened surface even when you approve.
> 6. **Static-analysis findings** — fixed, not filed.
>
> Plus every standing finding the plan lists — each an instant `CHANGES`.
>
> Verdict, ≤ 20 lines:
> `APPROVE` — one line why, plus the attack-surface note when 5 applies.
> `CHANGES` — numbered, each `file:line — problem → required fix`. "Improve error
> handling" is not a finding. Prefix security ones `SEC:`; they are fixed first.
> `ESCALATE` — only after round 2 failed; one line on what is stuck. An open `SEC:`
> always escalates rather than expiring on the cap.

**Worker (Sonnet) — one per task:**

> You are a WORKER implementing **one** task. You write the failing test before the
> fix without being reminded, and your diffs are small because you looked for the
> existing helper first.
>
> Order of work: design the types → write the failing test, see it **red** → smallest
> implementation that turns it green → fix the IDE's diagnostics on your diff → gate
> your slice → report.
>
> **Verify every API and signature the task names against the real tree before
> building on it.** The task's `Signatures` block quotes what was there at authoring
> time; confirm it. **If a `Test first` assertion will not compile, that is a plan
> bug** — report it in one line and stop. Never write a shim, a cast, or a wrapper
> whose only job is to make the plan's sentence true.
>
> **Hard limits:** touch only `Owns`. Never the forbidden files, never anything under
> `Not this task` — those are the orchestrator's. Do not commit. Do not edit the
> ledger or the ticket file; report a divergence in one line. Answer `CHANGES` by
> fixing, not debating — `SEC:` first — pushing back only as a one-line note.
>
> **Report, ≤ 15 lines, in this order:** (1) the `Test first` assertion quoted, and
> that you saw it red; (2) files written — exactly `Owns`; (3) gate result with test
> count before → after; (4) plan bugs found, one line each, unfixed; (5) anything in
> `Not this task` you left. Nothing else.

---

## 3. Mandatory skills

Every agent — orchestrator, reviewer, and worker — loads these. Not optional, not
situational. They do **not** auto-load in subagents: each role template in §2 begins with the
explicit Skill-tool invocations, and a dispatch prompt missing them is a bug in the dispatch.

| Skill | Role |
|---|---|
| `caveman` | Output compression. Terse reports and verdicts, full technical substance. Applies to agent-to-orchestrator traffic, **not** to code, commits, or PR bodies. |
| `ponytail` | Solution sizing. Climb the ladder — does it need to exist, is it already here, does stdlib cover it — before writing anything. Shortest working diff. The reviewer applies the same lens destructively: flag speculative abstraction for deletion. |
| `mastering-typescript` | Writing **and** reviewing TS. Type-level correctness, `satisfies`, discriminated unions over `any`, no unchecked casts. Workers consult it before designing a type; the reviewer consults it again when judging one. |

**Order of operations inside a task:** `mastering-typescript` (design the types) → TDD (write
the failing test) → `ponytail` (write the smallest thing that passes) → fix what the static
analyser reports (§3.1) → gate → `caveman` (report).

### 3.1 Static analysis — the IDE extension is the gate, not `sonar-analyze`

**The Sonar pass in this repo runs through the *SonarQube for IDE* (SonarLint) VS Code
extension.** Its findings arrive automatically as `<ide_diagnostics>` after every `Edit`/`Write`
— for the orchestrator, the workers, and the reviewer alike — and they are rule-tagged
(`typescript:S3776`, `typescript:S8786`). **Findings are fixed, not filed.** No agent needs to
invoke anything to get them; they simply arrive.

**Do not invoke or install `sonar-analyze`, `mcp__sonarqube__*`, or the `sonar` CLI.** They
require either a running SonarQube server or a bound Cloud organisation, and this checkout has
neither configured — no `sonar-project.properties`, no CI, no token. A plan that gates a task on
`sonar-analyze` is specifying a check this repo cannot currently run.

This is a **project decision, not a licensing limit**: the repo is public, so SonarQube Cloud's
free tier is available if someone chooses to wire it up. Until that exists in CI, the IDE
extension is the gate. If Cloud is ever bound, this section is what gets revised — add it as a
required status check on `main`/`develop` first, then relax the prohibition above.

**The ceiling, and it is load-bearing.** Standalone IDE analysis runs *local* rules only. It does
**not** perform taint analysis, so it will never find an injection or a path-traversal defect.
Those surfaces are held by two things and nothing else:

1. **Construction** — user data reaches a subprocess as argv elements via `execFile`, never as a
   command string; every user-influenced path is normalised and containment-asserted before any
   write; every webview interpolation goes through `escHtml`; every parse is guarded.
2. **The reviewer's manual §2 security trace** — which, absent taint analysis, is the *only*
   line of defence on those surfaces. Weight it accordingly: it is not a second opinion, it is
   the check.

This is why §4's security marking matters more here than it would in a repo with a full analyser
behind it.

**If the extension is absent** — diagnostics stop arriving — the gate degrades to `pnpm lint` +
`npx tsc --noEmit` + the reviewer's manual pass. That degradation is **recorded in the ledger**,
never skipped silently.

---

## 4. Methodology the plan must encode

Inherited from `CLAUDE.md` — **TDD, CUPID, DDD, in that order** — plus:

- **DRY.** One authority per cross-cutting concern. Before a plan proposes a new table, it
  must state which existing table (`LANGUAGES`, `TEST_TYPES`, the env registry, `PRACTICE_OPTIONS`)
  it extends instead. A plan that adds a parallel list is rejected at review.
- **KISS / YAGNI.** No interface with one implementation, no factory for one product, no
  config for a value that never changes. Speculative extension points are cut from the plan,
  not deferred inside it.
- **TDD.** Every task on a `vscode`-free unit names its test file and its first failing
  assertion **in the plan**, before an agent is dispatched. `vscode`-coupled work names its
  F5 manual-pass steps instead.
- **DDD.** New concepts get a named type in `src/types/` before behaviour exists. The domain
  model stays `vscode`-free.
- **Behaviour-preserving refactors need a golden net first** — byte-exact snapshots captured
  before editing, never touched during it.
- **Security is a standing gate, not a review item.** The threat model is inherited from
  `CLAUDE.md` and every plan restates it: artifact `.md` files, their test JSON, and solution
  buffers are **untrusted input**; user data reaches subprocesses as file contents or argv
  arrays (`execFile`), never command strings; user-influenced paths are normalised and
  containment-asserted before any write; every webview interpolation goes through `escHtml`;
  every parse is guarded. The plan must **mark each task that touches one of these surfaces
  as security-critical** — that marking is what tells the orchestrator to name the surface in
  the reviewer dispatch, tells the worker to include hostile-input tests, and tells the
  reviewer its §5 check is the reason this task exists. A security finding is fixed before
  any other finding and never expires on a round cap.

---

## 5. Task specification format

A task is dispatchable only when every field below is filled. Missing fields are the single
largest cause of a worker producing the wrong thing.

```markdown
### T<n> — <imperative title>

- **Owns:**      <exact file paths this task may write; must be disjoint from its wave>
- **Reads:**     <files it needs but must not modify>
- **Depends on:** <task ids, or `none`>
- **Test first:** <test file + the first assertion that must fail>
- **Done when:**  <observable condition — a passing assertion, not "implemented">
- **Gate:**       <the gate command, plus any extra check>

Optional, and required whenever the task touches existing code:

- **Signatures:** <the exact real signatures the task calls, copied from the tree with file:line>
- **Not this task:** <the adjacent thing a reasonable worker would also do, and who owns it instead>
- **Report:**     <what the worker hands back beyond "done">
```

**Sizing:** one task ≈ one file plus its test. A task that lists four owned files is two
tasks. A task nobody can verify from `Done when` alone is under-specified.

**Write the task for a cold reader.** The worker is a fresh Sonnet subagent (§2) with no
memory of the plan's authoring, no idea which of the repo's five path-checking functions is
the sanctioned one, and no way to know that the helper the task names sits behind a
differently-shaped signature than the task implies. Three fields exist for exactly that gap:

- **`Signatures`** — paste the real declaration, with `file:line`, for every existing
  function the task will call. This is the field that pays for itself: a plan reviewed
  against the tree here found five task descriptions naming functions with the wrong arity,
  a frontmatter field absent from the model, a tally field that did not exist, and a
  `vscode` API that was never in the stable typings. Each would have become a worker
  inventing a shim to make the plan's stated assertion true.
- **`Not this task`** — name the adjacent work and its real owner (usually an orchestrator
  row at wave close). Without it, a conscientious worker wires its own feature into the
  shared router and collides with the wave.
- **`Report`** — say what comes back: the failing-then-passing assertion, the gate's test
  count, any plan bug found. A worker report capped at N lines with no shape spends those
  lines on prose.

**A `Test first` assertion is a claim about the tree, and it must be checked before the plan
ships.** Open the file, read the signature, confirm the field name. An assertion that cannot
compile is not a red test — it is a worker's first hour spent debugging the plan.

**Reject a tautological `Test first`.** `assert.ok(fn(x).includes(y))` where `fn` echoes `x`
passes against an empty implementation; `assert.strictEqual(list.length, 8)` passes for eight
wrong entries. The assertion must fail for the reason the task exists, and it must be
possible to state what would make it fail later.

**Disjointness counts every file** — test files and `package.json` included. Two same-wave
tasks appending cases to one shared test file collide exactly like two tasks editing one
service; give each concern its own test file (the repo's `function-env-<lang>.test.ts`
pattern). And **no task may depend on a task in its own wave** — a same-wave dependency is a
sequencing bug, not a scheduling detail.

**The plan is the single entry point.** It must open by naming its companion files
(`progress.md`, `jira-tickets.md`) and declaring itself the authority they derive from, and it
must contain an **orchestrator protocol section** — read order, per-wave review loop, commit
policy (orchestrator commits per wave; workers never commit), red-gate stop rule, human-gate
stop-and-ask points — plus the **instance parameters** (repo path, branch, gate command,
forbidden files, report caps).

### 5.2 Self-containment — the plan carries its own execution appendix

**An orchestrator handed the plan must need nothing else. Not this file, not any
other.** The plan therefore ends with an **execution appendix** carrying, in full:

| The appendix carries | Copied from |
|---|---|
| the three role prompt templates, verbatim and tailored | §2 |
| the dispatch mechanics — `Agent` shapes, `model` on every spawn, `fork` forbidden, one message per wave, reviewer continued via `SendMessage` | §2 |
| the gate command, and why `rm -rf dist` is required | §6 |
| the per-wave review loop, the 2-round cap, `ESCALATE`, the red-gate stop | §2 |
| the commit-and-push policy, with the ticket-id subject rule | §2 |
| the **domain persona block**, opening every role prompt | §2.1 |
| the mandatory-skills table | §3 |
| the static-analysis rule, including the "no taint analysis" consequence | §3.1 |

**The plan's read order must not include this file.** State that explicitly in the
plan, with the reason — otherwise an executing agent finds the reference, follows
it, and the self-containment is decorative.

**On the drift this replaces.** The previous rule was the opposite: templates lived
only here, and a plan that copied them "creates a second authority to drift". The
copy *is* a second authority — deliberately. Each plan's appendix is the authority
for **that plan's run**, and it is allowed to differ, because a plan tailors its
templates (its own standing reviewer findings, its own forbidden files). Improvements
flow one way: a lesson learned during a run is promoted **back into this file** by
the plan's docs task, so the next plan starts from it. What is *not* acceptable is
the cost the old rule imposed — every executing agent reading the whole authoring
process to find three prompts.

---

## 6. The gate

Every wave ends with the repo gate:

```bash
rm -rf dist && npm test && npx tsc --noEmit
```

`npm test` runs compile + lint + the full suite. The macOS 103-char unix-socket
limit no longer bites: `.vscode-test.mjs` pins `--user-data-dir=/tmp/oa-vsct`,
which keeps the VS Code IPC socket path short. (The old workaround — a direct
`mocha` invocation because `pnpm test` supposedly could not run — was stale and
has been removed.)

`rm -rf dist` is **required**, not hygiene: `tsc` does not delete orphaned
`dist/*.js`, so a renamed or deleted test keeps running from stale output and
inflates the pass count.

`npx tsc --noEmit` is the type-truth — IDE diagnostics go stale.

`vscode`-coupled code is verified by the **F5 manual pass** only. The plan lists the exact
click-path per phase; "F5 and check it works" is not a test.

---

## 7. Progress tracking

`progress.md` is the single ledger. One row per task, updated **by the orchestrator** as each
worker reports — a worker never edits the ledger, or two workers race on it.

```markdown
| Task | Owner | Status | Test count | Gate | Notes |
|------|-------|--------|-----------|------|-------|
| T1   | wave-1 | done   | 509 → 517 | pass | — |
| T2   | wave-1 | wip    | —         | —    | blocked on T1 registry row |
```

Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with the reason).

**Record the test count on every gate run.** A silent drop means a test was deleted; per
`CLAUDE.md` that is allowed only loudly, with the relocated assertion named in the commit.

---

## 8. Jira

Each phase is an **epic**; each task or task cluster is a **story** under it. Ticket specs are
written into `jira-tickets.md` in creation order with: summary, description, acceptance
criteria, parent link, and estimate.

When the Atlassian connector is not authorized, the markdown file **is** the deliverable —
tickets get created in one pass afterwards. Do not block plan authoring on connector auth,
and never fabricate ticket keys; leave `<KEY>` placeholders and fill them after creation.

**Documentation-only changes need no ticket.** Editing `CLAUDE.md`, `CREATING_A_PLAN.md`,
`ARTIFACT_FILE_FORMAT.md`, `CHANGELOG.md`, a `README`, a `docs/` file, or any other prose/docs
file is exempt from the epic/story requirement **and** from the ticket-id commit prefix —
commit these with a plain `docs(...)` subject and no `<KEY>`. Tickets track feature work (code
and its tests), not documentation upkeep. A change that touches both code and docs is feature
work and takes the ticket id; a change that touches only docs does not.

**The PR references the tickets.** Every `plan.md` must specify — in its PR checklist — that the
pull request description lists the affected Jira tickets: the epic and every story the branch
delivered. This is what links the merged PR back to the tracker after the `docs/` deletion
removes `jira-tickets.md`. Use the real keys once created; a `<KEY>` placeholder is a blocker to
merge, not an acceptable final state (the tickets must exist before the PR opens).

---

## 9. Definition of done for a plan

Before any agent is dispatched, the plan must satisfy:

- [ ] Every phase names the **existing** authority it extends, not a new parallel one.
- [ ] Every task has all six fields from §5.
- [ ] Every wave's tasks own disjoint file sets — **test files and `package.json` included**.
- [ ] No task depends on a task in its own wave.
- [ ] The plan names its companion files, declares itself their authority, and contains the
      orchestrator protocol + the instance parameters (repo path, branch, gate, forbidden
      files, report caps).
- [ ] **The plan is self-contained (§5.2)** — it ends with an execution appendix carrying the
      **domain persona block (§2.1)**, the three role templates verbatim, the dispatch
      mechanics, the gate, the review loop, the commit policy, the skills table and the
      static-analysis rule. Every role prompt opens with the domain block, then its role
      layer, then the plan's instance parameters (§2.0). **Its read order does not
      include this file**, and it says so, with the reason. Verify by asking: could an
      orchestrator that has never seen `CREATING_A_PLAN.md` run this? If not, the appendix is
      short something.
- [ ] Shared-file wire-ups (registrations, table rows) are listed as orchestrator integration
      hunks in the wave table, not inside worker tasks.
- [ ] Every task touching untrusted input (artifact `.md`, test JSON, solution buffer,
      subprocess argv, user-influenced paths, webview interpolation) is **marked
      security-critical** and its Test-first field includes a hostile input. Its Gate names the
      **reviewer's manual security trace** — not `sonar-analyze`, which this repo cannot run
      (§3.1), and which would not catch taint defects even if it could.
- [ ] Shared-file (registry/table) edits are assigned to the orchestrator, not a worker.
- [ ] Every `vscode`-free task names a test file and a first failing assertion.
- [ ] Every `vscode`-coupled task names its F5 click-path.
- [ ] Deliberate simplifications carry a `ponytail:` comment naming the ceiling and the
      upgrade path.
- [ ] Any `.md` artifact format change updates `ARTIFACT_FILE_FORMAT.md` **in the
      same change** — the parser wins when doc and parser disagree, so the doc is the bug.
- [ ] `progress.md` exists with every task at `todo`.
- [ ] Per-wave commit **and push** is encoded: the orchestrator commits once per wave with the
      affected ticket id(s) leading the subject (`<KEY>` until keys exist), then pushes the
      feature branch. Docs-only changes are exempt from the ticket prefix (§8).
- [ ] The plan is **not executed on creation** — authoring stops and waits for the user's
      explicit go-ahead (standing rule at the top of this file).
- [ ] The plan's PR checklist requires the **PR description to list the affected Jira tickets**
      (the epic and its stories) — see §8.
- [ ] The PR checklist ends with `git rm -r docs`.
