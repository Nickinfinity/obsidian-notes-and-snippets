import * as vscode from 'vscode';
import { parseFromContent } from '../../../services/parser.service.js';
import { patchBlockCode, type BlockRef } from '../../../services/artifact-patcher.service.js';
import type { ParsedArtifactFile } from '../../../types/parsed-artifact.types.js';
import { blockAsArtifact } from './preview.helpers.js';
import { slugify } from '../../../services/filename.service.js';
import { extForLang, resolveLangId } from '../../../services/language-map.service.js';
import { out } from './shared.js';

/**
 * Deletes any leftover block-edit temp files from a previous session (e.g. after
 * a crash or non-clean teardown). Best-effort — errors are swallowed.
 *
 * @param storageUri - Extension storage dir (`context.storageUri ?? globalStorageUri`).
 * @returns A promise that resolves once the sweep completes.
 *
 * @example
 * await sweepBlockEditOrphans(context.storageUri ?? context.globalStorageUri);
 */
export async function sweepBlockEditOrphans(storageUri: vscode.Uri): Promise<void> {
    const dir = vscode.Uri.joinPath(storageUri, 'blockEdit');
    try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name] of entries) {
            try { await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, name)); }
            catch { /* ignore individual failures */ }
        }
        if (entries.length > 0) {
            out.appendLine(`[blockEdit] swept ${entries.length} orphan temp file(s)`);
        }
    } catch {
        /* dir does not exist yet — nothing to sweep */
    }
}

/** Callback bag the controller uses to push state back to the preview owner. */
export interface BlockEditCallbacks {
    /** Absolute filesystem path of the artifact root (passed to `parseFromContent`). */
    rootFs: string;
    /** Extension storage directory under which temp edit files are written. */
    storageUri: vscode.Uri;
    /** Returns the artifact currently being previewed (or `undefined` if none). */
    getCurrentArtifact: () => ParsedArtifactFile | undefined;
    /** Updates the owner's current artifact after a save round-trip. */
    setCurrentArtifact: (artifact: ParsedArtifactFile) => void;
    /** Writes a freshly parsed artifact into the navigator's parse cache. */
    setCache: (uri: vscode.Uri, parsed: ParsedArtifactFile) => void;
    /** Posts a message to the preview webview (or no-op if the panel is gone). */
    postMessage: (msg: unknown) => void;
    /** Returns the preview panel's view column so the temp file opens as a tab beside it (same group). */
    getViewColumn: () => vscode.ViewColumn | undefined;
}

/**
 * Opens a single code block as a real temp file in extension storage, giving the
 * user the full VS Code editor (highlighting, IntelliSense, formatting) scoped to
 * that one block. On explicit save the matching code fence in the source `.md` is
 * patched via `patchBlockCode`; on teardown the temp file is deleted.
 *
 * - Temp file lives at `<storageUri>/blockEdit/<slug>.<ext>` — never in the vault.
 * - Language is set explicitly with `setTextDocumentLanguage` (guarded by
 *   `getLanguages()`); the file extension is cosmetic.
 * - Sync is **save-only** (`onDidSaveTextDocument`), not live.
 *
 * @example
 * const ctrl = new BlockEditController(cb);
 * await ctrl.start(artifact, { kind: 'single' }, artifact.code, artifact.frontmatter.language);
 * // …later, before disposing the panel:
 * await ctrl.teardown();
 */
export class BlockEditController {
    private subs: vscode.Disposable[] = [];
    private tempUri: vscode.Uri | undefined;
    private sourceUri: vscode.Uri | undefined;
    private blockRef: BlockRef | undefined;

    constructor(private readonly cb: BlockEditCallbacks) {}

    /**
     * Writes the block code to a temp file, opens it beside the preview, sets its
     * language, and arms the save watcher. Replaces any previous session.
     *
     * @param artifact - The artifact (single-block file, or block-adapted) owning the code.
     * @param blockRef - Identifies which code fence in the source `.md` to patch.
     * @param code     - Initial code body to seed the temp file with.
     * @param language - Fence/frontmatter language hint used to resolve the editor language.
     *
     * @example
     * await controller.start(a, { kind: 'multi', heading: 'Production' }, a.code, a.frontmatter.language);
     */
    async start(
        artifact: ParsedArtifactFile,
        blockRef: BlockRef,
        code: string,
        language: string | undefined,
    ): Promise<void> {
        await this.teardown();

        // ── Resolve language + cosmetic extension ─────────────────────────────
        const known  = await vscode.languages.getLanguages();
        const langId = resolveLangId(language, language, known);
        const ext    = extForLang(langId);
        const base   = slugify(artifact.frontmatter.title || artifact.fileName) || 'block';

        // ── Write + open the temp file in extension storage ───────────────────
        const dir     = vscode.Uri.joinPath(this.cb.storageUri, 'blockEdit');
        await vscode.workspace.fs.createDirectory(dir);
        const tempUri = vscode.Uri.joinPath(dir, `${base}.${ext}`);
        await vscode.workspace.fs.writeFile(tempUri, new TextEncoder().encode(code));

        const doc = await vscode.workspace.openTextDocument(tempUri);
        if (known.includes(langId)) {
            await vscode.languages.setTextDocumentLanguage(doc, langId);
        }
        const column = this.cb.getViewColumn() ?? vscode.ViewColumn.Beside;
        await vscode.window.showTextDocument(doc, { viewColumn: column, preview: false });

        // ── Record state + arm the save watcher ───────────────────────────────
        this.tempUri   = tempUri;
        this.sourceUri = vscode.Uri.file(artifact.filePath);
        this.blockRef  = blockRef;

        const key = tempUri.toString();
        this.subs.push(
            vscode.workspace.onDidSaveTextDocument(d => {
                if (d.uri.toString() !== key) { return; }
                void this.onSave(d.getText());
            }),
        );
        out.appendLine(`[blockEdit] start → ${base}.${ext} (lang=${langId}, ref=${blockRef.kind})`);
    }

    /**
     * Disposes the save watcher and deletes the temp file. Safe to call multiple
     * times; always run before disposing the preview panel.
     *
     * @example
     * await controller.teardown();
     */
    async teardown(): Promise<void> {
        this.subs.forEach(s => s.dispose());
        this.subs = [];
        const temp = this.tempUri;
        this.tempUri   = undefined;
        this.sourceUri = undefined;
        this.blockRef  = undefined;
        if (temp) {
            try { await vscode.workspace.fs.delete(temp); }
            catch { /* already gone — ignore */ }
        }
    }

    /**
     * Patches the source `.md` with the saved temp content, re-parses, and pushes
     * the refreshed artifact back to the preview.
     */
    private async onSave(newCode: string): Promise<void> {
        if (!this.sourceUri || !this.blockRef) { return; }
        if (!this.cb.getCurrentArtifact()) { return; }

        try {
            const bytes   = await vscode.workspace.fs.readFile(this.sourceUri);
            const content = new TextDecoder().decode(bytes);
            const patched = patchBlockCode(content, this.blockRef, newCode);
            if (patched === content) {
                out.appendLine('[blockEdit] save: no change (block not found?)');
                return;
            }

            await vscode.workspace.fs.writeFile(this.sourceUri, new TextEncoder().encode(patched));
            const updated = parseFromContent(patched, this.sourceUri.fsPath, this.cb.rootFs);
            this.cb.setCache(this.sourceUri, updated);

            const next = this.adaptForPreview(updated);
            this.cb.setCurrentArtifact(next);
            this.cb.postMessage({ command: 'fileUpdated', artifact: next });
            out.appendLine('[blockEdit] save: patched source .md');
        } catch (e) {
            out.appendLine(`[blockEdit] save failed: ${(e as Error).message}`);
        }
    }

    /**
     * For a multi-block ref, re-adapts the matching block from the freshly parsed
     * file so the preview keeps showing that block. For a single ref, the whole
     * file artifact is the preview artifact.
     */
    private adaptForPreview(updated: ParsedArtifactFile): ParsedArtifactFile {
        if (this.blockRef?.kind !== 'multi') { return updated; }
        const heading = this.blockRef.heading;
        const block   = updated.blocks.find(b => b.heading === heading);
        return block ? blockAsArtifact(block, updated) : updated;
    }
}
