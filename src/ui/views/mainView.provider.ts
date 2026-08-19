import * as vscode from 'vscode';
import { getNonce } from '../../utils/helpers.js';
import { buildCreateItems, renderIdleHtml, renderPreviewPlaceholderHtml, resolveCreateCommandId } from './mainView.render.js';

/** The main pane's two render modes — `preview` lands in Wave 7. */
type MainViewMode = 'idle' | 'preview';

/** Stylesheets loaded by every mode, `base.css` first per the panel convention. */
const STYLE_FILES = ['base.css', 'codicon.css'];

/**
 * Narrows an inbound webview message to the `createType` shape.
 *
 * A webview message is untrusted input (it crosses a postMessage boundary),
 * so this checks shape only — `type` is validated downstream by
 * `resolveCreateCommandId`, which answers `undefined` for anything that is
 * not a create-form `ArtifactType`.
 *
 * @param message - Raw message from `webview.onDidReceiveMessage`.
 * @returns `true` when `message` has `{ command: 'createType', type: string }`.
 *
 * @example
 * isCreateTypeMessage({ command: 'createType', type: 'Snippet' }) // → true
 */
function isCreateTypeMessage(message: unknown): message is { command: 'createType'; type: string } {
    if (typeof message !== 'object' || message === null) {
        return false;
    }
    const m = message as Record<string, unknown>;
    return m.command === 'createType' && typeof m.type === 'string';
}

/**
 * Provides the main activity-bar pane — `MainViewProvider.viewType`.
 *
 * A single webview with two modes rather than a `TreeDataProvider`: `idle`
 * (the create list, this wave) and `preview` (Wave 7), so the same view keeps
 * its content across the mode switch instead of being torn down and rebuilt.
 *
 * Thin wiring only — row data and HTML come from the pure functions in
 * `mainView.render.ts`.
 *
 * @example
 * const provider = new MainViewProvider(context.extensionUri);
 * context.subscriptions.push(
 *   vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, provider),
 * );
 */
export class MainViewProvider implements vscode.WebviewViewProvider {
    /** The view id declared in `package.json`'s `contributes.views` — the one static mirror. */
    static readonly viewType = 'obsidian-artifacts.mainView';

    private view?: vscode.WebviewView;
    private mode: MainViewMode = 'idle';

    /**
     * @param extensionUri - Extension root URI, used to resolve `src/ui` assets.
     */
    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Resolves the webview view: sets its options, wires the message handler,
     * and renders the current mode.
     *
     * @param webviewView - The view instance VS Code hands the provider.
     *
     * @example
     * provider.resolveWebviewView(webviewView, context, token);
     */
    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'ui')],
        };
        webviewView.webview.onDidReceiveMessage((message: unknown) => this.handleMessage(message));
        this.render();
    }

    /**
     * Switches the pane's render mode and re-renders.
     *
     * `preview` is the Wave 7 seam — it renders the empty placeholder today.
     *
     * @param mode - `'idle'` (create list) or `'preview'`.
     *
     * @example
     * provider.setMode('preview');
     */
    setMode(mode: MainViewMode): void {
        this.mode = mode;
        this.render();
    }

    // ── Message handling ────────────────────────────────────────────────────

    /**
     * Handles a `createType` message by executing the derived base create
     * command for that type — the same `obsidian-artifacts.create.<dir>`
     * id `insert.command.ts`'s `artifactCommandId` mirrors for insert.
     *
     * `resolveCreateCommandId` gates on `getCreateFormTypes()` membership, so
     * a message naming a non-create-form type (e.g. `Variables`) is dropped
     * rather than resolving to a command id that is never registered.
     *
     * @param message - Raw message from the webview.
     */
    private handleMessage(message: unknown): void {
        if (!isCreateTypeMessage(message)) {
            return;
        }
        const commandId = resolveCreateCommandId(message.type);
        if (!commandId) {
            return;
        }
        void vscode.commands.executeCommand(commandId);
    }

    // ── Render ───────────────────────────────────────────────────────────────

    /** Re-renders `webview.html` for the current mode. */
    private render(): void {
        if (!this.view) {
            return;
        }
        const webview = this.view.webview;
        const cssUris = STYLE_FILES.map(f =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', f)).toString(),
        );
        webview.html = this.mode === 'idle'
            ? renderIdleHtml(buildCreateItems(), cssUris, webview.cspSource, getNonce())
            : renderPreviewPlaceholderHtml(cssUris, webview.cspSource);
    }
}
