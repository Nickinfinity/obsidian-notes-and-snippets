import { safeRelPath } from '../../services/multi-index.service.js';
import { buildFilePrefill } from '../create-prefill.helpers.js';
import type { ArtifactType } from '../../types/parsed-artifact.types.js';
import type { CaptureResult } from '../../types/artifact-form.types.js';

/**
 * Explorer single-file input for `captureExplorerFile` — the workspace
 * file's name, its already-read contents, and its `languageId`.
 * Deliberately not a `vscode.Uri`: this module stays `vscode`-free so it is
 * unit-testable without a host, and the caller (not this function) does the
 * `workspace.fs.readFile`.
 */
export interface ExplorerFileInput {
    /**
     * File name as reported by the workspace. Untrusted: a workspace file
     * is authored by whoever owns that workspace, not by this extension, so
     * this is validated by `fileNameForType` before it can reach `target:`
     * or `extension:` frontmatter.
     */
    fileName: string;
    /** Full file contents, already read by the caller. */
    contents: string;
    /** `document.languageId` (or equivalent) for the source file. */
    languageId: string;
}

/** Max accepted `contents` length — 512 KiB, measured in UTF-16 code units (`string.length`), not bytes. */
const MAX_CONTENTS_LENGTH = 512 * 1024;

/**
 * Validates a workspace file name for use as a whole-file type's `target:` /
 * `extension:` prefill, and returns it unchanged when valid.
 *
 * Rejects, never trims: runs `safeRelPath` first (rejects `..` traversal, an
 * absolute path, a backslash/drive-letter form, and NUL/control characters —
 * `multi-index.service.ts`'s single rejection authority), then additionally
 * rejects the **raw** name if it still contains a `/` separator. Both checks
 * run against `fileName` as received — `safeRelPath`'s *return value* is
 * used only to decide ok/reject, never as the accepted output, because
 * `safeRelPath` normalises (it drops `.`/`''` segments and a trailing
 * separator before joining), so reading its `relPath` back out would accept
 * `./CLAUDE.md` or `CLAUDE.md/` as if they were already the plain basename
 * `CLAUDE.md` — trimmed into an accepted shape rather than refused. A
 * rejected name is never extracted, stripped, or otherwise edited; an
 * accepted name is returned byte-for-byte identical to what came in.
 *
 * @param fileName - Untrusted workspace file name.
 * @param _type - Target artifact type (unused by the check itself — the name
 *   is validated identically for every type; `buildFilePrefill`'s own
 *   per-type table decides whether the name is even consumed).
 * @returns `fileName` unchanged when it is already a safe plain basename, else `undefined`.
 *
 * @example
 * fileNameForType('CLAUDE.md', 'AIAgentsConfig');        // → 'CLAUDE.md'
 * fileNameForType('../../etc/passwd', 'AIAgentsConfig'); // → undefined
 * fileNameForType('sub/b.ts', 'Template');                // → undefined (clean relative path, not a basename)
 * fileNameForType('./CLAUDE.md', 'AIAgentsConfig');       // → undefined (safeRelPath would normalise this to 'CLAUDE.md' — rejected raw instead)
 * fileNameForType('CLAUDE.md/', 'Template');              // → undefined (trailing separator — safeRelPath would drop it — rejected raw instead)
 */
export function fileNameForType(fileName: string, _type: ArtifactType): string | undefined {
    if (!safeRelPath(fileName).ok || fileName.includes('/')) {
        return undefined;
    }
    return fileName;
}

/**
 * Captures a single workspace file for the create-artifact form — the
 * source for `Template` and `AIAgentsConfig`, invoked from the Explorer.
 *
 * Pure: the caller has already done `workspace.fs.readFile` and passes the
 * decoded `contents`. Rejects (returns `undefined`) an oversized file before
 * building any prefill, and rejects a hostile `fileName` via
 * `fileNameForType` before it can reach `buildFilePrefill` — `path.basename`
 * inside `buildFilePrefill` would otherwise silently *trim* a traversal
 * string like `../../etc/passwd` down to the accepted-looking `passwd`,
 * which is exactly the "trimmed into an accepted one" failure this ordering
 * prevents.
 *
 * @param input - `{ fileName, contents, languageId }`, see `ExplorerFileInput`.
 * @param type - Target artifact type chosen for the new artifact.
 * @returns A `CaptureResult` with `source: 'file'`, or `undefined` when the
 *   file is oversized or `fileName` is not a safe plain basename.
 *
 * @example
 * captureExplorerFile({ fileName: 'CLAUDE.md', contents: '# hi', languageId: 'markdown' }, 'AIAgentsConfig');
 * // → { prefill: { target: 'CLAUDE.md', blocks: [{ heading: '', description: '', language: 'markdown', code: '# hi', vars: [] }] }, source: 'file' }
 *
 * @example
 * captureExplorerFile({ fileName: '../../etc/passwd', contents: 'x', languageId: 'plaintext' }, 'AIAgentsConfig');
 * // → undefined
 */
export function captureExplorerFile(input: ExplorerFileInput, type: ArtifactType): CaptureResult | undefined {
    if (input.contents.length > MAX_CONTENTS_LENGTH) {
        return undefined;
    }

    const safeName = fileNameForType(input.fileName, type);
    if (safeName === undefined) {
        return undefined;
    }

    return { prefill: buildFilePrefill(safeName, input.contents, input.languageId, type), source: 'file' };
}
