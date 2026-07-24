import * as assert from 'node:assert';
import { serializeArtifact } from '../src/services/artifact-serializer.service.js';
import { parseFromContent } from '../src/services/parser.service.js';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';

/**
 * T2 (security-critical) — the serializer must emit the agent-only
 * `provider`/`model`/`version` keys in D3 order and, because these values cross
 * the webview boundary, single-line them via `safeYamlValue` so an embedded
 * newline can never inject a sibling frontmatter key on re-parse.
 */
function agentModel(over: Partial<ArtifactFormModel> = {}): ArtifactFormModel {
    return {
        type:        'agent',
        title:       'Code reviewer',
        description: '',
        provider:    'Claude',
        model:       'Opus',
        version:     '4.8',
        tags:        [],
        blocks:      [{ heading: '', description: '', language: 'md', code: 'review it', vars: [] }],
        ...over,
    };
}

suite('agent serialization — provider/model/version', () => {

    test('emits the three keys in D3 order (after language, before tags)', () => {
        const md = serializeArtifact(agentModel({ tags: ['review'] }));
        assert.ok(md.includes('provider: Claude'), 'provider emitted');
        assert.ok(md.includes('model: Opus'), 'model emitted');
        assert.ok(md.includes('version: 4.8'), 'version emitted');

        const iProvider = md.indexOf('provider:');
        const iModel    = md.indexOf('model:');
        const iVersion  = md.indexOf('version:');
        const iTags     = md.indexOf('tags:');
        assert.ok(iProvider < iModel && iModel < iVersion && iVersion < iTags,
            `keys out of D3 order: provider=${iProvider} model=${iModel} version=${iVersion} tags=${iTags}`);
    });

    test('omits agent keys when empty (not emitted blank)', () => {
        const md = serializeArtifact(agentModel({ provider: '', model: '', version: '' }));
        assert.ok(!md.includes('provider:'), 'no empty provider');
        assert.ok(!md.includes('model:'), 'no empty model');
        assert.ok(!md.includes('version:'), 'no empty version');
    });

    // ── Security: newline key-injection ──────────────────────────────────────
    test('single-lines a newline-injection provider so no sibling key re-parses', () => {
        const md = serializeArtifact(agentModel({ provider: 'x\ntype: command' }));
        const reparsed = parseFromContent(md, '/vault/AgentsConf/x.md', '/vault/AgentsConf');
        assert.strictEqual(reparsed.frontmatter.type, 'agent', 'type not overridden by injected key');
        assert.ok(!md.includes('\ntype: command'), 'newline stripped — no injected frontmatter line');
    });
});
