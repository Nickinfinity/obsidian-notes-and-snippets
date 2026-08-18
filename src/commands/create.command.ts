import * as vscode from 'vscode';
import { getCreateFormTypes, getEntry } from '../services/artifact-type-config.service.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/config.service.js';
import { openArtifactFormPanel } from '../ui/panels/artifactForm/panel.js';
import { mapLanguageId } from '../services/language-map.service.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';
import type { ArtifactFormModel } from '../types/artifact-form.types.js';

// ── Pure prefill builders (exported for unit tests) ───────────────────────────

/**
 * Builds a `Partial<ArtifactFormModel>` prefill for a snippet created from an
 * editor selection. The VS Code `languageId` is mapped to the conventional
 * fence info-string via `mapLanguageId` (e.g. `typescriptreact` → `tsx`).
 *
 * @param text       - Selected text to prefill as `blocks[0].code`.
 * @param languageId - `editor.document.languageId` from the active editor.
 * @returns Partial model with a single prefilled block.
 *
 * @example
 * buildSnippetPrefill('const x = 1;', 'typescriptreact')
 * // → { blocks: [{ heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [] }] }
 */
export function buildSnippetPrefill(text: string, languageId: string): Partial<ArtifactFormModel> {
    return {
        blocks: [{ heading: '', description: '', language: mapLanguageId(languageId), code: text, vars: [] }],
    };
}

/**
 * Builds a `Partial<ArtifactFormModel>` prefill for a command created from a
 * terminal selection or clipboard text. Language is always `''` — the command
 * type locks to `bash` at serialise time via `constants.ts`.
 *
 * @param text - Terminal selection or clipboard text to prefill as `blocks[0].code`.
 * @returns Partial model with a single prefilled block.
 *
 * @example
 * buildCommandPrefill('git status')
 * // → { blocks: [{ heading: '', description: '', language: '', code: 'git status', vars: [] }] }
 */
export function buildCommandPrefill(text: string): Partial<ArtifactFormModel> {
    return {
        blocks: [{ heading: '', description: '', language: '', code: text, vars: [] }],
    };
}

// ── Type QuickPick ────────────────────────────────────────────────────────────

interface TypePickItem extends vscode.QuickPickItem {
    readonly artifactType: ArtifactType;
}

/**
 * Builds the QuickPick item list for the type selector.
 *
 * Items are derived from `getCreateFormTypes()` — never hard-coded — so
 * adding a new create-form type to `ARTIFACTS` automatically surfaces here.
 *
 * @returns Array of items, one per create-form-enabled artifact type.
 *
 * @example
 * buildTypeItems() // [{ label: '$(add) Create Snippet', detail: 'Snippets', artifactType: 'snippet' }, ...]
 */
function buildTypeItems(): TypePickItem[] {
    // Every type here came from getCreateFormTypes(), so getEntry cannot miss.
    return getCreateFormTypes().map(type => {
        const entry = getEntry(type);
        return {
            label:        `$(add) Create ${entry.name}`,
            detail:       entry.dir,
            artifactType: type,
        };
    });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/**
 * Opens the artifact create form panel for the chosen type.
 *
 * @param context - Extension context passed through to the form controller.
 * @param type    - Chosen artifact type.
 *
 * @example
 * openFormForType(context, 'snippet')
 */
function openFormForType(context: vscode.ExtensionContext, type: ArtifactType): void {
    openArtifactFormPanel(context, { mode: 'create', type });
}

// ── Command registration ──────────────────────────────────────────────────────

/**
 * Registers the `obsidian-artifacts.create` command and the two selection-entry
 * seam commands.
 *
 * The create command validates the vault, shows a type QuickPick derived from
 * `getCreateFormTypes()`, then opens the form panel via `openArtifactFormPanel`.
 * Selection-entry commands are stubs; Phase 7 fills in the real handlers.
 *
 * @param context - Extension context used to register disposable subscriptions.
 *
 * @example
 * // Called once inside activate():
 * registerCreateCommands(context);
 */
export function registerCreateCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        // ── obsidian-artifacts.create ─────────────────────────────────────────
        vscode.commands.registerCommand('obsidian-artifacts.create', async () => {
            const vaultPath = getVaultPath();

            if (!vaultPath || !validateObsidianVault(vaultPath)) { return; }

            const items  = buildTypeItems();
            const picked = await vscode.window.showQuickPick<TypePickItem>(items, {
                title:       'Obsidian Artifacts: Create',
                placeHolder: 'Choose artifact type',
            });
            if (!picked) { return; }  // Escape → no-op

            openFormForType(context, picked.artifactType);
        }),

        // ── obsidian-artifacts.create.fromSelection.snippet ──────────────────
        vscode.commands.registerCommand('obsidian-artifacts.create.fromSelection.snippet', () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }

            // Primary selection only — secondary cursors ignored per spec §1.4.
            const selectionText = editor.document.getText(editor.selection);
            if (!selectionText) {
                void vscode.window.showInformationMessage(
                    'Obsidian Artifacts: No selection to create snippet from.',
                );
                return;
            }

            const prefill = buildSnippetPrefill(selectionText, editor.document.languageId);
            openArtifactFormPanel(context, { mode: 'create', type: 'snippet', prefill });
        }),

        // ── obsidian-artifacts.create.fromSelection.command ──────────────────
        vscode.commands.registerCommand('obsidian-artifacts.create.fromSelection.command', async () => {
            // ── Source order: shellIntegration → clipboard (toast required) ──
            let text = '';

            const integration = (vscode.window.activeTerminal as any)?.shellIntegration as any;
            if (typeof integration?.selection === 'string' && integration.selection.length > 0) {
                text = integration.selection;
            }

            if (!text) {
                const clip = await vscode.env.clipboard.readText();
                if (clip) {
                    text = clip;
                    // Toast is required — clipboard reads must never be silent (spec §1.4).
                    void vscode.window.showInformationMessage(
                        'Obsidian Artifacts: Used clipboard contents — verify before saving.',
                    );
                }
            }

            if (!text) {
                void vscode.window.showInformationMessage(
                    'Obsidian Artifacts: No selection or clipboard contents to create command from.',
                );
                return;
            }

            const prefill = buildCommandPrefill(text);
            openArtifactFormPanel(context, { mode: 'create', type: 'command', prefill });
        }),
    );
}
