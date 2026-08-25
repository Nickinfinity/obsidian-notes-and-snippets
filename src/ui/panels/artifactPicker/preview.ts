import * as vscode from 'vscode';
import { parseFromContent, resolveVars } from '../../../services/parser.service.js';
import { renderCodeHtml, renderCodeRowsHtml } from '../../../services/render.service.js';
import { writesWholeFile } from '../../../services/artifact-type-config.service.js';
import { patchFrontmatterField, patchVarDefaults, type BlockRef } from '../../../services/artifact-patcher.service.js';
import { PreviewModeController, type SectionKey } from '../../../services/preview-mode.service.js';
import { getNonce } from '../../../utils/helpers.js';
import type { ParsedArtifactFile } from '../../../types/parsed-artifact.types.js';
import { out } from './shared.js';
import { performInsert, type InvocationSurface } from './preview.helpers.js';
import type { WebviewHost, HostMessage } from './webviewHost.js';
import type { MainViewPreviewState } from '../../views/mainView.preview.js';
import { renderPreviewHtml, renderMultiBlockPreviewHtml, renderPopupEmptyHtml, mergeVarsWithDefaults } from './preview.render.js';
import { FullEditController } from './fullEditor.js';
import { BlockEditController } from './blockEditor.js';
import { VarSetController } from './varSetController.js';
import { runCreateFileFlow, toBatchOutcome } from './preview.createFile.js';
import { BatchGate } from './preview.batch.js';
import { isIndexArtifact } from '../../../services/multi-index.service.js';
import type { BatchOutcome } from '../../../types/multi-index.types.js';

// Re-export the adapter so the navigator does not need to import preview.helpers directly.
export { blockAsArtifact } from './preview.helpers.js';

/** Callback bag the controller uses to push state back to the navigator. */
export interface PreviewCallbacks {
    extensionUri: vscode.Uri;
    rootFs: string;
    targetEditor: vscode.TextEditor | undefined;
    /** Updates the navigator's parse cache after a save round-trip. */
    setCache: (uri: vscode.Uri, parsed: ParsedArtifactFile) => void;
    /** Notifies the navigator that the preview session has ended. */
    onDispose: () => void;
    /**
     * The webview transport the preview renders into — the main pane
     * (Wave 7). Queues posts while the pane is hidden and distinguishes a
     * hide-dispose from a real teardown (H1/H2).
     */
    host: WebviewHost;
    /**
     * Reveals the main pane, waits for `resolveWebviewView` to have fired,
     * and attaches the live view to {@link host} (H3).
     *
     * Awaiting the reveal command alone is not enough — it settles when the
     * reveal completes, not when the provider callback runs (ledger #116).
     */
    ensureView: () => Promise<void>;
    /** Returns the pane to `idle` when the preview ends (Cancel, Insert, Create File). */
    endPreview: () => void;
    /**
     * Renders a preview state into the pane.
     *
     * The provider is the **single writer** of `webview.html` — routing HTML
     * through it rather than `host.setHtml` keeps one renderer for the pane's
     * two modes instead of two writers racing the same property.
     */
    showPreviewState: (state: MainViewPreviewState) => void;
    /** Subscribes to inbound webview messages; the provider owns the webview. */
    onWebviewMessage: (handler: (msg: Record<string, unknown>) => void) => vscode.Disposable;
    /** Closes the QuickPick (called from `handleInsert`). */
    closePicker: () => void;
    /** Extension storage dir for block-edit temp files (`context.storageUri ?? globalStorageUri`). */
    storageUri: vscode.Uri;
    /** Explorer URI a Template was invoked on (D2); `undefined` for non-template flows. */
    destUri?: vscode.Uri;
    /** Which context-menu surface the insert command was invoked from (T3); threaded to `performInsert`. */
    invocationSurface: InvocationSurface;
}

/**
 * Owns the preview session in the main pane: reveal/attach lifecycle, the
 * webview ↔ extension message protocol, and the embedded sub-controllers.
 * Created lazily by the navigator once the user starts hovering an item.
 *
 * The pane itself renders (`MainViewProvider`); this controller decides *what*
 * state to show and owns everything around it.
 *
 * @example
 * new PreviewPanelController({ extensionUri, rootFs, targetEditor, setCache, onDispose, closePicker }).showPreview(artifact);
 */
export class PreviewPanelController {
    /** True between the first render and the end of the preview session. */
    private open = false;
    private cssUri: string[] = [];
    private cspSource = '';
    private currentArtifact: ParsedArtifactFile | undefined;
    private modeController: PreviewModeController | undefined;
    private msgSub: vscode.Disposable | undefined;
    private readonly fullEdit:  FullEditController;
    private readonly blockEdit: BlockEditController;
    private readonly varSet:    VarSetController;
    private readonly batch = new BatchGate();  // one-shot per-step gate a MultiIndexRunner arms (T4)
    /** Which code fence the Edit Block action targets; updated on each `showPreview`. */
    private currentBlockRef: BlockRef = { kind: 'single' };

    constructor(private readonly cb: PreviewCallbacks) {
        this.fullEdit = new FullEditController({
            rootFs:              cb.rootFs,
            getCurrentArtifact:  () => this.currentArtifact,
            setCurrentArtifact:  a => { this.currentArtifact = a; },
            setCache:            cb.setCache,
            postMessage:         msg => { this.postToWebview(msg); },
            getViewColumn:       () => undefined,
        });
        this.blockEdit = new BlockEditController({
            rootFs:              cb.rootFs,
            storageUri:          cb.storageUri,
            getCurrentArtifact:  () => this.currentArtifact,
            setCurrentArtifact:  a => { this.currentArtifact = a; },
            setCache:            cb.setCache,
            postMessage:         msg => { this.postToWebview(msg); },
            getViewColumn:       () => undefined,
        });
        this.varSet = new VarSetController(cb.extensionUri, {
            getCurrentArtifact: () => this.currentArtifact,
            postMessage:        msg => { this.postToWebview(msg); },
            rememberAppliedSet: (subSetName, varNames) => {
                if (!this.modeController) { return; }
                for (const name of varNames) { this.modeController.setVarSource(name, subSetName); }
            },
        });
    }

    /**
     * Posts a sub-controller's message through the host.
     *
     * The sub-controllers' bags are typed `unknown` (they predate the host),
     * so this narrows rather than casts: a message with no string `command`
     * is dropped, because the queue keys on that field and an entry without
     * one could never be collapsed or flushed correctly.
     *
     * @param msg - Candidate message from a sub-controller.
     *
     * @example
     * this.postToWebview({ command: 'updateVars', vars });
     */
    private postToWebview(msg: unknown): void {
        if (typeof msg !== 'object' || msg === null) { return; }
        if (typeof (msg as { command?: unknown }).command !== 'string') { return; }
        this.cb.host.post(msg as HostMessage);
    }

    /** True while a preview session is active (regardless of pane visibility). */
    isOpen(): boolean { return this.open; }

    /**
     * Reveals the main pane and waits for its view to be live.
     *
     * `preserveFocus` is accepted for call-site compatibility but no longer
     * meaningful: an activity-bar pane is revealed by its own focus command,
     * which cannot reveal-without-focusing the way a `WebviewPanel` could.
     *
     * @param _preserveFocus - Ignored; see above.
     * @returns Resolves once the pane's view has resolved.
     *
     * @example
     * await controller.reveal(false);
     */
    async reveal(_preserveFocus: boolean): Promise<void> {
        await this.cb.ensureView();
    }

    /** Ends the preview session and returns the pane to `idle`. */
    dispose(): void {
        if (!this.open) { return; }
        this.open = false;
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.msgSub?.dispose();
        this.msgSub          = undefined;
        this.modeController  = undefined;
        this.currentArtifact = undefined;
        this.batch.settle({ kind: 'aborted' });  // no-op unless still armed (D5)
        this.cb.endPreview();
        this.cb.onDispose();
    }

    /** `MultiIndexRunner`'s per-step hook: arms the batch gate, shows the preview,
     *  reveals the panel, and returns the gate's promise (settled by `handleCreateFile` /
     *  `cancel` / `onDidDispose`). */
    previewOnce(artifact: ParsedArtifactFile, destDir: vscode.Uri): Promise<BatchOutcome> {
        const outcome = this.batch.arm(destDir);
        this.showPreview(artifact);
        this.reveal(false);
        return outcome;
    }

    // ── Renderers ─────────────────────────────────────────────────────────────

    /**
     * Shows the artifact in the main pane's interactive preview mode.
     *
     * @param artifact - Single-block artifact (or block-adapted artifact) to display.
     * @param blockRef - Source `.md` fence the Edit Block action targets; defaults
     *                   to `{ kind: 'single' }`.
     * @returns Resolves once the pane has rendered.
     *
     * @example
     * await controller.showPreview(artifact);
     */
    async showPreview(artifact: ParsedArtifactFile, blockRef?: BlockRef): Promise<void> {
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.currentArtifact = artifact;
        this.currentBlockRef = blockRef ?? { kind: 'single' };
        this.modeController  = new PreviewModeController(artifact.code);

        // Before `ensureHost`, never after: `ensureView` re-attaches the target
        // and `attachTarget` flushes a visible one, so clearing afterwards would
        // run *after* the flush it exists to prevent (ledger #119).
        this.cb.host.clearQueue();
        if (!await this.ensureHost()) { return; }

        const varSources = this.modeController?.getAllVarSources() ?? {};
        this.cb.showPreviewState({ kind: 'single', artifact, varSources });
        this.setupMessageHandler();
        out.appendLine(`[pane] preview → ${artifact.fileName}`);
    }

    /**
     * Shows a stacked multi-block preview in the main pane.
     *
     * @param artifact - Multi-block artifact to preview.
     * @returns Resolves once the pane has rendered.
     *
     * @example
     * await controller.showMultiBlockPreview(artifact);
     */
    async showMultiBlockPreview(artifact: ParsedArtifactFile): Promise<void> {
        this.cb.host.clearQueue();   // before ensureHost — see showPreview (ledger #119)
        if (!await this.ensureHost()) { return; }
        this.cb.showPreviewState({ kind: 'multi', artifact });
        out.appendLine(`[pane] multi-block preview → ${artifact.fileName} (${artifact.blocks.length} blocks)`);
    }

    /** Renders the empty state, leaving the pane in `preview` mode. */
    showEmpty(): void {
        if (!this.open) { return; }
        this.cb.showPreviewState({ kind: 'empty' });
    }

    // ── Internal: host lifecycle ──────────────────────────────────────────────

    /**
     * Reveals the pane, attaches it to the host, and wires the session's
     * lifecycle listeners.
     *
     * **Re-ensures on every render, not once per session.** Hiding an
     * activity-bar view via its context menu *disposes* it, which nulls the
     * provider's `view` — so an `if (this.open) return` fast path left the
     * pane permanently dead after the first hide: the next `showPreview`
     * changed no HTML, raised no error and logged nothing (ledger #119).
     * `ensureView` is cheap when the view is already live.
     *
     * **H2 — a hide is not a cancel.** The old popup aborted the batch gate
     * from `panel.onDidDispose`; hiding a view also disposes it, so that
     * wiring would abort a multi-index run whenever the user looked at
     * another container. Only an explicit end — Cancel, Insert, Create File —
     * calls {@link dispose}.
     *
     * @returns `true` when the pane is live and rendering can proceed.
     */
    private async ensureHost(): Promise<boolean> {
        try {
            await this.cb.ensureView();
            if (!this.open) {
                this.open = true;
                out.appendLine('[pane] preview session opened');
            }
            return true;
        } catch (err) {
            out.appendLine(`[pane] reveal FAILED: ${(err as Error).message}`);
            return false;
        }
    }

    // ── Internal: webview message routing ─────────────────────────────────────

    private setupMessageHandler(): void {
        this.msgSub?.dispose();
        this.msgSub = undefined;
        if (!this.open) { return; }
        this.msgSub = this.cb.onWebviewMessage(msg => {
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
        else if (cmd === 'copy')          { this.handleCopy(msg); }
        else if (cmd === 'cancel')        { this.cancel(); }
        else if (cmd === 'pickVarSet')    { await this.varSet.handlePickVarSet(msg); }
        else if (cmd === 'confirmApply')  { this.varSet.handleConfirmApply(); }
        else if (cmd === 'cancelApply')   { this.varSet.handleCancelApply(); }
        else if (cmd === 'saveAsVarSet')  { await this.varSet.handleSaveAsVarSet(msg); }
        else if (cmd === 'clearVarSource'){ this.modeController?.clearVarSource(msg.name as string); }
    }

    /** Cancel: settles the batch gate `skipped` when armed (D5); else disposes as before. */
    private cancel(): void { if (this.batch.isArmed) { this.batch.settle({ kind: 'skipped' }); return; } this.dispose(); }

    private handleFullEdit(): void {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        this.modeController?.enterFullEdit();
        this.fullEdit.start(vscode.Uri.file(artifact.filePath));
    }

    /**
     * Opens just the previewed code block as a temp file in extension storage;
     * saving it patches the matching fence in the source `.md` (`fileUpdated`).
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
            this.cb.host.post({ command: 'sectionSaved', section, success: true });
            this.cb.host.post({ command: 'fileUpdated', artifact: updated });
        } catch {
            this.cb.host.post({ command: 'sectionSaved', section, success: false });
        }
    }

    private handleInsert(msg: Record<string, unknown>): void {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }

        // Index guard (F7): a hovered index still renders Create File — only an armed run may write it.
        if (isIndexArtifact(artifact.frontmatter) && !this.batch.isArmed) {
            void vscode.window.showInformationMessage('This is a template index — press Enter in the picker to run it.'); return;
        }
        // Templates/agent configs write a whole file instead of inserting at the
        // cursor; `writesWholeFile` is the single source shared with the label.
        if (writesWholeFile(artifact.frontmatter.artifactType)) {
            void this.handleCreateFile(msg, artifact);
            return;
        }

        const code         = this.resolveInsertCode(msg, artifact);
        const resolvedVars = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);

        void performInsert(this.cb.targetEditor, { ...artifact, code }, resolvedVars, this.cb.invocationSurface);
        this.fullEdit.teardown();
        void this.blockEdit.teardown();
        this.dispose();
        this.cb.closePicker();
    }

    /**
     * Copies the resolved code to the clipboard — every artifact type, no
     * `writesWholeFile` / `isIndexArtifact` branching (T2 — the button is
     * universal by design). Resolution mirrors `handleInsert`: the same
     * `resolveInsertCode` + `mergeVarsWithDefaults` → `resolveVars` chain,
     * so Copy and Insert never disagree on what "this artifact" means.
     * @param msg - `{ code, vars }` posted by the webview's Copy button.
     * @example this.handleCopy({ code: 'ping <VK-host>', vars: { 'VK-host': 'db' } });
     */
    private handleCopy(msg: Record<string, unknown>): void {
        const artifact = this.currentArtifact;
        if (!artifact) { return; }
        const code         = this.resolveInsertCode(msg, artifact);
        const resolvedVars = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);
        // Chained, not fire-and-forget: a remote/SSH host can reject the write, and the
        // toast must not claim success when it did (reviewer finding 1).
        void vscode.env.clipboard.writeText(resolveVars(code, resolvedVars))
            .then(() => vscode.window.showInformationMessage('Obsidian Artifacts: Copied to clipboard.'));
    }

    /** Routes to the Create File flow (D12); armed (batch step) pins `destDir`, skips
     *  the tab-open (D7), and settles the gate instead of closing the panel/picker. */
    private async handleCreateFile(msg: Record<string, unknown>, artifact: ParsedArtifactFile): Promise<void> {
        const code = this.resolveInsertCode(msg, artifact);
        const vars = mergeVarsWithDefaults(msg.vars as Record<string, string>, artifact.vars);
        const result = await runCreateFileFlow({
            artifact, code, vars, destDir: this.batch.destDir,
            destUri: this.cb.destUri, openAfterWrite: !this.batch.isArmed,
        });
        if (this.batch.isArmed) { this.batch.settle(toBatchOutcome(result, vars)); return; }
        if (result.kind === 'written') { this.dispose(); this.cb.closePicker(); }
    }

    /**
     * Canonical code source for `Insert`: fullEdit mode → live `.md` document;
     * else `msg.code` from the webview; fallback → `artifact.code`.
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

