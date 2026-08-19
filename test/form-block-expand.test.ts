import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { scratchNameForBlock, FormBlockExpandController } from '../src/ui/panels/artifactForm/blockExpand.js';
import type { ArtifactFormBlock } from '../src/types/artifact-form.types.js';

/**
 * `blockExpand.ts` (T5, VSX-207) — form block expand → editor → back.
 *
 * `scratchNameForBlock` is the pure naming rule: it must slug a heading
 * before anything reaches `scratch-file.service`'s own containment checks,
 * so a hostile heading never arrives there unslugged (that service rejects
 * hostile input rather than sanitising it — this is the layer that keeps it
 * from ever seeing one).
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): vscode.Uri {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-block-expand-test-'));
    return vscode.Uri.file(dir);
}

function block(over: Partial<ArtifactFormBlock> = {}): ArtifactFormBlock {
    return { heading: '', description: '', language: '', code: '', vars: [], ...over };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

// ── scratchNameForBlock ──────────────────────────────────────────────────────

suite('form-block-expand', () => {

    suite('scratchNameForBlock', () => {
        test('empty heading falls back to untitled-block-<n+1>, keyed off index', () => {
            assert.strictEqual(
                scratchNameForBlock({ heading: '', language: 'typescript' }, 2),
                'untitled-block-3.ts',
            );
        });

        test('a hostile heading yields a slugged, separator-free name', () => {
            const name = scratchNameForBlock({ heading: '../../etc/passwd', language: 'ts' }, 0);
            assert.strictEqual(name, 'etc-passwd.ts');
            assert.ok(!name.includes('/') && !name.includes('\\'), 'name must carry no path separator');
            assert.ok(!name.includes('..'), 'name must carry no traversal segment');
        });

        test('a normal heading slugifies as the base name', () => {
            assert.strictEqual(
                scratchNameForBlock({ heading: 'Dev Setup', language: 'javascript' }, 5),
                'dev-setup.js',
            );
        });
    });

    // ── FormBlockExpandController ────────────────────────────────────────────

    suite('FormBlockExpandController', () => {
        test('start() writes the block code to a temp file and opens it', async () => {
            const storageUri = makeTmpDir();
            const b = block({ heading: 'My Block', language: 'typescript', code: 'const x = 1;' });
            const ctrl = new FormBlockExpandController({
                storageUri,
                getBlock: (i) => (i === 0 ? b : undefined),
                onSaved: () => { /* not exercised here */ },
                getViewColumn: () => undefined,
            });

            await ctrl.start(0);
            try {
                const doc = vscode.window.activeTextEditor?.document;
                assert.notStrictEqual(doc, undefined);
                assert.strictEqual(doc!.getText(), 'const x = 1;');
                assert.ok(doc!.uri.fsPath.endsWith(path.join('formBlockEdit', 'my-block.ts')));
            } finally {
                await ctrl.teardown();
            }
        });

        test('teardown() deletes the temp file', async () => {
            const storageUri = makeTmpDir();
            const b = block({ heading: 'Gone Soon', language: 'javascript', code: 'x' });
            const ctrl = new FormBlockExpandController({
                storageUri,
                getBlock: () => b,
                onSaved: () => { /* not exercised here */ },
                getViewColumn: () => undefined,
            });

            await ctrl.start(0);
            const tempUri = vscode.window.activeTextEditor!.document.uri;
            assert.strictEqual(await exists(tempUri), true);

            await ctrl.teardown();
            assert.strictEqual(await exists(tempUri), false);
        });

        test('saving the temp file reports the new text through onSaved', async () => {
            const storageUri = makeTmpDir();
            const b = block({ heading: 'Save Me', language: 'plaintext', code: 'before' });
            let saved: { index: number; code: string } | undefined;
            const ctrl = new FormBlockExpandController({
                storageUri,
                getBlock: () => b,
                onSaved: (index, code) => { saved = { index, code }; },
                getViewColumn: () => undefined,
            });

            await ctrl.start(3);
            try {
                const editor = vscode.window.activeTextEditor!;
                await editor.edit(e => {
                    const full = editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0));
                    e.replace(full, 'after');
                });
                await editor.document.save();

                assert.deepStrictEqual(saved, { index: 3, code: 'after' });
            } finally {
                await ctrl.teardown();
            }
        });

        test('a hostile heading never escapes extension storage', async () => {
            const storageUri = makeTmpDir();
            const b = block({ heading: '../../evil', language: 'ts', code: 'x' });
            const ctrl = new FormBlockExpandController({
                storageUri,
                getBlock: () => b,
                onSaved: () => { /* not exercised here */ },
                getViewColumn: () => undefined,
            });

            await ctrl.start(0);
            try {
                const doc = vscode.window.activeTextEditor?.document;
                assert.notStrictEqual(doc, undefined);
                assert.ok(doc!.uri.fsPath.startsWith(storageUri.fsPath), 'temp file must stay inside storageUri');
                assert.strictEqual(await exists(vscode.Uri.file(path.join(os.tmpdir(), 'evil.ts'))), false);
            } finally {
                await ctrl.teardown();
            }
        });
    });
});
