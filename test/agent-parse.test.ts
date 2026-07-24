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
        'type: agent',
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
        const parsed = parseFromContent(AGENT_MD, '/vault/AgentsConf/reviewer.md', '/vault/AgentsConf');
        assert.strictEqual(parsed.frontmatter.type, 'agent');
        assert.strictEqual(parsed.frontmatter.provider, 'Claude');
        assert.strictEqual(parsed.frontmatter.model, 'Opus');
        assert.strictEqual(parsed.frontmatter.version, '4.8');
    });

    test('leaves the keys undefined when the file omits them', () => {
        const md = '---\ntype: agent\ntitle: Bare\n---\n\n```md\nhi\n```\n';
        const parsed = parseFromContent(md, '/vault/AgentsConf/bare.md', '/vault/AgentsConf');
        assert.strictEqual(parsed.frontmatter.provider, undefined);
        assert.strictEqual(parsed.frontmatter.model, undefined);
        assert.strictEqual(parsed.frontmatter.version, undefined);
    });
});
