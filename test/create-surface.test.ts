import * as assert from 'node:assert';
import {
    isInContext,
    getCreateTypesForSurface,
    getIndexCapableTypes,
} from '../src/services/artifact-type-config.service.js';
import type { ArtifactType } from '../src/types/parsed-artifact.types.js';

/**
 * Unit tests for the create-surface derivation added on top of `ARTIFACTS`
 * (VSX-203). These three accessors replace ad-hoc per-surface literals
 * elsewhere on the create path: everything here is derived from
 * `ARTIFACTS.contexts` / `createForm` / `writesFile`, never hardcoded.
 */
suite('create-surface derivation', () => {

    // ── isInContext ──────────────────────────────────────────────────────────

    suite('isInContext', () => {
        test('matches an explicit surface', () => {
            assert.strictEqual(isInContext('Command', 'terminal'), true);
        });

        test('rejects a surface not declared', () => {
            assert.strictEqual(isInContext('Command', 'editor'), false);
        });

        test('"all" in contexts matches every surface', () => {
            assert.strictEqual(isInContext('Variables', 'editor'), true);
            assert.strictEqual(isInContext('Variables', 'terminal'), true);
            assert.strictEqual(isInContext('Variables', 'explorer'), true);
        });

        test('a both-context type (AIPrompt) matches editor and terminal only', () => {
            assert.strictEqual(isInContext('AIPrompt', 'editor'), true);
            assert.strictEqual(isInContext('AIPrompt', 'terminal'), true);
            assert.strictEqual(isInContext('AIPrompt', 'explorer'), false);
        });
    });

    // ── getCreateTypesForSurface — queryable-surface truth table ───────────────
    // 'all' is deliberately unrepresentable here: it is only ever a *declaration*
    // inside an entry's `contexts` (meaning "every surface"), never a surface a
    // caller can query — narrowing the parameter to Exclude<ArtifactContext, 'all'>
    // makes that nonsense query a compile error instead of a silently-empty answer.

    suite('getCreateTypesForSurface', () => {
        test('terminal', () => {
            assert.deepStrictEqual(getCreateTypesForSurface('terminal'), ['Command', 'AIPrompt']);
        });

        test('editor', () => {
            assert.deepStrictEqual(getCreateTypesForSurface('editor'), ['Snippet', 'AIPrompt']);
        });

        test('explorer', () => {
            assert.deepStrictEqual(getCreateTypesForSurface('explorer'), ['AIAgentsConfig', 'Template']);
        });

        test('Variables is absent from every surface (no createForm)', () => {
            const surfaces: ReadonlyArray<'editor' | 'terminal' | 'explorer'> =
                ['editor', 'terminal', 'explorer'];
            for (const surface of surfaces) {
                const types: ArtifactType[] = getCreateTypesForSurface(surface);
                assert.ok(!types.includes('Variables'), `Variables leaked into surface "${surface}"`);
            }
        });
    });

    // ── getIndexCapableTypes ─────────────────────────────────────────────────

    suite('getIndexCapableTypes', () => {
        test('is exactly the explorer writesFile types, in ARTIFACTS order', () => {
            assert.deepStrictEqual(getIndexCapableTypes(), ['AIAgentsConfig', 'Template']);
        });
    });
});
