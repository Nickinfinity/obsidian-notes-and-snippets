import * as path from 'node:path';
import * as vscode from 'vscode';
import { getEntry } from './artifact-type-config.service.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Discriminated union returned by `writeArtifact`.
 *
 * - `success`   — file written; `filePath` is the absolute OS path.
 * - `collision` — file already exists and `force` was not set; nothing written.
 * - `error`     — unexpected failure (path-escape, write error, etc.); caller
 *                 shows `message` to the user.
 */
export type WriteResult =
    | { kind: 'success';   filePath: string }
    | { kind: 'collision'; filePath: string }
    | { kind: 'error';     message: string };

/**
 * Arguments for `writeArtifact`.
 */
export interface WriteArgs {
    /** Vault root Uri — used to compute the base directory and for path-escape checks. */
    vaultRoot: vscode.Uri;
    /** Artifact type — determines the base subdirectory (e.g. `snippet` → `Snippets`). */
    type: ArtifactType;
    /** Target directory Uri — must be within `vaultRoot`. */
    chosenDir: vscode.Uri;
    /** Filename **without** `.md` extension — the writer appends it. */
    fileName: string;
    /** UTF-8 content to write. */
    content: string;
    /** When `true`, overwrite an existing file. Defaults to `false`. */
    force?: boolean;
}

// ── Public function ───────────────────────────────────────────────────────────

/**
 * Writes a vault artifact file using `vscode.workspace.fs`.
 *
 * Steps (in order):
 * 1. Validates `chosenDir` is inside `vaultRoot` (path-escape guard).
 * 2. Ensures the artifact-type base directory exists (auto-creates if absent).
 * 3. Checks whether the final path already exists:
 *    - Exists + `!force` → returns `{ kind: 'collision' }` without writing.
 *    - Exists + `force`  → overwrites.
 *    - Absent            → creates.
 * 4. Returns `{ kind: 'success', filePath }` on success.
 * 5. Returns `{ kind: 'error', message }` on any unexpected exception.
 *
 * The writer never calls `vscode.window.showTextDocument` — the panel closes
 * silently on success (deliberate UX; no editor tab opened).
 *
 * @param args - Write configuration.
 * @returns A `WriteResult` describing the outcome.
 *
 * @example
 * const result = await writeArtifact({ vaultRoot, type: 'snippet', chosenDir, fileName: 'my-snippet', content });
 * if (result.kind === 'success') { panel.dispose(); }
 */
export async function writeArtifact(args: WriteArgs): Promise<WriteResult> {
    try {
        // ── 1. Path-escape guard ───────────────────────────────────────────
        if (!isWithinRoot(args.vaultRoot, args.chosenDir)) {
            return { kind: 'error', message: `Destination "${args.chosenDir.fsPath}" is outside the vault root.` };
        }

        // ── 2. Auto-create base dir ────────────────────────────────────────
        const baseDir = vscode.Uri.joinPath(args.vaultRoot, getEntry(args.type).dir);
        await vscode.workspace.fs.createDirectory(baseDir);

        // ── 3. Collision check ─────────────────────────────────────────────
        const fileUri = vscode.Uri.joinPath(args.chosenDir, `${args.fileName}.md`);
        const exists = await fileExists(fileUri);

        if (exists && !args.force) {
            return { kind: 'collision', filePath: fileUri.fsPath };
        }

        // ── 4. Write ───────────────────────────────────────────────────────
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(args.content));
        return { kind: 'success', filePath: fileUri.fsPath };

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: 'error', message };
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Returns `true` when `candidate` is equal to or nested within `root`.
 *
 * Appends a platform separator before prefix-checking so `/vault-root-b` is
 * not matched as within `/vault-root`.
 *
 * @param root      - Vault root Uri.
 * @param candidate - Uri to validate.
 * @returns `true` if `candidate` is within `root`.
 *
 * @example
 * isWithinRoot(vaultRoot, vscode.Uri.joinPath(vaultRoot, 'Snippets')) // true
 * isWithinRoot(vaultRoot, vscode.Uri.file('/other/dir'))              // false
 */
function isWithinRoot(root: vscode.Uri, candidate: vscode.Uri): boolean {
    const rootPath = root.fsPath.endsWith(path.sep) ? root.fsPath : root.fsPath + path.sep;
    return candidate.fsPath === root.fsPath || candidate.fsPath.startsWith(rootPath);
}

/**
 * Returns `true` when a file exists at `uri` (stat succeeds without throwing).
 *
 * @param uri - File Uri to check.
 * @returns `true` if the file exists.
 *
 * @example
 * await fileExists(vscode.Uri.file('/vault/Snippets/route.md'))
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}
