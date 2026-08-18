import * as assert from 'node:assert';
import type { ArtifactFormBlock, ArtifactFormModel } from '../src/types/artifact-form.types.js';
import type { ParsedVar } from '../src/types/parsed-artifact.types.js';
import {
    mergeBlockVars,
    pruneVarsForSave,
    validateForSave,
    reorderBlocks,
} from '../src/ui/panels/artifactForm/panel.helpers.js';

// ── mergeBlockVars ────────────────────────────────────────────────────────────

suite('mergeBlockVars', () => {

    test('detected vars with no prior current state get empty defaultValue', () => {
        const current: ParsedVar[] = [];
        const detected: ParsedVar[] = [{ name: 'VK-host', defaultValue: '' }];
        const result = mergeBlockVars(current, detected);
        assert.deepStrictEqual(result, [{ name: 'VK-host', defaultValue: '' }]);
    });

    test('preserves typed default from current for detected vars', () => {
        const current: ParsedVar[]  = [{ name: 'VK-host', defaultValue: 'localhost' }];
        const detected: ParsedVar[] = [{ name: 'VK-host', defaultValue: '' }];
        const result = mergeBlockVars(current, detected);
        assert.deepStrictEqual(result, [{ name: 'VK-host', defaultValue: 'localhost' }]);
    });

    test('orphan with non-empty default is kept', () => {
        const current: ParsedVar[]  = [
            { name: 'VK-host', defaultValue: 'localhost' },
            { name: 'VK-gone', defaultValue: 'preserved' },
        ];
        const detected: ParsedVar[] = [{ name: 'VK-host', defaultValue: '' }];
        const result = mergeBlockVars(current, detected);
        assert.ok(result.some(v => v.name === 'VK-gone' && v.defaultValue === 'preserved'));
    });

    test('orphan with empty default is dropped', () => {
        const current: ParsedVar[]  = [
            { name: 'VK-host', defaultValue: 'localhost' },
            { name: 'VK-gone', defaultValue: '' },
        ];
        const detected: ParsedVar[] = [{ name: 'VK-host', defaultValue: '' }];
        const result = mergeBlockVars(current, detected);
        assert.ok(!result.some(v => v.name === 'VK-gone'));
    });

    test('returns empty when both inputs are empty', () => {
        assert.deepStrictEqual(mergeBlockVars([], []), []);
    });
});

// ── pruneVarsForSave ──────────────────────────────────────────────────────────

suite('pruneVarsForSave', () => {

    function makeBlock(code: string, vars: ParsedVar[]): ArtifactFormBlock {
        return { heading: '', description: '', language: 'javascript', code, vars };
    }

    test('keeps var whose token is present in code', () => {
        const block = makeBlock('const x = <VK-host>;', [{ name: 'VK-host', defaultValue: '' }]);
        const [pruned] = pruneVarsForSave([block]);
        assert.deepStrictEqual(pruned!.vars, [{ name: 'VK-host', defaultValue: '' }]);
    });

    test('drops orphan var with empty default', () => {
        const block = makeBlock('no tokens here', [{ name: 'VK-host', defaultValue: '' }]);
        const [pruned] = pruneVarsForSave([block]);
        assert.deepStrictEqual(pruned!.vars, []);
    });

    test('keeps orphan var with non-empty default', () => {
        const block = makeBlock('no tokens here', [{ name: 'VK-host', defaultValue: 'localhost' }]);
        const [pruned] = pruneVarsForSave([block]);
        assert.deepStrictEqual(pruned!.vars, [{ name: 'VK-host', defaultValue: 'localhost' }]);
    });

    test('processes multiple blocks independently', () => {
        const b0 = makeBlock('<VK-a>', [{ name: 'VK-a', defaultValue: '' }]);
        const b1 = makeBlock('no tokens', [{ name: 'VK-b', defaultValue: '' }]);
        const [p0, p1] = pruneVarsForSave([b0, b1]);
        assert.strictEqual(p0!.vars.length, 1);
        assert.strictEqual(p1!.vars.length, 0);
    });
});

// ── validateForSave ───────────────────────────────────────────────────────────

suite('validateForSave', () => {

    function model(overrides: Partial<ArtifactFormModel> = {}): ArtifactFormModel {
        return {
            type:        'snippet',
            title:       'Valid Title',
            description: '',
            tags:        [],
            blocks: [
                { heading: '', description: '', language: 'javascript', code: 'x', vars: [] },
            ],
            ...overrides,
        };
    }

    test('returns ok: true for a valid single-block model', () => {
        const result = validateForSave(model());
        assert.strictEqual(result.ok, true);
        assert.deepStrictEqual(result.errors, {});
    });

    test('fails when title is empty', () => {
        const result = validateForSave(model({ title: '   ' }));
        assert.strictEqual(result.ok, false);
        assert.ok(result.errors['title']);
    });

    test('fails when all blocks have empty code', () => {
        const result = validateForSave(model({
            blocks: [{ heading: '', description: '', language: 'js', code: '  ', vars: [] }],
        }));
        assert.strictEqual(result.ok, false);
        assert.ok(result.errors['blocks']);
    });

    test('multi-block fails when any block has empty heading', () => {
        const result = validateForSave(model({
            blocks: [
                { heading: 'A', description: '', language: 'js', code: 'x', vars: [] },
                { heading: '',  description: '', language: 'js', code: 'y', vars: [] },
            ],
        }));
        assert.strictEqual(result.ok, false);
        assert.ok(result.errors['block:1.heading']);
    });

    test('multi-block passes when all headings non-empty', () => {
        const result = validateForSave(model({
            blocks: [
                { heading: 'A', description: '', language: 'js', code: 'x', vars: [] },
                { heading: 'B', description: '', language: 'js', code: 'y', vars: [] },
            ],
        }));
        assert.strictEqual(result.ok, true);
    });
});

// ── reorderBlocks ─────────────────────────────────────────────────────────────

suite('reorderBlocks', () => {

    function blocks(count: number): ArtifactFormBlock[] {
        return Array.from({ length: count }, (_, i) => ({
            heading: String(i), description: '', language: 'js', code: '', vars: [],
        }));
    }

    test('swaps adjacent blocks', () => {
        const result = reorderBlocks(blocks(3), 0, 1);
        assert.strictEqual(result[0]!.heading, '1');
        assert.strictEqual(result[1]!.heading, '0');
        assert.strictEqual(result[2]!.heading, '2');
    });

    test('swaps non-adjacent blocks', () => {
        const result = reorderBlocks(blocks(3), 0, 2);
        assert.strictEqual(result[0]!.heading, '2');
        assert.strictEqual(result[2]!.heading, '0');
    });

    test('returns new array (immutable)', () => {
        const original = blocks(2);
        const result   = reorderBlocks(original, 0, 1);
        assert.notStrictEqual(result, original);
        assert.strictEqual(original[0]!.heading, '0');
    });

    test('same index → no change', () => {
        const result = reorderBlocks(blocks(2), 1, 1);
        assert.strictEqual(result[0]!.heading, '0');
        assert.strictEqual(result[1]!.heading, '1');
    });
});
