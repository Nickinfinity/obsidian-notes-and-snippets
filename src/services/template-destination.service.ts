import * as vscode from 'vscode';
import { pickDestFolder } from '../ui/panels/destFolderPicker.panel.js';

/**
 * Resolves where a template file should be written, given the URI the user
 * invoked the command on (D2):
 *  - clicked a **folder** → write inside it
 *  - clicked a **file**   → write into its parent folder
 *  - no URI (palette)     → open the folder picker rooted at the workspace
 *
 * The pure decision lives in `classifyDestination` (unit-tested); the `vscode`
 * wrapper `resolveDestination` stats the URI and handles the picker fallback.
 */

// ── Pure decision ────────────────────────────────────────────────────────────────

/**
 * Maps an invoked URI + its file type to the directory to write into.
 *
 * A directory (or a symlink pointing at one — the `Directory` bit is set) is
 * used as-is; anything else (a file, a symlink to a file) resolves to its parent.
 *
 * @param uri      - The URI the command was invoked on.
 * @param fileType - The stat'd `FileType` bitmask for `uri`.
 * @returns The directory URI to write the template into.
 *
 * @example
 * classifyDestination(Uri.file('/ws/src'), FileType.Directory)          // /ws/src
 * classifyDestination(Uri.file('/ws/src/a.ts'), FileType.File)          // /ws/src
 */
export function classifyDestination(uri: vscode.Uri, fileType: vscode.FileType): vscode.Uri {
    if ((fileType & vscode.FileType.Directory) !== 0) {
        return uri;
    }
    return vscode.Uri.joinPath(uri, '..');
}

// ── vscode wrapper ───────────────────────────────────────────────────────────────

/**
 * Resolves the destination directory for a template write.
 *
 * When `uri` is supplied it is stat'd and classified (D2); when it is absent —
 * or the stat fails — the folder picker opens rooted at the first workspace
 * folder. Returns `undefined` when no workspace is open or the user cancels the
 * picker.
 *
 * @param uri - The invoked Explorer URI, or `undefined` for a palette invocation.
 * @returns The chosen destination directory URI, or `undefined`.
 *
 * @example
 * const dest = await resolveDestination(clickedUri);
 * if (dest) { await writeTemplateFile({ ...args, destDir: dest }); }
 */
export async function resolveDestination(uri: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
    if (uri !== undefined) {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            return classifyDestination(uri, stat.type);
        } catch {
            // URI vanished between click and stat — fall through to the picker.
        }
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root === undefined) {
        return undefined;
    }
    return pickDestFolder(root);
}
