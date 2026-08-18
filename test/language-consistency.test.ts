import * as assert from 'node:assert';
import { LANG_ALIAS, LANG_EXT, LANG_FENCE } from '../src/types/constants.js';
import {
    extForLang,
    normalizeLangId,
} from '../src/services/language-map.service.js';
import { FREE_LANGUAGE_OPTIONS } from '../src/ui/panels/artifactForm/form.helpers.js';

/**
 * Drift guards binding the four language tables (services-dry Phase 4).
 *
 * The tables are deliberately NOT merged — they key differently and serve
 * different concerns (fence→id, id→fence, id→ext, UI dropdown). What they owe
 * each other is agreement, and nothing enforced it: `LANG_ALIAS` claimed in a
 * doc comment to be the inverse of `mapLanguageId`, and had already drifted
 * from it on Objective-C. A comment cannot fail a build; these tests can.
 *
 * Each guard below was proven to fail by reintroducing the exact original
 * drift before this file was committed.
 */

// ── Guard 1 — LANG_FENCE round-trips through LANG_ALIAS ─────────────────────────

suite('language tables — LANG_FENCE ↔ LANG_ALIAS agreement', () => {

    /**
     * Every id→fence entry must survive the return trip. `normalizeLangId` is
     * the real fence→id path used when opening a block for edit, so this asserts
     * the exact round-trip a user's `.md` fence takes, not a restatement of the
     * table.
     */
    test('every LANG_FENCE entry round-trips back to its own id', () => {
        for (const [id, fence] of Object.entries(LANG_FENCE)) {
            assert.strictEqual(
                normalizeLangId(fence),
                id,
                `LANG_FENCE['${id}'] = '${fence}' but normalizeLangId('${fence}') = '${normalizeLangId(fence)}'`
            );
        }
    });
});

// ── Guard 2 — LANG_EXT is keyed on canonical ids ────────────────────────────────

suite('language tables — LANG_EXT keys are canonical ids', () => {

    /**
     * `extForLang` is called with the output of `resolveLangId`, i.e. always a
     * canonical id. A key that is a *fence string* is therefore dead on arrival —
     * it can never be hit, and the id it should have covered silently falls
     * through to the `txt` fallback. `LANG_EXT['objc'] = 'm'` was exactly this
     * bug: Objective-C blocks opened as `.txt`.
     *
     * Self-mapping `LANG_FENCE` entries (`dockerfile` → `dockerfile`) are
     * excluded — for those the fence string *is* the canonical id, so keying
     * `LANG_EXT` on it is correct.
     */
    test('no LANG_EXT key is a fence string rather than a canonical id', () => {
        const fencesThatDifferFromTheirId = Object.entries(LANG_FENCE)
            .filter(([id, fence]) => id !== fence)
            .map(([, fence]) => fence);

        for (const id of Object.keys(LANG_EXT)) {
            assert.ok(
                !fencesThatDifferFromTheirId.includes(id),
                `LANG_EXT['${id}'] is keyed on a fence string, not a languageId — extForLang receives canonical ids, so this entry can never be hit`
            );
        }
    });
});

// ── Guard 3 — every dropdown option is known to the tables ──────────────────────

suite('language tables — FREE_LANGUAGE_OPTIONS are resolvable', () => {

    /**
     * A dropdown entry no table knows still writes a fence, and the block then
     * opens as a `.txt` temp file with no highlighting. Plain text (`''`) is the
     * one legitimate unmapped option.
     */
    test('every option except plain text maps to a real extension', () => {
        for (const option of FREE_LANGUAGE_OPTIONS) {
            if (option === '') { continue; }

            const id  = normalizeLangId(option);
            const ext = extForLang(id);

            assert.notStrictEqual(
                ext,
                'txt',
                `dropdown option '${option}' resolves to id '${id}' which no LANG_EXT entry covers`
            );
        }
    });
});
