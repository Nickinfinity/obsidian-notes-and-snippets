import * as vscode from 'vscode';
import { buildFormHtml } from './form.html.js';
import { FORM_CLIENT_JS } from './form.clientJs.js';
import { defaultModel } from './form.helpers.js';
import { pruneVarsForSave } from './panel.helpers.js';
import { serializeArtifact } from '../../../services/artifact-serializer.service.js';
import { writeArtifact } from '../../../services/artifact-writer.service.js';
import { pickDestFolder } from '../destFolderPicker.panel.js';
import { validateArtifactFilename, deriveFileName } from '../../../services/filename.service.js';
import { extractVars } from '../../../services/parser.service.js';
import { getNonce } from '../../../utils/helpers.js';
import { getEntry, getTypeSingular } from '../../../services/artifact-type-config.service.js';
import { getVaultRootUri } from '../../../services/config.service.js';
import { renderCodeRowsHtml } from '../../../services/render.service.js';
import { buildCodeBlockHtml } from '../artifactPicker/codeBlock.js';
import type { ArtifactType } from '../../../types/parsed-artifact.types.js';
import type { ArtifactFormModel } from '../../../types/artifact-form.types.js';

// ── Public API ────────────────────────────────────────────────────────────────

const FORM_VIEW_TYPE = 'obsidian-artifacts.artifactForm';

/**
 * Options for opening the Artifact Form panel.
 *
 * @example
 * openArtifactFormPanel(context, { mode: 'create', type: 'snippet' })
 */
export interface OpenFormOpts {
    /** `'create'` or `'edit'` — only create implemented; edit seam marked. */
    mode: 'create' | 'edit';
    /** Artifact type to create/edit. */
    type: ArtifactType;
    /** Optional prefilled model (e.g. from editor selection — Phase 7). */
    prefill?: Partial<ArtifactFormModel>;
    /** Edit-mode seam — source file URI. Not used in create mode. */
    sourceUri?: vscode.Uri;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let currentController: ArtifactFormController | undefined;

/**
 * Opens the Artifact Form panel for create (or edit) mode.
 *
 * If the panel is already open, reveals it rather than spawning a new one.
 * The panel owns its own lifecycle; callers should not hold any reference.
 *
 * @param context - Extension context for resource roots and subscriptions.
 * @param opts    - See `OpenFormOpts`.
 *
 * @example
 * openArtifactFormPanel(context, { mode: 'create', type: 'snippet' });
 */
export function openArtifactFormPanel(
    context: vscode.ExtensionContext,
    opts: OpenFormOpts,
): void {
    if (currentController) {
        currentController.reveal();
        return;
    }
    currentController = new ArtifactFormController(context, opts);
    currentController.open();
}

// ── Controller ────────────────────────────────────────────────────────────────

/**
 * Owns the Artifact Form `WebviewPanel` lifecycle, message routing, and the
 * atomic save flow (§4.5): folder pick → filename prompt → serialize →
 * write (with collision resolution).
 *
 * Singleton enforced via module-level `currentController`. Second invocation of
 * `openArtifactFormPanel` reveals the existing panel.
 *
 * @example
 * const ctrl = new ArtifactFormController(context, opts);
 * ctrl.open();
 */
class ArtifactFormController {
    private panel: vscode.WebviewPanel | undefined;
    private dirty  = false;
    private subs: vscode.Disposable[] = [];

    private readonly model: ArtifactFormModel;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly opts:    OpenFormOpts,
    ) {
        // edit-mode seam: hydrate from sourceUri — not implemented, seam only
        // Merge prefill (Partial) onto defaultModel base so required fields
        // (type/title/description/tags) always present; prefill.blocks wins.
        this.model = opts.prefill
            ? { ...defaultModel(opts.type), ...opts.prefill }
            : defaultModel(opts.type);
    }

    /**
     * Creates the webview panel and wires message + dispose subscriptions.
     *
     * @example
     * controller.open();
     */
    open(): void {
        // opts.type always comes from getCreateFormTypes(), so the lookup cannot miss.
        const title = `Obsidian Artifacts: Create ${getEntry(this.opts.type).name}`;

        this.panel = vscode.window.createWebviewPanel(
            FORM_VIEW_TYPE,
            title,
            vscode.ViewColumn.Active,
            {
                enableScripts:            true,
                retainContextWhenHidden:  true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui')],
            },
        );

        this.render();

        this.subs.push(
            this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg as Record<string, unknown>)),
            this.panel.onDidDispose(() => this.onDisposed()),
        );
    }

    /**
     * Brings the existing panel back into view.
     *
     * @example
     * controller.reveal();
     */
    reveal(): void { this.panel?.reveal(vscode.ViewColumn.Active); }

    /**
     * Disposes the webview panel and clears the singleton reference.
     *
     * @example
     * controller.dispose();
     */
    dispose(): void { this.panel?.dispose(); }

    // ── Private ───────────────────────────────────────────────────────────────

    private onDisposed(): void {
        this.subs.forEach(s => s.dispose());
        this.subs      = [];
        this.panel     = undefined;
        currentController = undefined;
    }

    private render(): void {
        if (!this.panel) { return; }
        const nonce  = getNonce();
        // Order matters — base.css carries the global reset. No hljs.css: those
        // rules are all .popup-body-scoped and never applied to this panel.
        const cssUri = ['base.css', 'form.css', 'code-block.css'].map(
            f => this.panel!.webview.asWebviewUri(
                vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', f),
            ).toString(),
        );
        this.panel.webview.html = buildFormHtml({
            model:        this.model,
            cspSource:    this.panel.webview.cspSource,
            cssUri,
            nonce,
            codeBlockHtml: (code, lang) => buildCodeBlockHtml(renderCodeRowsHtml(code, lang), lang),
            clientJs:     FORM_CLIENT_JS,
        });
    }

    private post(msg: unknown): void {
        void this.panel?.webview.postMessage(msg);
    }

    // ── Message router ────────────────────────────────────────────────────────

    private handleMessage(msg: Record<string, unknown>): void {
        switch (msg['command']) {
            case 'markDirty':    this.dirty = true; break;
            case 'addBlock':     break;  // locally handled in client JS; no-op here
            case 'validateName': this.handleValidateName(String(msg['name'] ?? '')); break;
            case 'detectVars':   this.handleDetectVars(Number(msg['blockIndex']), String(msg['code'] ?? '')); break;
            case 'removeBlock':  void this.handleRemoveBlock(Number(msg['blockIndex'])); break;
            case 'deleteEntire': void this.handleDeleteEntire(); break;
            case 'cancel':       void this.handleCancel(Boolean(msg['dirty'])); break;
            case 'save':         void this.handleSave(msg['model'] as ArtifactFormModel); break;
        }
    }

    private handleValidateName(name: string): void {
        const result = validateArtifactFilename(name);
        this.post({ command: 'nameValidation', ok: result.ok, reason: result.reason });
    }

    private handleDetectVars(blockIndex: number, code: string): void {
        const vars = extractVars(code);
        this.post({ command: 'varsDetected', blockIndex, vars });
    }

    private async handleRemoveBlock(blockIndex: number): Promise<void> {
        const singular = getTypeSingular(this.opts.type);
        const answer   = await vscode.window.showWarningMessage(
            `This ${singular} block will be deleted. Continue?`,
            { modal: true },
            'Delete',
        );
        this.post({ command: 'removeBlockConfirmed', blockIndex, confirmed: answer === 'Delete' });
    }

    private async handleDeleteEntire(): Promise<void> {
        const singular = getTypeSingular(this.opts.type);
        const answer   = await vscode.window.showWarningMessage(
            `Delete entire ${singular}? All unsaved changes will be lost.`,
            { modal: true },
            'Delete',
        );
        if (answer === 'Delete') {
            this.dispose();
        } else {
            this.post({ command: 'deleteEntireConfirmed', confirmed: false });
        }
    }

    private async handleCancel(dirty: boolean): Promise<void> {
        if (!dirty) { this.dispose(); return; }
        const answer = await vscode.window.showWarningMessage(
            'Discard unsaved changes?',
            { modal: true },
            'Discard',
        );
        if (answer === 'Discard') {
            this.dispose();
        } else {
            this.post({ command: 'cancelConfirmed', confirmed: false });
        }
    }

    // ── Atomic save flow (§4.5) ───────────────────────────────────────────────

    private async handleSave(model: ArtifactFormModel): Promise<void> {
        const vaultRoot = getVaultRootUri();
        if (!vaultRoot) {
            this.post({ command: 'saveResult', ok: false, error: 'Vault not configured.' });
            return;
        }

        // `model` crosses the webview boundary, so its type is untrusted here —
        // unlike opts.type elsewhere in this file. getEntry throws on an
        // unrecognised type; convert that into the user-facing save error.
        let baseDirName: string;
        try {
            baseDirName = getEntry(model.type).dir;
        } catch {
            this.post({ command: 'saveResult', ok: false, error: 'Unknown artifact type.' });
            return;
        }

        const baseDir = vscode.Uri.joinPath(vaultRoot, baseDirName);

        // Step 1: destination folder
        const chosenDir = await pickDestFolder(baseDir);
        if (!chosenDir) { return; }  // Escaped — return focus to form

        // Step 2: filename prompt
        const defaultName = deriveFileName(model.title);
        const fileName    = await vscode.window.showInputBox({
            title:          'Save artifact as',
            value:          defaultName,
            prompt:         'File name (without .md extension)',
            ignoreFocusOut: true,
            validateInput:  v => {
                const r = validateArtifactFilename(v);
                return r.ok ? undefined : r.reason;
            },
        });
        if (!fileName) { return; }  // Escaped — return focus to form

        // Step 3: serialize + write (with collision loop)
        const pruned  = { ...model, blocks: pruneVarsForSave(model.blocks) };
        const content = serializeArtifact(pruned);
        await this.writeWithCollision(vaultRoot, model.type, chosenDir, fileName, content);
    }

    private async writeWithCollision(
        vaultRoot: vscode.Uri,
        type:      ArtifactType,
        chosenDir: vscode.Uri,
        fileName:  string,
        content:   string,
        force      = false,
    ): Promise<void> {
        const result = await writeArtifact({ vaultRoot, type, chosenDir, fileName, content, force });

        if (result.kind === 'success') {
            this.dispose();
            return;
        }

        if (result.kind === 'collision') {
            const answer = await vscode.window.showWarningMessage(
                `"${result.filePath}" already exists. Overwrite?`,
                { modal: true },
                'Overwrite',
            );
            if (answer === 'Overwrite') {
                await this.writeWithCollision(vaultRoot, type, chosenDir, fileName, content, true);
            }
            // Cancel from collision → return focus to form (panel stays open)
            return;
        }

        // Error
        this.post({ command: 'saveResult', ok: false, error: result.message });
    }
}
