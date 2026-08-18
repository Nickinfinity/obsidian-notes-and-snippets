/**
 * Pure helpers for the block-scoped temp-file editor (Edit Block feature, VSX-89).
 *
 * These functions are intentionally free of any `vscode` dependency so they can
 * be unit-tested without an extension host. The `vscode`-dependent parts
 * (`getLanguages()` validation, `setTextDocumentLanguage`) live in
 * `blockEditor.ts`.
 *
 * The vscode-dependent parts (`getLanguages()` validation, `setTextDocumentLanguage`)
 * live in `blockEditor.ts`. Contracts are covered by `test/block-edit-helpers.test.ts`.
 */
import { LANG_ALIAS, LANG_EXT } from '../../../types/constants.js';

/** Fence info-strings that are not real languages — ignored by `resolveLangId`. */
const GENERIC_FENCE_LANGS = new Set(['', 'code', 'vks']);

/** Matches a languageId safe to use verbatim as a file extension. */
const FILENAME_SAFE_EXT_RE = /^[a-z0-9]+$/;

/**
 * Normalises a raw code-fence info-string to a canonical VS Code `languageId`.
 *
 * Lowercases the input, then resolves shorthand via `LANG_ALIAS`. Does **not**
 * validate against the host's installed languages — that is `resolveLangId`'s job.
 *
 * @param raw - Raw fence info-string (e.g. `'JS'`, `'Python'`, `'c#'`).
 * @returns The aliased id when a shorthand matches, otherwise the lowercased input.
 *
 * @example
 * normalizeLangId('JS')     // → 'javascript'
 * normalizeLangId('Python') // → 'python'
 * normalizeLangId('zig')    // → 'zig'
 */
export function normalizeLangId(raw: string): string {
    const lc = raw.toLowerCase();
    return LANG_ALIAS[lc] ?? lc;
}

/**
 * Resolves the languageId to apply to the temp document.
 *
 * Priority: fence language (when "real" — not `code`/`vks`/empty) → frontmatter
 * language → `'plaintext'`. A candidate is accepted only when its normalised form
 * appears in `known`.
 *
 * @param fenceLang       - Fence info-string of the block (may be `undefined`).
 * @param frontmatterLang - Frontmatter `language` value (may be `undefined`).
 * @param known           - Installed language ids (`vscode.languages.getLanguages()`).
 * @returns A validated languageId, or `'plaintext'` when nothing matches.
 *
 * @example
 * resolveLangId('js', undefined, ['javascript', 'plaintext'])  // → 'javascript'
 * resolveLangId('code', 'python', ['python', 'plaintext'])     // → 'python'
 * resolveLangId('nope', undefined, ['plaintext'])              // → 'plaintext'
 */
export function resolveLangId(
    fenceLang: string | undefined,
    frontmatterLang: string | undefined,
    known: string[],
): string {
    // ── Try each candidate in priority order ──────────────────────────────────
    for (const candidate of [fenceLang, frontmatterLang]) {
        if (candidate === undefined || GENERIC_FENCE_LANGS.has(candidate.toLowerCase())) {
            continue;
        }
        const id = normalizeLangId(candidate);
        if (known.includes(id)) {
            return id;
        }
    }
    return 'plaintext';
}

/**
 * Maps a languageId to a cosmetic file extension for the temp file name.
 *
 * Uses `LANG_EXT` first; otherwise returns the id itself when it is filename-safe
 * (`/^[a-z0-9]+$/`), else `'txt'`.
 *
 * @param langId - Canonical VS Code languageId.
 * @returns A file extension without the leading dot.
 *
 * @example
 * extForLang('javascript') // → 'js'
 * extForLang('zig')        // → 'zig'
 * extForLang('weird-id!')  // → 'txt'
 */
export function extForLang(langId: string): string {
    const mapped = LANG_EXT[langId];
    if (mapped !== undefined) {
        return mapped;
    }
    return FILENAME_SAFE_EXT_RE.test(langId) ? langId : 'txt';
}
