import { writesWholeFile } from './artifact-type-config.service.js';
import type { ParsedFrontmatter, ParsedVar } from '../types/parsed-artifact.types.js';
import type { CarryOver, DestCandidate, IndexPlan, IndexStep, RejectedEntry, RunTally } from '../types/multi-index.types.js';

/**
 * **THE** owner of *template-index* link syntax — `[[wiki/link]]` and
 * `[text](md/link.md)` — and the single rejection authority (`safeRelPath`)
 * for every vault-authored string that becomes a filesystem path on either
 * side of a multi-template run (plan §3.1), in the same spirit as
 * `flags.service.ts` owning the flag marker syntax.
 *
 * `vscode`-free and side-effect free: fully unit-testable without an
 * extension host.
 */

/** Result of `safeRelPath` — the shape both `resolveLinkTarget` and `buildDestCandidates` return. */
export type SafeRelPathResult =
    | { readonly ok: true; readonly relPath: string }
    | { readonly ok: false; readonly reason: string };

// C0 (`\x00-\x1F`), DEL (`\x7F`) **and** C1 (`\x80-\x9F`) — §3.1 says "a NUL or
// other control character", and C1 is a control range too. No traversal
// consequence, so this closes the letter of the spec rather than a hole.
const CONTROL_CHAR_RE = /[\x00-\x1F\x7F-\x9F]/;

/**
 * The one rejection authority for a vault-authored relative path (plan §3.1).
 *
 * Rejects, never sanitises: a `..` segment anywhere, a leading `/`, any `\`
 * (a Windows path or a drive-relative one), a `:` (a Windows drive letter or
 * a URI scheme such as `file:`), and any NUL/control character. Accepted
 * paths are normalised to POSIX — doubled separators and `.` segments are
 * collapsed — but the *content* of each segment is never decoded, so a
 * percent-encoded traversal sequence (`%2e%2e%2f…`) has no real `/` to split
 * on and survives as one literal, inert segment instead of resolving back
 * into `..`.
 *
 * @param raw - Untrusted path text — a link target or a `paths:` entry.
 * @returns `{ ok: true, relPath }` normalised to POSIX, or `{ ok: false, reason }`.
 *
 * @example
 * safeRelPath('dir/sub/file.md');   // → { ok: true, relPath: 'dir/sub/file.md' }
 * safeRelPath('../etc/passwd');     // → { ok: false, reason: '...' }
 */
export function safeRelPath(raw: string): SafeRelPathResult {
    if (raw.length === 0) { return { ok: false, reason: 'empty path' }; }
    if (CONTROL_CHAR_RE.exec(raw)) { return { ok: false, reason: 'contains a NUL or control character' }; }
    if (raw.includes(':')) { return { ok: false, reason: 'contains a drive letter or URI scheme (":")' }; }
    if (raw.includes('\\')) { return { ok: false, reason: 'contains a backslash path separator' }; }
    if (raw.startsWith('/')) { return { ok: false, reason: 'absolute path' }; }

    const segments = raw.split('/').filter(s => s !== '' && s !== '.');
    if (segments.includes('..')) { return { ok: false, reason: 'contains a parent-directory ("..") segment' }; }
    if (segments.length === 0) { return { ok: false, reason: 'empty path' }; }

    return { ok: true, relPath: segments.join('/') };
}

/**
 * Reports whether a parsed file's frontmatter marks it as a template index.
 *
 * `index: true` alone is not enough — a run can only write files (D6), so a
 * `snippet` or `command` carrying `index: true` is not an index.
 *
 * @param fm - Parsed frontmatter of a candidate file.
 * @returns `true` only when `fm.index === true` and the type writes whole files.
 *
 * @example
 * isIndexArtifact({ artifactType: 'Template', index: true }); // → true
 * isIndexArtifact({ artifactType: 'Snippet', index: true });  // → false
 */
export function isIndexArtifact(fm: ParsedFrontmatter): boolean {
    return fm.index === true && writesWholeFile(fm.artifactType);
}

// A wikilink `[[target]]` (capture group 1) or a markdown link `[text](target)`
// (capture group 2). The negative lookbehind fronts *both* forms so neither an
// image (`![alt](url)`) nor an embed (`![[note]]`) is read as an index entry —
// both display a note rather than nominate one to scaffold.
//
// Every class excludes its own opening delimiter (`[` in the bracket parts, `(`
// in the URL part) and `\n`. That is what keeps the scan **linear**: a flood of
// unclosed `[[[[…` or `[](` fails at the first character of each attempt rather
// than scanning to end-of-input per start position, which is the quadratic
// blow-up a vault-authored index body could otherwise trigger (S8786).
const LINK_RE = /(?<!!)(?:\[\[([^[\]\n]+)\]\]|\[[^[\]\n]*\]\(([^()\n]+)\))/g;

/**
 * Strips a wikilink's alias (`|`) and anchor (`#`) suffixes, keeping the target.
 *
 * @param raw - Captured wikilink interior, e.g. `'dir/Button#Usage|see usage'`.
 * @returns The target only, e.g. `'dir/Button'`.
 *
 * @example
 * stripWikiSuffixes('dir/Button#Usage|see usage'); // → 'dir/Button'
 */
function stripWikiSuffixes(raw: string): string {
    return raw.split('|')[0].split('#')[0].trim();
}

/**
 * Extracts every index link target from a file body, in document order.
 *
 * Both accepted syntaxes (D3) are matched by one pass over the text, so their
 * relative order is preserved automatically. Duplicates are preserved — a
 * link repeated twice yields two entries; de-duplication is a different
 * concern (`buildDestCandidates`), not this one.
 *
 * @param body - Index file body (frontmatter already stripped).
 * @returns Ordered list of raw link targets, alias/anchor suffixes stripped.
 *
 * @example
 * extractIndexLinks('1. [[dir_2/subdir1/Button]]\n2. [T](dir_2/subdir1/Button.test.md)');
 * // → ['dir_2/subdir1/Button', 'dir_2/subdir1/Button.test.md']
 */
export function extractIndexLinks(body: string): string[] {
    const out: string[] = [];
    for (const m of body.matchAll(LINK_RE)) {
        if (m[1] !== undefined) { out.push(stripWikiSuffixes(m[1])); }
        else if (m[2] !== undefined) { out.push(m[2].trim()); }
    }
    return out;
}

/**
 * Resolves one raw link target to a vault-relative `.md` path.
 *
 * ponytail: resolution is **subtree-relative only** — relative to the index
 * file's own directory (D4) — there is no vault-wide shortest-path search.
 * A link that legitimately lives elsewhere in the vault is rejected, not
 * chased down. Upgrade path, if ever needed: vault-wide resolution backed by
 * a note index (a full scan to disambiguate duplicate basenames), gated
 * behind its own opt-in since it changes what "safe" means for a link.
 *
 * @param link - Raw link target, as returned by `extractIndexLinks`.
 * @returns `safeRelPath`'s result, with `.md` appended when not already present.
 *
 * @example
 * resolveLinkTarget('dir_2/subdir1/Button');           // → { ok: true, relPath: 'dir_2/subdir1/Button.md' }
 * resolveLinkTarget('dir_2/subdir1/Button.test.md');   // → { ok: true, relPath: 'dir_2/subdir1/Button.test.md' }
 */
export function resolveLinkTarget(link: string): SafeRelPathResult {
    const safe = safeRelPath(link);
    if (!safe.ok) { return safe; }
    const relPath = safe.relPath.toLowerCase().endsWith('.md') ? safe.relPath : `${safe.relPath}.md`;
    return { ok: true, relPath };
}

/**
 * Returns the directory part of a POSIX relative path, `''` at the root.
 *
 * A thin wrapper is kept (rather than reaching for `path.posix.dirname`
 * directly at each call site) only to normalise its `'.'` "no directory"
 * answer to the `''` this domain uses throughout (`IndexStep.relDir`,
 * `DestCandidate.relPath`).
 *
 * @param relPath - POSIX-relative path, already `safeRelPath`-accepted.
 * @returns The directory portion, or `''` when `relPath` has none.
 *
 * @example
 * relDirOf('dir_2/subdir1/Button.md'); // → 'dir_2/subdir1'
 * relDirOf('Button.md');               // → ''
 */
function relDirOf(relPath: string): string {
    const lastSlash = relPath.lastIndexOf('/');
    return lastSlash === -1 ? '' : relPath.slice(0, lastSlash);
}

/**
 * Builds the full run plan for a template index: every link resolved to a
 * step, or refused with a reason — document order preserved on both lists.
 *
 * The single call the runner makes; it never calls `extractIndexLinks` /
 * `resolveLinkTarget` directly.
 *
 * @param body - Index file body (frontmatter already stripped).
 * @returns `{ steps, rejected }`, both in document order.
 *
 * @example
 * buildIndexPlan('[[dir/Button]]\n[[../escape]]');
 * // → { steps: [{ raw: 'dir/Button', relPath: 'dir/Button.md', relDir: 'dir' }],
 * //     rejected: [{ raw: '../escape', reason: '...' }] }
 */
export function buildIndexPlan(body: string): IndexPlan {
    const steps: IndexStep[] = [];
    const rejected: RejectedEntry[] = [];

    for (const raw of extractIndexLinks(body)) {
        const resolved = resolveLinkTarget(raw);
        if (!resolved.ok) {
            rejected.push({ raw, reason: resolved.reason });
            continue;
        }
        steps.push({ raw, relPath: resolved.relPath, relDir: relDirOf(resolved.relPath) });
    }

    return { steps, rejected };
}

/**
 * Joins two POSIX-relative directory fragments, either of which may be `''`.
 *
 * @param a - First fragment (e.g. the clicked Explorer folder).
 * @param b - Second fragment (e.g. the link's mirrored directory).
 * @returns The joined path; `''` when both fragments are `''`.
 *
 * @example
 * joinRelDirs('src/app', 'dir_2/subdir1'); // → 'src/app/dir_2/subdir1'
 * joinRelDirs('', '');                     // → ''
 */
function joinRelDirs(a: string, b: string): string {
    return [a, b].filter(s => s !== '').join('/');
}

/** Human label for a workspace-relative path — `'/'` stands in for the root. */
function labelFor(relPath: string): string {
    return relPath === '' ? '/' : relPath;
}

/**
 * Builds the destination candidate list for one index step (D9).
 *
 * The mirrored folder — the clicked folder plus the link's own relative
 * directory — is always first and pre-selectable. Each `paths:` entry that
 * `safeRelPath` accepts follows, in declaration order. Entries are deduped by
 * `relPath`, first occurrence wins; a rejected `paths:` entry is dropped
 * silently here — `buildIndexPlan` is what reports rejections to the user,
 * once, so this call does not repeat them.
 *
 * @param args.mirroredRelDir - The link's directory, relative to the index file.
 * @param args.clickedRelPath - The Explorer folder the run started from, workspace-relative.
 * @param args.indexPaths - The index file's declared `paths:` entries, in order.
 * @returns Ordered, deduped `DestCandidate[]`.
 *
 * @example
 * buildDestCandidates({ mirroredRelDir: 'dir_2/subdir1', clickedRelPath: 'src/app', indexPaths: ['src/components'] });
 */
export function buildDestCandidates(args: {
    readonly mirroredRelDir: string;
    readonly clickedRelPath: string;
    readonly indexPaths: readonly string[];
}): DestCandidate[] {
    const seen = new Map<string, DestCandidate>();

    const add = (relPath: string, detail: string): void => {
        if (seen.has(relPath)) { return; }
        seen.set(relPath, { relPath, label: labelFor(relPath), detail });
    };

    add(joinRelDirs(args.clickedRelPath, args.mirroredRelDir), 'Suggested — mirrors the index');

    for (const raw of args.indexPaths) {
        const safe = safeRelPath(raw);
        if (safe.ok) { add(safe.relPath, 'From the index'); }
    }

    return [...seen.values()];
}

/**
 * Applies carry-over variable values on top of a step's own defaults.
 *
 * Exact, case-sensitive match on the full `VK-xxx` token — the same rule
 * Variable Sets use. Returns a new array; neither `vars` nor `carry` is
 * mutated, so the runner can safely keep reusing its accumulated `carry` map
 * across steps.
 *
 * @param vars - The step's own parsed vars.
 * @param carry - Values submitted on earlier steps, keyed by full var name.
 * @returns A new `ParsedVar[]` with matching entries' `defaultValue` overridden.
 *
 * @example
 * applyCarryOver([{ name: 'VK-language', defaultValue: 'javascript' }], { 'VK-language': 'java' });
 * // → [{ name: 'VK-language', defaultValue: 'java' }]
 */
export function applyCarryOver(vars: ParsedVar[], carry: CarryOver): ParsedVar[] {
    return vars.map(v => (Object.hasOwn(carry, v.name) ? { ...v, defaultValue: carry[v.name] } : v));
}

/**
 * Renders the closing notification text for a finished (or aborted) run.
 *
 * Pure, so the exact wording is asserted rather than eyeballed in a manual
 * F5 pass.
 *
 * @param tally - The run's final counts.
 * @returns The notification text.
 *
 * @example
 * summariseRun({ written: 3, skipped: 0, aborted: false });
 * // → 'Multi-Template: 3 files written, 0 skipped.'
 */
export function summariseRun(tally: RunTally): string {
    const fileWord = tally.written === 1 ? 'file' : 'files';
    const suffix = tally.aborted ? ' Run cancelled.' : '';
    return `Multi-Template: ${tally.written} ${fileWord} written, ${tally.skipped} skipped.${suffix}`;
}
