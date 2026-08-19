import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { openScratchFile, disposeScratchFile, sweepOrphans } from '../src/services/scratch-file.service.js';

/**
 * `scratch-file.service.ts` is the one authority for real temp-edit files
 * written into extension storage (`<storageUri>/<subdir>/<slug>.<ext>`),
 * generalised from `blockEditor.ts`'s `<storageUri>/blockEdit/` behaviour.
 *
 * Security focus: a hostile `baseName` must be **rejected**, never slugged
 * into an accepted write — `slugify('../../evil')` is `'evil'`, an innocuous
 * filename, so containment must be checked against the *raw* name too, not
 * only the post-slug one. Both hostile shapes are asserted below.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): vscode.Uri {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-file-test-'));
    return vscode.Uri.file(dir);
}

async function readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

suite('scratch-file.service', () => {

    // ── Happy path ───────────────────────────────────────────────────────────

    test('openScratchFile writes content at <storageUri>/<subdir>/<slug>.<ext>', async () => {
        const storageUri = makeTmpDir();
        const uri = await openScratchFile({
            storageUri,
            subdir: 'blockEdit',
            baseName: 'My Block Title',
            ext: 'ts',
            content: 'const x = 1;',
        });
        assert.notStrictEqual(uri, undefined);
        assert.ok(uri!.fsPath.endsWith(path.join('blockEdit', 'my-block-title.ts')));
        assert.strictEqual(await readFile(uri!), 'const x = 1;');
    });

    test('openScratchFile creates the subdir when absent', async () => {
        const storageUri = makeTmpDir();
        const uri = await openScratchFile({
            storageUri,
            subdir: 'blockEdit',
            baseName: 'fresh',
            ext: 'js',
            content: 'x',
        });
        assert.notStrictEqual(uri, undefined);
        const dirStat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(storageUri, 'blockEdit'));
        assert.ok((dirStat.type & vscode.FileType.Directory) !== 0);
    });

    // ── Hostile base names — rejected, not sanitised ───────────────────────────

    test('a parent-directory traversal base name is rejected', async () => {
        const storageUri = makeTmpDir();
        const result = await openScratchFile({
            storageUri, subdir: 'x', baseName: '../../evil', ext: 'ts', content: '',
        });
        assert.strictEqual(result, undefined);
    });

    test('a traversal base name never even creates the subdir — rejected before any write', async () => {
        const storageUri = makeTmpDir();
        await openScratchFile({ storageUri, subdir: 'x', baseName: '../../evil', ext: 'ts', content: 'x' });
        // Rejection happens before mkdir+write, and it must not have been
        // slugged into an accepted "evil.ts" write inside storageUri/x either.
        assert.strictEqual(await exists(vscode.Uri.joinPath(storageUri, 'x')), false);
        assert.strictEqual(await exists(vscode.Uri.joinPath(storageUri, 'x', 'evil.ts')), false);
    });

    test('an absolute-path base name is rejected', async () => {
        const storageUri = makeTmpDir();
        const result = await openScratchFile({
            storageUri, subdir: 'x', baseName: '/etc/passwd', ext: 'ts', content: '',
        });
        assert.strictEqual(result, undefined);
    });

    test('an absolute-path base name never writes to that absolute location', async () => {
        const storageUri = makeTmpDir();
        await openScratchFile({ storageUri, subdir: 'x', baseName: '/etc/passwd', ext: 'ts', content: 'x' });
        assert.strictEqual(await exists(vscode.Uri.file('/etc/passwd.ts')), false);
    });

    test('a base name that slugifies to empty is rejected', async () => {
        const storageUri = makeTmpDir();
        const result = await openScratchFile({
            storageUri, subdir: 'x', baseName: '!!!', ext: 'ts', content: '',
        });
        assert.strictEqual(result, undefined);
    });

    // ── Hostile subdir — rejected, not sanitised ────────────────────────────────
    // `vscode.Uri.joinPath` normalises `..`, so `subdir` is exactly as untrusted
    // as `baseName` and must go through the same containment gate.

    test('a parent-directory traversal subdir is rejected', async () => {
        const storageUri = makeTmpDir();
        const result = await openScratchFile({
            storageUri, subdir: '../../evil-dir', baseName: 'fine', ext: 'ts', content: '',
        });
        assert.strictEqual(result, undefined);
    });

    test('a traversal subdir never creates the escape target', async () => {
        const storageUri = makeTmpDir();
        // One level up from storageUri is os.tmpdir() itself — a deterministic,
        // writable-if-the-guard-were-missing target, unlike '../../evil-dir'
        // (which could land outside any writable dir and pass for the wrong
        // reason: OS permission denial rather than our own containment check).
        const escapeTarget = path.join(os.tmpdir(), 'scratch-file-escape-marker');
        await openScratchFile({ storageUri, subdir: '../scratch-file-escape-marker', baseName: 'fine', ext: 'ts', content: 'x' });
        assert.strictEqual(fs.existsSync(escapeTarget), false, 'a hostile subdir must not create anything outside storageUri');
    });

    // ── dispose ──────────────────────────────────────────────────────────────

    test('disposeScratchFile deletes the file', async () => {
        const storageUri = makeTmpDir();
        const uri = await openScratchFile({
            storageUri, subdir: 'blockEdit', baseName: 'to-delete', ext: 'ts', content: 'x',
        });
        assert.notStrictEqual(uri, undefined);
        assert.strictEqual(await exists(uri!), true);
        await disposeScratchFile(uri!);
        assert.strictEqual(await exists(uri!), false);
    });

    test('disposeScratchFile on an already-missing file does not throw', async () => {
        const storageUri = makeTmpDir();
        const ghost = vscode.Uri.joinPath(storageUri, 'blockEdit', 'never-existed.ts');
        await assert.doesNotReject(disposeScratchFile(ghost));
    });

    // ── sweepOrphans ─────────────────────────────────────────────────────────

    test('sweepOrphans removes every leftover file in the subdir', async () => {
        const storageUri = makeTmpDir();
        await openScratchFile({ storageUri, subdir: 'blockEdit', baseName: 'orphan-one', ext: 'ts', content: 'a' });
        await openScratchFile({ storageUri, subdir: 'blockEdit', baseName: 'orphan-two', ext: 'ts', content: 'b' });

        const dir = vscode.Uri.joinPath(storageUri, 'blockEdit');
        const before = await vscode.workspace.fs.readDirectory(dir);
        assert.strictEqual(before.length, 2);

        await sweepOrphans(storageUri, 'blockEdit');

        const after = await vscode.workspace.fs.readDirectory(dir);
        assert.strictEqual(after.length, 0);
    });

    test('sweepOrphans on a subdir that does not exist is a no-op, not an error', async () => {
        const storageUri = makeTmpDir();
        await assert.doesNotReject(sweepOrphans(storageUri, 'blockEdit'));
    });

    // ── sweepOrphans — hostile subdir, rejected not sanitised ───────────────────

    test('sweepOrphans with a traversal subdir deletes nothing outside storageUri', async () => {
        const storageUri = makeTmpDir();
        // A sibling directory with a bait file — outside storageUri, and what a
        // missing containment check on `subdir` would expose to the delete loop.
        const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-file-victim-'));
        const baitFile = path.join(victimDir, 'bait.txt');
        fs.writeFileSync(baitFile, 'do not delete');

        const subdir = path.join('..', path.basename(victimDir));
        await assert.doesNotReject(sweepOrphans(storageUri, subdir));

        assert.strictEqual(fs.existsSync(baitFile), true, 'sweepOrphans must not touch a directory outside storageUri');
        assert.strictEqual(fs.existsSync(victimDir), true, 'sweepOrphans must not touch a directory outside storageUri');
    });
});
