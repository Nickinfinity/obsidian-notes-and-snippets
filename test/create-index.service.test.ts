import * as assert from 'node:assert';
import { buildIndexArtifactPlan } from '../src/services/create-index.service.js';
import { extractIndexLinks, resolveLinkTarget } from '../src/services/multi-index.service.js';

/**
 * Unit tests for `create-index.service.ts` — turns a multi-selection of
 * workspace-relative paths into an `{ siblings, index, links }` plan (T11).
 *
 * The security-critical assertions here are the plan's own requirement (§8.3
 * / plan note 1): every hostile raw path must be **rejected via `safeRelPath`
 * and thrown**, never trimmed or silently accepted. The round-trip test is
 * what proves the generated index body uses the *same* link syntax the
 * existing reader (`extractIndexLinks` / `resolveLinkTarget`) already
 * understands, rather than a second, drifted spelling.
 */

suite('buildIndexArtifactPlan', () => {

    test('derives links preserving directory structure, extension stripped', () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        assert.deepStrictEqual(plan.links, ['a', 'sub/b']);
    });

    test('throws on a ".." traversal path', () => {
        assert.throws(() => buildIndexArtifactPlan(['../x'], 'Template'));
    });

    test('throws on an absolute path', () => {
        assert.throws(() => buildIndexArtifactPlan(['/etc/passwd'], 'Template'));
    });

    test('throws on a backslash / drive-letter path', () => {
        assert.throws(() => buildIndexArtifactPlan(['C:\\tmp\\x'], 'Template'));
    });

    test('throws on a NUL / control character', () => {
        assert.throws(() => buildIndexArtifactPlan(['a\x00b'], 'Template'));
    });

    test('throws when the type cannot write whole files', () => {
        assert.throws(() => buildIndexArtifactPlan(['a.ts'], 'Snippet'));
    });

    test('returns one sibling ArtifactFormModel per accepted path, in order', () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        assert.strictEqual(plan.siblings.length, 2);
        assert.strictEqual(plan.siblings[0].artifactType, 'Template');
        assert.strictEqual(plan.siblings[0].title, 'a');
        assert.strictEqual(plan.siblings[1].title, 'b');
    });

    test('de-duplicates colliding slugs deterministically, by input order', () => {
        // Same directory, same basename once extensions are stripped: 'dir/a'.
        const plan = buildIndexArtifactPlan(['dir/a.ts', 'dir/a.tsx'], 'Template');
        assert.deepStrictEqual(plan.links, ['dir/a', 'dir/a-2']);

        // Same input, same order -> same output. Not a Set/timestamp artifact.
        const again = buildIndexArtifactPlan(['dir/a.ts', 'dir/a.tsx'], 'Template');
        assert.deepStrictEqual(again.links, plan.links);
    });

    test('generated index body round-trips through the existing reader', () => {
        const plan = buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template');
        const body = plan.index.blocks[0].code;

        const rawLinks = extractIndexLinks(body);
        assert.deepStrictEqual(rawLinks, plan.links);

        const resolved = rawLinks.map(resolveLinkTarget);
        assert.ok(resolved.every(r => r.ok));
        assert.deepStrictEqual(
            resolved.map(r => (r.ok ? r.relPath : '')),
            ['a.md', 'sub/b.md'],
        );
    });

    test('every derived link passes safeRelPath (asserted indirectly via resolveLinkTarget ok)', () => {
        const plan = buildIndexArtifactPlan(['weird name/Sub Folder.ts'], 'Template');
        const resolved = plan.links.map(resolveLinkTarget);
        assert.ok(resolved.every(r => r.ok));
    });

    test('de-dup checks the emitted link, not just a same-base counter — no two siblings collide', () => {
        // 'a.md' collides with 'a.ts' on base 'a' -> bumps to 'a-2'; 'a-2.ts' then
        // collides with THAT emitted 'a-2', not merely with base 'a-2's own counter.
        // A dedup keyed on base alone (not the emitted set) yields ['a', 'a-2', 'a-2'].
        const plan = buildIndexArtifactPlan(['a.ts', 'a.md', 'a-2.ts'], 'Template');
        assert.strictEqual(plan.links.length, 3);
        assert.strictEqual(new Set(plan.links).size, 3, `expected 3 distinct links, got ${JSON.stringify(plan.links)}`);
    });

    test('throws rather than silently dropping a path segment with no [a-z0-9] characters', () => {
        // '!!!' slugs to '' — a directory that cannot be represented must not be
        // dropped (which would relocate the sibling to the root).
        assert.throws(() => buildIndexArtifactPlan(['!!!/b.ts'], 'Template'));
    });

    test('sets extension on a Template sibling and target on an AIAgentsConfig sibling, from the raw path', () => {
        const templatePlan = buildIndexArtifactPlan(['dir/Button.tsx'], 'Template');
        assert.strictEqual(templatePlan.siblings[0].extension, 'tsx');
        assert.strictEqual(templatePlan.siblings[0].target, undefined);

        const agentPlan = buildIndexArtifactPlan(['CLAUDE.md'], 'AIAgentsConfig');
        assert.strictEqual(agentPlan.siblings[0].target, 'CLAUDE.md');
        assert.strictEqual(agentPlan.siblings[0].extension, undefined);
    });
});
