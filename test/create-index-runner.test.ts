import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { runCreateIndex } from '../src/ui/views/createIndexRunner.js';
import type { CreateIndexCallbacks } from '../src/ui/views/createIndexRunner.js';
import { buildIndexArtifactPlan } from '../src/services/create-index.service.js';
import { parseFromContent } from '../src/services/parser.service.js';
import type { WriteArgs, WriteResult } from '../src/services/artifact-writer.service.js';

/**
 * T12 — `runCreateIndex`, driven entirely through its callback bag: a fake
 * `pickDest` and a fake `writeArtifact` that never touch disk. Mirrors the
 * fake style `multi-index-runner.test.ts` (T6) already established for its
 * sibling runner.
 */

const VAULT_ROOT = vscode.Uri.file('/vault');

/** Records every `writeArtifact` call and returns a scripted outcome per call index (default: success). */
class WriteSpy {
    calls: WriteArgs[] = [];
    outcomes = new Map<number, WriteResult['kind']>();

    readonly writeArtifact: CreateIndexCallbacks['writeArtifact'] = async (args) => {
        const i = this.calls.length;
        this.calls.push(args);
        const kind = this.outcomes.get(i) ?? 'success';
        if (kind === 'success') { return { kind: 'success', filePath: `${args.chosenDir.fsPath}/${args.fileName}.md` }; }
        if (kind === 'collision') { return { kind: 'collision', filePath: `${args.chosenDir.fsPath}/${args.fileName}.md` }; }
        return { kind: 'error', message: 'boom' };
    };
}

suite('runCreateIndex', () => {

    test('cancelled pickDest — aborted, nothing written, writeArtifact never called', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => undefined,
        });

        assert.deepStrictEqual(tally, { written: 0, skipped: 0, aborted: true });
        assert.strictEqual(spy.calls.length, 0);
    });

    test('pickDest result outside vaultRoot — aborted before any write (the one containment assertion this runner owns)', async () => {
        const plan = buildIndexArtifactPlan(['a.ts'], 'Template');
        const spy = new WriteSpy();
        const outside = vscode.Uri.file('/somewhere-else');

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => outside,
        });

        assert.deepStrictEqual(tally, { written: 0, skipped: 0, aborted: true });
        assert.strictEqual(spy.calls.length, 0);
    });

    test('happy path — every sibling then the index is written, in order, never with force', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();
        const chosenDir = vscode.Uri.joinPath(VAULT_ROOT, 'Templates');

        const { tally, message } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => chosenDir,
        });

        assert.deepStrictEqual(tally, { written: 3, skipped: 0, aborted: false });
        assert.strictEqual(spy.calls.length, 3, '2 siblings + 1 index');
        assert.ok(message.startsWith('Create index:'), `expected the 'Create index' label, got: ${message}`);

        // Sibling filenames are the plan's links verbatim — extension-less, directory preserved.
        assert.strictEqual(spy.calls[0].fileName, 'a');
        assert.strictEqual(spy.calls[1].fileName, 'sub/b');
        assert.ok(spy.calls.every(c => c.force === undefined), 'force must never be set — collisions are a batch skip, not an overwrite');
        assert.ok(spy.calls.every(c => c.chosenDir === chosenDir));
    });

    test('the written index content round-trips through parseFromContent with index === true', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();

        await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => vscode.Uri.joinPath(VAULT_ROOT, 'Templates'),
        });

        const indexCall = spy.calls[spy.calls.length - 1];
        assert.strictEqual(indexCall.fileName, 'index');

        const parsed = parseFromContent(indexCall.content, '/vault/Templates/index.md', '/vault/Templates');
        assert.strictEqual(parsed.frontmatter.index, true);
    });

    test('a sibling collision degrades to a skip; the run continues and the index still writes', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();
        spy.outcomes.set(0, 'collision');

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => vscode.Uri.joinPath(VAULT_ROOT, 'Templates'),
        });

        assert.deepStrictEqual(tally, { written: 2, skipped: 1, aborted: false });
        assert.strictEqual(spy.calls.length, 3, 'the collision does not stop the sibling loop or the index write');
    });

    test('a sibling write error degrades to a skip, same as a collision', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();
        spy.outcomes.set(1, 'error');

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => vscode.Uri.joinPath(VAULT_ROOT, 'Templates'),
        });

        assert.deepStrictEqual(tally, { written: 2, skipped: 1, aborted: false });
    });

    // ── Review round 1 fixes ─────────────────────────────────────────────────

    test('a selection containing "index.ts" writes both the sibling and the index, under distinct names', async () => {
        // T11 derives the sole sibling's link as 'index' (slugify('index') === 'index'),
        // the same name the index's own title ('Index') would naively produce —
        // without a bump, the index write collides with the sibling and is silently skipped.
        const plan = buildIndexArtifactPlan(['index.ts'], 'Template');
        assert.deepStrictEqual(plan.links, ['index']);
        const spy = new WriteSpy();

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => vscode.Uri.joinPath(VAULT_ROOT, 'Templates'),
        });

        assert.deepStrictEqual(tally, { written: 2, skipped: 0, aborted: false });
        assert.deepStrictEqual(spy.calls.map(c => c.fileName), ['index', 'index-2']);
    });

    test('an index write collision degrades to a skip — the trailing branch is not silently "written"', async () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const spy = new WriteSpy();
        spy.outcomes.set(2, 'collision'); // 2 siblings (calls 0,1) then the index (call 2)

        const { tally } = await runCreateIndex(plan, {
            vaultRoot: VAULT_ROOT,
            writeArtifact: spy.writeArtifact,
            pickDest: async () => vscode.Uri.joinPath(VAULT_ROOT, 'Templates'),
        });

        assert.deepStrictEqual(tally, { written: 2, skipped: 1, aborted: false });
    });
});
