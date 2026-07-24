import * as assert from 'node:assert';
import { serializeArtifact } from '../src/services/artifact-serializer.service.js';
import { parseFromContent } from '../src/services/parser.service.js';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';

/**
 * T5 — the provider/model/version keys must survive a full
 * `parse(serialize(x))` round-trip in D3 order, and empty fields must be
 * omitted (not emitted blank) rather than round-tripping to `''`.
 */
const ROOT = '/vault/AgentsConf';
const FILE = '/vault/AgentsConf/reviewer.md';

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

suite('agent round-trip — provider/model/version', () => {

    test('a fully-populated agent model preserves the three keys in D3 order', () => {
        const md = serializeArtifact(agentModel({ tags: ['review'] }));
        const fm = parseFromContent(md, FILE, ROOT).frontmatter;

        assert.strictEqual(fm.provider, 'Claude');
        assert.strictEqual(fm.model, 'Opus');
        assert.strictEqual(fm.version, '4.8');

        // D3 order in the emitted bytes: provider < model < version < tags.
        const i = (k: string): number => md.indexOf(`\n${k}:`);
        assert.ok(i('provider') < i('model') && i('model') < i('version') && i('version') < i('tags'),
            'agent keys not in D3 order relative to tags');
    });

    test('empty agent fields are omitted, not emitted blank', () => {
        const md = serializeArtifact(agentModel({ provider: '', model: '', version: '' }));
        const fm = parseFromContent(md, FILE, ROOT).frontmatter;

        assert.strictEqual(fm.provider, undefined);
        assert.strictEqual(fm.model, undefined);
        assert.strictEqual(fm.version, undefined);
    });
});
