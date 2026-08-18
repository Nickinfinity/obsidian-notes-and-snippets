import * as assert from 'node:assert';
import { STRING_FRONTMATTER_KEYS } from '../src/services/parser.service.js';
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
