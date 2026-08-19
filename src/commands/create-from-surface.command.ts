import * as vscode from 'vscode';
import { getCreateTypesForSurface, getIndexCapableTypes, getEntry } from '../services/artifact-type-config.service.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/config.service.js';
import { openArtifactFormPanel } from '../ui/panels/artifactForm/panel.js';
import type { ArtifactContext } from '../types/artifact.types.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';
import type { CaptureFn } from '../types/artifact-form.types.js';

// ── Command id trio — mirrors insert.command.ts's artifactCommandId /
//    artifactTerminalCommandId one word over. Never re-derive the lowercasing
//    inline; every id in this file comes from these three. ─────────────────

/**
 * Derives the base VS Code command ID for an artifact's create command.
 *
 * Pattern: `obsidian-artifacts.create.<dir.toLowerCase()>`
 *
 * @param dir - The artifact's `dir` field (e.g. `'Snippets'`, `'AIAgentsConf'`).
 * @returns The fully-qualified VS Code command ID string.
 *
 * @example
 * createCommandId('Snippets') // → 'obsidian-artifacts.create.snippets'
 */
export function createCommandId(dir: string): string {
    return `obsidian-artifacts.create.${dir.toLowerCase()}`;
}

/**
 * Derives the sibling command ID registered for the **terminal** context menu
 * of a both-context artifact (`contexts` containing both `'editor'` and
 * `'terminal'`, e.g. `AIPrompt`) — same reasoning as `artifactTerminalCommandId`
 * in `insert.command.ts`: a menu label comes only from `contributes.commands.title`,
 * so a distinct surface needs a distinct command ID.
 *
 * @param dir - The artifact's `dir` field (e.g. `'AIPrompts'`).
 * @returns The fully-qualified terminal-surface create command ID string.
 *
 * @example
 * createTerminalCommandId('AIPrompts') // → 'obsidian-artifacts.create.aiprompts.terminal'
 */
export function createTerminalCommandId(dir: string): string {
    return `${createCommandId(dir)}.terminal`;
}

/**
 * Derives the sibling command ID registered for the multi-select **template
 * index** flow on the Explorer, for a whole-file type (`writesFile === true`).
 *
 * @param dir - The artifact's `dir` field (e.g. `'Templates'`).
 * @returns The fully-qualified index-surface create command ID string.
 *
 * @example
 * createIndexCommandId('Templates') // → 'obsidian-artifacts.create.templates.index'
 */
export function createIndexCommandId(dir: string): string {
    return `${createCommandId(dir)}.index`;
}

// ── Derivation ──────────────────────────────────────────────────────────────

/** One registered create command: its id and the type it opens the form for. */
interface CreateSurfaceEntry {
    readonly commandId: string;
    readonly type: ArtifactType;
}

const SURFACES: readonly Exclude<ArtifactContext, 'all'>[] = ['editor', 'terminal', 'explorer'];

/**
 * Derives every create command this extension registers: one entry per
 * (type × surface) where `createForm === true && isInContext(type, surface)`
 * (via `getCreateTypesForSurface`), plus one `.index` entry per type in
 * `getIndexCapableTypes()`.
 *
 * **Deduplicated by `commandId` via a `Map`.** A type can resolve to the same
 * `commandId` on two surfaces it declares — any two non-both-context surfaces
 * today (e.g. a hypothetical `contexts: ['editor', 'explorer']`), or every
 * surface at once the day a `contexts: ['all']` type (`Variables` already is
 * one) gains `createForm`. Without the dedup, the loop below would push that
 * pair twice and `registerCreateSurfaceCommands` would call
 * `vscode.commands.registerCommand` twice with the same id, which throws and
 * fails `activate()` — a defect a `Set` applied only to the returned id list
 * would hide, since two identical entries collapse to one id either way. This
 * is the **single** deduped list both `buildCreateCommandIds` and
 * `registerCreateSurfaceCommands` read, so the id list and the actual VS Code
 * registration cannot disagree — there is only one derivation, not two that
 * happen to agree today.
 *
 * A both-context type (`AIPrompt` today) resolves to its `.terminal` id only
 * on the `'terminal'` surface; every other surface uses the base id, exactly
 * as `insert.command.ts` splits `artifactCommandId` / `artifactTerminalCommandId`.
 *
 * @param surfaceTypes - Injection seam for tests; defaults to the real
 *   `getCreateTypesForSurface`. Never overridden outside `test/`.
 * @param indexTypes - Injection seam for tests; defaults to the real
 *   `getIndexCapableTypes`. Never overridden outside `test/`.
 * @returns Every `{ commandId, type }` pair this extension registers, one per unique `commandId`.
 *
 * @example
 * deriveCreateSurfaceEntries().find(e => e.commandId.endsWith('.aiprompts.terminal'))
 * // → { commandId: 'obsidian-artifacts.create.aiprompts.terminal', type: 'AIPrompt' }
 */
export function deriveCreateSurfaceEntries(
    surfaceTypes: (surface: Exclude<ArtifactContext, 'all'>) => ArtifactType[] = getCreateTypesForSurface,
    indexTypes: () => ArtifactType[] = getIndexCapableTypes,
): CreateSurfaceEntry[] {
    const entries = new Map<string, CreateSurfaceEntry>();

    for (const surface of SURFACES) {
        for (const type of surfaceTypes(surface)) {
            const artifact = getEntry(type);
            const bothContexts = artifact.contexts.includes('editor') && artifact.contexts.includes('terminal');
            const commandId = surface === 'terminal' && bothContexts
                ? createTerminalCommandId(artifact.dir)
                : createCommandId(artifact.dir);
            entries.set(commandId, { commandId, type });
        }
    }

    for (const type of indexTypes()) {
        const commandId = createIndexCommandId(getEntry(type).dir);
        entries.set(commandId, { commandId, type });
    }

    return [...entries.values()];
}

/**
 * Returns the full set of create command IDs this extension registers, pure
 * and `vscode`-registration-free (though the module still imports `vscode`'s
 * types, same as `insert.command.ts`'s pure exports). Drives
 * `test/create-command-ids.test.ts`'s drift guard against `package.json`.
 *
 * The list is already unique — `deriveCreateSurfaceEntries` dedupes by
 * `commandId` — so this is a plain projection, not a second dedup pass.
 *
 * @returns Every derived create command ID.
 *
 * @example
 * buildCreateCommandIds().includes('obsidian-artifacts.create.aiprompts.terminal') // → true
 */
export function buildCreateCommandIds(): string[] {
    return deriveCreateSurfaceEntries().map(e => e.commandId);
}

// ── Capture seam (empty this wave) ───────────────────────────────────────────


// ── Command registration ─────────────────────────────────────────────────────

/**
 * Registers one create command per entry from `deriveCreateSurfaceEntries()`.
 * Each handler validates the vault, resolves its capture (currently always
 * absent — see `CaptureFn` above), and opens the create form for its type
 * with the resulting prefill.
 *
 * @param context - Extension context used to register disposable subscriptions.
 * @returns void
 *
 * @example
 * // Called once inside activate():
 * registerCreateSurfaceCommands(context);
 */
export function registerCreateSurfaceCommands(context: vscode.ExtensionContext): void {
    // Empty this wave by design — Waves 2–3 fill it, one capture per surface.
    // Typed against the SHARED CaptureFn (types/artifact-form.types.ts) so the
    // create path has exactly one answer to "what does a capture return"; a
    // second local shape was the defect this contract exists to prevent.
    const captures: Record<string, CaptureFn<vscode.Uri | undefined>> = {};

    for (const { commandId, type } of deriveCreateSurfaceEntries()) {
        const disposable = vscode.commands.registerCommand(
            commandId,
            (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
                const vaultPath = getVaultPath();
                if (!vaultPath || !validateObsidianVault(vaultPath)) { return; }

                const capture = captures[commandId];
                // `undefined` is the one "nothing to capture" signal; the form
                // then opens unprefilled rather than not at all.
                const prefill = capture?.(uris?.[0] ?? uri, type)?.prefill;

                openArtifactFormPanel(context, { mode: 'create', type, prefill });
            },
        );
        context.subscriptions.push(disposable);
    }
}
