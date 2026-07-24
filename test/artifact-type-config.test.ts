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
    writesWholeFile,
    forcesSingleBlock,
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

        test('agent returns its form object (create-form-enabled, D4)', () => {
            const cfg = getFormConfig('agent');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.language.default, '');
            assert.strictEqual(cfg.label.singular, 'agent config');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('template returns its form object (Templates-as-files)', () => {
            const cfg = getFormConfig('template');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.label.singular, 'template');
            assert.strictEqual(cfg.multiBlock, false);
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

        test('agent === free (create-form-enabled, D4)', () => {
            assert.strictEqual(getLanguageMode('agent'), 'free');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getLanguageMode('variables'));
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
            assert.throws(() => getDefaultLanguage('variables'));
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

        test('agent === true (D4)', () => {
            assert.strictEqual(canMultiBlock('agent'), true);
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => canMultiBlock('variables'));
        });
    });

    // ── getCreateFormTypes ───────────────────────────────────────────────────

    suite('getCreateFormTypes', () => {
        // If this list changes, update `constants.ts` — never edit this test
        // to satisfy code drift. The helper derives the list from
        // ARTIFACTS[*].createForm === true. Adding a new createForm type
        // anywhere must extend the result automatically.
        test('returns exactly [agent, snippet, command, template] (order-insensitive)', () => {
            const sorted = [...getCreateFormTypes()].sort();
            assert.deepStrictEqual(sorted, ['agent', 'command', 'snippet', 'template']);
        });
    });

    // ── writesWholeFile ──────────────────────────────────────────────────────

    suite('writesWholeFile', () => {
        // Single source for the Explorer "Create File" flow — both the preview
        // label and the insert handler branch on it, so they cannot disagree.
        test('template writes a whole file', () => {
            assert.strictEqual(writesWholeFile('template'), true);
        });

        test('agent writes a whole file (target:-named config)', () => {
            assert.strictEqual(writesWholeFile('agent'), true);
        });

        test('cursor-insert / terminal types do not', () => {
            assert.strictEqual(writesWholeFile('snippet'), false);
            assert.strictEqual(writesWholeFile('command'), false);
            assert.strictEqual(writesWholeFile('variables'), false);
        });

        /**
         * Drift guard: the answer must be **derived** from `ARTIFACTS.writesFile`,
         * not a hardcoded `type === 'template' || type === 'agent'`. Reintroduce
         * that literal check and this fails the moment the table and the code
         * disagree — the exact class of drift `CLAUDE.md` names.
         */
        test('answers exactly what ARTIFACTS.writesFile declares, for every type', () => {
            for (const entry of ARTIFACTS) {
                assert.strictEqual(writesWholeFile(entry.type), entry.writesFile === true,
                    `writesWholeFile('${entry.type}') disagrees with its ARTIFACTS.writesFile flag`);
            }
        });
    });

    // ── forcesSingleBlock ────────────────────────────────────────────────────

    suite('forcesSingleBlock', () => {
        // Non-throwing sibling of canMultiBlock — the picker asks it about every
        // parsed file, including types with no create form.
        test('template forces a single block (D1)', () => {
            assert.strictEqual(forcesSingleBlock('template'), true);
        });

        test('multi-block-capable types do not', () => {
            assert.strictEqual(forcesSingleBlock('agent'), false);
            assert.strictEqual(forcesSingleBlock('snippet'), false);
            assert.strictEqual(forcesSingleBlock('command'), false);
        });

        test('a type with no form config answers false instead of throwing', () => {
            // canMultiBlock('variables') throws; navigation code must not need a try/catch.
            assert.strictEqual(forcesSingleBlock('variables'), false);
        });

        /** Drift guard: it is the inverse of the same `form.multiBlock` flag. */
        test('mirrors ARTIFACTS.form.multiBlock for every create-form type', () => {
            for (const entry of ARTIFACTS) {
                if (entry.form === undefined) { continue; }
                assert.strictEqual(forcesSingleBlock(entry.type), !entry.form.multiBlock,
                    `forcesSingleBlock('${entry.type}') disagrees with its form.multiBlock flag`);
            }
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
