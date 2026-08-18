import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFromContent } from '../src/services/parser.service.js';
import { serializeArtifact, FRONTMATTER_KEY_ORDER } from '../src/services/artifact-serializer.service.js';
import type { ArtifactFormBlock, ArtifactFormModel } from '../src/types/artifact-form.types.js';
import type { ParsedArtifactFile } from '../src/types/parsed-artifact.types.js';

/**
 * Tests for `serializeArtifact` — the inverse of `parseFromContent`.
 *
 * Group A: Direct-emit — build a model, assert the serialized string matches
 * the expected canonical output byte-for-byte (one fixture per canonical shape).
 *
 * Group B: Round-trip property — for each Phase 2 fixture file, parse → model
 * → serialize → parse again, then assert the two parses are deep-equal.
 *
 * Extra: YAML safety — newlines in title/description are stripped to spaces.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Absolute path to the Phase 2 fixture directory. */
const FIXTURE_DIR = path.join(__dirname, '../../test/fixtures/artifact-form');

/**
 * Reads a Phase 2 fixture file and returns its `ParsedArtifactFile`.
 *
 * @param name - Fixture filename including `.md` extension.
 * @returns Parsed result with `filePath` set to the fixture's real path.
 *
 * @example
 * loadFixture('snippet-minimal.md')
 */
function loadFixture(name: string): ParsedArtifactFile {
    const filePath = path.join(FIXTURE_DIR, name);
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseFromContent(content, filePath, FIXTURE_DIR);
}

/**
 * Builds an `ArtifactFormModel` from a `ParsedArtifactFile`.
 *
 * For single-block files (`blocks.length === 0`), creates one block from the
 * top-level `code`, `vars`, and `frontmatter.language`. For multi-block files,
 * maps each `ParsedBlock` to an `ArtifactFormBlock`.
 *
 * @param parsed - The result of `parseFromContent`.
 * @returns A minimal form model suitable for passing to `serializeArtifact`.
 *
 * @example
 * parsedToModel(loadFixture('snippet-minimal.md'))
 */
function parsedToModel(parsed: ParsedArtifactFile): ArtifactFormModel {
    const isMultiBlock = parsed.blocks.length > 0;

    if (isMultiBlock) {
        const blocks: ArtifactFormBlock[] = parsed.blocks.map(b => ({
            heading:     b.heading,
            description: b.description,
            language:    b.fenceLang ?? '',
            code:        b.code,
            vars:        b.vars,
        }));
        return {
            type:        parsed.frontmatter.type,
            title:       parsed.frontmatter.title       ?? '',
            description: parsed.frontmatter.description ?? '',
            tags:        parsed.frontmatter.tags        ?? [],
            blocks,
        };
    }

    return {
        type:        parsed.frontmatter.type,
        title:       parsed.frontmatter.title       ?? '',
        description: parsed.frontmatter.description ?? '',
        tags:        parsed.frontmatter.tags        ?? [],
        blocks: [{
            heading:     '',
            description: '',
            language:    parsed.frontmatter.language ?? '',
            code:        parsed.code,
            vars:        parsed.vars,
        }],
    };
}

// ── Group A — Direct-emit ─────────────────────────────────────────────────────

suite('serializeArtifact — Group A: direct emit', () => {

    // ── snippet-minimal ───────────────────────────────────────────────────────

    test('snippet-minimal: emits frontmatter, language in fence and key, no vars block', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'Minimal Snippet',
            description: 'Smallest valid snippet.',
            tags: [],
            blocks: [{ heading: '', description: '', language: 'javascript', code: "console.log('hello');", vars: [] }],
        };
        const expected = [
            '---',
            'type: snippet',
            'title: Minimal Snippet',
            'description: Smallest valid snippet.',
            'language: javascript',
            '---',
            '',
            '```javascript',
            "console.log('hello');",
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── snippet-quoted-default ────────────────────────────────────────────────

    test('snippet-quoted-default: emits tags and vks fence with verbatim quoted default', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'Quoted Default Snippet',
            description: 'Tests verbatim default preservation with quoted strings.',
            tags: ['ui', 'state'],
            blocks: [{
                heading: '', description: '', language: 'javascript',
                code: 'element.className = <VK-x>;',
                vars: [{ name: 'VK-x', defaultValue: '"active"' }],
            }],
        };
        const expected = [
            '---',
            'type: snippet',
            'title: Quoted Default Snippet',
            'description: Tests verbatim default preservation with quoted strings.',
            'language: javascript',
            'tags: [ui, state]',
            '---',
            '',
            '```javascript',
            'element.className = <VK-x>;',
            '```',
            '',
            'vars:',
            '```vks',
            'VK-x="active"',
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── snippet-plain-text ────────────────────────────────────────────────────

    test('snippet-plain-text: omits language key, emits bare fence', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'Plain Text Snippet',
            description: 'Plain text with no language field and a bare code fence.',
            tags: [],
            blocks: [{
                heading: '', description: '', language: '',
                code: 'Some plain text content.\nNo language highlight.',
                vars: [],
            }],
        };
        const expected = [
            '---',
            'type: snippet',
            'title: Plain Text Snippet',
            'description: Plain text with no language field and a bare code fence.',
            '---',
            '',
            '```',
            'Some plain text content.',
            'No language highlight.',
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── command-with-defaults ─────────────────────────────────────────────────

    test('command-with-defaults: locked type emits language: bash regardless of block.language', () => {
        const model: ArtifactFormModel = {
            type: 'command',
            title: 'Deploy Command',
            description: 'Deploy to a named environment and region.',
            tags: ['deploy'],
            blocks: [{
                heading: '', description: '', language: '',   // locked: ignored by serializer
                code: './deploy.sh <VK-env> <VK-region>',
                vars: [
                    { name: 'VK-env',    defaultValue: 'staging'   },
                    { name: 'VK-region', defaultValue: 'us-east-1' },
                ],
            }],
        };
        const expected = [
            '---',
            'type: command',
            'title: Deploy Command',
            'description: Deploy to a named environment and region.',
            'language: bash',
            'tags: [deploy]',
            '---',
            '',
            '```bash',
            './deploy.sh <VK-env> <VK-region>',
            '```',
            '',
            'vars:',
            '```vks',
            'VK-env=staging',
            'VK-region=us-east-1',
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── snippet-multi-block ───────────────────────────────────────────────────

    test('snippet-multi-block: no top-level language or code fence; per-block headings and vks', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'API URLs',
            description: 'Development and production API base URLs.',
            tags: ['api', 'urls'],
            blocks: [
                {
                    heading: 'Development',
                    description: 'Local development server URL.',
                    language: 'javascript',
                    code: "const baseUrl = 'http://localhost:<VK-PORT>';",
                    vars: [{ name: 'VK-PORT', defaultValue: '3000' }],
                },
                {
                    heading: 'Production',
                    description: 'Production API base URL.',
                    language: 'javascript',
                    code: "const baseUrl = 'https://api.<VK-DOMAIN>';",
                    vars: [{ name: 'VK-DOMAIN', defaultValue: 'example.com' }],
                },
            ],
        };
        const expected = [
            '---',
            'type: snippet',
            'title: API URLs',
            'description: Development and production API base URLs.',
            'tags: [api, urls]',
            '---',
            '',
            '## Development',
            'Local development server URL.',
            '',
            '```javascript',
            "const baseUrl = 'http://localhost:<VK-PORT>';",
            '```',
            '',
            'vars:',
            '```vks',
            'VK-PORT=3000',
            '```',
            '',
            '## Production',
            'Production API base URL.',
            '',
            '```javascript',
            "const baseUrl = 'https://api.<VK-DOMAIN>';",
            '```',
            '',
            'vars:',
            '```vks',
            'VK-DOMAIN=example.com',
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── snippet-orphan-default ────────────────────────────────────────────────

    test('snippet-orphan-default: emits vks for var absent from code (orphan default)', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'Orphan Default Snippet',
            description: 'Declares a variable default for a token not present in the code body.',
            tags: [],
            blocks: [{
                heading: '', description: '', language: 'javascript',
                code: "console.log('no tokens here');",
                vars: [{ name: 'VK-extra', defaultValue: 'hello' }],
            }],
        };
        const expected = [
            '---',
            'type: snippet',
            'title: Orphan Default Snippet',
            'description: Declares a variable default for a token not present in the code body.',
            'language: javascript',
            '---',
            '',
            '```javascript',
            "console.log('no tokens here');",
            '```',
            '',
            'vars:',
            '```vks',
            'VK-extra=hello',
            '```',
            '',
        ].join('\n');
        assert.strictEqual(serializeArtifact(model), expected);
    });

    // ── FRONTMATTER_KEY_ORDER ─────────────────────────────────────────────────

    test('FRONTMATTER_KEY_ORDER matches canonical order from spec', () => {
        assert.deepStrictEqual(
            Array.from(FRONTMATTER_KEY_ORDER),
            ['type', 'title', 'description', 'language', 'tags', 'env', 'target'],
        );
    });
});

// ── Group B — Round-trip property ─────────────────────────────────────────────

suite('serializeArtifact — Group B: round-trip property', () => {

    // ── snippet-minimal ───────────────────────────────────────────────────────

    test('snippet-minimal: parse → model → serialize → parse is deep-equal', () => {
        const filePath = path.join(FIXTURE_DIR, 'snippet-minimal.md');
        const parsed1 = loadFixture('snippet-minimal.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);
        assert.deepStrictEqual(parsed2, parsed1);
    });

    // ── snippet-quoted-default ────────────────────────────────────────────────

    test('snippet-quoted-default: quoted default value survives round-trip verbatim', () => {
        const filePath = path.join(FIXTURE_DIR, 'snippet-quoted-default.md');
        const parsed1 = loadFixture('snippet-quoted-default.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);
        assert.deepStrictEqual(parsed2, parsed1);
    });

    // ── snippet-plain-text ────────────────────────────────────────────────────

    test('snippet-plain-text: no language survives round-trip as bare fence', () => {
        const filePath = path.join(FIXTURE_DIR, 'snippet-plain-text.md');
        const parsed1 = loadFixture('snippet-plain-text.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);
        assert.deepStrictEqual(parsed2, parsed1);
    });

    // ── command-with-defaults ─────────────────────────────────────────────────
    // The serializer normalises command type → language: bash even when the
    // fixture used a bare fence. We verify the important fields survive rather
    // than a full deepStrictEqual against the legacy fixture parse.

    test('command-with-defaults: type and code survive round-trip; language normalises to bash', () => {
        const filePath = path.join(FIXTURE_DIR, 'command-with-defaults.md');
        const parsed1 = loadFixture('command-with-defaults.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);

        assert.strictEqual(parsed2.frontmatter.type, 'command');
        assert.strictEqual(parsed2.frontmatter.language, 'bash');      // normalised
        assert.strictEqual(parsed2.code, parsed1.code);
        assert.deepStrictEqual(parsed2.vars, parsed1.vars);
    });

    test('command-with-defaults: serialize is idempotent after normalisation', () => {
        const parsed1 = loadFixture('command-with-defaults.md');
        const model1 = parsedToModel(parsed1);
        const content2 = serializeArtifact(model1);
        const parsed2 = parseFromContent(content2, path.join(FIXTURE_DIR, 'command-with-defaults.md'), FIXTURE_DIR);
        const content3 = serializeArtifact(parsedToModel(parsed2));
        assert.strictEqual(content3, content2);
    });

    // ── snippet-multi-block ───────────────────────────────────────────────────

    test('snippet-multi-block: two blocks survive round-trip with descriptions and var defaults', () => {
        const filePath = path.join(FIXTURE_DIR, 'snippet-multi-block.md');
        const parsed1 = loadFixture('snippet-multi-block.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);
        assert.deepStrictEqual(parsed2, parsed1);
    });

    // ── snippet-orphan-default ────────────────────────────────────────────────

    test('snippet-orphan-default: orphan var default survives round-trip', () => {
        const filePath = path.join(FIXTURE_DIR, 'snippet-orphan-default.md');
        const parsed1 = loadFixture('snippet-orphan-default.md');
        const model = parsedToModel(parsed1);
        const content2 = serializeArtifact(model);
        const parsed2 = parseFromContent(content2, filePath, FIXTURE_DIR);
        assert.deepStrictEqual(parsed2, parsed1);
    });
});

// ── Extra — YAML safety ───────────────────────────────────────────────────────

suite('serializeArtifact — YAML safety: newline strip', () => {

    test('newlines in title and description are stripped to single space', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'Foo\nBar',
            description: 'Line1\nLine2',
            tags: [],
            blocks: [{ heading: '', description: '', language: '', code: 'x', vars: [] }],
        };
        const content = serializeArtifact(model);
        const parsed = parseFromContent(content, '/fake/path.md', '/fake');
        assert.strictEqual(parsed.frontmatter.title, 'Foo Bar');
        assert.strictEqual(parsed.frontmatter.description, 'Line1 Line2');
    });

    test('CRLF and CR in title are also stripped to single space', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'A\r\nB\rC',
            description: 'X',
            tags: [],
            blocks: [{ heading: '', description: '', language: '', code: 'x', vars: [] }],
        };
        const content = serializeArtifact(model);
        const parsed = parseFromContent(content, '/fake/path.md', '/fake');
        assert.strictEqual(parsed.frontmatter.title, 'A B C');
    });

    test('vars with empty defaultValue are not emitted in vks fence', () => {
        const model: ArtifactFormModel = {
            type: 'snippet',
            title: 'T',
            description: '',
            tags: [],
            blocks: [{
                heading: '', description: '', language: '',
                code: '<VK-host>',
                vars: [{ name: 'VK-host', defaultValue: '' }],
            }],
        };
        const content = serializeArtifact(model);
        assert.ok(!content.includes('vks'), 'vks fence should not be emitted for empty defaults');
    });
});
