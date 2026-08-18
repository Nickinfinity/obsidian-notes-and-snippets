import * as vscode from 'vscode';
import { applyVarSet, buildVarSetModel } from '../../../services/varset.service.js';
import { serializeArtifact } from '../../../services/artifact-serializer.service.js';
import { slugify } from '../../../services/filename.service.js';
import { getEntry } from '../../../services/artifact-type-config.service.js';
import { getVaultRootUri } from '../../../services/config.service.js';
import type { ParsedArtifactFile, ParsedVar } from '../../../types/parsed-artifact.types.js';
import type { ApplyResult, VarSubSet } from '../../../types/varset.types.js';
import { getVarSetScanner, pickVarSet } from '../varsetPicker.panel.js';
import { renderVarSetDiffHtml } from './varSetDiff.js';

/** Callbacks the controller uses to push state back to the host preview panel. */
export interface VarSetControllerCallbacks {
    /** Returns the artifact currently shown in the popup (`undefined` between switches). */
    getCurrentArtifact: () => ParsedArtifactFile | undefined;
    /** Posts a message to the popup webview. */
    postMessage: (msg: Record<string, unknown>) => void;
    /** Captures an applied sub-set so the source badge persists across re-renders. */
    rememberAppliedSet: (subSetName: string, varNames: string[]) => void;
}

/**
 * Owns the variable-set message flow inside the preview panel:
 * `pickVarSet`  → QuickPick → diff preview
 * `confirmApply` / `cancelApply` → finalise
 * `saveAsVarSet` → write a new `Variables/<slug>.md` file.
 *
 * Stateless across artifacts — the active sub-set is held only between the
 * QuickPick acceptance and the user's confirm/cancel decision.
 *
 * @example
 * const ctrl = new VarSetController(extensionUri, { getCurrentArtifact, postMessage, rememberAppliedSet });
 * await ctrl.handlePickVarSet({ values: { 'VK-host': '' } });
 */
export class VarSetController {

    /** Pending `ApplyResult` between `pickVarSet` selection and `confirmApply`. */
    private pending: { subSet: VarSubSet; result: ApplyResult } | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly cb: VarSetControllerCallbacks,
    ) {}

    /**
     * Opens the QuickPick, computes the diff, and posts the diff HTML to the webview.
     *
     * @param msg - Webview payload — must contain `values: Record<string, string>`
     *              with the user's current input map.
     * @returns Resolves once the diff has been posted (or no-op on cancel).
     *
     * @example
     * await ctrl.handlePickVarSet({ values: collectVars() });
     */
    async handlePickVarSet(msg: Record<string, unknown>): Promise<void> {
        const artifact = this.cb.getCurrentArtifact();
        if (!artifact) { return; }

        const variablesDirUri = getVariablesDirUri();
        if (!variablesDirUri) {
            void vscode.window.showErrorMessage('Variables directory is not configured. Open the Settings panel to enable it.');
            return;
        }

        const picked = await pickVarSet(
            artifact.vars,
            artifact.frontmatter.tags ?? [],
            variablesDirUri,
            this.extensionUri,
        );
        if (!picked) { return; }

        const currentValues = (msg.values as Record<string, string> | undefined) ?? {};
        const result = applyVarSet(currentValues, picked.subSet.vars);
        this.pending = { subSet: picked.subSet, result };

        this.cb.postMessage({
            command:    'showVarSetDiff',
            html:       renderVarSetDiffHtml(result.changes, picked.subSet.heading),
            subSetName: picked.subSet.heading,
        });
    }

    /**
     * Finalises the pending apply — pushes merged values + source-badge metadata to the webview.
     *
     * @returns void
     *
     * @example
     * ctrl.handleConfirmApply();
     */
    handleConfirmApply(): void {
        const pending = this.pending;
        if (!pending) { return; }

        const filledOrOverriddenNames = pending.result.changes
            .filter(c => c.action === 'filled' || c.action === 'overridden')
            .map(c => c.name);

        this.cb.rememberAppliedSet(pending.subSet.heading, filledOrOverriddenNames);

        this.cb.postMessage({
            command:    'varSetApplied',
            values:     pending.result.values,
            subSetName: pending.subSet.heading,
            varNames:   filledOrOverriddenNames,
        });
        this.pending = undefined;
    }

    /**
     * Aborts the pending apply — webview reverts the diff view back to inputs.
     *
     * @returns void
     *
     * @example
     * ctrl.handleCancelApply();
     */
    handleCancelApply(): void {
        this.pending = undefined;
        this.cb.postMessage({ command: 'varSetCancelled' });
    }

    /**
     * Implements the save-as-variable-set flow — prompts for title and description,
     * builds a new `.md` file under `Variables/<slug>.md`, writes it, and invalidates
     * the scanner cache so the next pick run sees the new file.
     *
     * @param msg - Webview payload — must contain `values: Record<string, string>`
     *              with the user's current non-empty input map.
     * @returns Resolves once the file is written or after the user cancels a prompt.
     *
     * @example
     * await ctrl.handleSaveAsVarSet({ values: { 'VK-host': 'localhost' } });
     */
    async handleSaveAsVarSet(msg: Record<string, unknown>): Promise<void> {
        const artifact = this.cb.getCurrentArtifact();
        if (!artifact) { return; }

        const values = (msg.values as Record<string, string> | undefined) ?? {};
        const nonEmpty: [string, string][] = Object.entries(values).filter(([, v]) => v.length > 0);
        if (nonEmpty.length === 0) {
            void vscode.window.showInformationMessage('No values to save — fill at least one variable first.');
            return;
        }

        const variablesDirUri = getVariablesDirUri();
        if (!variablesDirUri) {
            void vscode.window.showErrorMessage('Variables directory is not configured. Open the Settings panel to enable it.');
            return;
        }

        const title = await vscode.window.showInputBox({
            prompt: 'Name for this variable set',
            placeHolder: 'e.g. Local Development',
            validateInput: v => v.trim().length === 0 ? 'Name cannot be empty.' : undefined,
        });
        if (!title) { return; }

        const description = await vscode.window.showInputBox({
            prompt: 'Description (optional)',
            placeHolder: 'Short context for this variable set',
        });
        // User can dismiss the description prompt — that aborts the save flow.
        if (description === undefined) { return; }

        const tags    = artifact.frontmatter.tags ?? [];
        const content = serializeArtifact(buildVarSetModel(title.trim(), description.trim(), tags, nonEmpty));
        // Empty slug (a title of only punctuation) would write a bare `.md`.
        const slug    = slugify(title) || 'untitled-variable-set';
        const fileUri = vscode.Uri.joinPath(variablesDirUri, `${slug}.md`);

        try {
            await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
            getVarSetScanner().invalidate();
            void vscode.window.showInformationMessage(`Variable set saved: ${title.trim()}`);
        } catch (err) {
            void vscode.window.showErrorMessage(`Failed to save variable set: ${(err as Error).message}`);
        }
    }
}

// ── Module helpers ────────────────────────────────────────────────────────────

/**
 * Resolves the configured `<vault>/Variables` directory URI from VS Code settings.
 *
 * @returns The directory URI, or `null` when `obsidianArtifacts.vaultPath` is unset.
 *
 * @example
 * const dir = getVariablesDirUri();
 */
function getVariablesDirUri(): vscode.Uri | null {
    const vaultRoot = getVaultRootUri();
    if (!vaultRoot) { return null; }
    return vscode.Uri.joinPath(vaultRoot, getEntry('variables').dir);
}

// ── ParsedVar export — helps consumers avoid an extra import ─────────────────
export type { ParsedVar };
