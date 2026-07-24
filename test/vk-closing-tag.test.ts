import * as assert from 'node:assert';
import { extractVars, resolveVars, VK_TOKEN_RE } from '../src/services/parser.service.js';
import { renderCodeHtml } from '../src/services/render.service.js';
import { CODE_BLOCK_CLIENT_JS } from '../src/ui/panels/artifactPicker/codeBlock.js';

/**
 * `</VK-x>` is the render-safe spelling of `<VK-x>`.
 *
 * Unfenced markdown (a flagged payload) treats `<VK-repo>` as a legal HTML open
 * tag, so Obsidian renders it as an unclosed custom element that swallows every
 * block below it. Closing the tag fixes the note; these tests pin that both
 * spellings mean **one** variable, and that a pair yields the value **once**.
 */

suite('extractVars — closing tags are the same variable', () => {

    test('a lone closing tag is detected', () => {
        assert.deepStrictEqual(extractVars('Review </VK-repo>.'), [{ name: 'VK-repo', defaultValue: '' }]);
    });

    test('an adjacent pair is one variable, not two', () => {
        assert.deepStrictEqual(extractVars('Review <VK-repo></VK-repo>.'), [{ name: 'VK-repo', defaultValue: '' }]);
    });

    test('opening and closing forms of the same name collapse to one entry', () => {
        assert.deepStrictEqual(
            extractVars('<VK-repo> ... </VK-repo> ... <VK-repo>'),
            [{ name: 'VK-repo', defaultValue: '' }],
        );
    });

    test('order still follows first appearance across both forms', () => {
        assert.deepStrictEqual(
            extractVars('</VK-b> <VK-a>').map(v => v.name),
            ['VK-b', 'VK-a'],
        );
    });

    test('a closing tag that is not a VK token is ignored', () => {
        assert.deepStrictEqual(extractVars('</div> </VKfoo> <a href="x">'), []);
    });
});

suite('resolveVars — a pair emits the value once', () => {

    const VARS = { 'VK-repo': 'my-app', 'VK-branch': 'main' };

    test('an adjacent pair collapses to a single value', () => {
        assert.strictEqual(resolveVars('Review <VK-repo></VK-repo> now.', VARS), 'Review my-app now.');
    });

    test('a lone closing tag resolves like an opening one', () => {
        assert.strictEqual(resolveVars('Review </VK-repo> now.', VARS), 'Review my-app now.');
    });

    test('mismatched names are two separate tokens, not a pair', () => {
        assert.strictEqual(resolveVars('<VK-repo></VK-branch>', VARS), 'my-appmain');
    });

    test('a pair split by text is two tokens', () => {
        assert.strictEqual(resolveVars('<VK-repo> on </VK-repo>', VARS), 'my-app on my-app');
    });

    test('an unknown variable is left literal in both spellings', () => {
        assert.strictEqual(resolveVars('<VK-nope></VK-nope> </VK-nope>', VARS), '<VK-nope></VK-nope> </VK-nope>');
    });

    test('an empty value blanks the pair rather than leaving markup behind', () => {
        assert.strictEqual(resolveVars('a<VK-x></VK-x>b', { 'VK-x': '' }), 'ab');
    });

    test('real markdown payload resolves to clean prose', () => {
        const payload = 'You are working on <VK-repo></VK-repo>, branch </VK-branch>.';
        assert.strictEqual(resolveVars(payload, VARS), 'You are working on my-app, branch main.');
    });
});

suite('render — closing tags are highlighted like opening ones', () => {

    test('a closing tag gets its own vk-var span', () => {
        const html = renderCodeHtml('Review </VK-repo>.', 'markdown');
        assert.match(html, /<span[^>]*class="[^"]*vk-var[^"]*"[^>]*>&lt;\/VK-repo&gt;<\/span>/);
    });

    test('a pair produces two spans and no stray markup', () => {
        const html = renderCodeHtml('<VK-repo></VK-repo>', 'markdown');
        assert.strictEqual((html.match(/class="[^"]*vk-var[^"]*"/g) ?? []).length, 2);
    });
});

// ── Drift guard ─────────────────────────────────────────────────────────────────

/**
 * The webview's `vkWrap` cannot import `VK_TOKEN_RE` (client JS has no module
 * system), so it carries a twin pattern. Bind them: the webview highlighter must
 * recognise exactly the tokens the parser resolves, or a token renders plain in
 * the code area and silently vanishes on insert.
 */
suite('webview vkWrap matches VK_TOKEN_RE', () => {

    /** Pulls the `vkWrap` regex literal out of the generated client JS. */
    function webviewTokenRe(): RegExp {
        const src = /html\.replace\(\/(.+?)\/g,/.exec(CODE_BLOCK_CLIENT_JS);
        assert.ok(src, 'vkWrap regex not found in CODE_BLOCK_CLIENT_JS');
        // The webview matches HTML-escaped text; decode so both patterns are
        // compared against the same raw token spellings.
        const body = src[1].replaceAll('&lt;', '<').replaceAll('&gt;', '>');
        return new RegExp(body, 'g');
    }

    const CASES = ['<VK-repo>', '</VK-repo>', '<VK-a_b>', '</VK-a_b>'];
    const NON_TOKENS = ['<div>', '</div>', '<VK->', '</VK->', '<vk-repo>'];

    for (const token of CASES) {
        test(`both patterns match ${token}`, () => {
            assert.strictEqual(
                new RegExp(VK_TOKEN_RE.source, 'g').test(token),
                webviewTokenRe().test(token),
                `parser and webview disagree on ${token}`,
            );
        });
    }

    for (const token of NON_TOKENS) {
        test(`both patterns reject ${token}`, () => {
            assert.strictEqual(new RegExp(VK_TOKEN_RE.source, 'g').test(token), false, `parser matched ${token}`);
            assert.strictEqual(webviewTokenRe().test(token), false, `webview matched ${token}`);
        });
    }
});
