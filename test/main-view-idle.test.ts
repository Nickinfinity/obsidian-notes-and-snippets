import * as assert from 'node:assert';
import { buildCreateItems, renderIdleHtml, resolveCreateCommandId } from '../src/ui/views/mainView.render.js';
import { getCreateFormTypes } from '../src/services/artifact-type-config.service.js';

/**
 * Unit tests for the main pane's idle-mode data and HTML (T4, VSX-206).
 *
 * `buildCreateItems()` must be *derived* from `getCreateFormTypes()` /
 * `getEntry()` — never a hand-copied literal list — so a new create-form type
 * in `ARTIFACTS` surfaces here with no code change. `renderIdleHtml` must
 * escape every interpolated value; nothing else in this module may hand-roll
 * a second `esc`. `resolveCreateCommandId` is the message-boundary guard —
 * it must reject any `ArtifactType` that is not create-form-enabled, since a
 * webview message is untrusted input.
 */
suite('mainView — idle mode', () => {

    test('buildCreateItems() labels match the live registry, in order', () => {
        assert.deepStrictEqual(
            buildCreateItems().map(i => i.label),
            ['Create Snippets', 'Create AI Agents Config', 'Create Commands', 'Create Templates', 'Create AI Prompts'],
        );
    });

    test('buildCreateItems() types are derived from getCreateFormTypes(), not hand-copied', () => {
        assert.deepStrictEqual(buildCreateItems().map(i => i.type), getCreateFormTypes());
    });

    test('renderIdleHtml escapes a "<" in a label — no raw tag reaches the document', () => {
        const html = renderIdleHtml(
            [{ type: 'Snippet', label: 'Create <script>Snippets' }],
            'base.css',
            "'self'",
            'test-nonce',
        );
        assert.ok(html.includes('&lt;script&gt;'));
        assert.ok(!html.includes('<script>Snippets'));
    });

    test('resolveCreateCommandId resolves a create-form type to its base create id', () => {
        assert.strictEqual(resolveCreateCommandId('Snippet'), 'obsidian-artifacts.create.snippets');
    });

    test('resolveCreateCommandId rejects a non-create-form type (e.g. Variables)', () => {
        assert.strictEqual(resolveCreateCommandId('Variables'), undefined);
    });

    test('resolveCreateCommandId rejects an arbitrary string that is not any ArtifactType', () => {
        assert.strictEqual(resolveCreateCommandId('NotARealType'), undefined);
    });
});
