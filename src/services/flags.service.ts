/**
 * **THE** owner of artifact *flag* syntax — the markers that delimit a region of
 * plain markdown inside a vault note.
 *
 * A vault file is already markdown, so an artifact whose payload *is* markdown
 * (an agent config, and later an AI-prompt snippet) has nothing to wrap it in: a
 * ` ``` ` fence would be wrong (the payload may itself contain fences) and a
 * heading would swallow the author's surrounding notes. Flags mark exactly where
 * the artifact starts and ends:
 *
 * ```md
 * Notes to myself — not part of the artifact.
 *
 * %%oa:start%%
 * You are a reviewer for <VK-repo>.
 *
 * ```bash
 * npm test
 * ```
 * %%oa:end%%
 *
 * More notes, also excluded.
 * ```
 *
 * `%%…%%` is Obsidian's own comment syntax, so the flags are invisible in
 * Obsidian's reading view while staying plain text on disk.
 *
 * **Type-agnostic on purpose.** Nothing here knows about `agent`, `template`, or
 * `snippet`; the parser applies it to every artifact file, so the planned
 * AI-prompt snippet subtype needs no new extraction code — only a registry row.
 *
 * `vscode`-free and side-effect free.
 */

/** A single `%%oa:start%%` … `%%oa:end%%` region lifted out of a vault file. */
export interface FlaggedRegion {
    /** Name from the start flag (`%%oa:start Dev%%` → `'Dev'`); `''` when unnamed. */
    readonly name: string;
    /** Verbatim markdown between the flags, outer blank lines removed. */
    readonly content: string;
}

// ── Syntax ──────────────────────────────────────────────────────────────────────
// Declared once, here. `flags-syntax.test.ts` fails if any other `src/` file
// spells the marker out again — the drift class that made `escHtml` diverge.

/** Opening flag on its own line: `%%oa:start%%` or `%%oa:start Some name%%`. */
const START_FLAG_RE = /^[ \t]*%%[ \t]*oa:start(?:[ \t]+([^%\n]*?))?[ \t]*%%[ \t]*$/;

/** Closing flag on its own line: `%%oa:end%%`. */
const END_FLAG_RE = /^[ \t]*%%[ \t]*oa:end[ \t]*%%[ \t]*$/;

/** A fence opener/closer: up to 3 spaces of indent, then 3+ backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Returns the fence marker a line opens, or `undefined` when it opens none.
 *
 * The marker (its run of backticks/tildes) is returned rather than a boolean so
 * `closesFence` can apply the CommonMark rule that a fence closes only on the
 * same character, at the same length or longer — otherwise a ` ``` ` inside a
 * ` ~~~ ` block would end it and the flag scanner would resume one block early.
 *
 * @param line - One raw line of the file body.
 * @returns The opening marker run (e.g. '```'), or `undefined`.
 *
 * @example
 * fenceOpener('```bash') // → '```'
 * fenceOpener('const x') // → undefined
 */
function fenceOpener(line: string): string | undefined {
    return FENCE_RE.exec(line)?.[1];
}

/**
 * Reports whether `line` closes a fence opened with `marker`.
 *
 * @param marker - The run that opened the currently-open fence.
 * @param line   - One raw line of the file body.
 * @returns `true` when the line is a closer of the same character and length.
 *
 * @example
 * closesFence('```', '````')  // → true  (longer run of the same char)
 * closesFence('~~~', '```')   // → false (different char)
 */
function closesFence(marker: string, line: string): boolean {
    const run = fenceOpener(line);
    return run !== undefined && run[0] === marker[0] && run.length >= marker.length;
}

/**
 * Drops blank lines from both ends of a region without touching its interior.
 *
 * `trim()` is not used: it would also strip meaningful leading indentation from
 * the first content line (a markdown list or an indented code sample).
 *
 * @param lines - The collected region lines, in order.
 * @returns The region content as a single string.
 *
 * @example
 * joinRegion(['', 'Review <VK-file>.', '']) // → 'Review <VK-file>.'
 */
function joinRegion(lines: string[]): string {
    let start = 0;
    let end   = lines.length;
    while (start < end && lines[start].trim() === '') { start++; }
    while (end > start && lines[end - 1].trim() === '') { end--; }
    return lines.slice(start, end).join('\n');
}

/**
 * Extracts every flagged region from a file body, in document order.
 *
 * Scans line by line and **ignores flags inside fenced code blocks**, so a
 * prompt that documents the flag syntax in a ` ```md ` sample does not terminate
 * itself. Text outside the flags is dropped — that is the whole point of the
 * markers.
 *
 * Two lenient rules, chosen so a half-typed file still previews instead of
 * vanishing, both pinned by tests:
 * - an unterminated start flag runs to end of file;
 * - a second start flag while a region is open is content, not a new region.
 *
 * @param body - File content **with frontmatter already stripped**.
 * @returns Ordered regions; `[]` when the file uses no flags (the classic shape).
 *
 * @example
 * extractFlaggedRegions('%%oa:start Dev%%\nrun it\n%%oa:end%%')
 * // → [{ name: 'Dev', content: 'run it' }]
 */
export function extractFlaggedRegions(body: string): FlaggedRegion[] {
    const regions: FlaggedRegion[] = [];
    let openFence: string | undefined;
    let name: string | undefined;   // defined ⇔ a region is currently open
    let lines: string[] = [];

    for (const line of body.split(/\r?\n/)) {
        // ── Inside a fence: everything is content, only its closer matters ────
        if (openFence !== undefined) {
            if (closesFence(openFence, line)) { openFence = undefined; }
            if (name !== undefined) { lines.push(line); }
            continue;
        }

        const opener = fenceOpener(line);
        if (opener !== undefined) {
            openFence = opener;
            if (name !== undefined) { lines.push(line); }
            continue;
        }

        // ── Outside every fence: flags are live ──────────────────────────────
        const start = START_FLAG_RE.exec(line);
        if (start && name === undefined) {
            name  = (start[1] ?? '').trim();
            lines = [];
            continue;
        }
        if (name !== undefined && END_FLAG_RE.exec(line)) {
            regions.push({ name, content: joinRegion(lines) });
            name = undefined;
            continue;
        }
        if (name !== undefined) { lines.push(line); }
    }

    if (name !== undefined) { regions.push({ name, content: joinRegion(lines) }); }
    return regions;
}
