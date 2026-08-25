import * as assert from 'node:assert';
import {
    buildSnippetPrefill,
    buildCommandPrefill,
    buildFilePrefill,
} from '../src/commands/create-prefill.helpers.js';

/**
 * Unit tests for the pure create-form prefill builders (VSX-205).
 *
 * All three are VS Code-free: they transform text/file inputs into a
 * `Partial<ArtifactFormModel>` shape with no I/O. `buildSnippetPrefill` and
 * `buildCommandPrefill` are copied verbatim from `create.command.ts` (which
 * still owns the originals this wave); `buildFilePrefill` is new.
 */

// ── buildSnippetPrefill ───────────────────────────────────────────────────────

suite('buildSnippetPrefill', () => {
    test('maps typescriptreact languageId to tsx fence string', () => {
        const result = buildSnippetPrefill('const x = 1;', 'typescriptreact');
        assert.strictEqual(result.blocks?.[0]?.language, 'tsx');
    });

    test('passes through unknown languageId unchanged', () => {
        const result = buildSnippetPrefill('code', 'some-unknown-lang');
        assert.strictEqual(result.blocks?.[0]?.language, 'some-unknown-lang');
    });

    test('carries code and empty heading/description/vars', () => {
        const result = buildSnippetPrefill('const x = 1;', 'javascript');
        assert.deepStrictEqual(result.blocks?.[0], {
            heading: '', description: '', language: 'javascript', code: 'const x = 1;', vars: [],
        });
    });
});

// ── buildCommandPrefill ───────────────────────────────────────────────────────

suite('buildCommandPrefill', () => {
    test('language is always empty string', () => {
        const result = buildCommandPrefill('git status');
        assert.strictEqual(result.blocks?.[0]?.language, '');
    });

    test('carries code verbatim', () => {
        const result = buildCommandPrefill('git status');
        assert.deepStrictEqual(result.blocks?.[0], {
            heading: '', description: '', language: '', code: 'git status', vars: [],
        });
    });
});

// ── buildFilePrefill ──────────────────────────────────────────────────────────

suite('buildFilePrefill', () => {
    test('maps languageId through mapLanguageId for the block fence', () => {
        // mapLanguageId is a passthrough for 'markdown' — LANG_FENCE carries no
        // entry for it (the fence string already equals the languageId); 'md'
        // lives only in LANG_EXT, a different table for cosmetic extensions.
        const result = buildFilePrefill('CLAUDE.md', '# hi', 'markdown', 'AIAgentsConfig');
        const [block] = result.blocks ?? [];
        assert.ok(block);
        assert.strictEqual(block.language, 'markdown');
    });

    test('maps a languageId with a real fence alias (typescriptreact -> tsx)', () => {
        const result = buildFilePrefill('Button.tsx', 'const x = 1;', 'typescriptreact', 'Template');
        const [block] = result.blocks ?? [];
        assert.ok(block);
        assert.strictEqual(block.language, 'tsx');
    });

    test('carries file contents into blocks[0].code', () => {
        const result = buildFilePrefill('CLAUDE.md', '# hi', 'markdown', 'AIAgentsConfig');
        const [block] = result.blocks ?? [];
        assert.ok(block);
        assert.strictEqual(block.code, '# hi');
    });

    test('AIAgentsConfig: sets target to the basename verbatim, not slugged', () => {
        const result = buildFilePrefill('CLAUDE.md', '# hi', 'markdown', 'AIAgentsConfig');
        assert.strictEqual(result.target, 'CLAUDE.md');
        assert.strictEqual(result.extension, undefined);
    });

    test('AIAgentsConfig: strips directory components from the file path', () => {
        const result = buildFilePrefill('/some/dir/CLAUDE.md', '# hi', 'markdown', 'AIAgentsConfig');
        assert.strictEqual(result.target, 'CLAUDE.md');
    });

    test('Template: sets extension without the leading dot', () => {
        const result = buildFilePrefill('Button.tsx', 'const x = 1;', 'typescriptreact', 'Template');
        assert.strictEqual(result.extension, 'tsx');
        assert.strictEqual(result.target, undefined);
    });

    test('any other type: sets neither target nor extension', () => {
        const result = buildFilePrefill('notes.md', 'text', 'markdown', 'Snippet');
        assert.strictEqual(result.target, undefined);
        assert.strictEqual(result.extension, undefined);
    });
});
