import * as vscode from 'vscode';
import { parseFromContent } from '../../../services/parser.service.js';
import { renderCodeHtml, renderCodeRowsHtml } from '../../../services/render.service.js';
import { patchFrontmatterField, patchVarDefaults, type BlockRef } from '../../../services/artifact-patcher.service.js';
import { PreviewModeController, type SectionKey } from '../../../services/preview-mode.service.js';
import { getNonce } from '../../../utils/helpers.js';
import type { ParsedArtifactFile } from '../../../types/parsed-artifact.types.js';
import { out } from './shared.js';
import { POPUP_VIEW_TYPE, performInsert } from './preview.helpers.js';
import { renderPreviewHtml, renderMultiBlockPreviewHtml, renderPopupEmptyHtml, mergeVarsWithDefaults } from './preview.render.js';
import { FullEditController } from './fullEditor.js';
import { BlockEditController } from './blockEditor.js';
import { VarSetController } from './varSetController.js';

// Re-export the adapter so the navigator does not need to import preview.helpers directly.
export { blockAsArtifact } from './preview.helpers.js';

/** Callback bag the controller uses to push state back to the navigator. */
export interface PreviewCallbacks {
    extensionUri: vscode.Uri;
    rootFs: string;
    targetEditor: vscode.TextEditor | undefined;
    /** Updates the navigator's parse cache after a save round-trip. */
    setCache: (uri: vscode.Uri, parsed: ParsedArtifactFile) => void;
    /** Notifies the navigator that the popup webview has been disposed. */
    onDispose: () => void;
    /** Closes the QuickPick (called from `handleInsert`). */
    closePicker: () => void;
    /** Extension storage dir for block-edit temp files (`context.storageUri ?? globalStorageUri`). */
    storageUri: vscode.Uri;
}

/**
 * Owns the popup `WebviewPanel` lifecycle, all preview HTML rendering, the
 * webview ↔ extension message protocol, and the embedded `FullEditController`.
 *
 * Created lazily by the navigator once the user starts hovering an item.
 *
 * @example
 * const ctrl = new PreviewPanelController({ extensionUri, rootFs, targetEditor, setCache, onDispose, closePicker });
 * await ctrl.showPreview(artifact);
 */
export class PreviewPanelController {
    private panel: vscode.WebviewPanel | undefined;
    private cssUri: string[] = [];
    private cspSource = '';
    private currentArtifact: ParsedArtifactFile | undefined;
    private modeController: PreviewModeController | undefined;
    private msgSub: vscode.Disposable | undefined;
    private readonly fullEdit:  FullEditController;
    private readonly blockEdit: BlockEditController;
    private readonly varSet:    VarSetController;
    /** Which code fence the Edit Block action targets; updated on each `showPreview`. */
    private currentBlockRef: BlockRef = { kind: 'single' };

    constructor(private readonly cb: PreviewCallbacks) {
        this.fullEdit = new FullEditController({
            rootFs:              cb.rootFs,
            getCurrentArtifact:  () => this.currentArtifact,
            setCurrentArtifact:  a => { this.currentArtifact = a; },
            setCache:            cb.setCache,
            postMessage:         msg => { void this.panel?.webview.postMessage(msg); },
            getViewColumn:       () => this.panel?.viewColumn,
        });
        this.blockEdit = new BlockEditController({
            rootFs:              cb.rootFs,
            storageUri:          cb.storageUri,
            getCurrentArtifact:  () => this.currentArtifact,
            setCurrentArtifact:  a => { this.currentArtifact = a; },
            setCache:            cb.setCache,
            postMessage:         msg => { void this.panel?.webview.postMessage(msg); },
            getViewColumn:       () => this.panel?.viewColumn,
        });
        this.varSet = new VarSetController(cb.extensionUri, {
            getCurrentArtifact: () => this.currentArtifact,
            postMessage:        msg => { void this.panel?.webview.postMessage(msg); },
            rememberAppliedSet: (subSetName, varNames) => {
                if (!this.modeController) { return; }
                for (const name of varNames) { this.modeController.setVarSource(name, subSetName); }
            },
        });
    }

    /** True when the popup panel currently exists (regardless of visibility). */
    isOpen(): boolean { return this.panel !== undefined; }

    /**
     * Brings the popup tab into view in its column.
     *
     * @param preserveFocus - When `true`, keeps focus on the QuickPick (used during
     *                        navigation).  Pass `false` after the picker hides to
     *                        focus the panel for interaction.
     */
    reveal(preserveFocus: boolean): void {
        this.panel?.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, preserveFocus);
    }

    /** Disposes the popup panel — the dispose listener fires `cb.onDispose`. */
    dispose(): void { this.panel?.dispose(); }

    // ── Renderers ─────────────────────────────────────────────────────────────

    /**
     * Creates (once per session) or updates the popup in interactive preview mode.
     *
     * @param artifact - Single-block artifact (or block-adapted artifact) to display.
     * @param blockRef - Which source `.md` code fence the Edit Block action targets.
     *                   Defaults to `{ kind: 'single' }`; pass `{ kind: 'multi', heading }`
     *                   when previewing a block of a multi-block file.
     */
    showPreview(artifact: ParsedArtifactFile, blockRef?: BlockRef): void {
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.currentArtifact = artifact;
        this.currentBlockRef = blockRef ?? { kind: 'single' };
        this.modeController  = new PreviewModeController(artifact.code);

        if (!this.ensurePanel()) { return; }

        const codeRowsHtml = renderCodeRowsHtml(artifact.code, artifact.frontmatter.language);
        const varSources   = this.modeController?.getAllVarSources() ?? {};
        this.panel!.webview.html = renderPreviewHtml(artifact, codeRowsHtml, getNonce(), this.cssUri, this.cspSource, varSources);
        this.setupMessageHandler();
        this.reveal(true);
        out.appendLine(`[popup] preview → ${artifact.fileName}`);
    }

    /**
     * Creates (once per session) or updates the popup with a stacked multi-block preview.
     *
     * @param artifact - Multi-block artifact to preview.
     */
    showMultiBlockPreview(artifact: ParsedArtifactFile): void {
        if (!this.ensurePanel()) { return; }

        const highlightedBlocks = artifact.blocks.map(b => ({
            heading:     b.heading,
            codeHtml:    renderCodeHtml(b.code, b.fenceLang ?? artifact.frontmatter.language),
            vars:        b.vars,
            description: b.description,
        }));
        this.panel!.webview.html = renderMultiBlockPreviewHtml(artifact, highlightedBlocks, this.cssUri, this.cspSource);
        this.reveal(true);
        out.appendLine(`[popup] multi-block preview → ${artifact.fileName} (${artifact.blocks.length} blocks)`);
    }

    /** Replaces the panel HTML with the empty-state placeholder. */
    showEmpty(): void {
        if (!this.panel) { return; }
        this.panel.webview.html = renderPopupEmptyHtml(this.cssUri, this.cspSource);
    }

    // ── Internal: panel lifecycle ─────────────────────────────────────────────

    private ensurePanel(): boolean {
        if (this.panel) { return true; }
        try {
            this.panel = vscode.window.createWebviewPanel(
                POPUP_VIEW_TYPE,
                'Artifact Preview',
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                {
                    enableScripts:           true,
                    retainContextWhenHidden: true,
                    localResourceRoots:      [vscode.Uri.joinPath(this.cb.extensionUri, 'src', 'ui')],
                },
            );
            this.panel.onDidDispose(() => {
                this.fullEdit.teardown();
                void this.blockEdit.teardown();
                this.msgSub?.dispose();
                this.msgSub          = undefined;
                this.panel           = undefined;
                this.modeController  = undefined;
                this.currentArtifact = undefined;
                this.cb.onDispose();
            });
            // Order matters — base.css carries the global reset every panel needs.
            this.cssUri = ['base.css', 'picker.css', 'code-block.css', 'hljs.css', 'varset.css'].map(
                f => this.panel!.webview.asWebviewUri(
                    vscode.Uri.joinPath(this.cb.extensionUri, 'src', 'ui', f),
                ).toString(),
            );
            this.cspSource = this.panel.webview.cspSource;
            out.appendLine(`[popup] created`);
            return true;
        } catch (err) {
            out.appendLine(`[popup] create FAILED: ${(err as Error).message}`);
            return false;
        }
    }

    // ── Internal: webview message routing ─────────────────────────────────────

    private setupMessageHandler(): void {
        this.msgSub?.dispose();
        this.msgSub = undefined;
        if (!this.panel) { return; }
        this.msgSub = this.panel.webview.onDidReceiveMessage(msg => {
            void this.handleMessage(msg as Record<string, unknown>);
        });
    }

    private async handleMessage(msg: Record<string, unknown>): Promise<void> {
        const cmd = msg.command as string;
        if      (cmd === 'startEdit')     { this.modeController?.startEditingSection(msg.section as SectionKey); }
        else if (cmd === 'cancelEdit')    { this.modeController?.stopEditingSection(msg.section as SectionKey); }
        else if (cmd === 'quickEdit')     { this.modeController?.enterQuickEdit(); }
        else if (cmd === 'backToPreview') { this.modeController?.enterPreview(); }
        else if (cmd === 'fullEdit')      { this.handleFullEdit(); }
        else if (cmd === 'editBlock')     { await this.handleEditBlock(); }
        else if (cmd === 'saveSection')   { await this.handleSaveSection(msg); }
        else if (cmd === 'insert')        { this.handleInsert(msg); }
        else if (cmd === 'cancel')        { this.dispose(); }
        else if (cmd === 'pickVarSet')    { await this.varSet.handlePickVarSet(msg); }
        else if (cmd === 'confirmApply')  { this.varSet.handleConfirmApply(); }
        else if (cmd === 'cancelApply')   { this.varSet.handleCancelApply(); }
        else if (cmd === 'saveAsVarSet')  { await this.varSet.handleSaveAsVarSet(msg); }
        else if (cmd === 'clearVarSource'){ this.modeController?.clearVarSource(msg.name as string); }
    }

    private handleFullEdit(): void {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        this.modeController?.enterFullEdit();
        this.fullEdit.start(vscode.Uri.file(artifact.filePath));
    }

    /**
     * Opens just the previewed code block as a temp file in extension storage.
     * Saving that file patches the matching code fence in the source `.md` and
     * refreshes the preview via a `fileUpdated` round-trip.
     */
    private async handleEditBlock(): Promise<void> {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        await this.blockEdit.start(
            artifact,
            this.currentBlockRef,
            artifact.code,
            artifact.frontmatter.language,
        );
    }

    private async handleSaveSection(msg: Record<string, unknown>): Promise<void> {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        const fileUri = vscode.Uri.file(artifact.filePath);
        const section = msg.section as string;
        try {
            const bytes = await vscode.workspace.fs.readFile(fileUri);
            let content = new TextDecoder().decode(bytes);
            if (section === 'varDefaults') {
                content = patchVarDefaults(content, msg.value as Record<string, string>);
            } else {
                content = patchFrontmatterField(content, section, msg.value as string);
            }
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
            const updated = parseFromContent(content, fileUri.fsPath, this.cb.rootFs);
            this.cb.setCache(fileUri, updated);
            this.currentArtifact = updated;
            this.modeController?.stopEditingSection(section as SectionKey);
            // sectionSaved before fileUpdated so the webview exits edit mode first,
            // then fileUpdated can safely update all non-editing sections.
            void this.panel?.webview.postMessage({ command: 'sectionSaved', section, success: true });
            void this.panel?.webview.postMessage({ command: 'fileUpdated', artifact: updated });
        } catch {
            void this.panel?.webview.postMessage({ command: 'sectionSaved', section, success: false });
        }
    }

    private handleInsert(msg: Record<string, unknown>): void {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        const code         = this.resolveInsertCode(msg, artifact);
        const resolvedVars = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);

        performInsert(this.cb.targetEditor, { ...artifact, code }, resolvedVars);
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.dispose();
        this.cb.closePicker();
    }

    /**
     * Picks the canonical code source for `Insert`:
     *   - fullEdit mode → live `.md` document content (may have unsaved external edits)
     *   - else          → `msg.code` from the contenteditable webview surface
     *   - fallback      → `artifact.code` (last parsed snapshot)
     */
    private resolveInsertCode(msg: Record<string, unknown>, artifact: ParsedArtifactFile): string {
        const mode = this.modeController?.mode ?? 'preview';
        if (mode === 'fullEdit') {
            const fileUri = vscode.Uri.file(artifact.filePath);
            const openDoc = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
            if (openDoc) {
                return parseFromContent(openDoc.getText(), artifact.filePath, this.cb.rootFs).code;
            }
        }
        return typeof msg.code === 'string' ? msg.code : artifact.code;
    }
}

