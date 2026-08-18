import * as assert from 'node:assert';
import {
    getAllTypes,
    getEntry,
    getFormConfig,
    getLanguageMode,
    getDefaultLanguage,
    getTypeSingular,
    canMultiBlock,
    getCreateFormTypes,
} from '../src/services/artifact-type-config.service.js';
import { ARTIFACTS } from '../src/types/constants.js';
import type { ArtifactType } from '../src/types/parsed-artifact.types.js';

/**
 * Unit tests for the per-type form-config helper service.
 *
 * The service wraps `ARTIFACTS` from `src/types/constants.ts` so the rest of
 * the codebase never traverses the constants array directly. Per-type behaviour
 * is data-driven — adding a new createForm type should require only a
 * `constants.ts` change, never a code change here or downstream.
 */
suite('artifact-type-config.service', () => {

    // ── getFormConfig ────────────────────────────────────────────────────────

    suite('getFormConfig', () => {
        test('snippet returns its form object', () => {
            const cfg = getFormConfig('snippet');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.language.default, '');
            assert.strictEqual(cfg.label.singular, 'snippet');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('command returns its form object', () => {
            const cfg = getFormConfig('command');
            assert.strictEqual(cfg.language.mode, 'locked');
            assert.strictEqual(cfg.language.default, 'bash');
            assert.strictEqual(cfg.label.singular, 'command');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('agent throws (not create-form-enabled)', () => {
            assert.throws(() => getFormConfig('agent'), /agent/);
        });

        test('template throws (deferred)', () => {
            assert.throws(() => getFormConfig('template'), /template/);
        });

        test('variables throws (own save-as flow)', () => {
            assert.throws(() => getFormConfig('variables'), /variables/);
        });

        test('unknown type throws', () => {
            assert.throws(() => getFormConfig('bogus' as ArtifactType));
        });
    });

    // ── getLanguageMode ──────────────────────────────────────────────────────

    suite('getLanguageMode', () => {
        test('snippet === free', () => {
            assert.strictEqual(getLanguageMode('snippet'), 'free');
        });

        test('command === locked', () => {
            assert.strictEqual(getLanguageMode('command'), 'locked');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getLanguageMode('agent'));
        });
    });

    // ── getDefaultLanguage ───────────────────────────────────────────────────

    suite('getDefaultLanguage', () => {
        test('snippet === "" (plain text)', () => {
            assert.strictEqual(getDefaultLanguage('snippet'), '');
        });

        test('command === "bash"', () => {
            assert.strictEqual(getDefaultLanguage('command'), 'bash');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getDefaultLanguage('template'));
        });
    });

    // ── getTypeSingular ──────────────────────────────────────────────────────

    suite('getTypeSingular', () => {
        test('snippet === "snippet"', () => {
            assert.strictEqual(getTypeSingular('snippet'), 'snippet');
        });

        test('command === "command"', () => {
            assert.strictEqual(getTypeSingular('command'), 'command');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getTypeSingular('variables'));
        });
    });

    // ── canMultiBlock ────────────────────────────────────────────────────────

    suite('canMultiBlock', () => {
        test('snippet === true', () => {
            assert.strictEqual(canMultiBlock('snippet'), true);
        });

        test('command === true', () => {
            assert.strictEqual(canMultiBlock('command'), true);
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => canMultiBlock('agent'));
        });
    });

    // ── getCreateFormTypes ───────────────────────────────────────────────────

    suite('getCreateFormTypes', () => {
        // If this list changes, update `constants.ts` — never edit this test
        // to satisfy code drift. The helper derives the list from
        // ARTIFACTS[*].createForm === true. Adding a new createForm type
        // anywhere must extend the result automatically.
        test('returns exactly [snippet, command] (order-insensitive)', () => {
            const sorted = [...getCreateFormTypes()].sort();
            assert.deepStrictEqual(sorted, ['command', 'snippet']);
        });
    });

    // ── getEntry / getAllTypes (services-dry Phase 2) ─────────────────────────

    suite('getEntry', () => {

        /**
         * @example
         * getEntry('snippet').dir === 'Snippets'
         */
        test('returns the matching entry for every declared type', () => {
            for (const entry of ARTIFACTS) {
                assert.strictEqual(getEntry(entry.type), entry,
                    `getEntry('${entry.type}') did not return its ARTIFACTS entry`);
            }
        });

        test('exposes dir and name for a create-form type', () => {
            assert.strictEqual(getEntry('snippet').dir, 'Snippets');
            assert.strictEqual(getEntry('command').dir, 'Commands');
        });

        test('works for non-create-form types too (unlike getFormConfig)', () => {
            assert.strictEqual(getEntry('variables').dir, 'Variables');
            assert.strictEqual(getEntry('agent').dir, 'AgentsConf');
        });

        test('throws on an unknown type rather than returning undefined', () => {
            assert.throws(
                () => getEntry('nope' as ArtifactType),
                /Unknown artifact type: nope/,
            );
        });
    });

    suite('getAllTypes', () => {

        /**
         * @example
         * getAllTypes() // → ['snippet', 'agent', 'command', 'template', 'variables']
         */
        test('returns every declared type in declaration order', () => {
            assert.deepStrictEqual(getAllTypes(), ARTIFACTS.map(e => e.type));
        });

        test('includes non-create-form types', () => {
            assert.ok(getAllTypes().includes('variables'));
            assert.ok(getAllTypes().includes('agent'));
            assert.ok(getAllTypes().includes('template'));
        });
    });
});
