import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { BatchGate } from '../src/ui/panels/artifactPicker/preview.batch.js';

/**
 * Unit tests for `BatchGate` — the one-shot promise gate that lets the
 * multi-index runner `await` a step's outcome from the preview webview.
 *
 * `vscode` is only used here for `Uri.file`; the source module itself
 * imports `Uri` type-only, so these tests do not require the extension
 * host beyond what `vscode.Uri` already provides in-suite.
 */

suite('BatchGate', () => {

    test('starts unarmed, arms, and settle resolves the armed promise', async () => {
        const gate = new BatchGate();
        assert.strictEqual(gate.isArmed, false);

        const destUri = vscode.Uri.file('/ws/dest');
        const p = gate.arm(destUri);
        assert.strictEqual(gate.isArmed, true);

        gate.settle({ kind: 'skipped' });
        assert.deepStrictEqual(await p, { kind: 'skipped' });
        assert.strictEqual(gate.isArmed, false);
    });

    test('settling twice resolves to the first outcome; the second call is a no-op', async () => {
        const gate = new BatchGate();
        const p = gate.arm(vscode.Uri.file('/ws/dest'));

        gate.settle({ kind: 'aborted' });
        gate.settle({ kind: 'skipped' });

        assert.deepStrictEqual(await p, { kind: 'aborted' });
    });

    test('arm while already armed rejects, leaving the first promise pending', async () => {
        const gate = new BatchGate();
        const first = gate.arm(vscode.Uri.file('/ws/a'));

        await assert.rejects(() => gate.arm(vscode.Uri.file('/ws/b')));

        gate.settle({ kind: 'skipped' });
        assert.deepStrictEqual(await first, { kind: 'skipped' });
    });

    test('destDir tracks the armed Uri and clears once settled', () => {
        const gate = new BatchGate();
        assert.strictEqual(gate.destDir, undefined);

        const destUri = vscode.Uri.file('/ws/dest');
        void gate.arm(destUri);
        assert.strictEqual(gate.destDir, destUri);

        gate.settle({ kind: 'skipped' });
        assert.strictEqual(gate.destDir, undefined);
    });

    test('settle before any arm is a no-op and does not throw', () => {
        const gate = new BatchGate();
        assert.doesNotThrow(() => { gate.settle({ kind: 'aborted' }); });
        assert.strictEqual(gate.isArmed, false);
    });

    test('a written outcome round-trips its payload', async () => {
        const gate = new BatchGate();
        const p = gate.arm(vscode.Uri.file('/ws/dest'));
        gate.settle({ kind: 'written', vars: { 'VK-a': '1' }, filePath: '/ws/dest/a.ts' });
        assert.deepStrictEqual(await p, { kind: 'written', vars: { 'VK-a': '1' }, filePath: '/ws/dest/a.ts' });
    });

    test('re-arming after settle works (the gate is reusable across steps)', async () => {
        const gate = new BatchGate();
        const p1 = gate.arm(vscode.Uri.file('/ws/one'));
        gate.settle({ kind: 'skipped' });
        assert.deepStrictEqual(await p1, { kind: 'skipped' });

        const p2 = gate.arm(vscode.Uri.file('/ws/two'));
        assert.strictEqual(gate.isArmed, true);
        gate.settle({ kind: 'aborted' });
        assert.deepStrictEqual(await p2, { kind: 'aborted' });
    });
});
