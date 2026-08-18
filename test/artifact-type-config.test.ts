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
            const cfg = getFormConfig('Snippet');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.language.default, '');
            assert.strictEqual(cfg.label.singular, 'snippet');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('command returns its form object', () => {
            const cfg = getFormConfig('Command');
            assert.strictEqual(cfg.language.mode, 'locked');
            assert.strictEqual(cfg.language.default, 'bash');
            assert.strictEqual(cfg.label.singular, 'command');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('agent returns its form object (create-form-enabled, D4)', () => {
            const cfg = getFormConfig('AIAgentsConfig');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.language.default, '');
            assert.strictEqual(cfg.label.singular, 'agent config');
            assert.strictEqual(cfg.multiBlock, true);
        });

        test('template returns its form object (Templates-as-files)', () => {
            const cfg = getFormConfig('Template');
            assert.strictEqual(cfg.language.mode, 'free');
            assert.strictEqual(cfg.label.singular, 'template');
            assert.strictEqual(cfg.multiBlock, false);
        });

        test('variables throws (own save-as flow)', () => {
            assert.throws(() => getFormConfig('Variables'), /Variables/);
        });

        test('unknown type throws', () => {
            assert.throws(() => getFormConfig('bogus' as ArtifactType));
        });
    });

    // ── getLanguageMode ──────────────────────────────────────────────────────

    suite('getLanguageMode', () => {
        test('snippet === free', () => {
            assert.strictEqual(getLanguageMode('Snippet'), 'free');
        });

        test('command === locked', () => {
            assert.strictEqual(getLanguageMode('Command'), 'locked');
        });

        test('agent === free (create-form-enabled, D4)', () => {
            assert.strictEqual(getLanguageMode('AIAgentsConfig'), 'free');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getLanguageMode('Variables'));
        });
    });

    // ── getDefaultLanguage ───────────────────────────────────────────────────

    suite('getDefaultLanguage', () => {
        test('snippet === "" (plain text)', () => {
            assert.strictEqual(getDefaultLanguage('Snippet'), '');
        });

        test('command === "bash"', () => {
            assert.strictEqual(getDefaultLanguage('Command'), 'bash');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getDefaultLanguage('Variables'));
        });
    });

    // ── getTypeSingular ──────────────────────────────────────────────────────

    suite('getTypeSingular', () => {
        test('snippet === "snippet"', () => {
            assert.strictEqual(getTypeSingular('Snippet'), 'snippet');
        });

        test('command === "command"', () => {
            assert.strictEqual(getTypeSingular('Command'), 'command');
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => getTypeSingular('Variables'));
        });
    });

    // ── canMultiBlock ────────────────────────────────────────────────────────

    suite('canMultiBlock', () => {
        test('snippet === true', () => {
            assert.strictEqual(canMultiBlock('Snippet'), true);
        });

        test('command === true', () => {
            assert.strictEqual(canMultiBlock('Command'), true);
        });

        test('agent === true (D4)', () => {
            assert.strictEqual(canMultiBlock('AIAgentsConfig'), true);
        });

        test('throws for non-create-form type', () => {
            assert.throws(() => canMultiBlock('Variables'));
        });
    });

    // ── getCreateFormTypes ───────────────────────────────────────────────────

    suite('getCreateFormTypes', () => {
        // If this list changes, update `constants.ts` — never edit this test
        // to satisfy code drift. The helper derives the list from
        // ARTIFACTS[*].createForm === true. Adding a new createForm type
        // anywhere must extend the result automatically.
        test('returns exactly [AIAgentsConfig, AIPrompt, Snippet, Command, Template] (order-insensitive)', () => {
            const sorted = [...getCreateFormTypes()].sort();
            assert.deepStrictEqual(sorted, ['AIAgentsConfig', 'AIPrompt', 'Command', 'Snippet', 'Template']);
        });
    });

    // ── writesWholeFile ──────────────────────────────────────────────────────

    suite('writesWholeFile', () => {
        // Single source for the Explorer "Create File" flow — both the preview
        // label and the insert handler branch on it, so they cannot disagree.
        test('template writes a whole file', () => {
            assert.strictEqual(writesWholeFile('Template'), true);
        });

        test('agent writes a whole file (target:-named config)', () => {
            assert.strictEqual(writesWholeFile('AIAgentsConfig'), true);
        });

        test('cursor-insert / terminal types do not', () => {
            assert.strictEqual(writesWholeFile('Snippet'), false);
            assert.strictEqual(writesWholeFile('Command'), false);
            assert.strictEqual(writesWholeFile('Variables'), false);
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
            assert.strictEqual(forcesSingleBlock('Template'), true);
        });

        test('multi-block-capable types do not', () => {
            assert.strictEqual(forcesSingleBlock('AIAgentsConfig'), false);
            assert.strictEqual(forcesSingleBlock('Snippet'), false);
            assert.strictEqual(forcesSingleBlock('Command'), false);
        });

        test('a type with no form config answers false instead of throwing', () => {
            // canMultiBlock('Variables') throws; navigation code must not need a try/catch.
            assert.strictEqual(forcesSingleBlock('Variables'), false);
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
         * getEntry('Snippet').dir === 'Snippets'
         */
        test('returns the matching entry for every declared type', () => {
            for (const entry of ARTIFACTS) {
                assert.strictEqual(getEntry(entry.type), entry,
                    `getEntry('${entry.type}') did not return its ARTIFACTS entry`);
            }
        });

        test('exposes dir and name for a create-form type', () => {
            assert.strictEqual(getEntry('Snippet').dir, 'Snippets');
            assert.strictEqual(getEntry('Command').dir, 'Commands');
        });

        test('works for non-create-form types too (unlike getFormConfig)', () => {
            assert.strictEqual(getEntry('Variables').dir, 'Variables');
            assert.strictEqual(getEntry('AIAgentsConfig').dir, 'AIAgentsConf');
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
         * getAllTypes() // → ['Snippet', 'AIAgentsConfig', 'Command', 'Template', 'Variables']
         */
        test('returns every declared type in declaration order', () => {
            assert.deepStrictEqual(getAllTypes(), ARTIFACTS.map(e => e.type));
        });

        test('includes non-create-form types', () => {
            assert.ok(getAllTypes().includes('Variables'));
            assert.ok(getAllTypes().includes('AIAgentsConfig'));
            assert.ok(getAllTypes().includes('Template'));
        });
    });
});
