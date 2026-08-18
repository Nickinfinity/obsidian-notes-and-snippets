import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { writeTemplateFile } from '../src/services/template-writer.service.js';

/**
 * T5 — write a template file into the **workspace** (not the vault).
 *
 * Security-critical: the destination is attacker-influenced, so containment is
 * asserted before any I/O. The hostile `destDir` / `fileName` cases below are
 * the reason this module is separate from `writeArtifact` (which is vault-scoped
 * and auto-creates a base directory).
 */

function makeTmpDir(): vscode.Uri {
    return vscode.Uri.file(fs.mkdtempSync(path.join(os.tmpdir(), 'tmpl-writer-test-')));
}

async function readFile(uri: vscode.Uri): Promise<string> {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

// ── Containment (§5) ─────────────────────────────────────────────────────────────

suite('writeTemplateFile — containment', () => {

    test('destDir outside the workspace root → error, no write', async () => {
        const workspaceRoot = makeTmpDir();
        const outside = makeTmpDir();  // a wholly separate temp dir
        const target = vscode.Uri.joinPath(outside, 'evil.ts');
        const result = await writeTemplateFile({
            workspaceRoot, destDir: outside, fileName: 'evil.ts', content: 'x',
        });
        assert.strictEqual(result.kind, 'error');
        assert.strictEqual(await exists(target), false, 'nothing must be written outside root');
    });

    test('a fileName that escapes the root via .. → error, no write', async () => {
        const workspaceRoot = makeTmpDir();
        // joinPath(root, '../evil.ts') normalises above root
        const escaped = vscode.Uri.joinPath(workspaceRoot, '..', 'evil.ts');
        const result = await writeTemplateFile({
            workspaceRoot, destDir: workspaceRoot, fileName: '../evil.ts', content: 'x',
        });
        assert.strictEqual(result.kind, 'error');
        assert.strictEqual(await exists(escaped), false);
    });

    test('destDir equal to the workspace root is allowed', async () => {
        const workspaceRoot = makeTmpDir();
        const result = await writeTemplateFile({
            workspaceRoot, destDir: workspaceRoot, fileName: 'ok.ts', content: 'x',
        });
        assert.strictEqual(result.kind, 'success');
    });
});

// ── Write behaviour ──────────────────────────────────────────────────────────────

suite('writeTemplateFile — write', () => {

    test('writes fileName verbatim — extension included, no .md appended', async () => {
        const workspaceRoot = makeTmpDir();
        const result = await writeTemplateFile({
            workspaceRoot, destDir: workspaceRoot, fileName: 'Button.tsx', content: 'export const B = 1;',
        });
        assert.strictEqual(result.kind, 'success');
        if (result.kind === 'success') {
            assert.ok(result.filePath.endsWith('Button.tsx'), result.filePath);
            assert.ok(!result.filePath.endsWith('.md'));
        }
    });

    test('written content is byte-equal to input', async () => {
        const workspaceRoot = makeTmpDir();
        const content = 'line1\nline2\n';
        const result = await writeTemplateFile({
            workspaceRoot, destDir: workspaceRoot, fileName: 'f.txt', content,
        });
        assert.strictEqual(result.kind, 'success');
        if (result.kind === 'success') {
            assert.strictEqual(await readFile(vscode.Uri.file(result.filePath)), content);
        }
    });

    test('does NOT create a Templates base dir in the workspace', async () => {
        const workspaceRoot = makeTmpDir();
        await writeTemplateFile({
            workspaceRoot, destDir: workspaceRoot, fileName: 'x.ts', content: 'x',
        });
        assert.strictEqual(
            await exists(vscode.Uri.joinPath(workspaceRoot, 'Templates')),
            false,
            'workspace write must not create an artifact-type base directory',
        );
    });
});

// ── Collision ────────────────────────────────────────────────────────────────────

suite('writeTemplateFile — collision', () => {

    test('collision without force → collision, original preserved', async () => {
        const workspaceRoot = makeTmpDir();
        const args = { workspaceRoot, destDir: workspaceRoot, fileName: 'keep.ts', content: 'original' };
        const first = await writeTemplateFile(args);
        assert.strictEqual(first.kind, 'success');
        const second = await writeTemplateFile({ ...args, content: 'new' });
        assert.strictEqual(second.kind, 'collision');
        if (first.kind === 'success') {
            assert.strictEqual(await readFile(vscode.Uri.file(first.filePath)), 'original');
        }
    });

    test('force: true overwrites', async () => {
        const workspaceRoot = makeTmpDir();
        const args = { workspaceRoot, destDir: workspaceRoot, fileName: 'ow.ts', content: 'original' };
        const first = await writeTemplateFile(args);
        assert.strictEqual(first.kind, 'success');
        const second = await writeTemplateFile({ ...args, content: 'updated', force: true });
        assert.strictEqual(second.kind, 'success');
        if (second.kind === 'success') {
            assert.strictEqual(await readFile(vscode.Uri.file(second.filePath)), 'updated');
        }
    });
});
