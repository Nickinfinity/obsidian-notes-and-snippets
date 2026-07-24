import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';
import { buildFormHtml } from '../src/ui/panels/artifactForm/form.html.js';

// ── Snapshot helpers ──────────────────────────────────────────────────────────

const SNAPSHOT_DIR = path.join(__dirname, '../../test/snapshots/form-html');

/**
 * Writes or compares an HTML snapshot.
 *
 * When `UPDATE_SNAPSHOTS=1` is set, writes `actual` to disk and returns.
 * Otherwise, reads the saved snapshot and asserts byte-equality.
 *
 * @param name   - Snapshot file name (without extension).
 * @param actual - HTML string to compare or record.
 */
function snapshot(name: string, actual: string): void {
    const filePath = path.join(SNAPSHOT_DIR, `${name}.html`);
    if (process.env['UPDATE_SNAPSHOTS']) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        fs.writeFileSync(filePath, actual, 'utf8');
        return;
    }
    let expected: string;
    try {
        expected = fs.readFileSync(filePath, 'utf8');
    } catch {
        throw new Error(
            `Snapshot missing: ${filePath}\nRun with UPDATE_SNAPSHOTS=1 to generate.`
        );
    }
    assert.strictEqual(actual, expected, `Snapshot mismatch: ${name}`);
}

// ── Mock codeBlockHtml ────────────────────────────────────────────────────────

/**
 * Stub for `codeBlockHtml` parameter — avoids hljs dependency in snapshot tests.
 *
 * @param code - Code content.
 * @param lang - Language identifier.
 * @returns Simple `<pre>` element for snapshot comparison.
 */
function mockCodeBlock(code: string, lang: string): string {
    return `<pre class="mock-code-block" data-lang="${lang}">${code}</pre>`;
}

// ── Shared args ───────────────────────────────────────────────────────────────

const ARGS = {
    cspSource: 'https://test-csp-source',
    cssUri:    'https://test-css-uri/styles.css',
    nonce:     'test-nonce-abc123',
    codeBlockHtml: mockCodeBlock,
};

// ── Snapshot tests ────────────────────────────────────────────────────────────

suite('buildFormHtml — snapshots', () => {

    test('snippet single-block — language selector enabled', () => {
        const model: ArtifactFormModel = {
            type:        'snippet',
            title:       'Test Snippet',
            description: 'A test snippet.',
            tags:        ['testing', 'example'],
            blocks: [
                {
                    heading:     '',
                    description: '',
                    language:    'javascript',
                    code:        'console.log("hello");',
                    vars:        [],
                },
            ],
        };
        const html = buildFormHtml({ ...ARGS, model });

        // Language selector must be enabled (free mode = no `disabled`)
        const selectorStart = html.indexOf('id="block-0-lang"');
        assert.ok(selectorStart !== -1, 'language selector element present');
        const selectorChunk = html.slice(selectorStart, selectorStart + 60);
        assert.ok(!selectorChunk.includes('disabled'), 'snippet lang selector not disabled');

        snapshot('snippet-single-block', html);
    });

    test('command single-block — language selector disabled showing bash', () => {
        const model: ArtifactFormModel = {
            type:        'command',
            title:       'Deploy',
            description: '',
            tags:        [],
            blocks: [
                {
                    heading:     '',
                    description: '',
                    language:    'bash',
                    code:        'echo deploy',
                    vars:        [],
                },
            ],
        };
        const html = buildFormHtml({ ...ARGS, model });

        // Language selector must be disabled (locked mode)
        const selectorStart = html.indexOf('id="block-0-lang"');
        assert.ok(selectorStart !== -1, 'language selector element present');
        const selectorChunk = html.slice(selectorStart, selectorStart + 80);
        assert.ok(selectorChunk.includes('disabled'), 'command lang selector is disabled');
        assert.ok(html.includes('>bash<'), 'command selector shows bash');

        snapshot('command-single-block', html);
    });

    test('snippet multi-block (2 blocks) — cards with reorder buttons', () => {
        const model: ArtifactFormModel = {
            type:        'snippet',
            title:       'Multi Snippet',
            description: 'File-level description.',
            tags:        ['multi'],
            blocks: [
                {
                    heading:     'Block One',
                    description: 'First block.',
                    language:    'javascript',
                    code:        'const a = 1;',
                    vars:        [],
                },
                {
                    heading:     'Block Two',
                    description: 'Second block.',
                    language:    'typescript',
                    code:        'const b: number = 2;',
                    vars:        [],
                },
            ],
        };
        const html = buildFormHtml({ ...ARGS, model });

        // Both card headings rendered
        assert.ok(html.includes('value="Block One"'), 'first block heading in HTML');
        assert.ok(html.includes('value="Block Two"'), 'second block heading in HTML');

        // First block's ↑ disabled; last block's ↓ disabled
        assert.ok(
            html.includes('data-action="up" data-block="0" disabled') ||
            html.includes('data-block="0" data-action="up" disabled'),
            'first block up-button disabled',
        );
        assert.ok(
            html.includes('data-action="down" data-block="1" disabled') ||
            html.includes('data-block="1" data-action="down" disabled'),
            'last block down-button disabled',
        );

        snapshot('snippet-multi-block', html);
    });
});

// ── T7: template create form ──────────────────────────────────────────────────

/**
 * Templates-as-files (T7): the create form gains an optional, template-only
 * extension field and, being `multiBlock: false`, drops the add-block button.
 */
suite('buildFormHtml — template', () => {

    function templateModel(extension = ''): ArtifactFormModel {
        return {
            type:        'template',
            title:       'React Component',
            description: '',
            extension,
            tags:        [],
            blocks: [
                { heading: '', description: '', language: 'typescriptreact', code: 'export const C = () => null;', vars: [] },
            ],
        };
    }

    test('renders a template-only extension input, seeded with the model value', () => {
        const html = buildFormHtml({ ...ARGS, model: templateModel('.tsx') });
        assert.ok(html.includes('id="extension"'), 'extension input present for a template');
        assert.ok(html.includes('value=".tsx"'), 'extension input seeded with the model value');
    });

    test('drops the add-block button (multiBlock: false)', () => {
        const html = buildFormHtml({ ...ARGS, model: templateModel() });
        assert.ok(!html.includes('id="add-block-btn"'), 'no add-block button for a single-block-only type');
    });

    test('a snippet form has no extension input', () => {
        const snippet: ArtifactFormModel = {
            type: 'snippet', title: 'S', description: '', tags: [],
            blocks: [{ heading: '', description: '', language: 'javascript', code: 'x', vars: [] }],
        };
        assert.ok(!buildFormHtml({ ...ARGS, model: snippet }).includes('id="extension"'));
    });
});

// ── T3: agent create form ──────────────────────────────────────────────────────

/**
 * AI Agents Config (T3): the create form gains three agent-only, free-text
 * frontmatter inputs — provider / model / version — rendered for no other type.
 */
suite('buildFormHtml — agent', () => {

    function agentModel(over: Partial<ArtifactFormModel> = {}): ArtifactFormModel {
        return {
            type:        'agent',
            title:       'Code reviewer',
            description: '',
            provider:    'Claude',
            model:       'Opus',
            version:     '4.8',
            tags:        [],
            blocks: [
                { heading: '', description: '', language: 'md', code: 'You are a reviewer.', vars: [] },
            ],
            ...over,
        };
    }

    test('renders agent-only provider/model/version inputs seeded from the model', () => {
        const html = buildFormHtml({ ...ARGS, model: agentModel() });
        assert.ok(html.includes('id="provider"'), 'provider input present');
        assert.ok(html.includes('value="Claude"'), 'provider seeded');
        assert.ok(html.includes('id="model"'), 'model input present');
        assert.ok(html.includes('value="Opus"'), 'model seeded');
        assert.ok(html.includes('id="version"'), 'version input present');
        assert.ok(html.includes('value="4.8"'), 'version seeded');

        snapshot('agent-single-block', html);
    });

    test('a snippet form has no provider/model/version inputs', () => {
        const snippet: ArtifactFormModel = {
            type: 'snippet', title: 'S', description: '', tags: [],
            blocks: [{ heading: '', description: '', language: 'javascript', code: 'x', vars: [] }],
        };
        const html = buildFormHtml({ ...ARGS, model: snippet });
        assert.ok(!html.includes('id="provider"'), 'no provider input for a snippet');
        assert.ok(!html.includes('id="version"'), 'no version input for a snippet');
    });
});
