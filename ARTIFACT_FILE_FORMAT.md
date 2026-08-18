# Artifact `.md` File Format — Authoritative Spec

This file is the **single source of truth** for the on-disk structure of every
vault artifact `.md` file and how it varies per artifact type. The parser
(`src/services/parser.service.ts`) reads this format; any serializer/writer must
produce exactly this format so that `parse(serialize(x))` round-trips.

> When writing vault `.md` files, test fixtures, or a serializer, this file —
> not memory — defines the contract. If parser behaviour and this doc disagree,
> that is a bug in one of them; reconcile, do not guess.

> Examples below use `~~~` as the outer fence purely so the inner ` ``` `
> markdown fences render literally. In a real `.md` file every fence is a
> standard triple-backtick.

---

## 1. Canonical single-block structure

~~~md
---
type: snippet | template | command | agent | variables
title: Human-readable title
description: Short explanation
language: javascript
tags: [tag1, tag2]
---

```code
// Code content — <VK-xxx> tokens are replaced at insert time
const x = <VK-variableName>;
```

vars:
VK-variableName=defaultValue
VK-anotherVar=
~~~

- **Frontmatter** — YAML between `---` fences. Recognised keys: `type` (required;
  unknown value falls back to `snippet`), `title`, `description`, `language`,
  `tags` (inline array `[a, b]`), `env`, `target`.
- **Blank line after frontmatter is optional.** The code fence may sit on the
  very next line after the closing `---` (real files do this), or be separated
  by one or more blank lines. A serializer may emit either; round-trip is
  unaffected.
- **Code block** — first fenced block after frontmatter. Info string may be
  `code`, a real language (`javascript`), or **empty** (plain text). Trailing
  whitespace is trimmed on parse — a serializer must trim too for round-trip.
- **Vars (defaults)** — optional. Accepted forms, parser priority order:
  1. A ` ```vks ` fenced block (preferred, unambiguous). May be preceded by a
     decorative label line — `vars:`, `vars`, `### VKs:`, prose, blank lines.
     The label is **ignored**; the ` ```vks ` fence is what binds. (Real files
     write `vars:` then a ` ```vks ` fence — this is the fenced form, not the
     legacy form.)
  2. A legacy unfenced `vars:` / `vars` label followed directly by bare
     `KEY=value` lines (no fence), placed after the code block.
  Keys use the full `VK-` prefix. Empty value (`VK-x=`) is valid → default `''`.
  Lines starting with `#` are treated as comments and skipped. Vars not listed
  are still auto-detected from `<VK-xxx>` tokens in the code.
- **Default values are literal.** Only leading/trailing whitespace of the
  `KEY=value` line is trimmed. Quotes are **not** stripped — `VK-value="active"`
  yields the default `"active"` (quotes included), because the author wants a
  quoted string literal in the emitted code. A serializer emits the stored
  value verbatim — never auto-quote, auto-strip, or escape it.

**A serializer should always emit the ` ```vks ` fenced form, never the legacy
unfenced `vars:` form. Emitting a `vars:` label line immediately before the
` ```vks ` fence is allowed (matches real files) and parses identically.**

### 1.1 Serializer rules — single-block

- **Canonical frontmatter key order:** `type`, `title`, `description`,
  `language`, `tags`, `env`, `target`. Keys with empty/undefined values are
  omitted (except `type`, always emitted). Reserved keys (`env`, `target`) sit
  at the end so future additions append cleanly.
- **Language is emitted in both frontmatter and the code fence info-string**
  for single-block files. The parser hoists fence → frontmatter when the
  frontmatter key is missing (`parser.service.ts` line 346); emitting both is
  the deterministic round-trip shape.
- **Plain text** (resolved `language === ''`): emit a bare ` ``` ` fence with
  empty info string AND **omit the `language` key entirely** from frontmatter.
  Do not emit `language: ` (empty value).
- **Single-line YAML enforcement** for `title`, `description`, and each
  `tags[i]`: the parser slices on the first `:` per line, so a literal newline
  in any of these values corrupts the frontmatter on re-parse. The serializer
  MUST strip `\r\n` / `\r` / `\n` (replace with single space) from `title`
  and `description`, then collapse runs of spaces. Tag entries MUST reject
  `,`, `]`, `\n`, `\r` (filtered at input; serializer asserts as last line of
  defence). `env` and `target` follow the same single-line rule.

---

## 2. Multi-block structure

A file with two or more `## ` (h2) headings, each followed by a fenced code
block, is a **multi-block file**. The picker shows blocks as a sub-list.

**File-level vs per-block description coexist.** The frontmatter `description:`
key is the **file-level description** and applies to the whole artifact. Each
section's text line between `## Heading` and the code fence is the
**per-block description** for that block. Both may be present at the same
time, and either may be empty.

- Sections split on `## ` (h2) **only** — `###`+ markers stay inside a block, so
  a serializer must never emit `## ` inside code.
- Each section may carry its own defaults via a ` ```vks ` fence placed
  **anywhere after** its code fence. Keys use the full `VK-` prefix.
- Any non-code text between the code fence and the ` ```vks ` fence (blank
  lines, an `### VKs:` marker, prose) is ignored; the ` ```vks ` fence still
  binds to that section's code.
- Per-block vars = tokens auto-detected from the block code, with matching
  ` ```vks ` defaults overlaid (code order preserved; vks-only keys appended).
- The conventional real-file layout per section is: `## Heading`, a one-line
  description, the code fence, a blank line, a decorative `### VKs:` marker, a
  blank line, then the ` ```vks ` fence. The marker and blank lines are ignored;
  only the code fence and the binding ` ```vks ` fence matter. Literal-value and
  optional-blank-line rules from §1 apply identically here.

### 2.1 Serializer rules — multi-block

- **No top-level code fence or top-level ` ```vks ` fence before the first
  `## ` heading.** The parser runs `parseCodeBlock` and `parseVars`
  unconditionally — even on multi-block files. If the serializer emits a
  top-level fence between frontmatter and the first heading, on re-parse the
  first block's code or vars would be hoisted as top-level `code` / `vars`,
  causing round-trip drift. Multi-block content starts directly with `## `.
- **No `language:` key in frontmatter** for multi-block files. Language lives
  on each block's fence info-string only.
- **Per-block layout:** `## <heading>`, optional one-line description, blank
  line, ` ```<lang>\n<code>\n``` `, optional per-block ` ```vks ` fence (same
  emit-when rule as §5 — only when at least one var has a non-empty default).

~~~md
---
type: snippet
title: API URLs
---

## Development
Local dev server.
```bash
http://localhost:<VK-PORT>
```

### VKs:

```vks
VK-PORT=3000
```

## Production
```bash
https://api.example.com
```
~~~

---

## 3. `type: variables` files

The content uses a ` ```vks ` block instead of a ` ```code ` block. Used both
for environment variable files and for **Variable Sets**.

~~~md
---
type: variables
env: dev
---

```vks
API_URL=http://localhost:3000
DB_URL=mongodb://localhost:27017
```
~~~

- Single-block variable file: one ` ```vks ` fence — its top-level vars are the
  whole set.
- Multi-block variable file: `## Heading` + ` ```vks ` blocks. Each heading is
  an independent sub-set with its own vars.

---

## 4. Variable syntax — `<VK-xxx>`

`<VK-xxx>` is the placeholder syntax for vault artifact variables.

- **`VK-`** is a fixed prefix. The hint after the hyphen can be any casing:
  `camelCase`, `UPPER_SNAKE`, `PascalCase`, `lowercase`.
- **Regex:** `/<VK-([A-Za-z][A-Za-z0-9_]*)>/g` — hint must start with a letter;
  subsequent characters may be letters, digits, or underscores.
- **Collision-free by design** — does not conflict with JS/TS generics or JSX,
  HTML tags, CSS, Vue (`v-` prefix differs), Python, Shell, Jinja, Handlebars
  (`{{}}` differs), or Markdown rendering.
- **Token = variable name** — the full token including the `VK-` prefix is the
  variable name used for deduplication and substitution. `<VK-host>` →
  `name: 'VK-host'`.
- **Auto-detected from code** — `extractVars(code)` scans any code block for
  tokens automatically. A vars section is only needed to supply non-empty
  default values; its keys must also use the `VK-` prefix (e.g.
  `VK-host=localhost`).
- **Block-scoped in multi-block files** — each block's vars are extracted
  independently. The same token in two blocks produces a separate var in each.

> **Rule:** Always use `<VK-xxx>` syntax. Never use `{{xxx}}`.

---

## 5. Per-artifact variations

`type` is set from the chosen artifact; the destination directory comes from
`ARTIFACTS` in `src/types/constants.ts`.

| `type` | Vault dir | `language` field | Code fence | Defaults | Multi-block | Notes |
|---|---|---|---|---|---|---|
| `snippet` | `Snippets` | yes (or plain text) | language or empty | ` ```vks ` | yes | Editor insert. |
| `template` | `Templates` | yes (or plain text) | language or empty | ` ```vks ` | yes | Editor/explorer insert. Future: multi-file. |
| `command` | `Commands` | yes — **locked to `bash`** | `bash` (locked by serializer) | ` ```vks ` | yes | Terminal insert. |
| `agent` | `AgentsConf` | optional | language or empty | ` ```vks ` | yes | `target:` names the destination file (e.g. `CLAUDE.md`). Future: multi-file folder + marker. |
| `variables` | `Variables` | n/a | ` ```vks ` only | the block itself | yes (sub-sets) | `env:` labels the environment. Variable Sets live here. |

Rules a serializer enforces:

- **Single-block:** `language` allowed in frontmatter. Multi-block: no top-level
  `language` — language lives on each block's fence.
- **`command`:** no `language` selector in the create UI. The type is treated
  as **locked to `bash`** (`form.language.mode === 'locked'`,
  `form.language.default === 'bash'` in `constants.ts`). The serializer emits
  `language: bash` in single-block frontmatter and `bash` on every block fence
  info-string, deterministically — the UI never lets the user override it. A
  legacy authored `.md` whose fence carries `sh` or is empty still parses; the
  serializer normalises to `bash` on next write. Multi-block command files
  follow the §2.1 rule (no top-level `language`) but every block fence is
  still `bash`.
- **Plain text (any type):** emit a bare ` ``` ` fence (empty info string). The
  parser's `CODE_FENCE_RE` (`/```(\w*)\r?\n.../`) matches it because `\w*`
  allows zero characters.
- **`tags`:** emit `tags: [a, b]`; omit the key entirely when there are no tags.
- **vks fence:** emit only when at least one var has a non-empty default value.

---

## 6. Variable Sets — storage shape

(Behaviour — scoring, apply/stacking/save-as flow, module map — stays in
`CLAUDE.md`. Only the on-disk shape lives here.)

- Variable set files live in the vault's `Variables/` directory with
  `type: variables` frontmatter.
- A single-block variable file uses one ` ```vks ` fence — its top-level vars
  are the whole set.
- A multi-block variable file uses `## Heading` + ` ```vks ` blocks. Each
  heading is an independent sub-set with its own vars.
