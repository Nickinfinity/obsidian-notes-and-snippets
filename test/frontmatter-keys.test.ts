import * as assert from 'node:assert';
import { STRING_FRONTMATTER_KEYS, parseFromContent } from '../src/services/parser.service.js';
import { FRONTMATTER_KEY_ORDER } from '../src/services/artifact-serializer.service.js';

/**
 * Drift guard for R3 — the two frontmatter key lists that must agree.
 *
 * They are deliberately NOT merged: the parser's set says "read these as plain
 * strings", the serializer's array says "emit in this order". Different
 * directions, different shapes. What binds them is that anything written must
 * be readable — otherwise a key round-trips to nothing and the data is lost on
 * the next save, silently.
 *
 * `type` and `tags` are excluded because the parser handles them specially:
 * `type` is validated against ARTIFACTS, `tags` is parsed as a list.
 */

/** Keys the parser handles outside the plain-string path. */
const SPECIALLY_PARSED = new Set(['type', 'tags']);

suite('frontmatter key lists — serializer vs parser', () => {

    test('every key the serializer emits is one the parser reads back', () => {
        for (const key of FRONTMATTER_KEY_ORDER) {
            const known = SPECIALLY_PARSED.has(key) || STRING_FRONTMATTER_KEYS.has(key);
            assert.ok(
                known,
                `serializer emits "${key}" but the parser drops it — add it to STRING_FRONTMATTER_KEYS or stop emitting it`
            );
        }
    });

    test('every plain-string key the parser reads is one the serializer can emit', () => {
        for (const key of STRING_FRONTMATTER_KEYS) {
            assert.ok(
                FRONTMATTER_KEY_ORDER.includes(key),
                `parser reads "${key}" but the serializer never emits it — the key can be read but never written`
            );
        }
    });
});

/**
 * The two **read-side-only** index keys.
 *
 * They deliberately break the symmetry the suite above enforces for string keys:
 * the parser reads them, the serializer never emits them (plan D11). A guard is
 * needed because the obvious "fix" — adding them to `FRONTMATTER_KEY_ORDER` —
 * would emit keys nothing in `ArtifactFormModel` ever sets.
 */
suite('index frontmatter keys — read-side only', () => {

    const parse = (fm: string) => parseFromContent(`---\n${fm}\n---\n\nbody\n`, '/vault/Templates/i.md', '/vault/Templates').frontmatter;

    test('reads index: true and the paths inline array', () => {
        const fm = parse('type: template\nindex: true\npaths: [a/b, c]');
        assert.strictEqual(fm.index, true);
        assert.deepStrictEqual(fm.paths, ['a/b', 'c']);
    });

    test('a non-true index value is false, never truthy', () => {
        assert.strictEqual(parse('type: template\nindex: false').index, false);
        assert.strictEqual(parse('type: template\nindex: yes').index, false);
    });

    test('an absent index key stays undefined', () => {
        assert.strictEqual(parse('type: template').index, undefined);
    });

    test('the serializer never emits either key', () => {
        for (const key of ['index', 'paths']) {
            assert.ok(
                !FRONTMATTER_KEY_ORDER.includes(key),
                `"${key}" is read-side only (plan D11) — emitting these needs ArtifactFormModel plumbing first`
            );
        }
    });
});
