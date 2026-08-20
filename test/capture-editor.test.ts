import * as assert from 'node:assert';
import { captureEditor } from '../src/commands/capture/editor.capture.js';

/**
 * Unit tests for `captureEditor` (VSX-209, T7).
 *
 * Pure: takes `{ text, languageId }`, never a `vscode.TextEditor`. Empty
 * selection yields `undefined` so the caller shows a toast instead of
 * opening an empty form. `Snippet` (language mode `free`) keeps the mapped
 * fence language; `AIPrompt` (language mode `hidden`) forces its
 * `form.language.default` (`markdown`) regardless of the editor's
 * `languageId` — read through `getLanguageMode`/`getDefaultLanguage`, never
 * a `type === 'AIPrompt'` literal.
 */

suite('captureEditor', () => {
    test('empty selection yields undefined', () => {
        assert.strictEqual(captureEditor({ text: '', languageId: 'ts' }, 'Snippet'), undefined);
    });

    test('Snippet: maps languageId through mapLanguageId (typescriptreact -> tsx)', () => {
        const result = captureEditor({ text: 'const x = 1;', languageId: 'typescriptreact' }, 'Snippet');
        assert.strictEqual(result?.source, 'selection');
        assert.deepStrictEqual(result?.prefill.blocks?.[0], {
            heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [],
        });
    });

    test('AIPrompt: forces markdown fence regardless of editor languageId', () => {
        const result = captureEditor({ text: 'Review <VK-repo>.', languageId: 'typescript' }, 'AIPrompt');
        assert.strictEqual(result?.prefill.blocks?.[0]?.language, 'markdown');
        assert.strictEqual(result?.prefill.blocks?.[0]?.code, 'Review <VK-repo>.');
    });

    test('source is always selection', () => {
        const result = captureEditor({ text: 'hi', languageId: 'plaintext' }, 'Snippet');
        assert.strictEqual(result?.source, 'selection');
    });
});
