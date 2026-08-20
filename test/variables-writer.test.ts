import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { renderVariablesFile, writeVariablesFile } from '../src/services/variables-writer.service.js';
import { parseFromContent } from '../src/services/parser.service.js';
import { buildVarSetModel } from '../src/services/varset.service.js';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';

/**
 * T15 — Variables file writer.
 *
 * The parse → serialize → parse round-trip IS the guard for the whole-file
 * rewrite strategy: `renderVariablesFile` renders through `serializeArtifact`
 * only, and `writeVariablesFile` writes through `writeArtifact({ force: true })`
 * only. No bespoke Variables-file assembly exists anywhere in this module.
 */

const SNAPSHOT_DIR = path.resolve(__dirname, '../../test/snapshots/varset');

/**
 * Every golden's file stem, derived from the directory itself rather than
 * hand-copied — an eighth golden is picked up automatically instead of
 * silently going untested (the `VALID_TYPES` failure mode `CLAUDE.md` names).
 */
const GOLDEN_NAMES = fs.readdirSync(SNAPSHOT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -'.md'.length));

/**
 * Reads a `test/snapshots/varset/*.md` golden verbatim — the canonical output
 * of `serializeArtifact` itself, per the plan's fixture-substitution note
 * (ledger #79). Read-only: this suite never writes into that directory.
 *
 * @param name - Golden file stem.
 * @returns The golden file's exact contents.
 */
function readGolden(name: string): string {
    return fs.readFileSync(path.join(SNAPSHOT_DIR, `${name}.md`), 'utf8');
}

/**
 * Rebuilds an `ArtifactFormModel` from a golden's own parsed shape, so the
 * round-trip is driven purely by what the file already says — no dependency
 * on the private CASES table `varset-serialize.test.ts` used to produce it.
 *
 * @param name - Golden file stem.
 * @returns Single-block Variables model matching the golden's frontmatter/vars.
 */
function modelFromGolden(name: string): ArtifactFormModel {
    const parsed = parseFromContent(readGolden(name), `/vault/Variables/${name}.md`, '/vault/Variables');
    return {
        artifactType: 'Variables',
        title: parsed.frontmatter.title ?? '',
        description: parsed.frontmatter.description ?? '',
        tags: parsed.frontmatter.tags ?? [],
        blocks: [{ heading: '', description: '', language: '', code: '', vars: parsed.vars }],
    };
}

function makeTmpDir(): vscode.Uri {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'variables-writer-test-'));
    return vscode.Uri.file(dir);
}

async function readFile(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(bytes);
}

// ── Round-trip — single sub-set (plan's verbatim Test first) ──────────────────

suite('renderVariablesFile — round-trip', () => {

    test('Test first — a single sub-set model round-trips through parseFromContent', () => {
        const model = buildVarSetModel('Local Dev', '', [], [['VK-host', 'localhost']]);
        const md = renderVariablesFile(model);
        const back = parseFromContent(md, '/v/Variables/dev.md', '/v/Variables');
        assert.deepStrictEqual(back.vars, model.blocks[0].vars);
    });

    test('the golden directory is non-empty — an empty dir must not fake a green suite', () => {
        assert.ok(GOLDEN_NAMES.length > 0, `no *.md goldens found in ${SNAPSHOT_DIR}`);
    });

    for (const name of GOLDEN_NAMES) {
        test(`golden "${name}" round-trips with no frontmatter-key loss`, () => {
            const model = modelFromGolden(name);
            const md = renderVariablesFile(model);
            const back = parseFromContent(md, `/vault/Variables/${name}.md`, '/vault/Variables');

            assert.strictEqual(back.frontmatter.artifactType, 'Variables', `${name}: artifactType`);
            assert.strictEqual(back.frontmatter.title, model.title, `${name}: title`);
            assert.strictEqual(back.frontmatter.description ?? '', model.description, `${name}: description`);
            assert.deepStrictEqual(back.frontmatter.tags ?? [], model.tags, `${name}: tags`);
            assert.deepStrictEqual(back.vars, model.blocks[0].vars, `${name}: vars`);
        });
    }

    // ── Multi sub-set (2+ `## ` blocks) — the hard half ────────────────────────
    //
    // A one-sub-set model's data lands in `back.vars` (asserted above). A
    // two-sub-set model is multi-block, so per-block data must be read from
    // `back.blocks[i].vars` instead — asserted here so this suite does not
    // only check the easy half.
    //
    // Empirically (verified against the real `serializeArtifact` →
    // `parseFromContent` path, not asserted from the plan's prose): the
    // top-level `back.vars` for a multi-block file is NOT `[]`. It is
    // polluted with sub-set 1's vars, because `parser.service.ts`'s
    // `parseVars`/`parseCodeBlock` scan the *whole file* for the first fence
    // and are blind to `## ` headings — the same fence `parseBlocks` also
    // reads correctly, scoped, into `blocks[0]`. This is the normalisation
    // ceiling the writer's `ponytail:` comment names. No caller reads
    // `back.vars` for a multi-block file today (every caller branches on
    // `blocks.length`), so nothing downstream observes it — but the pollution
    // is real and this assertion pins it so a future caller does not learn it
    // the hard way.
    test('a two sub-set model: per-block data lands in blocks[i].vars; top-level vars is NOT empty (ceiling)', () => {
        const model: ArtifactFormModel = {
            artifactType: 'Variables',
            title: 'Env Bundle',
            description: '',
            tags: [],
            blocks: [
                { heading: 'Dev', description: '', language: '', code: '', vars: [{ name: 'VK-host', defaultValue: 'localhost' }] },
                { heading: 'Prod', description: '', language: '', code: '', vars: [
                    { name: 'VK-host', defaultValue: 'prod.example.com' },
                    { name: 'VK-port', defaultValue: '443' },
                ] },
            ],
        };
        const md = renderVariablesFile(model);
        const back = parseFromContent(md, '/vault/Variables/env-bundle.md', '/vault/Variables');

        assert.strictEqual(back.blocks.length, 2);
        assert.deepStrictEqual(back.blocks[0].vars, model.blocks[0].vars, 'sub-set 1 vars');
        assert.deepStrictEqual(back.blocks[1].vars, model.blocks[1].vars, 'sub-set 2 vars');

        // The ceiling: top-level `vars` is sub-set 1's, not `[]`.
        assert.deepStrictEqual(back.vars, model.blocks[0].vars, 'top-level vars ceiling — polluted with sub-set 1');
    });
});

// ── writeVariablesFile — writes through writeArtifact(force: true) only ───────

suite('writeVariablesFile', () => {

    test('writes a new Variables file that round-trips', async () => {
        const vaultRoot = makeTmpDir();
        const chosenDir = vscode.Uri.joinPath(vaultRoot, 'Variables');
        const model = buildVarSetModel('Local Dev', '', [], [['VK-host', 'localhost']]);

        const result = await writeVariablesFile({ vaultRoot, chosenDir, fileName: 'dev', model });

        assert.strictEqual(result.kind, 'success');
        // Independent of `renderVariablesFile` — parses the file back off disk
        // and checks real values, so a broken renderer (e.g. one that writes
        // `''`) cannot pass by comparing against its own broken output.
        const written = await readFile(vscode.Uri.file(result.kind === 'success' ? result.filePath : ''));
        const back = parseFromContent(written, result.kind === 'success' ? result.filePath : '', chosenDir.fsPath);
        assert.strictEqual(back.frontmatter.artifactType, 'Variables');
        assert.strictEqual(back.frontmatter.title, 'Local Dev');
        assert.deepStrictEqual(back.vars, [{ name: 'VK-host', defaultValue: 'localhost' }]);
    });

    test('force: true overwrites an existing Variables file — the edit path', async () => {
        const vaultRoot = makeTmpDir();
        const chosenDir = vscode.Uri.joinPath(vaultRoot, 'Variables');
        const first = buildVarSetModel('Local Dev', '', [], [['VK-host', 'localhost']]);
        const edited = buildVarSetModel('Local Dev', '', [], [['VK-host', 'staging.example.com']]);

        const firstResult = await writeVariablesFile({ vaultRoot, chosenDir, fileName: 'dev', model: first });
        assert.strictEqual(firstResult.kind, 'success');

        const secondResult = await writeVariablesFile({ vaultRoot, chosenDir, fileName: 'dev', model: edited });
        assert.strictEqual(secondResult.kind, 'success', 'edit path must overwrite, never collide');

        // Independent check, as above — read real bytes off disk and parse
        // them, rather than re-deriving the expectation from the function
        // under test.
        const written = await readFile(vscode.Uri.file(secondResult.kind === 'success' ? secondResult.filePath : ''));
        const back = parseFromContent(written, secondResult.kind === 'success' ? secondResult.filePath : '', chosenDir.fsPath);
        assert.deepStrictEqual(back.vars, [{ name: 'VK-host', defaultValue: 'staging.example.com' }]);
    });

    test('rejects a chosenDir outside vaultRoot — containment, not string concatenation', async () => {
        const vaultRoot = makeTmpDir();
        const outsideDir = makeTmpDir();
        const model = buildVarSetModel('Local Dev', '', [], [['VK-host', 'localhost']]);

        const result = await writeVariablesFile({ vaultRoot, chosenDir: outsideDir, fileName: 'evil', model });

        assert.strictEqual(result.kind, 'error');
        assert.ok(!fs.existsSync(path.join(outsideDir.fsPath, 'evil.md')));
    });
});
