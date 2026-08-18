import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writeArtifact } from '../src/services/artifact-writer.service.js';

/**
 * Integration tests for `writeArtifact` — uses real temp directories and
 * `vscode.workspace.fs` so the writer is exercised under the same API surface
 * it uses in production.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a fresh temp directory for one test run and returns its Uri.
 *
 * @returns `vscode.Uri` pointing to the new temp dir.
 *
 * @example
 * const vaultRoot = makeTmpDir();
 */
function makeTmpDir(): vscode.Uri {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-writer-test-'));
    return vscode.Uri.file(dir);
}

/**
 * Reads a file via `vscode.workspace.fs` and returns its UTF-8 content.
 *
 * @param uri - File Uri to read.
 * @returns UTF-8 string content.
 *
 * @example
 * await readFile(vscode.Uri.file('/tmp/test/foo.md'))
 */
async function readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('writeArtifact', () => {

    // ── Base-dir auto-create ──────────────────────────────────────────────────

    test('auto-creates Snippets base dir when it does not exist', async () => {
        const vaultRoot = makeTmpDir();
        const result = await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'my-snippet',
            content: 'hello',
        });
        assert.strictEqual(result.kind, 'success');
        const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(vaultRoot, 'Snippets'));
        assert.ok((stat.type & vscode.FileType.Directory) !== 0, 'Snippets dir should exist');
    });

    test('auto-creates Commands base dir when it does not exist', async () => {
        const vaultRoot = makeTmpDir();
        const result = await writeArtifact({
            vaultRoot,
            type: 'command',
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Commands'),
            fileName: 'deploy',
            content: 'echo deploy',
        });
        assert.strictEqual(result.kind, 'success');
        const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(vaultRoot, 'Commands'));
        assert.ok((stat.type & vscode.FileType.Directory) !== 0);
    });

    // ── Path resolution ───────────────────────────────────────────────────────

    test('success result filePath ends with fileName.md', async () => {
        const vaultRoot = makeTmpDir();
        const result = await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'my-snippet',
            content: 'x',
        });
        assert.strictEqual(result.kind, 'success');
        assert.ok(result.filePath.endsWith('my-snippet.md'));
    });

    test('chosenDir is honoured for nested subdirectory', async () => {
        const vaultRoot = makeTmpDir();
        const nestedDir = vscode.Uri.joinPath(vaultRoot, 'Snippets', 'Web');
        await vscode.workspace.fs.createDirectory(nestedDir);
        const result = await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: nestedDir,
            fileName: 'route',
            content: 'x',
        });
        assert.strictEqual(result.kind, 'success');
        assert.ok(result.filePath.includes(path.join('Snippets', 'Web')));
    });

    // ── Success — byte-equal ──────────────────────────────────────────────────

    test('written file content matches input exactly', async () => {
        const vaultRoot = makeTmpDir();
        const content = '---\ntype: snippet\n---\n\n```javascript\nconsole.log("hi");\n```\n';
        const result = await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'hi',
            content,
        });
        assert.strictEqual(result.kind, 'success');
        const written = await readFile(vscode.Uri.file(result.filePath));
        assert.strictEqual(written, content);
    });

    // ── Collision — no force ──────────────────────────────────────────────────

    test('returns collision when file exists and force is not set', async () => {
        const vaultRoot = makeTmpDir();
        const args = {
            vaultRoot,
            type: 'snippet' as const,
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'existing',
            content: 'original',
        };
        await writeArtifact(args);  // first write → success
        const result = await writeArtifact(args);  // second → collision
        assert.strictEqual(result.kind, 'collision');
    });

    test('collision does not overwrite the existing file', async () => {
        const vaultRoot = makeTmpDir();
        const args = {
            vaultRoot,
            type: 'snippet' as const,
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'keep-me',
            content: 'original content',
        };
        const first = await writeArtifact(args);
        assert.strictEqual(first.kind, 'success');
        await writeArtifact({ ...args, content: 'new content' });  // collision
        const preserved = await readFile(vscode.Uri.file(first.filePath));
        assert.strictEqual(preserved, 'original content');
    });

    // ── Collision — force: true ───────────────────────────────────────────────

    test('force: true overwrites existing file', async () => {
        const vaultRoot = makeTmpDir();
        const args = {
            vaultRoot,
            type: 'snippet' as const,
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'overwrite-me',
            content: 'original',
        };
        const first = await writeArtifact(args);
        assert.strictEqual(first.kind, 'success');
        const second = await writeArtifact({ ...args, content: 'updated', force: true });
        assert.strictEqual(second.kind, 'success');
        const written = await readFile(vscode.Uri.file(second.filePath));
        assert.strictEqual(written, 'updated');
    });

    // ── Path-escape guard ─────────────────────────────────────────────────────

    test('chosenDir outside vaultRoot returns error', async () => {
        const vaultRoot = makeTmpDir();
        const outsideDir = makeTmpDir();  // a completely separate temp dir
        const result = await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: outsideDir,
            fileName: 'evil',
            content: 'x',
        });
        assert.strictEqual(result.kind, 'error');
    });

    // ── No editor tab opened ──────────────────────────────────────────────────

    test('writer does not open any editor tab on success', async () => {
        const vaultRoot = makeTmpDir();
        const editorsBefore = vscode.window.visibleTextEditors.length;
        await writeArtifact({
            vaultRoot,
            type: 'snippet',
            chosenDir: vscode.Uri.joinPath(vaultRoot, 'Snippets'),
            fileName: 'silent-write',
            content: 'x',
        });
        assert.strictEqual(
            vscode.window.visibleTextEditors.length,
            editorsBefore,
            'writeArtifact must not open an editor tab',
        );
    });
});
