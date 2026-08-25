import * as assert from 'node:assert';
import { buildBlockCard, buildSingleBlockContent } from '../src/ui/panels/artifactForm/form.blocks.js';
import { FORM_CLIENT_JS } from '../src/ui/panels/artifactForm/form.clientJs.js';
import type { ArtifactFormBlock } from '../src/types/artifact-form.types.js';

/**
 * T9 (VSX-211) — the create-form "expand block to editor" button.
 *
 * Three call sites render a block's code area, and all three must carry the
 * button or it vanishes on that path:
 * 1. `form.blocks.ts`'s `buildBlockCard` — server-rendered multi-block card.
 * 2. `form.clientJs.ts`'s `buildNewCardHtml` — client-added multi-block card.
 * 3. `form.blocks.ts`'s `buildSingleBlockContent` — the plain single-block
 *    form (Snippet/Command/etc. with exactly one block) — the common case,
 *    and the one round 1 of review found missing.
 */

function mockCodeBlock(code: string, lang: string): string {
    return `<pre data-lang="${lang}">${code}</pre>`;
}

const BLOCK: ArtifactFormBlock = {
    heading:     'One',
    description: '',
    language:    'javascript',
    code:        'const a = 1;',
    vars:        [],
};

suite('form-expand-button — server-rendered card (form.blocks.ts)', () => {

    test('buildBlockCard renders the expand-editor-btn for its block index', () => {
        const html = buildBlockCard(BLOCK, 0, 1, 'free', '', mockCodeBlock);
        assert.match(html, /class="expand-editor-btn" data-block="0"/);
    });

    test('expand-editor-btn is a distinct class from the collapse chevron expand-btn', () => {
        const html = buildBlockCard(BLOCK, 0, 1, 'free', '', mockCodeBlock);
        // Neither button may carry both tokens — the delegated click handler
        // matches 'expand-btn' by exact class-list membership, so a button
        // classed with both would fire both behaviours on one click.
        assert.ok(!/class="[^"]*\bexpand-btn\b[^"]*\bexpand-editor-btn\b[^"]*"/.test(html));
        assert.ok(!/class="[^"]*\bexpand-editor-btn\b[^"]*\bexpand-btn\b[^"]*"/.test(html));
        assert.match(html, /class="expand-btn" data-block="0"/);
    });
});

suite('form-expand-button — single-block form (form.blocks.ts)', () => {

    test('buildSingleBlockContent renders the expand-editor-btn inside .block-code', () => {
        const html = buildSingleBlockContent(BLOCK, 0, 'free', '', mockCodeBlock);
        assert.match(html, /class="expand-editor-btn" data-block="0"/);
    });

    test('renders for a hidden-language-mode type too (e.g. AIAgentsConfig — no lang selector)', () => {
        const html = buildSingleBlockContent(BLOCK, 0, 'hidden', 'markdown', mockCodeBlock);
        assert.match(html, /class="expand-editor-btn" data-block="0"/);
    });
});

suite('form-expand-button — client-added card (form.clientJs.ts)', () => {

    test('buildNewCardHtml (inlined in FORM_CLIENT_JS) also renders expand-editor-btn', () => {
        const fn = FORM_CLIENT_JS.slice(
            FORM_CLIENT_JS.indexOf('function buildNewCardHtml'),
            FORM_CLIENT_JS.indexOf('function buildNewLangSelectHtml'),
        );
        assert.match(fn, /class="expand-editor-btn"/);
    });

    test('clicking expand-editor-btn posts expandBlock with the block index', () => {
        assert.match(
            FORM_CLIENT_JS,
            /target\.classList\.contains\('expand-editor-btn'\)[\s\S]{0,200}vscode\.postMessage\(\{ command: 'expandBlock', index: blockIndex \}\);/,
        );
    });

    test('a blockUpdated message replaces that block\'s code area (no new esc copy)', () => {
        assert.match(FORM_CLIENT_JS, /case 'blockUpdated':/);
        assert.match(FORM_CLIENT_JS, /setCodeForBlock\(msg\.index, msg\.code\)/);
        // The replacement path reuses renderRows (shared with __codeBlock.setCode),
        // not a second render/escape implementation.
        assert.match(FORM_CLIENT_JS, /function setCodeForBlock\(blockIndex, code\) \{[\s\S]{0,400}renderRows\(code \|\| ''\)/);
    });
});
