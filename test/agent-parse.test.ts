import * as assert from 'node:assert';
import { parseFromContent } from '../src/services/parser.service.js';

/**
 * T1 — the parser must read the agent-only `provider`/`model`/`version`
 * frontmatter keys. Before they were added to `STRING_FRONTMATTER_KEYS` the
 * generic string path dropped them silently.
 */
suite('agent frontmatter parsing — provider/model/version', () => {

    const AGENT_MD = [
        '---',
        'artifactType: AIAgentsConfig',
        'title: Code reviewer',
        'provider: Claude',
        'model: Opus',
        'version: 4.8',
        '---',
        '',
        '```md',
        'You are a reviewer.',
        '```',
        '',
    ].join('\n');

    test('reads provider/model/version off an agent file', () => {
        const parsed = parseFromContent(AGENT_MD, '/vault/AIAgentsConf/reviewer.md', '/vault/AIAgentsConf');
        assert.strictEqual(parsed.frontmatter.artifactType, 'AIAgentsConfig');
        assert.strictEqual(parsed.frontmatter.provider, 'Claude');
        assert.strictEqual(parsed.frontmatter.model, 'Opus');
        assert.strictEqual(parsed.frontmatter.version, '4.8');
    });

    test('leaves the keys undefined when the file omits them', () => {
        const md = '---\nartifactType: AIAgentsConfig\ntitle: Bare\n---\n\n```md\nhi\n```\n';
        const parsed = parseFromContent(md, '/vault/AIAgentsConf/bare.md', '/vault/AIAgentsConf');
        assert.strictEqual(parsed.frontmatter.provider, undefined);
        assert.strictEqual(parsed.frontmatter.model, undefined);
        assert.strictEqual(parsed.frontmatter.version, undefined);
    });
});
