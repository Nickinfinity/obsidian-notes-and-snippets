import * as assert from 'node:assert';
import { captureExplorerFile, fileNameForType } from '../src/commands/capture/explorer.capture.js';

/**
 * Unit tests for `captureExplorerFile` / `fileNameForType` (VSX-212, T10).
 *
 * 🔒 Security-critical: a workspace file name — authored by whoever owns the
 * workspace, not this extension — becomes vault frontmatter (`target:` /
 * `extension:`) and, downstream, an actual filename on disk. Every hostile
 * shape must be *rejected* (`undefined`), never trimmed into an accepted one.
 */

suite('fileNameForType', () => {
    test('plain basename is accepted unchanged', () => {
        assert.strictEqual(fileNameForType('CLAUDE.md', 'AIAgentsConfig'), 'CLAUDE.md');
    });

    test('rejects a ../ traversal', () => {
        assert.strictEqual(fileNameForType('../../etc/passwd', 'AIAgentsConfig'), undefined);
    });

    test('rejects an absolute path', () => {
        assert.strictEqual(fileNameForType('/etc/passwd', 'AIAgentsConfig'), undefined);
    });

    test('rejects a clean relative path with a separator (safeRelPath-clean, not a basename)', () => {
        assert.strictEqual(fileNameForType('sub/b.ts', 'Template'), undefined);
    });

    test('rejects a Windows backslash/drive-letter form', () => {
        assert.strictEqual(fileNameForType('C:\\Windows\\System32\\evil.txt', 'AIAgentsConfig'), undefined);
    });

    test('rejects a NUL character', () => {
        assert.strictEqual(fileNameForType('evil\x00.txt', 'AIAgentsConfig'), undefined);
    });

    test('rejects a control character', () => {
        assert.strictEqual(fileNameForType('evil\x01name.txt', 'Template'), undefined);
    });

    test('rejects a leading-./-normalised name (safeRelPath strips "./" — raw is not a plain basename)', () => {
        assert.strictEqual(fileNameForType('./CLAUDE.md', 'AIAgentsConfig'), undefined);
    });

    test('rejects a trailing-slash name (safeRelPath strips it — raw is not a plain basename)', () => {
        assert.strictEqual(fileNameForType('CLAUDE.md/', 'Template'), undefined);
    });
});

suite('captureExplorerFile', () => {
    test('AIAgentsConfig: builds target from a verbatim basename via buildFilePrefill', () => {
        const result = captureExplorerFile(
            { fileName: 'CLAUDE.md', contents: '# hi', languageId: 'markdown' },
            'AIAgentsConfig',
        );
        assert.strictEqual(result?.source, 'file');
        assert.strictEqual(result?.prefill.target, 'CLAUDE.md');
        assert.deepStrictEqual(result?.prefill.blocks?.[0], {
            heading: '', description: '', language: 'markdown', code: '# hi', vars: [],
        });
    });

    test('Template: builds extension from the file extension via buildFilePrefill', () => {
        const result = captureExplorerFile(
            { fileName: 'Button.tsx', contents: 'const x = 1;', languageId: 'typescriptreact' },
            'Template',
        );
        assert.strictEqual(result?.source, 'file');
        assert.strictEqual(result?.prefill.extension, 'tsx');
        assert.strictEqual(result?.prefill.blocks?.[0]?.language, 'tsx');
    });

    test('rejects a hostile fileName before it ever reaches buildFilePrefill (never trimmed to "passwd")', () => {
        const result = captureExplorerFile(
            { fileName: '../../etc/passwd', contents: 'x', languageId: 'plaintext' },
            'AIAgentsConfig',
        );
        assert.strictEqual(result, undefined);
    });

    test('rejects an oversized file (> 512 KiB)', () => {
        const result = captureExplorerFile(
            { fileName: 'CLAUDE.md', contents: 'a'.repeat(512 * 1024 + 1), languageId: 'markdown' },
            'AIAgentsConfig',
        );
        assert.strictEqual(result, undefined);
    });

    test('accepts a file at exactly the 512 KiB boundary', () => {
        const result = captureExplorerFile(
            { fileName: 'CLAUDE.md', contents: 'a'.repeat(512 * 1024), languageId: 'markdown' },
            'AIAgentsConfig',
        );
        assert.strictEqual(result?.source, 'file');
    });
});
