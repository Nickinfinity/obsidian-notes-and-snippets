import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractFlaggedRegions } from '../src/services/flags.service.js';

/**
 * Unit tests for the `%%oa:start%%` … `%%oa:end%%` flag scanner.
 *
 * The scanner is what lets an artifact's payload *be* markdown instead of being
 * wrapped in a fence, so the cases that matter are the ones where the payload
 * looks like the syntax around it: inner code fences, a documented flag inside a
 * sample, an unclosed flag mid-edit.
 */
suite('extractFlaggedRegions', () => {

    test('a file with no flags yields no regions (classic fenced shape)', () => {
        assert.deepStrictEqual(extractFlaggedRegions('# Notes\n\n```js\nx\n```\n'), []);
    });

    test('an unnamed region returns its content with the flags removed', () => {
        const body = 'Notes above.\n\n%%oa:start%%\nReview <VK-file>.\n%%oa:end%%\n\nNotes below.';
        assert.deepStrictEqual(extractFlaggedRegions(body), [
            { name: '', content: 'Review <VK-file>.' },
        ]);
    });

    test('text outside the flags is dropped — that is what the markers are for', () => {
        const body = 'Private vault notes.\n%%oa:start%%\npayload\n%%oa:end%%\ntrailing notes';
        assert.strictEqual(extractFlaggedRegions(body)[0].content, 'payload');
    });

    test('a named start flag carries its name (becomes the block heading)', () => {
        const body = '%%oa:start Dev server%%\nrun dev\n%%oa:end%%';
        assert.deepStrictEqual(extractFlaggedRegions(body), [
            { name: 'Dev server', content: 'run dev' },
        ]);
    });

    test('several named regions are returned in document order', () => {
        const body = [
            '%%oa:start Dev%%', 'dev payload', '%%oa:end%%',
            'notes between',
            '%%oa:start Prod%%', 'prod payload', '%%oa:end%%',
        ].join('\n');
        assert.deepStrictEqual(extractFlaggedRegions(body).map(r => r.name), ['Dev', 'Prod']);
        assert.deepStrictEqual(extractFlaggedRegions(body).map(r => r.content), ['dev payload', 'prod payload']);
    });

    test('surrounding whitespace inside the marker is tolerated', () => {
        const body = '  %%  oa:start   Dev  %%  \npayload\n  %% oa:end %%';
        assert.deepStrictEqual(extractFlaggedRegions(body), [{ name: 'Dev', content: 'payload' }]);
    });

    test('markdown inside the region is kept verbatim, code fences included', () => {
        const body = [
            '%%oa:start%%',
            '# Heading',
            '',
            '- bullet',
            '',
            '```bash',
            'npm test',
            '```',
            '%%oa:end%%',
        ].join('\n');
        assert.strictEqual(
            extractFlaggedRegions(body)[0].content,
            '# Heading\n\n- bullet\n\n```bash\nnpm test\n```',
        );
    });

    /**
     * The regression this scanner exists to avoid: a prompt that *documents* the
     * flag syntax inside a fenced sample must not terminate itself there.
     */
    test('an end flag inside a fenced block does not close the region', () => {
        const body = [
            '%%oa:start%%',
            'Wrap your prompt like this:',
            '```md',
            '%%oa:start%%',
            'text',
            '%%oa:end%%',
            '```',
            'Done.',
            '%%oa:end%%',
        ].join('\n');
        const regions = extractFlaggedRegions(body);
        assert.strictEqual(regions.length, 1, 'the fenced sample must not split the region');
        assert.ok(regions[0].content.endsWith('Done.'), `region ended early: ${regions[0].content}`);
        assert.ok(regions[0].content.includes('%%oa:end%%'), 'the sample flags belong to the payload');
    });

    test('a tilde fence is not closed by a backtick fence', () => {
        const body = '%%oa:start%%\n~~~\n```\n%%oa:end%%\n~~~\ntail\n%%oa:end%%';
        const regions = extractFlaggedRegions(body);
        assert.strictEqual(regions.length, 1);
        assert.ok(regions[0].content.endsWith('tail'), `region ended early: ${regions[0].content}`);
    });

    test('an unterminated region runs to end of file (a half-typed file still previews)', () => {
        assert.deepStrictEqual(extractFlaggedRegions('%%oa:start Draft%%\nstill writing'), [
            { name: 'Draft', content: 'still writing' },
        ]);
    });

    test('a second start flag while a region is open is content, not a new region', () => {
        const regions = extractFlaggedRegions('%%oa:start A%%\none\n%%oa:start B%%\ntwo\n%%oa:end%%');
        assert.strictEqual(regions.length, 1);
        assert.strictEqual(regions[0].name, 'A');
        assert.strictEqual(regions[0].content, 'one\n%%oa:start B%%\ntwo');
    });

    test('blank lines are trimmed from the ends but never from the middle', () => {
        const body = '%%oa:start%%\n\n\nfirst\n\n\nlast\n\n%%oa:end%%';
        assert.strictEqual(extractFlaggedRegions(body)[0].content, 'first\n\n\nlast');
    });

    test('CRLF files parse identically to LF files', () => {
        const body = '%%oa:start Dev%%\r\npayload\r\n%%oa:end%%\r\n';
        assert.deepStrictEqual(extractFlaggedRegions(body), [{ name: 'Dev', content: 'payload' }]);
    });
});

// ── Drift guard ─────────────────────────────────────────────────────────────────

/**
 * The flag syntax is a cross-file contract (parser, docs, future create form), so
 * it gets a test rather than a comment claiming it is centralised. A second
 * hand-rolled `%%oa:` regex anywhere in `src/` is exactly how `escHtml` grew four
 * divergent copies.
 */
suite('flag syntax is declared exactly once', () => {

    /** Recursively lists every `.ts` file under a directory. */
    function tsFiles(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { return tsFiles(full); }
            return e.name.endsWith('.ts') ? [full] : [];
        });
    }

    test('only flags.service.ts spells out the marker', () => {
        const srcRoot = path.resolve(__dirname, '../../src');
        const offenders = tsFiles(srcRoot)
            .filter(f => path.basename(f) !== 'flags.service.ts')
            .filter(f => fs.readFileSync(f, 'utf-8').includes('oa:start'));

        assert.deepStrictEqual(offenders, [],
            `flag syntax must come from flags.service.ts, not be re-spelled in: ${offenders.join(', ')}`);
    });
});
