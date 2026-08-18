import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllTypes, getEntry } from './artifact-type-config.service.js';
import { isPathWithin } from '../utils/path-containment.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';

/**
 * T4 — vault frontmatter migration: `type: <legacy>` → `artifactType: <PascalCase>`.
 *
 * `vscode`-free by design (T4 plan note 5) so the whole rewrite + containment
 * surface is unit-testable without an extension host — `migrate.command.ts` is
 * the only file that touches `vscode`.
 *
 * Two layers:
 * - A pure, file-content rewriter (`planFrontmatterRewrite` / `applyFrontmatterRewrite`)
 *   that never reads or writes disk.
 * - A filesystem layer (`planMigration` / `applyMigration`) that walks the
 *   `ARTIFACTS` directories under a vault root and drives the rewriter.
 *
 * The dry-run/apply split is structural, not a boolean: `planMigration` only
 * ever *reads*; `applyMigration` is a separate call that takes the plan it
 * returned. There is no code path that writes without a plan produced first.
 */

// ── Legacy value → PascalCase map ───────────────────────────────────────────

/**
 * Builds the legacy `type:` value → current `artifactType:` literal map.
 *
 * Derived from `getAllTypes()` — never a hand-written table — so a type added
 * to `ARTIFACTS` never needs a second edit here. Two types don't fit the
 * generic "lowercase the literal" rule, both handled as visible, commented
 * exceptions rather than folded silently into the loop:
 *
 * - `AIAgentsConfig`'s legacy spelling is `agent` — a rename, not a case-fold
 *   (its lowercase, `aiagentsconfig`, was never written to a vault file).
 * - `AIPrompt` has **no** legacy spelling at all — it was introduced after this
 *   frontmatter scheme, using `artifactType: AIPrompt` from day one. Leaving
 *   it out of the generic lowercase loop means a hand-authored `type: aiprompt`
 *   (whatever a user meant by it) is left untouched rather than silently
 *   "corrected" into a migration that never happened.
 *
 * @returns Map keyed by the legacy lowercase (or irregular) value, valued by
 *   the current `ArtifactType` literal.
 *
 * @example
 * buildLegacyTypeMap().get('agent');    // → 'AIAgentsConfig'
 * buildLegacyTypeMap().get('snippet');  // → 'Snippet'
 * buildLegacyTypeMap().get('aiprompt'); // → undefined — AIPrompt is new, not legacy
 */
export function buildLegacyTypeMap(): ReadonlyMap<string, ArtifactType> {
    const IRREGULAR_LEGACY_VALUE: Partial<Record<ArtifactType, string>> = {
        AIAgentsConfig: 'agent',
    };
    const NEVER_HAD_A_LEGACY_SPELLING = new Set<ArtifactType>(['AIPrompt']);

    const map = new Map<string, ArtifactType>();
    for (const type of getAllTypes()) {
        if (NEVER_HAD_A_LEGACY_SPELLING.has(type)) { continue; }
        map.set(IRREGULAR_LEGACY_VALUE[type] ?? type.toLowerCase(), type);
    }
    return map;
}

// ── Pure content rewriter ────────────────────────────────────────────────────

/** A single planned line-level rewrite inside a file's first frontmatter block. */
export interface FrontmatterTypeLine {
    /** The exact line as found, e.g. `'type: agent'`. */
    oldLine: string;
    /** Its replacement, e.g. `'artifactType: AIAgentsConfig'`. */
    newLine: string;
}

// Matches the file's *first* `---`-fenced block only (anchored at position 0,
// non-greedy up to the first closing fence) — a `---` block appearing later in
// the body, or a `type:` line inside a later fence, is structurally outside
// this match and therefore never touched.
const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const LEADING_FENCE_RE = /^---\r?\n/;

interface FrontmatterBlockBounds {
    /** Absolute offset of the block's inner content, just after the opening fence's newline. */
    start: number;
    /** Absolute offset just past the block's inner content, before the closing fence. */
    end: number;
}

/**
 * Locates the inner-content span of the file's first frontmatter block.
 *
 * @param content - Full file content.
 * @returns Absolute `[start, end)` offsets, or `null` when the file carries
 *   no frontmatter block at all.
 *
 * @example
 * locateFirstFrontmatterBlock('---\ntype: snippet\n---\nbody') // → { start: 4, end: 18 }
 */
function locateFirstFrontmatterBlock(content: string): FrontmatterBlockBounds | null {
    const match = FRONTMATTER_BLOCK_RE.exec(content);
    if (!match) { return null; }
    const fence = LEADING_FENCE_RE.exec(match[0]);
    if (!fence) { return null; }
    const start = match.index + fence[0].length;
    return { start, end: start + match[1].length };
}

/** One line's text (terminator stripped) plus its absolute start offset in the source string. */
interface OffsetLine {
    text: string;
    offset: number;
}

/**
 * Splits `content[start, end)` into lines, each carrying its absolute offset
 * in `content` — so a caller can splice a single line back in without
 * disturbing anything else (a different line ending elsewhere included).
 *
 * @param content - Full file content.
 * @param start   - Inclusive start offset of the span to split.
 * @param end     - Exclusive end offset of the span to split.
 * @returns Ordered lines with their absolute offsets.
 *
 * @example
 * linesWithOffsets('a\nbb\n', 0, 5) // → [{text:'a',offset:0}, {text:'bb',offset:2}]
 */
function linesWithOffsets(content: string, start: number, end: number): OffsetLine[] {
    const lines: OffsetLine[] = [];
    let pos = start;
    while (pos < end) {
        const nl = content.indexOf('\n', pos);
        const lineEnd = (nl === -1 || nl >= end) ? end : nl;
        const raw = content.slice(pos, lineEnd);
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        lines.push({ text, offset: pos });
        pos = lineEnd + 1;
    }
    return lines;
}

/**
 * Plans the line-level rewrite a file's first frontmatter block needs, or
 * reports that none is needed.
 *
 * Returns `null` (no rewrite) when: the file has no frontmatter at all; the
 * block already carries an `artifactType:` key (idempotent — never
 * double-written, regardless of key order); the block has no `type:` key; or
 * the `type:` value is not a recognised legacy spelling (left untouched
 * rather than guessed at).
 *
 * @param content   - Full file content.
 * @param legacyMap - Legacy value → `ArtifactType` map; defaults to `buildLegacyTypeMap()`.
 * @returns The line to change and its replacement, or `null`.
 *
 * @example
 * planFrontmatterRewrite('---\ntype: snippet\n---\nbody')
 * // → { oldLine: 'type: snippet', newLine: 'artifactType: Snippet' }
 *
 * @example
 * planFrontmatterRewrite('---\ntype: agent\n---\nbody')
 * // → { oldLine: 'type: agent', newLine: 'artifactType: AIAgentsConfig' }
 */
export function planFrontmatterRewrite(
    content: string,
    legacyMap: ReadonlyMap<string, ArtifactType> = buildLegacyTypeMap(),
): FrontmatterTypeLine | null {
    const block = locateFirstFrontmatterBlock(content);
    if (!block) { return null; }

    let typeLine: OffsetLine | undefined;
    for (const line of linesWithOffsets(content, block.start, block.end)) {
        const colonIdx = line.text.indexOf(':');
        if (colonIdx === -1) { continue; }
        const key = line.text.slice(0, colonIdx).trim();
        if (key === 'artifactType') { return null; }
        if (key === 'type' && !typeLine) { typeLine = line; }
    }
    if (!typeLine) { return null; }

    const rawValue = typeLine.text.slice(typeLine.text.indexOf(':') + 1).trim();
    const newType = legacyMap.get(rawValue);
    if (!newType) { return null; }

    return { oldLine: typeLine.text, newLine: `artifactType: ${newType}` };
}

/**
 * Explains a `planFrontmatterRewrite` `null` result, but only when the file
 * looks like it *should* have migrated and didn't — a leading BOM, blank
 * line(s) before the frontmatter fence, or a quoted `type:` value.
 *
 * The overwhelming majority of `null`s are wholly expected (no frontmatter,
 * or frontmatter with no `type:` key at all — vault files routinely carry
 * neither) and must stay silent; reporting every one of those would bury the
 * few files a user actually needs to look at. Each candidate fix is applied
 * to a *copy* and re-checked with `planFrontmatterRewrite` before a reason is
 * returned, so this never reports a false positive on a file that was simply
 * never going to migrate.
 *
 * @param content   - Full file content that `planFrontmatterRewrite` returned `null` for.
 * @param legacyMap - Legacy value → `ArtifactType` map; defaults to `buildLegacyTypeMap()`.
 * @returns A human-readable reason, or `null` when the file is unremarkable.
 *
 * @example
 * explainUnrecognisedFrontmatter('﻿---\ntype: snippet\n---\nbody')
 * // → 'a byte-order mark (BOM) precedes the frontmatter fence'
 */
function explainUnrecognisedFrontmatter(
    content: string,
    legacyMap: ReadonlyMap<string, ArtifactType> = buildLegacyTypeMap(),
): string | null {
    if (content.startsWith('\uFEFF') && planFrontmatterRewrite(content.slice(1), legacyMap)) {
        return 'a byte-order mark (BOM) precedes the frontmatter fence';
    }

    const blankPrefix = /^(\r?\n)+/.exec(content);
    if (blankPrefix && planFrontmatterRewrite(content.slice(blankPrefix[0].length), legacyMap)) {
        return 'blank line(s) precede the opening frontmatter fence';
    }

    const block = locateFirstFrontmatterBlock(content);
    if (!block) { return null; }
    for (const line of linesWithOffsets(content, block.start, block.end)) {
        const colonIdx = line.text.indexOf(':');
        if (colonIdx === -1 || line.text.slice(0, colonIdx).trim() !== 'type') { continue; }
        const raw = line.text.slice(colonIdx + 1).trim();
        const unquoted = raw.replace(/^['"]|['"]$/g, '');
        if (raw !== unquoted && legacyMap.has(unquoted)) {
            return `type: value is quoted ("${raw}") — expected a bare legacy value`;
        }
    }
    return null;
}

/**
 * Applies a previously planned rewrite to file content — a surgical
 * single-line splice, never a parse-and-reserialize round trip, so every
 * other key in the block (including read-side-only `index:` / `paths:`)
 * survives byte-identical.
 *
 * If the exact `oldLine` text can no longer be found inside the first
 * frontmatter block (file changed on disk since planning), the content is
 * returned unchanged rather than guessing at a different line to touch.
 *
 * @param content - Full file content to rewrite.
 * @param rewrite - The change previously returned by `planFrontmatterRewrite`.
 * @returns The rewritten content, or `content` unchanged if the line was not found.
 *
 * @example
 * applyFrontmatterRewrite('---\ntype: snippet\n---\nbody', { oldLine: 'type: snippet', newLine: 'artifactType: Snippet' })
 * // → '---\nartifactType: Snippet\n---\nbody'
 */
export function applyFrontmatterRewrite(content: string, rewrite: FrontmatterTypeLine): string {
    const block = locateFirstFrontmatterBlock(content);
    if (!block) { return content; }

    for (const line of linesWithOffsets(content, block.start, block.end)) {
        if (line.text === rewrite.oldLine) {
            return content.slice(0, line.offset) + rewrite.newLine + content.slice(line.offset + line.text.length);
        }
    }
    return content;
}

// ── Filesystem layer ─────────────────────────────────────────────────────────

/** One file `planMigration` found needing a rewrite. */
export interface MigrationChange extends FrontmatterTypeLine {
    /** Absolute on-disk path. */
    filePath: string;
    /** Path relative to the vault root — for the dry-run report. */
    relativePath: string;
}

/** One file `planMigration` could not confidently parse — reported, never guessed at. */
export interface MigrationSkip {
    /** Absolute on-disk path. */
    filePath: string;
    /** Path relative to the vault root — for the dry-run report. */
    relativePath: string;
    /** Human-readable reason nothing was planned for this file. */
    reason: string;
}

/** What `planMigration` would do. Nothing is written until `applyMigration` runs on this. */
export interface MigrationPlan {
    readonly changes: readonly MigrationChange[];
    /**
     * Files that look like they should have migrated but didn't parse
     * cleanly (BOM, leading blank lines, a quoted `type:` value) — distinct
     * from the much larger, unremarkable set of files with no `type:` key at
     * all, which are not reported. Zero on this vault today; kept so "0
     * changes" never gets misread as "vault is clean" when it could mean "I
     * could not understand these."
     */
    readonly skipped: readonly MigrationSkip[];
}

/** What `applyMigration` actually wrote. */
export interface MigrationApplyResult {
    readonly changedFiles: readonly string[];
}

/**
 * Resolves `candidate` to its *real* (symlink-dereferenced) path and returns
 * it only when that real path is contained in `root`'s real path per
 * `isPathWithin` — **the** containment authority (`utils/path-containment.ts`).
 * Refuses — returns `null` — on any resolution failure (dangling symlink,
 * permissions error) rather than assuming safety; never sanitises a candidate
 * back inside the root.
 *
 * Resolves **once**: the caller must use the returned string for every
 * subsequent `stat`/recursion on this entry rather than re-resolving
 * `candidate` itself — re-resolving is a TOCTOU gap (the target a symlink
 * points at between the two calls is not guaranteed to be the same one that
 * was just validated). This is exactly the "callers needing symlink safety"
 * contract `isPathWithin`'s own doc comment states.
 *
 * @param root      - Trusted root directory (the vault root).
 * @param candidate - Untrusted path to validate (a symlink target inside a
 *   vault-authored artifact directory).
 * @returns The resolved real path when contained, else `null`.
 *
 * @example
 * resolveContained('/vault', '/vault/Snippets/x.md') // → '/vault/Snippets/x.md'
 * resolveContained('/vault', '/etc/passwd')           // → null
 */
function resolveContained(root: string, candidate: string): string | null {
    try {
        const realRoot = fs.realpathSync(root);
        const realCandidate = fs.realpathSync(candidate);
        return isPathWithin(realRoot, realCandidate) ? realCandidate : null;
    } catch {
        return null;
    }
}

/**
 * Resolves a symlink dirent and folds it into `results`/recursion when (and
 * only when) it stays inside `vaultRoot`.
 *
 * Split out of `collectMarkdownFiles` to keep that function's cognitive
 * complexity under the ESLint cap (S3776) — this is the one branch with
 * nested error handling (containment failure, a stat failure after
 * resolution) that pushed it over.
 *
 * @param vaultRoot - Vault root, the containment boundary for symlink targets.
 * @param childPath - The symlink's own path (pre-resolution).
 * @param results   - Accumulator mutated in place, matching `collectMarkdownFiles`.
 * @returns void
 *
 * @example
 * collectSymlinkEntry('/vault', '/vault/Snippets/link', results)
 */
function collectSymlinkEntry(vaultRoot: string, childPath: string, results: string[]): void {
    // Hostile case: a symlink inside a vault-authored artifact directory may
    // point outside the vault root — refused outright, never followed.
    // Resolved once: `real` (not a fresh `realpathSync(childPath)` call) is
    // what gets stat'd and recursed into, so the path validated is the exact
    // path used — a second resolve would reopen a TOCTOU gap if the link's
    // target changed between the two calls.
    const real = resolveContained(vaultRoot, childPath);
    if (!real) { return; }

    let stat: fs.Stats;
    try {
        stat = fs.statSync(real);
    } catch {
        return; // link died between resolution and stat — refuse, don't throw
    }

    if (stat.isDirectory()) {
        collectMarkdownFiles(vaultRoot, real, results);
    } else if (stat.isFile() && real.endsWith('.md')) {
        results.push(real);
    }
}

/**
 * Recursively collects every `.md` file under `dirPath`, refusing to follow
 * any symlink whose real target resolves outside `vaultRoot`.
 *
 * A missing or unreadable directory yields no files rather than throwing —
 * `planMigration` calls this once per `ARTIFACTS` directory and most vaults
 * don't have all of them.
 *
 * @param vaultRoot - Vault root, the containment boundary for symlink targets.
 * @param dirPath   - Directory to scan (recurses into real subdirectories).
 * @param results   - Accumulator (internal recursion parameter).
 * @returns Absolute paths of every `.md` file found.
 *
 * @example
 * collectMarkdownFiles('/vault', '/vault/AIAgentsConf') // → ['/vault/AIAgentsConf/x.md', ...]
 */
function collectMarkdownFiles(vaultRoot: string, dirPath: string, results: string[] = []): string[] {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const childPath = path.join(dirPath, entry.name);

        if (entry.isSymbolicLink()) {
            collectSymlinkEntry(vaultRoot, childPath, results);
            continue;
        }

        if (entry.isDirectory()) {
            collectMarkdownFiles(vaultRoot, childPath, results);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            results.push(childPath);
        }
    }
    return results;
}

/**
 * Scans every `ARTIFACTS` directory under `vaultRoot` and reports the
 * frontmatter rewrite each file needs. Read-only — never writes.
 *
 * The directory list comes from `getAllTypes()` / `getEntry()` — the same
 * `ARTIFACTS` authority every other vault-directory consumer reads — so a
 * directory not declared there (e.g. this vault's `DBs/`, `Docker/`, `GIT/`)
 * is out of scope by construction, not by an exclusion list.
 *
 * @param vaultRoot - Absolute path to the configured vault root.
 * @returns The plan: every file that needs a rewrite, and what it needs.
 *
 * @example
 * const plan = planMigration('/Users/me/vault');
 * plan.changes.length // → 15 on a vault with 15 legacy files
 */
export function planMigration(vaultRoot: string): MigrationPlan {
    const legacyMap = buildLegacyTypeMap();
    const changes: MigrationChange[] = [];
    const skipped: MigrationSkip[] = [];

    for (const type of getAllTypes()) {
        const dirPath = path.join(vaultRoot, getEntry(type).dir);
        for (const filePath of collectMarkdownFiles(vaultRoot, dirPath)) {
            let content: string;
            try {
                content = fs.readFileSync(filePath, 'utf8');
            } catch {
                continue; // unreadable file — skip, does not abort the scan
            }
            const relativePath = path.relative(vaultRoot, filePath);
            const rewrite = planFrontmatterRewrite(content, legacyMap);
            if (rewrite) {
                changes.push({ filePath, relativePath, ...rewrite });
                continue;
            }
            const reason = explainUnrecognisedFrontmatter(content, legacyMap);
            if (reason) {
                skipped.push({ filePath, relativePath, reason });
            }
        }
    }
    return { changes, skipped };
}

/**
 * Writes the rewrites described by a previously computed `MigrationPlan`.
 *
 * The only function in this module that touches disk for a write. Each file
 * is handled independently — one unreadable or already-changed file is
 * skipped, not fatal to the rest of the run.
 *
 * Re-validates each file against the *current* disk content before writing —
 * time passes between `planMigration` and a user confirming the apply modal,
 * and a file that gained `artifactType:` (or otherwise stopped matching the
 * plan) in that window must be skipped, not double-written. Re-planning off
 * the freshly-read content is the whole check: it already encodes "already
 * migrated" and "line moved/changed", so there is nothing else to compare.
 *
 * @param plan - A plan returned by `planMigration`.
 * @returns The absolute paths actually rewritten.
 *
 * @example
 * const result = applyMigration(planMigration(vaultRoot));
 * result.changedFiles.length // → 15
 */
export function applyMigration(plan: MigrationPlan): MigrationApplyResult {
    const changedFiles: string[] = [];
    for (const change of plan.changes) {
        try {
            const content = fs.readFileSync(change.filePath, 'utf8');
            const fresh = planFrontmatterRewrite(content);
            if (fresh?.oldLine !== change.oldLine || fresh?.newLine !== change.newLine) {
                continue; // stale plan entry — file changed since planning, don't touch it
            }
            const rewritten = applyFrontmatterRewrite(content, change);
            if (rewritten !== content) {
                fs.writeFileSync(change.filePath, rewritten, 'utf8');
                changedFiles.push(change.filePath);
            }
        } catch {
            // One bad file must not abort the whole apply run.
        }
    }
    return { changedFiles };
}
