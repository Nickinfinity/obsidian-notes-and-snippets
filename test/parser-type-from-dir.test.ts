import * as assert from 'node:assert';
import { parseFromContent } from '../src/services/parser.service.js';

/**
 * A vault file's artifact directory declares its type when the frontmatter does
 * not (VSX bug: commands inserted into the editor instead of the terminal).
 *
 * Real vault files routinely carry no frontmatter at all — a `Commands/` file
 * often starts straight at `## heading`. The directory is what the user chose
 * when they filed it, and `ARTIFACTS` already treats the directory as the
 * source of truth for every other behaviour (menus, context keys, commands).
 * Before this, such a file parsed as `type: 'snippet'` and `performInsert`
 * routed it to the cursor.
 */

/** A multi-block commands file exactly as it appears in a real vault — no frontmatter. */
const NO_FRONTMATTER = [
    '## Change url (remote)',
    '',
    '```bash',
    'git remote set-url origin "new_url"',
    '```',
].join('\n');

suite('parser — artifact type inferred from the vault directory', () => {

    test('a Commands file with no frontmatter parses as type: command', () => {
        const parsed = parseFromContent(NO_FRONTMATTER, '/vault/Commands/GIT/Remote.md', '/vault/Commands');
        assert.strictEqual(parsed.frontmatter.type, 'command');
    });

    test('blocks of such a file inherit the directory-derived type', () => {
        const parsed = parseFromContent(NO_FRONTMATTER, '/vault/Commands/GIT/Remote.md', '/vault/Commands');
        assert.ok(parsed.blocks.length > 0, 'expected the ## heading to produce a block');
        assert.strictEqual(parsed.frontmatter.type, 'command');
    });

    test('a Snippets file with no frontmatter still parses as type: snippet', () => {
        const parsed = parseFromContent(NO_FRONTMATTER, '/vault/Snippets/x.md', '/vault/Snippets');
        assert.strictEqual(parsed.frontmatter.type, 'snippet');
    });

    test('explicit frontmatter always wins over the directory', () => {
        const explicit = `---\ntype: snippet\n---\n\n${NO_FRONTMATTER}`;
        const parsed = parseFromContent(explicit, '/vault/Commands/x.md', '/vault/Commands');
        assert.strictEqual(parsed.frontmatter.type, 'snippet');
    });

    test('an unrecognised directory falls back to snippet', () => {
        const parsed = parseFromContent(NO_FRONTMATTER, '/vault/Whatever/x.md', '/vault/Whatever');
        assert.strictEqual(parsed.frontmatter.type, 'snippet');
    });
});
