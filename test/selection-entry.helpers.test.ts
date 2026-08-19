import * as assert from 'node:assert';
import { buildSnippetPrefill, buildCommandPrefill } from '../src/commands/create-prefill.helpers.js';

/**
 * Unit tests for the two pure prefill builders used by the selection-entry
 * commands (Phase 7 — VSX-85).
 *
 * Repointed at Wave 0 close (VSX-205) from `create.command.ts` onto
 * `create-prefill.helpers.ts`. **The assertions are deliberately unchanged** —
 * they are the golden net proving the copy is behaviour-identical, so editing
 * one to accommodate the move would dissolve the only evidence that it was a
 * move rather than a rewrite. The originals stay in `create.command.ts` until
 * Wave 2 deletes them.
 *
 * Both helpers are VS Code-free; they only transform text + languageId into
 * a Partial<ArtifactFormModel> shape. All VS Code I/O is in the command
 * handler and is not tested here.
 */

// ── buildSnippetPrefill ───────────────────────────────────────────────────────

suite('buildSnippetPrefill', () => {

    /**
     * @example
     * buildSnippetPrefill('const x = 1;', 'typescriptreact')
     * // → { blocks: [{ heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [] }] }
     */
    test('maps typescriptreact languageId to tsx fence string', () => {
        const result = buildSnippetPrefill('const x = 1;', 'typescriptreact');
        assert.strictEqual(result.blocks?.[0]?.language, 'tsx');
    });

    test('maps shellscript languageId to bash fence string', () => {
        const result = buildSnippetPrefill('echo hi', 'shellscript');
        assert.strictEqual(result.blocks?.[0]?.language, 'bash');
    });

    test('maps javascriptreact to jsx', () => {
        const result = buildSnippetPrefill('return <div/>', 'javascriptreact');
        assert.strictEqual(result.blocks?.[0]?.language, 'jsx');
    });

    test('passes through unknown languageId unchanged', () => {
        const result = buildSnippetPrefill('code', 'some-unknown-lang');
        assert.strictEqual(result.blocks?.[0]?.language, 'some-unknown-lang');
    });

    test('passes through well-known ids that need no mapping (typescript)', () => {
        const result = buildSnippetPrefill('let x: number', 'typescript');
        assert.strictEqual(result.blocks?.[0]?.language, 'typescript');
    });

    test('passes through empty languageId as empty string', () => {
        const result = buildSnippetPrefill('plain text', '');
        assert.strictEqual(result.blocks?.[0]?.language, '');
    });

    test('puts selection text in blocks[0].code', () => {
        const code = 'const foo = () => "bar";';
        const result = buildSnippetPrefill(code, 'javascript');
        assert.strictEqual(result.blocks?.[0]?.code, code);
    });

    test('returns exactly one block', () => {
        const result = buildSnippetPrefill('x', 'javascript');
        assert.strictEqual(result.blocks?.length, 1);
    });

    test('block has empty heading and description', () => {
        const result = buildSnippetPrefill('x', 'javascript');
        assert.strictEqual(result.blocks?.[0]?.heading, '');
        assert.strictEqual(result.blocks?.[0]?.description, '');
    });

    test('block vars array is empty', () => {
        const result = buildSnippetPrefill('x', 'javascript');
        assert.deepStrictEqual(result.blocks?.[0]?.vars, []);
    });

    test('preserves multi-line selection verbatim', () => {
        const multiLine = 'line one\nline two\nline three';
        const result = buildSnippetPrefill(multiLine, 'plaintext');
        assert.strictEqual(result.blocks?.[0]?.code, multiLine);
    });
});

// ── buildCommandPrefill ───────────────────────────────────────────────────────

suite('buildCommandPrefill', () => {

    /**
     * @example
     * buildCommandPrefill('git status')
     * // → { blocks: [{ heading: '', description: '', language: '', code: 'git status', vars: [] }] }
     */
    test('language is always empty string (command type locks to bash via constants)', () => {
        const result = buildCommandPrefill('git status');
        assert.strictEqual(result.blocks?.[0]?.language, '');
    });

    test('puts text in blocks[0].code', () => {
        const cmd = 'docker ps -a';
        const result = buildCommandPrefill(cmd);
        assert.strictEqual(result.blocks?.[0]?.code, cmd);
    });

    test('returns exactly one block', () => {
        const result = buildCommandPrefill('ls');
        assert.strictEqual(result.blocks?.length, 1);
    });

    test('block has empty heading and description', () => {
        const result = buildCommandPrefill('ls');
        assert.strictEqual(result.blocks?.[0]?.heading, '');
        assert.strictEqual(result.blocks?.[0]?.description, '');
    });

    test('block vars array is empty', () => {
        const result = buildCommandPrefill('ls');
        assert.deepStrictEqual(result.blocks?.[0]?.vars, []);
    });

    test('preserves multi-line command text verbatim', () => {
        const multi = 'git add .\ngit commit -m "msg"';
        const result = buildCommandPrefill(multi);
        assert.strictEqual(result.blocks?.[0]?.code, multi);
    });
});
