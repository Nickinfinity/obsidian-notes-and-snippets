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
  `extension` (template-only, §5.1), `provider` / `model` / `version` (agent-only,
  §5.2), `tags` (inline array `[a, b]`), `env`, `target`.
- **Blank line after frontmatter is optional.** The code fence may sit on the
  very next line after the closing `---` (real files do this), or be separated
  by one or more blank lines. A serializer may emit either; round-trip is
  unaffected.
- **Code block** — first fenced block after frontmatter. Info string may be
  `code`, a real language (`javascript`), or **empty** (plain text). Trailing
  whitespace is trimmed on parse — a serializer must trim too for round-trip.
  **A file may delimit its payload with flags instead of a fence** (§7) — for
  artifacts whose content is markdown, such as agent configs.
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
  `language`, `extension`, `provider`, `model`, `version`, `tags`, `env`,
  `target` (the serializer's `FRONTMATTER_KEY_ORDER`). Keys with empty/undefined
  values are omitted (except `type`, always emitted). The type-specific keys
  (`extension` = template, `provider`/`model`/`version` = agent) group after
  `language`; reserved keys (`env`, `target`) sit at the end so future additions
  append cleanly.
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
- **Regex:** `/<\/?VK-([A-Za-z][A-Za-z0-9_]*)>/g` — hint must start with a letter;
  subsequent characters may be letters, digits, or underscores.
- **Closing form — `</VK-xxx>` is the same variable.** Both spellings detect,
  deduplicate, score, and substitute identically; one input, one var-set entry.
  See §4.1 for why it exists and how a pair resolves.
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

### 4.1 The closing form — `</VK-xxx>`

`<VK-repo>` is a **legal HTML open tag name** (CommonMark tag names allow
letters, digits and hyphens — but not underscores). Inside a ` ``` ` fence that
is harmless, but a **flagged payload (§7) is real markdown**: Obsidian parses the
token as an unclosed custom element and every block after it — the rest of the
prose, the ` ```vks ` fence — becomes its child instead of a top-level block, so
the note stops rendering correctly.

Closing the tag leaves nothing open. Both render-safe spellings are supported:

| Spelling | Renders in Obsidian | Resolves to |
|---|---|---|
| `<VK-repo>` | ✗ swallows the rest of the note | value |
| `<VK-repo></VK-repo>` | ✓ empty element, nothing left open | value **once** |
| `</VK-repo>` | ✓ stray end tag, ignored by the parser | value |
| `<VK-repo_name>` | ✓ `_` is illegal in a tag name → literal text | value |

- **Substitution is two-pass** (`resolveVars`): an **adjacent** `<VK-x></VK-x>`
  pair collapses to the value *once*, then every remaining opening or closing tag
  resolves individually. `<VK-a></VK-b>` is not a pair — it is two tokens.
  `<VK-x> text </VK-x>` is also two tokens (not adjacent), each substituted.
- **Detection deduplicates across forms** — `<VK-x>` and `</VK-x>` in one file
  yield a single `VK-x` variable, one preview input, one var-set match.
- **Unknown variables stay literal** in both spellings, so partial substitution
  is still safe.
- The webview code area highlights both forms; its `vkWrap` twin is bound to
  `VK_TOKEN_RE` by `test/vk-closing-tag.test.ts`.

---

## 5. Per-artifact variations

`type` is set from the chosen artifact; the destination directory comes from
`ARTIFACTS` in `src/types/constants.ts`.

| `type` | Vault dir | `language` field | Code fence | Defaults | Multi-block | Notes |
|---|---|---|---|---|---|---|
| `snippet` | `Snippets` | yes (or plain text) | language or empty | ` ```vks ` | yes | Editor insert. |
| `template` | `Templates` | yes (or plain text) | language or empty | ` ```vks ` | **no (D1)** | Explorer → **writes a whole file** into the workspace. Single-block only. `extension:` overrides the fence language (see §5.1). |
| `command` | `Commands` | yes — **locked to `bash`** | `bash` (locked by serializer) | ` ```vks ` | yes | Terminal insert. |
| `agent` | `AgentsConf` | optional | language, empty, **or none — flags instead (§7)** | ` ```vks ` | yes* | Explorer → **writes a whole file** into the workspace (like `template`), named from `target:` (§5.2). `provider` / `model` / `version` record the AI provenance (agent-only, §5.2). *Create File enforces a single block/region. |
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
- **`extension`:** a `type: template`-only frontmatter key. Emitted verbatim
  (single line enforced) when non-empty, in the key order
  `type · title · description · language · extension · provider · model · version · tags · env · target`.
  Parsed as a plain string. Absent/empty for every other type.
- **`provider` / `model` / `version`:** `type: agent`-only frontmatter keys
  (§5.2). Each emitted verbatim (single line enforced) when non-empty, in the
  key order above. Parsed as plain strings. Absent/empty for every other type.

### 5.1 Templates — whole-file behaviour

A `template` is not a fragment inserted at the cursor; invoking **New File from
Template** from the Explorer writes the artifact's single code block to disk as a
real file, with `<VK-xxx>` variables resolved exactly as every other artifact
resolves them.

- **Single-block only (D1).** A template `.md` with two or more `##` blocks is a
  validation error surfaced when Create File is pressed — no file is written.
  The parser stays general; the guard (`validateTemplateBlocks`,
  `services/template.service.ts`) is template-scoped.
- **Output filename — extension precedence (D3):** **user-typed → frontmatter
  `extension:` → fence language.** A typed name that already carries an extension
  wins whole; otherwise the extension is taken from `extension:` (leading dot
  optional), and only if that is absent from the fence language (mapped through
  `language-map.service.ts`). `extension:` and the typed name are path-injection
  vectors: a value carrying `/`, `\`, `..`, or a NUL is **rejected, never
  sanitised**.
- **Destination (D2):** the clicked folder (or a clicked file's parent), or a
  folder picker rooted at the workspace when invoked from the palette. The write
  is containment-checked against the workspace folder before any I/O and creates
  no directory.

### 5.2 Agents — provider / model / version

An `agent` config records which AI it targets via three optional, **agent-only**
free-text frontmatter keys. They are metadata only — they do not change insert or
target-file write behaviour.

~~~md
---
type: agent
title: Code reviewer
provider: Claude
model: Opus
version: "4.8"
---
~~~

- **Free-text, optional.** Any of the three may be absent; an empty value is
  **omitted**, never emitted blank. No curated dropdown — the create form renders
  three plain text inputs, rendered for no other type.
- **Single-line enforced.** Like `title` / `description` / `extension`, each value
  is routed through the serializer's `safeYamlValue` so an embedded newline cannot
  inject a sibling frontmatter key on re-parse. They are parsed as plain strings.
- **Round-trip.** A hand-authored agent file carrying these keys preserves them
  through `parse(serialize(x))`; the create form seeds its inputs from them.
- **Multi-block (D4).** The agent create form reuses the multi-block machinery
  (`form.multiBlock === true`), matching the §5 agent row.

**Whole-file behaviour (Explorer → Create File).** Like a `template`, invoking an
agent config from the Explorer **writes its code block to disk as a real file**
with `<VK-xxx>` resolved — it does not insert at the cursor. Shared with templates
via `writesWholeFile(type)` (`artifact-type-config.service.ts`), the single source
for both the preview's `Create File` label and the write-vs-insert branch.

- **Filename from `target:`.** The default (editable) name is seeded from the
  `target:` frontmatter key (e.g. `CLAUDE.md`); absent, it falls back to the title.
  `target:` is a path-injection vector — a value carrying `/`, `\`, `..`, or a NUL
  is **rejected, never sanitised**, and the write is containment-checked against the
  workspace folder (identical guards to the template `extension:`/typed-name path).
- **Single-block only for the write.** A 2+ block agent is a Create-File validation
  error (an agent config is one file), even though the create form permits authoring
  multiple blocks (D4).
- **No code fence required.** An agent config is markdown, so its payload is
  normally delimited by flags (§7) rather than wrapped in a fence. Both shapes
  parse; the write path is identical.

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

---

## 7. Flags — plain-markdown payloads

A vault note *is* markdown. When the artifact's payload is itself markdown — an
agent config, and the planned AI-prompt snippet subtype — there is nothing to
wrap it in: a ` ``` ` fence is wrong (the payload may contain fences of its own)
and a `##` heading would swallow the author's surrounding notes. **Flags** mark
where the artifact starts and ends:

~~~md
---
type: agent
title: Code reviewer
target: CLAUDE.md
---

Scratch notes to myself — not part of the artifact.

%%oa:start%%
# Reviewer

Review <VK-repo> and report findings.

```bash
npm test
```
%%oa:end%%

More notes, also excluded.
~~~

`%%…%%` is Obsidian's own comment syntax, so flags are **invisible in Obsidian's
reading view** while staying plain text on disk.

### 7.1 Syntax

| Flag | Form |
|---|---|
| Start | `%%oa:start%%` — or `%%oa:start Some name%%` |
| End | `%%oa:end%%` |

- **Own line.** A flag must be the only thing on its line. Leading/trailing
  whitespace and spaces inside the `%%…%%` are tolerated (`%% oa:start Dev %%`).
- **Name.** Everything after `oa:start` up to the closing `%%`, trimmed. Optional.
- **Case-sensitive**, lowercase `oa:start` / `oa:end`.
- The syntax has exactly one owner in code: `src/services/flags.service.ts`.
  `test/flags.service.test.ts` fails if any other `src/` file spells it out again.

### 7.2 Parsing rules

- **Flags beat fences.** A file containing at least one start flag takes the
  flagged path; its ` ``` ` fences and `##` headings are payload, never structure.
  A file with no flags parses exactly as it always did — flags are **additive**,
  and no existing vault file changes meaning.
- **Text outside the flags is dropped.** That is the point of the markers.
- **Content is verbatim**, inner fences included; only blank lines at the two ends
  are trimmed, never interior ones or leading indentation.
- **Fenced regions are skipped while scanning**, so a prompt that *documents* the
  flag syntax inside a ` ```md ` sample does not terminate itself. Fence matching
  follows CommonMark: a fence closes only on the same character (` ``` ` vs `~~~`)
  at the same length or longer.
- **One region → single-block file** (`blocks: []`; its name is decorative, the
  title comes from frontmatter). **Two or more → one `ParsedBlock` per region**,
  the flag name as the block heading, so the multi-block picker and preview work
  unchanged.
- **`language` defaults to `markdown`** when frontmatter does not set one; an
  explicit `language:` still wins. This is what makes `extForLang` yield `.md` for
  a written file with no `extension:` / `target:`.
- **Two lenient rules**, so a half-typed file still previews: an unterminated
  start flag runs to end of file, and a second start flag while a region is open
  is content, not a new region.

### 7.3 Variables

`<VK-xxx>` tokens in a flagged payload are **auto-detected** — a prompt's whole
value is its tokens, so an explicit list is not required. A ` ```vks ` fence
supplies defaults for them and is **file-level**: put it *outside* the flags,
since anything between them is payload.

~~~md
%%oa:start%%
Review <VK-repo_name> on <VK-branch_name>.
%%oa:end%%

vars:
```vks
VK-repo_name=obsidian-artifacts
```
~~~

**Write flagged-payload tokens in a render-safe spelling.** A flagged payload is
*not* inside a code fence, so Obsidian parses it as markdown — and a bare
`<VK-repo>` is a legal HTML open tag that swallows every block below it,
including this ` ```vks ` fence. Use `<VK-repo></VK-repo>`, a lone `</VK-repo>`,
or a name containing `_`; **all three resolve to the same variable and the same
output** (§4.1 has the full table).

This is a **rendering-only** concern: the extension parses, resolves and writes
every spelling identically, and payloads inside a ` ``` ` fence are immune (no
HTML is parsed there). The vault's `AgentsConf/test/*.md` examples use the
underscore form.

### 7.4 Whole-file types

Flags need no special handling in the Create File flow: the region content lands
in `code`, so `validateSingleBlock` (2+ regions → the same "one file" error) and
`resolveOutputFileName` (`target:` for agents, extension chain for templates)
apply to a flagged file exactly as to a fenced one. Adding the AI-prompt snippet
subtype later requires **no extraction code** — only its `ARTIFACTS` row.

**Serializer.** Flags are a read-side format today: the create form still writes
the fenced shape, and `parse(serialize(x))` is unaffected because the serializer
never emits flags. Hand-authored flagged files are edited through **Edit .md**
(raw text), not re-serialized.
