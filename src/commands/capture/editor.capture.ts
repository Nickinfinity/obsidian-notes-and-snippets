import { buildSnippetPrefill } from '../create-prefill.helpers.js';
import { getDefaultLanguage, getLanguageMode } from '../../services/artifact-type-config.service.js';
import type { ArtifactType } from '../../types/parsed-artifact.types.js';
import type { CaptureResult } from '../../types/artifact-form.types.js';

/**
 * Editor-selection input for `captureEditor` — the primary selection's text
 * and its document's `languageId`. Deliberately not `vscode.TextEditor`: this
 * module stays `vscode`-free so it is unit-testable without a host.
 */
export interface EditorSelection {
    /** Selected text (primary selection only; secondary cursors ignored). */
    text: string;
    /** `editor.document.languageId` of the source document. */
    languageId: string;
}

/**
 * Captures an editor selection into a `CaptureResult` for the create-artifact
 * form.
 *
 * An empty selection yields `undefined` — the caller shows a toast instead of
 * opening an empty form. Otherwise the fence language follows the target
 * type's form config: `free`/`locked` modes keep the mapped fence language
 * from `buildSnippetPrefill` (via `mapLanguageId`); `hidden` mode (e.g.
 * `AIPrompt`, whose payload is flagged markdown with no language to pick)
 * overrides it with `getDefaultLanguage(type)` instead. The mode is always
 * read through `getLanguageMode`/`getDefaultLanguage` — never a `type ===
 * 'AIPrompt'` literal, so a future hidden-mode type needs no change here.
 *
 * @param sel  - `{ text, languageId }` from the active editor's primary selection.
 * @param type - Target artifact type chosen for the new artifact.
 * @returns A `CaptureResult` with `source: 'selection'`, or `undefined` when `sel.text` is empty.
 *
 * @example
 * captureEditor({ text: '', languageId: 'ts' }, 'Snippet'); // → undefined
 *
 * @example
 * captureEditor({ text: 'const x = 1;', languageId: 'typescriptreact' }, 'Snippet');
 * // → { prefill: { blocks: [{ heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [] }] }, source: 'selection' }
 *
 * @example
 * captureEditor({ text: 'Review <VK-repo>.', languageId: 'typescript' }, 'AIPrompt');
 * // → { prefill: { blocks: [{ heading: '', description: '', language: 'markdown', code: 'Review <VK-repo>.', vars: [] }] }, source: 'selection' }
 */
export function captureEditor(sel: EditorSelection, type: ArtifactType): CaptureResult | undefined {
    if (sel.text === '') {
        return undefined;
    }

    const prefill = buildSnippetPrefill(sel.text, sel.languageId);

    // ── Hidden language mode: fence is fixed, never the editor's languageId ──
    if (getLanguageMode(type) === 'hidden') {
        const [block] = prefill.blocks ?? [];
        if (block) {
            prefill.blocks = [{ ...block, language: getDefaultLanguage(type) }];
        }
    }

    return { prefill, source: 'selection' };
}
