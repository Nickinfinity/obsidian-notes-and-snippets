import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFromContent } from '../src/services/parser.service.js';

/**
 * Smoke assertions for the six canonical fixture files in
 * `test/fixtures/artifact-form/`. Each test loads the fixture from disk,
 * parses it via `parseFromContent`, and checks the shape rules defined in
 * `docs/artifact-form/phase-2-fixtures/01-fixtures.md`.
 *
 * These are NOT round-trip tests (that is Phase 3). They verify the parser
 * correctly reads each canonical shape and that every fixture is well-formed.
 */

// ── Fixture loader ────────────────────────────────────────────────────────────

/**
 * Absolute path to `test/fixtures/artifact-form/` regardless of CWD.
 *
 * `__dirname` in the compiled output is `dist/test/`; two levels up lands at
 * the project root, then we descend into the source fixture directory.
 */
const FIXTURE_DIR = path.join(__dirname, '../../test/fixtures/artifact-form');

/**
 * Reads a fixture file and runs `parseFromContent` on it.
 *
 * @param name - Fixture filename including `.md` extension.
 * @returns Parsed artifact result.
 *
 * @example
 * load('snippet-minimal.md')
 */
function load(name: string) {
    const filePath = path.join(FIXTURE_DIR, name);
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseFromContent(content, filePath, FIXTURE_DIR);
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

suite('fixtures smoke — snippet-minimal.md', () => {

    test('parses without error', () => {
        const result = load('snippet-minimal.md');
        assert.ok(result);
    });

    test('type is snippet', () => {
        assert.strictEqual(load('snippet-minimal.md').frontmatter.type, 'snippet');
    });

    test('language is javascript', () => {
        assert.strictEqual(load('snippet-minimal.md').frontmatter.language, 'javascript');
    });

    test('no vars', () => {
        assert.strictEqual(load('snippet-minimal.md').vars.length, 0);
    });

    test('no blocks (single-block file)', () => {
        assert.strictEqual(load('snippet-minimal.md').blocks.length, 0);
    });

    test('code is non-empty', () => {
        assert.ok(load('snippet-minimal.md').code.length > 0);
    });
});

suite('fixtures smoke — snippet-quoted-default.md', () => {

    test('vars[0] name is VK-x', () => {
        assert.strictEqual(load('snippet-quoted-default.md').vars[0]?.name, 'VK-x');
    });

    test('vars[0] defaultValue preserves quotes verbatim', () => {
        // Quotes must NOT be stripped — defaultValue is '"active"' not 'active'
        assert.strictEqual(load('snippet-quoted-default.md').vars[0]?.defaultValue, '"active"');
    });

    test('has 2 tags', () => {
        assert.strictEqual(load('snippet-quoted-default.md').frontmatter.tags?.length, 2);
    });
});

suite('fixtures smoke — snippet-plain-text.md', () => {

    test('language is undefined (no language key, bare fence)', () => {
        assert.strictEqual(load('snippet-plain-text.md').frontmatter.language, undefined);
    });

    test('code is non-empty', () => {
        assert.ok(load('snippet-plain-text.md').code.length > 0);
    });

    test('type is snippet', () => {
        assert.strictEqual(load('snippet-plain-text.md').frontmatter.type, 'snippet');
    });
});

suite('fixtures smoke — command-with-defaults.md', () => {

    test('type is command', () => {
        assert.strictEqual(load('command-with-defaults.md').frontmatter.type, 'command');
    });

    test('language is undefined (bare fence, no language key)', () => {
        assert.strictEqual(load('command-with-defaults.md').frontmatter.language, undefined);
    });

    test('has vars with defaults', () => {
        const { vars } = load('command-with-defaults.md');
        assert.ok(vars.length > 0, 'expected at least one var');
        assert.ok(vars.every(v => v.defaultValue.length > 0), 'all vars should have defaults');
    });
});

suite('fixtures smoke — snippet-multi-block.md', () => {

    test('blocks.length is 2', () => {
        assert.strictEqual(load('snippet-multi-block.md').blocks.length, 2);
    });

    test('block[0] has non-empty description', () => {
        const desc = load('snippet-multi-block.md').blocks[0]?.description;
        assert.ok(desc && desc.length > 0, 'block[0] description should be non-empty');
    });

    test('block[1] has non-empty description', () => {
        const desc = load('snippet-multi-block.md').blocks[1]?.description;
        assert.ok(desc && desc.length > 0, 'block[1] description should be non-empty');
    });

    test('block[0] has VK-PORT var with default 3000', () => {
        const vars = load('snippet-multi-block.md').blocks[0]?.vars ?? [];
        const port = vars.find(v => v.name === 'VK-PORT');
        assert.ok(port, 'VK-PORT var missing from block[0]');
        assert.strictEqual(port.defaultValue, '3000');
    });

    test('block[1] has VK-DOMAIN var with default example.com', () => {
        const vars = load('snippet-multi-block.md').blocks[1]?.vars ?? [];
        const domain = vars.find(v => v.name === 'VK-DOMAIN');
        assert.ok(domain, 'VK-DOMAIN var missing from block[1]');
        assert.strictEqual(domain.defaultValue, 'example.com');
    });
});

suite('fixtures smoke — snippet-orphan-default.md', () => {

    test('vars includes VK-extra even though token absent from code', () => {
        const { vars } = load('snippet-orphan-default.md');
        const extra = vars.find(v => v.name === 'VK-extra');
        assert.ok(extra, 'VK-extra should appear in vars (declare-ahead / orphan path)');
    });

    test('VK-extra defaultValue is hello', () => {
        const { vars } = load('snippet-orphan-default.md');
        const extra = vars.find(v => v.name === 'VK-extra');
        assert.strictEqual(extra?.defaultValue, 'hello');
    });

    test('code does not contain VK-extra token', () => {
        const { code } = load('snippet-orphan-default.md');
        assert.ok(!code.includes('<VK-extra>'), 'VK-extra should not appear in the code body');
    });
});
