/**
 * Validation + slug helpers for artifact filenames and folder names.
 *
 * Pure service — no VS Code API, no disk I/O. Used by:
 *   - the create form (live filename validation)
 *   - the destination folder picker (new-folder name validation)
 *
 * Rules per `ARTIFACT_FORM_PLAN.md` §5.
 */

type ValidationResult = { ok: true } | { ok: false; reason: string };

const ILLEGAL_CHARS_RE   = /[\\/:*?"<>|]/;
const CONTROL_CHARS_RE   = /[\x00-\x1F\x7F]/;
const RESERVED_NAMES_RE  = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MD_EXTENSION_RE    = /\.md$/i;
const SLUG_NON_ALNUM_RE  = /[^a-z0-9]+/g;
const SLUG_TRIM_DASH_RE  = /^-+|-+$/g;

/**
 * Runs the common name checks shared by file and folder validators.
 *
 * Covers empty-after-trim, illegal characters, ASCII control characters,
 * leading / trailing dot, leading / trailing space, and Windows reserved
 * names. Returns the first failure encountered with a user-facing reason.
 *
 * @param name - Raw name string as typed by the user.
 * @returns `{ ok: true }` when all shared rules pass; `{ ok: false, reason }` otherwise.
 *
 * @example
 * runCommonChecks('CON');   // → { ok: false, reason: 'Reserved system name' }
 * runCommonChecks('foo');   // → { ok: true }
 */
function runCommonChecks(name: string): ValidationResult {
    if (name.trim().length === 0) {
        return { ok: false, reason: 'Name cannot be empty' };
    }
    if (name.startsWith(' ') || name.endsWith(' ')) {
        return { ok: false, reason: 'Name cannot start or end with a space' };
    }
    if (name.startsWith('.') || name.endsWith('.')) {
        return { ok: false, reason: 'Name cannot start or end with a dot' };
    }
    if (ILLEGAL_CHARS_RE.exec(name)) {
        return { ok: false, reason: 'Name contains an illegal character (\\ / : * ? " < > |)' };
    }
    if (CONTROL_CHARS_RE.exec(name)) {
        return { ok: false, reason: 'Name contains a control character' };
    }
    if (RESERVED_NAMES_RE.exec(name)) {
        return { ok: false, reason: 'Reserved system name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)' };
    }
    return { ok: true };
}

/**
 * Validates a user-typed artifact filename (without the `.md` extension).
 *
 * Adds two file-only rules on top of `runCommonChecks`: rejects any
 * case-variant of `.md` (the writer appends it) and otherwise allows
 * unicode characters since Obsidian supports them in note names.
 *
 * @param name - Filename string (without `.md` extension).
 * @returns `{ ok: true }` when valid, `{ ok: false, reason }` otherwise.
 *
 * @example
 * validateArtifactFilename('express-route'); // → { ok: true }
 * validateArtifactFilename('foo.md');        // → { ok: false, reason: ... }
 * validateArtifactFilename('café-utils');    // → { ok: true }
 */
export function validateArtifactFilename(name: string): { ok: boolean; reason?: string } {
    const shared = runCommonChecks(name);
    if (!shared.ok) { return shared; }
    if (MD_EXTENSION_RE.exec(name)) {
        return { ok: false, reason: 'Do not include the .md extension — it is appended automatically' };
    }
    return { ok: true };
}

/**
 * Validates a user-typed folder name created inside the artifact root.
 *
 * Adds folder-specific rules on top of `runCommonChecks`: rejects `.` and
 * `..` (no traversal) and rejects any `/` or `\` (folder names are a single
 * path segment — nested paths must be created level by level). Does **not**
 * reject `.md` extensions since folders are not markdown files.
 *
 * @param name - Folder name string (single path segment).
 * @returns `{ ok: true }` when valid, `{ ok: false, reason }` otherwise.
 *
 * @example
 * validateFolderName('Web');     // → { ok: true }
 * validateFolderName('..');      // → { ok: false, reason: ... }
 * validateFolderName('a/b');     // → { ok: false, reason: ... }
 */
export function validateFolderName(name: string): { ok: boolean; reason?: string } {
    if (name === '.' || name === '..') {
        return { ok: false, reason: 'Folder name cannot be "." or ".."' };
    }
    return runCommonChecks(name);
}

/**
 * Lowercases and dash-separates a title into a filesystem-safe slug.
 *
 * Strategy: lowercase → replace every run of non-`[a-z0-9]` characters with
 * a single `-` → strip leading/trailing `-`. No transliteration — non-ASCII
 * letters collapse into separators along with punctuation and whitespace.
 *
 * @param title - Raw title string.
 * @returns Slug string (may be empty if `title` has no `[a-z0-9]` chars).
 *
 * @example
 * slugify('Hello World!!');  // → 'hello-world'
 * slugify('   ');            // → ''
 * slugify('Phase 0.5');      // → 'phase-0-5'
 */
export function slugify(title: string): string {
    return title
        .toLowerCase()
        .replaceAll(SLUG_NON_ALNUM_RE, '-')
        .replaceAll(SLUG_TRIM_DASH_RE, '');
}

/**
 * Derives a filename from a title via `slugify`, falling back to `'untitled'`.
 *
 * Used to pre-fill the filename input box when the user opens the picker
 * after typing a title in the form.
 *
 * @param title - Raw title string.
 * @returns The slug, or `'untitled'` when the slug would otherwise be empty.
 *
 * @example
 * deriveFileName('My New Snippet'); // → 'my-new-snippet'
 * deriveFileName('');               // → 'untitled'
 * deriveFileName('!!!');            // → 'untitled'
 */
export function deriveFileName(title: string): string {
    const slug = slugify(title);
    return slug.length > 0 ? slug : 'untitled';
}
