import * as assert from 'node:assert';
import { parseFromContent } from '../src/services/parser.service.js';
import { serializeArtifact } from '../src/services/artifact-serializer.service.js';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';

/**
 * T1 — the `extension` frontmatter key, parser **and** serializer, atomically.
 *
 * The two key lists (`STRING_FRONTMATTER_KEYS`, `FRONTMATTER_KEY_ORDER`) are
 * bound in both directions by `frontmatter-keys.test.ts`; this suite proves the
 * `extension` value actually survives a parse → serialize → parse round-trip,
 * which is the point of adding it to both lists in one change.
 */

const ROOT = '/v';
const PATH = '/v/Templates/mod.md';

function templateModel(extension?: string): ArtifactFormModel {
    return {
        artifactType: 'Template',
        title: 'Mod',
        description: '',
        tags: [],
        ...(extension !== undefined ? { extension } : {}),
        blocks: [{ heading: '', description: '', language: 'javascript', code: 'export const x = 1;', vars: [] }],
    };
}

// ── Parser side ─────────────────────────────────────────────────────────────────

suite('extension frontmatter — parser', () => {

    test('parses `extension: .mjs` into frontmatter.extension', () => {
        const md = '---\nartifactType: Template\ntitle: Mod\nextension: .mjs\nlanguage: javascript\n---\n\n```javascript\nexport const x = 1;\n```\n';
        const parsed = parseFromContent(md, PATH, ROOT);
        assert.strictEqual(parsed.frontmatter.extension, '.mjs');
    });

    test('extension key absent → frontmatter.extension is undefined', () => {
        const md = '---\nartifactType: Template\ntitle: Mod\nlanguage: javascript\n---\n\n```javascript\nx\n```\n';
        const parsed = parseFromContent(md, PATH, ROOT);
        assert.strictEqual(parsed.frontmatter.extension, undefined);
    });
});

// ── Serializer side ─────────────────────────────────────────────────────────────

suite('extension frontmatter — serializer', () => {

    test('serializes model.extension into the frontmatter', () => {
        const out = serializeArtifact(templateModel('.mjs'));
        assert.ok(out.includes('extension: .mjs'), `expected an extension line, got:\n${out}`);
    });

    test('absent extension is omitted from the frontmatter', () => {
        assert.ok(!serializeArtifact(templateModel()).includes('extension:'));
    });

    test('empty-string extension is omitted from the frontmatter', () => {
        assert.ok(!serializeArtifact(templateModel('')).includes('extension:'));
    });
});

// ── Round-trip ───────────────────────────────────────────────────────────────────

suite('extension frontmatter — round-trip', () => {

    test('parse → serialize → parse preserves the extension', () => {
        const first = serializeArtifact(templateModel('.mjs'));
        const parsed = parseFromContent(first, PATH, ROOT);
        assert.strictEqual(parsed.frontmatter.extension, '.mjs');
    });
});
