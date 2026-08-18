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
 * `artifactType` and `tags` are excluded because the parser handles them
 * specially: `artifactType` is validated against ARTIFACTS, `tags` is parsed
 * as a list.
 */

/** Keys the parser handles outside the plain-string path. */
const SPECIALLY_PARSED = new Set(['artifactType', 'tags']);

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
 * T1 — the `artifactType` key migration (D1). `type:` is no longer read at
 * all; only `artifactType:` is, and only with an exact-case match against the
 * PascalCase `ArtifactType` union — D1 rules out a case-insensitive fallback.
 */
suite('artifactType key — T1 migration', () => {

    test('FRONTMATTER_KEY_ORDER[0] is artifactType — the first emitted line', () => {
        assert.strictEqual(FRONTMATTER_KEY_ORDER[0], 'artifactType');
    });

    test('artifactType: Snippet parses to the PascalCase literal', () => {
        const parsed = parseFromContent('---\nartifactType: Snippet\n---\n\nbody\n', '/vault/Snippets/x.md', '/vault/Snippets');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Snippet');
    });

    test('artifactType: snippet (wrong case) does not match — falls through to the directory-derived default', () => {
        // '/vault/Commands' derives a default of 'Command'; a case-insensitive
        // bug would wrongly accept 'snippet' as 'Snippet' instead.
        const parsed = parseFromContent('---\nartifactType: snippet\n---\n\nbody\n', '/vault/Commands/x.md', '/vault/Commands');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Command');
    });

    test('a legacy `type:` key is ignored entirely — never read as artifactType', () => {
        const parsed = parseFromContent('---\ntype: Command\n---\n\nbody\n', '/vault/Snippets/x.md', '/vault/Snippets');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Snippet');
    });

    test('a value outside the union never downgrades silently to a hardcoded default', () => {
        // Directory-derived default here is 'Command', not the hardcoded
        // 'Snippet' — an unrecognised value must fall through to THAT, not to
        // a literal always equal to 'Snippet'.
        const parsed = parseFromContent('---\nartifactType: NotARealType\n---\n\nbody\n', '/vault/Commands/x.md', '/vault/Commands');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Command');
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
        const fm = parse('artifactType: Template\nindex: true\npaths: [a/b, c]');
        assert.strictEqual(fm.index, true);
        assert.deepStrictEqual(fm.paths, ['a/b', 'c']);
    });

    test('a non-true index value is false, never truthy', () => {
        assert.strictEqual(parse('artifactType: Template\nindex: false').index, false);
        assert.strictEqual(parse('artifactType: Template\nindex: yes').index, false);
    });

    test('an absent index key stays undefined', () => {
        assert.strictEqual(parse('artifactType: Template').index, undefined);
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
