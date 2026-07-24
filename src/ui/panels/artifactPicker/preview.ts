import * as vscode from 'vscode';
import { parseFromContent, resolveVars } from '../../../services/parser.service.js';
import { renderCodeHtml, renderCodeRowsHtml } from '../../../services/render.service.js';
import { validateSingleBlock, resolveOutputFileName } from '../../../services/template.service.js';
import { writesWholeFile, getTypeSingular } from '../../../services/artifact-type-config.service.js';
import { writeTemplateFile } from '../../../services/template-writer.service.js';
import { resolveDestination } from '../../../services/template-destination.service.js';
import { validateTargetFileName } from '../../../services/filename.service.js';
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
    /** Explorer URI a Template was invoked on (D2); `undefined` for non-template flows. */
    destUri?: vscode.Uri;
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

        // Templates and agent configs write a whole file into the workspace instead
        // of inserting at the cursor. The webview keeps posting the existing `insert`
        // message; the branch happens here so preview.clientJs.ts / webview-messages
        // need no edit. `writesWholeFile` is the single source shared with the label.
        if (writesWholeFile(artifact.frontmatter.type)) {
            void this.handleCreateFile(msg, artifact);
            return;
        }

        const code         = this.resolveInsertCode(msg, artifact);
        const resolvedVars = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);

        performInsert(this.cb.targetEditor, { ...artifact, code }, resolvedVars);
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.dispose();
        this.cb.closePicker();
    }

    /**
     * Create File flow for `type: template`: enforce D1, resolve the destination
     * and filename, substitute variables, write into the workspace, then open the
     * new file. Any rejection (bad block count, cancelled prompt, containment
     * failure) stops the flow without writing.
     */
    private async handleCreateFile(msg: Record<string, unknown>, artifact: ParsedArtifactFile): Promise<void> {
        const type = artifact.frontmatter.type;

        // ── D1: single-block only (template) / one config file (agent) ────────
        const blockCheck = validateSingleBlock(artifact, getTypeSingular(type));
        if (!blockCheck.ok) {
            void vscode.window.showErrorMessage(`Obsidian Artifacts: ${blockCheck.reason}`);
            return;
        }

        // ── Destination (D2) + containment root ───────────────────────────────
        const destDir = await resolveDestination(this.cb.destUri);
        if (!destDir) { return; }  // no workspace open, or the folder picker was cancelled
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(destDir)?.uri;
        if (!workspaceRoot) {
            void vscode.window.showErrorMessage('Obsidian Artifacts: Destination is not inside an open workspace folder.');
            return;
        }

        // ── Default filename — throws on a hostile frontmatter value ──────────
        // Per-type naming (template = D3 extension precedence, agent = `target:`
        // verbatim) is the service's decision, not the panel's; a hostile value
        // throws here rather than being sanitised into a plausible path.
        let defaultName: string;
        try {
            defaultName = resolveOutputFileName(artifact);
        } catch (err) {
            void vscode.window.showErrorMessage(`Obsidian Artifacts: ${(err as Error).message}`);
            return;
        }

        const fileName = await this.askFileName(defaultName);
        if (fileName === undefined) { return; }  // cancelled

        // ── Resolve variables into the file content, then write ───────────────
        const code    = this.resolveInsertCode(msg, artifact);
        const vars    = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);
        const content = resolveVars(code, vars);

        const finalPath = await this.writeWithCollisionHandling(workspaceRoot, destDir, fileName, content);
        if (finalPath === undefined) { return; }  // cancelled or errored (message already shown)

        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(finalPath));
        await vscode.window.showTextDocument(doc);
        this.dispose();
        this.cb.closePicker();
    }

    /**
     * Prompts for a target filename, seeded with `defaultValue` and validated
     * live by `validateTargetFileName` (workspace-target rules, T3).
     *
     * @param defaultValue - Prefilled, fully-editable filename (raw title + ext, P5).
     * @returns The confirmed filename, or `undefined` when the user cancels.
     */
    private async askFileName(defaultValue: string): Promise<string | undefined> {
        return vscode.window.showInputBox({
            prompt:         'File name for the new file',
            value:          defaultValue,
            ignoreFocusOut: true,
            validateInput:  v => {
                const r = validateTargetFileName(v);
                return r.ok ? undefined : r.reason;
            },
        });
    }

    /**
     * Writes the template file, resolving collisions interactively: on an existing
     * file the user chooses Overwrite (retry with `force`), Rename (re-prompt), or
     * Cancel. Containment/error results surface a message and abort.
     *
     * @returns The written file's absolute path, or `undefined` on cancel/error.
     */
    private async writeWithCollisionHandling(
        workspaceRoot: vscode.Uri,
        destDir: vscode.Uri,
        fileName: string,
        content: string,
    ): Promise<string | undefined> {
        let name  = fileName;
        let force = false;
        for (;;) {
            const result = await writeTemplateFile({ workspaceRoot, destDir, fileName: name, content, force });
            if (result.kind === 'success') { return result.filePath; }
            if (result.kind === 'error') {
                void vscode.window.showErrorMessage(`Obsidian Artifacts: ${result.message}`);
                return undefined;
            }
            // ── collision → ask ────────────────────────────────────────────────
            const choice = await vscode.window.showWarningMessage(
                `"${name}" already exists in that folder.`, { modal: true }, 'Overwrite', 'Rename');
            if (choice === 'Overwrite') { force = true; continue; }
            if (choice !== 'Rename')    { return undefined; }  // Cancel / dismissed
            const renamed = await this.askFileName(name);
            if (renamed === undefined) { return undefined; }
            name  = renamed;
            force = false;
        }
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

