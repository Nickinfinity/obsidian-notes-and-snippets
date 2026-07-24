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

/**
 * Opening flag on its own line: `%%oa:start%%` or `%%oa:start Some name%%`.
 *
 * The name group is `[ \t]` + a `%`-free run, **not** `[ \t]+(...)?[ \t]*` — the
 * latter let whitespace be matched by three different parts of the pattern, the
 * ambiguity SonarLint reports as super-linear backtracking (S8786). Trailing
 * spaces inside the run are removed by `.trim()` at the call site instead.
 */
const START_FLAG_RE = /^[ \t]*%%[ \t]*oa:start(?:[ \t]([^%\n]*))?%%[ \t]*$/;

/** Closing flag on its own line: `%%oa:end%%`. */
const END_FLAG_RE = /^[ \t]*%%[ \t]*oa:end[ \t]*%%[ \t]*$/;

/** A fence opener/closer: up to 3 spaces of indent, then 3+ backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Reports whether a line is a `***` **visual rule** — 3 or more asterisks and
 * nothing else but surrounding whitespace.
 *
 * `***` is the marker's own separator, not the author's content: the flags are
 * invisible in Obsidian, so a rule above and below a region is what makes a
 * block *visible* — the job a ` ``` ` fence does for a snippet, and what makes
 * several prompts in one note distinguishable. It is therefore always dropped
 * from the payload.
 *
 * `***` rather than `---` on purpose: `---` stays ordinary content (a real
 * thematic break an author may want inside a prompt), it reads as frontmatter at
 * the top of a file, and directly under a text line it is a setext H2 instead of
 * a rule. `***` renders as a horizontal line in every position.
 *
 * Scanned rather than matched with `/^ *\*{3,} *$/` — an anchored run quantifier
 * trips SonarLint's super-linear-backtracking heuristic (S8786), and the same
 * linear-scan shape is already the house style in `template.service.helpers.ts`.
 *
 * @param line - One raw line of the file body.
 * @returns `true` for `***`, `*****`, `  ***  `; `false` for `**`, `* * *`, `***bold***`.
 *
 * @example
 * isVisualRule('***')       // → true
 * isVisualRule('* * *')     // → false — spaced breaks are not the marker form
 * isVisualRule('***text***')// → false — bold-italic, not a rule
 */
function isVisualRule(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.length < 3) { return false; }
    for (const ch of trimmed) {
        if (ch !== '*') { return false; }
    }
    return true;
}

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
    const run = fenceOpener(line) ?? '';
    return run.startsWith(marker[0]) && run.length >= marker.length;
}

/**
 * Drops blank lines from both ends of a region without touching its interior.
 *
 * `***` rules are already gone by this point — they are filtered during the scan
 * (see `scanOutsideFence`), where fence state is known, so a `***` inside a
 * fenced code sample stays untouched.
 *
 * `trim()` is not used: it would also strip meaningful leading indentation from
 * the first content line (a markdown list or an indented code sample).
 *
 * @param lines - The collected region lines, in order.
 * @returns The region content as a single string.
 *
 * @example
 * regionContent(['', 'Review <VK-file>.', '']) // → 'Review <VK-file>.'
 */
function regionContent(lines: string[]): string {
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
    const state: ScanState = { regions: [], lines: [] };
    for (const line of body.split(/\r?\n/)) {
        scanLine(state, line);
    }
    closeOpenRegion(state);   // lenient: an unterminated region runs to EOF
    return state.regions;
}

/** Mutable state carried across the line scan. `name` is defined ⇔ a region is open. */
interface ScanState {
    regions: FlaggedRegion[];
    openFence?: string;
    name?: string;
    lines: string[];
}

/**
 * Routes one line: fence bookkeeping first, flags only outside every fence.
 *
 * Split into `scanInsideFence` / `scanOutsideFence` rather than written as one
 * loop body — inline it and the function crosses the cognitive-complexity cap
 * (S3776) that this repo enforces at 15.
 *
 * @param state - Scan state, mutated in place.
 * @param line  - One raw line of the file body.
 *
 * @example
 * scanLine({ regions: [], lines: [] }, '%%oa:start%%')
 */
function scanLine(state: ScanState, line: string): void {
    if (state.openFence !== undefined) {
        if (closesFence(state.openFence, line)) { state.openFence = undefined; }
        collect(state, line);
        return;
    }
    const opener = fenceOpener(line);
    if (opener !== undefined) {
        state.openFence = opener;
        collect(state, line);
        return;
    }
    scanOutsideFence(state, line);
}

/**
 * Handles a line that sits outside every fence, where flags are live.
 *
 * A start flag while a region is already open is **content**, not a new region —
 * one of the two lenient rules that keep a half-typed file previewable.
 *
 * @param state - Scan state, mutated in place.
 * @param line  - One raw line, known to be outside any fence.
 *
 * @example
 * scanOutsideFence(state, '%%oa:end%%')
 */
function scanOutsideFence(state: ScanState, line: string): void {
    const start = START_FLAG_RE.exec(line);
    if (start && state.name === undefined) {
        state.name  = (start[1] ?? '').trim();
        state.lines = [];
        return;
    }
    if (state.name !== undefined && END_FLAG_RE.exec(line)) {
        closeOpenRegion(state);
        return;
    }
    // `***` is the marker's visual rule — dropped **only between a start and an
    // end flag**, where it is chrome rather than payload. Outside a region (and
    // in a file with no flags at all) it is ordinary markdown and survives.
    // Filtering here rather than in `regionContent` is also what keeps a `***`
    // inside a fenced code sample intact: fenced lines never reach this branch.
    if (state.name !== undefined && isVisualRule(line)) { return; }
    collect(state, line);
}

/**
 * Appends a line to the open region, or discards it when none is open.
 *
 * @param state - Scan state, mutated in place.
 * @param line  - The line to keep or drop.
 *
 * @example
 * collect(state, 'Review <VK-file>.')
 */
function collect(state: ScanState, line: string): void {
    if (state.name !== undefined) { state.lines.push(line); }
}

/**
 * Closes the open region into `state.regions`, if one is open.
 *
 * @param state - Scan state, mutated in place.
 *
 * @example
 * closeOpenRegion(state); // pushes { name, content } and clears `name`
 */
function closeOpenRegion(state: ScanState): void {
    if (state.name === undefined) { return; }
    state.regions.push({ name: state.name, content: regionContent(state.lines) });
    state.name = undefined;
}
