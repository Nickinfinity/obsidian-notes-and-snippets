import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildIndexPlan } from '../src/services/multi-index.service.js';
import { parseArtifactFile } from '../src/services/parser.service.js';
import { MultiIndexRunner } from '../src/ui/panels/artifactPicker/multiIndex.js';
import type { MultiIndexCallbacks } from '../src/ui/panels/artifactPicker/multiIndex.js';
import type { BatchOutcome, DestCandidate, IndexStep } from '../src/types/multi-index.types.js';
import type { ParsedArtifactFile } from '../src/types/parsed-artifact.types.js';

/**
 * T6 — `MultiIndexRunner`, driven entirely through its callback bag: a
 * stubbed `chooseDestination` (returns the first candidate, i.e. the mirrored
 * folder) and a stubbed `previewStep` (returns `written` with fixed vars, or
 * whatever outcome a given scenario needs). No extension-host UI interaction
 * is required — that's exactly why the callback bag exists.
 *
 * The vault side is real, read-only fixtures under `test/fixtures/multi-index/`
 * (mirroring the exact link set `multi-index.service.test.ts`'s `buildIndexPlan`
 * suite already exercises); the workspace side is a fresh temp directory per
 * test, cleaned up in `teardown`.
 */

const FIXTURE_DIR = path.join(__dirname, '../../test/fixtures/multi-index');

function readIndexArtifact(fileName: string): ParsedArtifactFile {
    const parsed = parseArtifactFile(path.join(FIXTURE_DIR, fileName), FIXTURE_DIR);
    assert.ok(parsed, `fixture ${fileName} must parse`);
    return parsed;
}

function makeWorkspaceRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'multi-index-runner-test-'));
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

/** `chooseDestination` stub — always picks the mirrored (first) candidate. */
function firstCandidateChooser(workspaceRoot: vscode.Uri): MultiIndexCallbacks['chooseDestination'] {
    return async (_step: IndexStep, candidates: readonly DestCandidate[]) => vscode.Uri.joinPath(workspaceRoot, candidates[0].relPath);
}

/** Records every `previewStep` invocation, and — for `written` calls — writes a marker file so the run's on-disk effect is observable. */
class PreviewStepRecorder {
    calls: { artifact: ParsedArtifactFile; destDir: vscode.Uri }[] = [];
    /** Per-call override, keyed by call index (0-based); default is `written`. */
    outcomes = new Map<number, BatchOutcome['kind']>();

    readonly previewStep: MultiIndexCallbacks['previewStep'] = async (artifact, destDir) => {
        const callIndex = this.calls.length;
        this.calls.push({ artifact, destDir });
        const kind = this.outcomes.get(callIndex) ?? 'written';
        if (kind !== 'written') { return { kind }; }
        const filePath = vscode.Uri.joinPath(destDir, `${artifact.fileName}.out`);
        await vscode.workspace.fs.writeFile(filePath, new TextEncoder().encode(artifact.fileName));
        return { kind: 'written', vars: { 'VK-language': 'java' }, filePath: filePath.fsPath };
    };
}

function makeCallbacks(overrides: Partial<MultiIndexCallbacks> & { workspaceRoot: vscode.Uri }): MultiIndexCallbacks {
    return {
        indexDirUri: vscode.Uri.file(FIXTURE_DIR),
        clickedRelPath: '',
        vaultRootFs: FIXTURE_DIR,
        chooseDestination: firstCandidateChooser(overrides.workspaceRoot),
        previewStep: async () => ({ kind: 'skipped' }),
        closePicker: () => { /* no-op default */ },
        disposePreview: () => { /* no-op default */ },
        ...overrides,
    };
}

// ── buildIndexPlan — the first failing assertion (sanity check on the shared fixture) ──

suite('MultiIndexRunner — plan shape', () => {

    test('the index fixture resolves to the documented relDir sequence', () => {
        const indexArtifact = readIndexArtifact('index.md');
        const plan = buildIndexPlan(indexArtifact.code);
        assert.deepStrictEqual(plan.steps.map(s => s.relDir), ['dir_2/subdir1', 'dir_2/subdir1', 'dir_1']);
    });
});

// ── Full run — success path ──────────────────────────────────────────────────

suite('MultiIndexRunner — run (success)', () => {

    let workspaceDir: string;

    setup(() => { workspaceDir = makeWorkspaceRoot(); });
    teardown(() => { fs.rmSync(workspaceDir, { recursive: true, force: true }); });

    test('writes all three files at their nested paths and creates the folder chain', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const recorder = new PreviewStepRecorder();
        let closed = 0;
        let disposed = 0;
        const cb = makeCallbacks({
            workspaceRoot,
            previewStep: recorder.previewStep,
            closePicker: () => { closed++; },
            disposePreview: () => { disposed++; },
        });

        await new MultiIndexRunner(cb).run(readIndexArtifact('index.md'));

        assert.strictEqual(recorder.calls.length, 3, 'all three accepted steps must run');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.out')), true);
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.test.out')), true);
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_1/barrel.out')), true);
        assert.strictEqual(closed, 1, 'closePicker must fire exactly once');
        assert.strictEqual(disposed, 1, 'disposePreview must fire exactly once');
    });

    test('carry-over reaches step 2: its VK-language default equals step 1\'s submitted value', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const recorder = new PreviewStepRecorder();
        const cb = makeCallbacks({ workspaceRoot, previewStep: recorder.previewStep });

        await new MultiIndexRunner(cb).run(readIndexArtifact('index.md'));

        const step1Vars = recorder.calls[0].artifact.vars;
        assert.strictEqual(step1Vars.find(v => v.name === 'VK-language')?.defaultValue, 'javascript', 'step 1 keeps its own default (empty carry)');

        const step2Vars = recorder.calls[1].artifact.vars;
        assert.strictEqual(step2Vars.find(v => v.name === 'VK-language')?.defaultValue, 'java', 'step 2 must see step 1\'s submitted value, not its own "python" default');
    });
});

// ── Skip / abort semantics ───────────────────────────────────────────────────

suite('MultiIndexRunner — run (skip / abort)', () => {

    let workspaceDir: string;

    setup(() => { workspaceDir = makeWorkspaceRoot(); });
    teardown(() => { fs.rmSync(workspaceDir, { recursive: true, force: true }); });

    test('a skipped outcome on step 2 leaves step 3 running', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const recorder = new PreviewStepRecorder();
        recorder.outcomes.set(1, 'skipped');
        const cb = makeCallbacks({ workspaceRoot, previewStep: recorder.previewStep });

        await new MultiIndexRunner(cb).run(readIndexArtifact('index.md'));

        assert.strictEqual(recorder.calls.length, 3, 'step 3 must still be attempted after a skip');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.out')), true);
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.test.out')), false, 'the skipped step writes nothing');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_1/barrel.out')), true);
    });

    test('an aborted outcome on step 2 means step 3 never runs', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const recorder = new PreviewStepRecorder();
        recorder.outcomes.set(1, 'aborted');
        const cb = makeCallbacks({ workspaceRoot, previewStep: recorder.previewStep });

        await new MultiIndexRunner(cb).run(readIndexArtifact('index.md'));

        assert.strictEqual(recorder.calls.length, 2, 'step 3 must never be attempted once aborted');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_1')), false, 'no folder chain for the never-run step');
    });
});

// ── Security — workspace containment (§e), before createDirectory ───────────

suite('MultiIndexRunner — workspace containment', () => {

    let workspaceDir: string;
    let outsideDir: string;

    setup(() => {
        workspaceDir = makeWorkspaceRoot();
        outsideDir   = makeWorkspaceRoot();  // a wholly separate temp dir — never inside workspaceRoot
    });
    teardown(() => {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    test('a chooseDestination result outside the workspace is rejected before createDirectory; the run continues', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const outside        = vscode.Uri.file(outsideDir);
        const recorder = new PreviewStepRecorder();

        let call = 0;
        const cb = makeCallbacks({
            workspaceRoot,
            chooseDestination: async (_step, candidates) => {
                const destDir = call === 0 ? outside : vscode.Uri.joinPath(workspaceRoot, candidates[0].relPath);
                call++;
                return destDir;
            },
            previewStep: recorder.previewStep,
        });

        await new MultiIndexRunner(cb).run(readIndexArtifact('index.md'));

        // Step 1's hostile destination must never have been written into or created.
        assert.strictEqual(await exists(vscode.Uri.joinPath(outside, 'subdir1')), false);
        const outsideEntries = fs.readdirSync(outsideDir);
        assert.deepStrictEqual(outsideEntries, [], 'nothing must be created outside the workspace root');

        // Steps 2 and 3 (one bad destination cannot kill the run) still ran.
        assert.strictEqual(recorder.calls.length, 2, 'only the two steps with an in-workspace destination reach previewStep');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.test.out')), true);
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_1/barrel.out')), true);
    });
});

// ── Security — hostile index: parent-directory traversal + absolute path ────

suite('MultiIndexRunner — hostile index fixture', () => {

    let workspaceDir: string;

    setup(() => { workspaceDir = makeWorkspaceRoot(); });
    teardown(() => { fs.rmSync(workspaceDir, { recursive: true, force: true }); });

    test('buildIndexPlan rejects both the traversal link and the absolute-path link', () => {
        const indexArtifact = readIndexArtifact('hostile-index.md');
        const plan = buildIndexPlan(indexArtifact.code);

        assert.strictEqual(plan.steps.length, 1, 'only the one legitimate link becomes a step');
        assert.deepStrictEqual(plan.rejected.map(r => r.raw), ['../../etc/passwd', '/etc/passwd']);
    });

    test('a full run of the hostile index writes only the legitimate file, nothing outside the workspace', async () => {
        const workspaceRoot = vscode.Uri.file(workspaceDir);
        const recorder = new PreviewStepRecorder();
        const cb = makeCallbacks({ workspaceRoot, previewStep: recorder.previewStep });

        await new MultiIndexRunner(cb).run(readIndexArtifact('hostile-index.md'));

        assert.strictEqual(recorder.calls.length, 1, 'the two rejected links never reach previewStep at all');
        assert.strictEqual(await exists(vscode.Uri.joinPath(workspaceRoot, 'dir_2/subdir1/Button.out')), true);
    });
});
