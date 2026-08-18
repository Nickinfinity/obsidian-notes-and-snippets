import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildVarSetModel } from '../src/services/varset.service.js';
import { serializeArtifact } from '../src/services/artifact-serializer.service.js';
import { parseFromContent } from '../src/services/parser.service.js';

/**
 * Byte-identical golden lock for variable-set `.md` emission (services-dry
 * Phase 5).
 *
 * These snapshots were captured from the hand-rolled `buildVarSetFileContent`
 * **before** the emission path was rerouted through `serializeArtifact`. They
 * are the proof that the reroute changed no bytes, so they are **never edited**
 * during the refactor — if one fails, the refactor is wrong, not the golden.
 */

const SNAPSHOT_DIR = path.resolve(__dirname, '../../test/snapshots/varset');

/** Cases mirror the shapes the save-as flow can produce. */
const CASES: {
    name: string;
    title: string;
    description: string;
    tags: string[];
    entries: [string, string][];
}[] = [
    { name: 'bare',        title: 'Local Dev', description: '',                     tags: [],             entries: [['VK-host', 'localhost']] },
    { name: 'description', title: 'Local Dev', description: 'Dev machine settings', tags: [],             entries: [['VK-host', 'localhost']] },
    { name: 'tags',        title: 'Local Dev', description: '',                     tags: ['api', 'dev'], entries: [['VK-host', 'localhost']] },
    { name: 'full',        title: 'Local Dev', description: 'Dev machine settings', tags: ['api', 'dev'], entries: [['VK-host', 'localhost']] },
    { name: 'multi-var',   title: 'Local Dev', description: '',                     tags: [],             entries: [['VK-host', 'localhost'], ['VK-port', '3000'], ['VK-user', 'admin']] },
    { name: 'equals',      title: 'Local Dev', description: '',                     tags: [],             entries: [['VK-query', 'a=b&c=d']] },
    { name: 'quotes',      title: 'Local Dev', description: '',                     tags: [],             entries: [['VK-flag', '"active"']] },
];

/**
 * Reads a golden file verbatim.
 *
 * @param name - Case name, matching the `.md` file stem in the snapshot dir.
 * @returns The golden file's exact contents.
 *
 * @example
 * readGolden('bare') // '---\ntype: variables\n…'
 */
function readGolden(name: string): string {
    return fs.readFileSync(path.join(SNAPSHOT_DIR, `${name}.md`), 'utf8');
}

// ── Golden lock ───────────────────────────────────────────────────────────────

suite('variable-set serialization — golden bytes', () => {
    for (const c of CASES) {
        test(`${c.name} matches its golden byte-for-byte`, () => {
            const actual = serializeArtifact(buildVarSetModel(c.title, c.description, c.tags, c.entries));
            assert.strictEqual(actual, readGolden(c.name));
        });
    }
});

// ── Round-trip ────────────────────────────────────────────────────────────────

suite('variable-set serialization — parse round-trip', () => {

    /**
     * The emitted file must be readable by the parser that consumes it, with
     * vars in the order they were written. A byte-identical file that no longer
     * parses would satisfy the goldens and still break the feature.
     */
    test('every golden parses back to its vars in order', () => {
        for (const c of CASES) {
            const parsed = parseFromContent(readGolden(c.name), `/vault/Variables/${c.name}.md`, '/vault');

            assert.strictEqual(parsed.frontmatter.type, 'variables', `${c.name}: type`);
            assert.strictEqual(parsed.frontmatter.title, c.title, `${c.name}: title`);
            // Covers the emitted frontmatter keys the serializer and parser must
            // agree on for this shape (R3): every key written is read back.
            assert.strictEqual(parsed.frontmatter.description ?? '', c.description, `${c.name}: description`);
            assert.deepStrictEqual(parsed.frontmatter.tags ?? [], c.tags, `${c.name}: tags`);
            assert.deepStrictEqual(
                parsed.vars.map(v => [v.name, v.defaultValue]),
                c.entries,
                `${c.name}: vars did not survive the round-trip`
            );
        }
    });
});
