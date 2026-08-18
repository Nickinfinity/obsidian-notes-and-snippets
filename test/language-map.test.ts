import * as assert from 'node:assert';
import { mapLanguageId } from '../src/services/language-map.service.js';

/**
 * Unit tests for mapLanguageId — pure function that maps VS Code languageId
 * strings to conventional hljs / Obsidian fence info-strings.
 *
 * Each row of the initial table gets one assertion. Passthrough is verified
 * for ids already matching fence conventions and for the empty string.
 */

// ── Table rows ────────────────────────────────────────────────────────────────

suite('mapLanguageId — initial table', () => {

    /**
     * @example
     * mapLanguageId('typescriptreact') === 'tsx'
     */
    test('typescriptreact → tsx', () => {
        assert.strictEqual(mapLanguageId('typescriptreact'), 'tsx');
    });

    test('javascriptreact → jsx', () => {
        assert.strictEqual(mapLanguageId('javascriptreact'), 'jsx');
    });

    test('shellscript → bash', () => {
        assert.strictEqual(mapLanguageId('shellscript'), 'bash');
    });

    test('dockerfile → dockerfile', () => {
        assert.strictEqual(mapLanguageId('dockerfile'), 'dockerfile');
    });

    test('objective-c → objc', () => {
        assert.strictEqual(mapLanguageId('objective-c'), 'objc');
    });

    test('objective-cpp → objcpp', () => {
        assert.strictEqual(mapLanguageId('objective-cpp'), 'objcpp');
    });
});

// ── Passthrough ───────────────────────────────────────────────────────────────

suite('mapLanguageId — passthrough', () => {

    /**
     * @example
     * mapLanguageId('javascript') === 'javascript'
     */
    test('javascript passes through unchanged', () => {
        assert.strictEqual(mapLanguageId('javascript'), 'javascript');
    });

    test('typescript passes through unchanged', () => {
        assert.strictEqual(mapLanguageId('typescript'), 'typescript');
    });

    test('python passes through unchanged', () => {
        assert.strictEqual(mapLanguageId('python'), 'python');
    });

    test('empty string passes through unchanged', () => {
        assert.strictEqual(mapLanguageId(''), '');
    });

    test('unknown id passes through unchanged', () => {
        assert.strictEqual(mapLanguageId('some-unknown-lang'), 'some-unknown-lang');
    });
});
