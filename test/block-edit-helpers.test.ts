import * as assert from 'node:assert';
import { LANG_ALIAS, LANG_EXT } from '../src/types/constants.js';
import {
    extForLang,
    normalizeLangId,
    resolveLangId,
} from '../src/ui/panels/artifactPicker/blockEditor.helpers.js';

/**
 * Unit tests for the Edit Block language helpers (VSX-89) and the
 * LANG_ALIAS / LANG_EXT data maps (VSX-87).
 *
 * The block-editor `slug` helper was a third copy of `slugify` and was deleted
 * in the services-dry refactor (Phase 1). Its four cases now live in
 * `filename.service.test.ts` against the surviving implementation.
 *
 * The helper functions are throwing stubs until VSX-89 is implemented — those
 * suites are the red baseline. The map suite (VSX-87) is green: the maps are
 * data and ship with this change.
 */

// ── LANG_ALIAS / LANG_EXT data maps (VSX-87) ────────────────────────────────────

suite('LANG_ALIAS / LANG_EXT maps', () => {

    test('LANG_ALIAS resolves common shorthands to canonical languageIds', () => {
        assert.strictEqual(LANG_ALIAS['js'], 'javascript');
        assert.strictEqual(LANG_ALIAS['ts'], 'typescript');
        assert.strictEqual(LANG_ALIAS['py'], 'python');
        assert.strictEqual(LANG_ALIAS['sh'], 'shellscript');
        assert.strictEqual(LANG_ALIAS['bash'], 'shellscript');
        assert.strictEqual(LANG_ALIAS['c#'], 'csharp');
        assert.strictEqual(LANG_ALIAS['c++'], 'cpp');
        assert.strictEqual(LANG_ALIAS['yml'], 'yaml');
    });

    test('every LANG_ALIAS value is a non-empty lowercase string', () => {
        for (const [key, value] of Object.entries(LANG_ALIAS)) {
            assert.ok(value.length > 0, `alias ${key} maps to empty string`);
            assert.strictEqual(value, value.toLowerCase(), `alias value ${value} not lowercase`);
        }
    });

    test('no LANG_ALIAS entry maps a key to itself (would be a redundant alias)', () => {
        for (const [key, value] of Object.entries(LANG_ALIAS)) {
            assert.notStrictEqual(key, value, `alias ${key} maps to itself`);
        }
    });

    test('LANG_EXT maps canonical ids to bare extensions (no leading dot)', () => {
        assert.strictEqual(LANG_EXT['javascript'], 'js');
        assert.strictEqual(LANG_EXT['typescript'], 'ts');
        assert.strictEqual(LANG_EXT['python'], 'py');
        assert.strictEqual(LANG_EXT['csharp'], 'cs');
        assert.strictEqual(LANG_EXT['shellscript'], 'sh');
        assert.strictEqual(LANG_EXT['plaintext'], 'txt');
    });

    test('no LANG_EXT value contains a leading dot', () => {
        for (const [id, ext] of Object.entries(LANG_EXT)) {
            assert.ok(!ext.startsWith('.'), `ext for ${id} has a leading dot: ${ext}`);
        }
    });
});

// ── normalizeLangId (VSX-89) ────────────────────────────────────────────────────

suite('normalizeLangId', () => {

    test('lowercases an already-valid id', () => {
        assert.strictEqual(normalizeLangId('Python'), 'python');
    });

    test('resolves an uppercase shorthand via the alias map', () => {
        assert.strictEqual(normalizeLangId('JS'), 'javascript');
    });

    test('passes a valid id straight through', () => {
        assert.strictEqual(normalizeLangId('javascript'), 'javascript');
    });

    test('lowercases an unknown id with no alias', () => {
        assert.strictEqual(normalizeLangId('Zig'), 'zig');
    });
});

// ── resolveLangId (VSX-89) ──────────────────────────────────────────────────────

suite('resolveLangId', () => {

    const known = ['javascript', 'typescript', 'python', 'json', 'plaintext'];

    test('prefers a real fence language, normalising shorthand', () => {
        assert.strictEqual(resolveLangId('js', undefined, known), 'javascript');
    });

    test('ignores the generic "code" fence and falls back to frontmatter', () => {
        assert.strictEqual(resolveLangId('code', 'python', known), 'python');
    });

    test('ignores a "vks" fence and falls back to frontmatter', () => {
        assert.strictEqual(resolveLangId('vks', 'json', known), 'json');
    });

    test('uses frontmatter when fence language is empty', () => {
        assert.strictEqual(resolveLangId('', 'typescript', known), 'typescript');
    });

    test('returns plaintext when nothing resolves', () => {
        assert.strictEqual(resolveLangId(undefined, undefined, known), 'plaintext');
    });

    test('returns plaintext when the resolved id is not installed', () => {
        assert.strictEqual(resolveLangId('madeuplang', undefined, known), 'plaintext');
    });
});

// ── extForLang (VSX-89) ─────────────────────────────────────────────────────────

suite('extForLang', () => {

    test('maps a known languageId to its mapped extension', () => {
        assert.strictEqual(extForLang('javascript'), 'js');
        assert.strictEqual(extForLang('csharp'), 'cs');
    });

    test('plaintext maps to txt', () => {
        assert.strictEqual(extForLang('plaintext'), 'txt');
    });

    test('an unmapped but filename-safe id is used verbatim as the extension', () => {
        assert.strictEqual(extForLang('zig'), 'zig');
    });

    test('an unmapped non-filename-safe id falls back to txt', () => {
        assert.strictEqual(extForLang('weird-id!'), 'txt');
    });
});
