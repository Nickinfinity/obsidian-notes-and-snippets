import { buildCommandPrefill } from '../create-prefill.helpers.js';
import { getDefaultLanguage, getLanguageMode } from '../../services/artifact-type-config.service.js';
import type { ArtifactType } from '../../types/parsed-artifact.types.js';
import type { ArtifactFormModel, CaptureResult } from '../../types/artifact-form.types.js';

/**
 * Everything `captureTerminal` needs from the outside world, injected so the
 * function stays pure and `vscode`-free. The real caller wires this to
 * `vscode.env.clipboard` and `workbench.action.terminal.copySelection` — see
 * the now-deleted `create.command.ts`, which reached for
 * `(activeTerminal as any)?.shellIntegration?.selection`. That branch was dead
 * code: `TerminalShellIntegration` (stable `@types/vscode`) exposes `cwd`,
 * `env` and `executeCommand` only — never a `selection` property — so it was
 * always `undefined` and always fell through to the clipboard. The only real terminal-selection capture VS Code
 * offers is copying the selection into the clipboard via the command palette
 * action, which is why this bag copies first and diffs against the saved
 * value instead of reading a selection directly.
 */
export interface TerminalCaptureBag {
    /** Reads the current clipboard text. */
    readClipboard(): Promise<string>;
    /** Overwrites the clipboard text. */
    writeClipboard(text: string): Promise<void>;
    /** Runs `workbench.action.terminal.copySelection` (or equivalent). */
    copySelection(): Promise<void>;
    /** Whether a terminal is active — guards against copying with none open. */
    hasActiveTerminal(): boolean;
}

/**
 * Builds the prefill block for captured terminal text via
 * `buildCommandPrefill` (empty-language block), then — same shape as T7's
 * `captureEditor` — overrides the language with `getDefaultLanguage(type)`
 * when the type's form config is `hidden` mode (e.g. `AIPrompt`, whose
 * language is fixed to `markdown` in `ARTIFACTS`, never picked). The mode is
 * always read through `getLanguageMode`/`getDefaultLanguage` — never a
 * `type === 'AIPrompt'` literal — so a future hidden-mode type needs no
 * change here. The override is non-mutating: a fresh block object into a
 * fresh `blocks` array, `buildCommandPrefill`'s return is never edited in place.
 *
 * @param type - Target artifact type.
 * @param text - Captured text.
 * @returns Partial model with a single prefilled block.
 */
function buildPrefill(type: ArtifactType, text: string): Partial<ArtifactFormModel> {
    const prefill = buildCommandPrefill(text);

    if (getLanguageMode(type) === 'hidden') {
        const [block] = prefill.blocks ?? [];
        if (block) {
            prefill.blocks = [{ ...block, language: getDefaultLanguage(type) }];
        }
    }

    return prefill;
}

/**
 * Captures terminal text for the create-form: tries a terminal selection
 * first (via a copy-to-clipboard round trip, since VS Code exposes no direct
 * selection read), falls back to whatever the clipboard already held, and
 * always restores the clipboard to its pre-capture value.
 *
 * Sequence: save the clipboard → (if a terminal is active) run
 * `copySelection()` and re-read the clipboard — a changed value is the
 * selection (`source: 'selection'`); unchanged means there was no selection,
 * so the saved value is treated as the user's own clipboard content
 * (`source: 'clipboard'`). The saved value is restored in a `finally` on
 * every path, including a throw from `copySelection`/`readClipboard`.
 *
 * @param bag  - Injected I/O, see `TerminalCaptureBag`.
 * @param type - Target artifact type; only `AIPrompt` changes the prefilled language.
 * @returns The capture result, or `undefined` when there was nothing to capture.
 *
 * @example
 * const result = await captureTerminal(realBag, 'Command');
 * // result?.source === 'selection' | 'clipboard' | undefined
 */
export async function captureTerminal(
    bag: TerminalCaptureBag,
    type: ArtifactType,
): Promise<CaptureResult | undefined> {
    const saved = await bag.readClipboard();

    try {
        let text = saved;
        let source: 'selection' | 'clipboard' = 'clipboard';

        if (bag.hasActiveTerminal()) {
            await bag.copySelection();
            const afterCopy = await bag.readClipboard();
            if (afterCopy !== saved) {
                text = afterCopy;
                source = 'selection';
            }
        }

        if (!text) {
            return undefined;
        }

        return { prefill: buildPrefill(type, text), source };
    } finally {
        await bag.writeClipboard(saved);
    }
}
