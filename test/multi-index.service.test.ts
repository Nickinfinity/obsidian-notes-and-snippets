import * as assert from 'node:assert';
import {
    safeRelPath,
    isIndexArtifact,
    extractIndexLinks,
    resolveLinkTarget,
    buildIndexPlan,
    buildDestCandidates,
    applyCarryOver,
    summariseRun,
} from '../src/services/multi-index.service.js';
import type { ParsedFrontmatter, ParsedVar } from '../src/types/parsed-artifact.types.js';

/**
 * Unit tests for the template-index domain service — **the single owner of the
 * index link syntax**, in the same spirit as `flags.service.test.ts` owns the
 * flag syntax.
 *
 * `safeRelPath` is the security-critical surface (plan §3.1): every hostile
 * category is asserted directly, and — because the plan requires proof that
 * it is the *single* rejection authority — through both callers that consume
 * vault-authored paths: `resolveLinkTarget` (link targets) and
 * `buildDestCandidates` (`paths:` entries).
 */

suite('extractIndexLinks', () => {

    test('extracts both wikilink and markdown-link targets, in document order', () => {
        assert.deepStrictEqual(
            extractIndexLinks('1. [[dir_2/subdir1/Button]]\n2. [T](dir_2/subdir1/Button.test.md)'),
            ['dir_2/subdir1/Button', 'dir_2/subdir1/Button.test.md'],
        );
    });

    test('strips a wikilink alias suffix ([[a|b]] -> a)', () => {
        assert.deepStrictEqual(extractIndexLinks('[[dir/Button|Button component]]'), ['dir/Button']);
    });

    test('strips a wikilink anchor suffix ([[a#h]] -> a)', () => {
        assert.deepStrictEqual(extractIndexLinks('[[dir/Button#Usage]]'), ['dir/Button']);
    });

    test('strips both alias and anchor together', () => {
        assert.deepStrictEqual(extractIndexLinks('[[dir/Button#Usage|see usage]]'), ['dir/Button']);
    });

    test('duplicate links are preserved, not deduped', () => {
        assert.deepStrictEqual(
            extractIndexLinks('[[dir/a]]\n[[dir/a]]'),
            ['dir/a', 'dir/a'],
        );
    });

    test('non-link prose lines are ignored', () => {
        assert.deepStrictEqual(
            extractIndexLinks('Scaffolds a component.\n[[dir/a]]\nDone.'),
            ['dir/a'],
        );
    });

    test('a markdown image is not read as an index link', () => {
        assert.deepStrictEqual(extractIndexLinks('![alt](dir/pic.png)\n[[dir/a]]'), ['dir/a']);
    });

    // The wikilink form must exclude embeds for the same reason the markdown
    // form excludes images: `![[…]]` transcludes a note for display, it does not
    // nominate a file to scaffold. Guards the asymmetry the two branches of
    // LINK_RE would otherwise have.
    test('an embedded wikilink (![[a]]) is not read as an index link', () => {
        assert.deepStrictEqual(extractIndexLinks('![[dir/preview]]\n[[dir/a]]'), ['dir/a']);
    });

    test('an embedded image wikilink is not read as an index link', () => {
        assert.deepStrictEqual(extractIndexLinks('![[dir/pic.png]]'), []);
    });

    // A target carrying `[` or `(` is unlinkable rather than silently truncated
    // into a *different* path — the character-class exclusions that make these
    // no-matches are the same ones that keep the scan linear on a hostile body.
    test('a wikilink target containing "[" is not truncated into a different path', () => {
        assert.deepStrictEqual(extractIndexLinks('[[dir/a[1]]]'), []);
    });

    test('a markdown link target containing "(" is not truncated into a different path', () => {
        assert.deepStrictEqual(extractIndexLinks('[T](dir/a(1).md)'), []);
    });

    test('a link may not span a newline', () => {
        assert.deepStrictEqual(extractIndexLinks('[[dir/a\nb]]'), []);
    });

    test('an empty body yields no links', () => {
        assert.deepStrictEqual(extractIndexLinks(''), []);
    });
});

suite('safeRelPath — the single rejection authority', () => {

    test('accepts an ordinary relative path unchanged', () => {
        assert.deepStrictEqual(safeRelPath('dir_2/subdir1/Button.md'), { ok: true, relPath: 'dir_2/subdir1/Button.md' });
    });

    test('normalises to POSIX: collapses doubled slashes and drops a leading "./"', () => {
        assert.deepStrictEqual(safeRelPath('./dir//sub/file.md'), { ok: true, relPath: 'dir/sub/file.md' });
    });

    test('rejects a parent-directory traversal sequence', () => {
        const result = safeRelPath('../etc/passwd');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result), 'a rejected path must never be rewritten and returned');
        assert.ok(!result.ok && result.reason.length > 0);
    });

    test('rejects a traversal sequence buried mid-path', () => {
        const result = safeRelPath('dir/../../etc/passwd');
        assert.strictEqual(result.ok, false);
    });

    test('rejects an absolute POSIX path', () => {
        const result = safeRelPath('/etc/passwd');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result));
    });

    test('rejects a Windows drive-letter path', () => {
        const result = safeRelPath('C:\\Windows\\System32\\evil.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result));
    });

    test('rejects a backslash-separated path with no drive letter', () => {
        const result = safeRelPath('dir_2\\subdir1\\Button.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result));
    });

    test('rejects a NUL / control character', () => {
        const result = safeRelPath('dir/evil\u0000.md');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result));
    });

    test('rejects a file: URI', () => {
        const result = safeRelPath('file:///etc/passwd');
        assert.strictEqual(result.ok, false);
        assert.ok(!('relPath' in result));
    });

    test('a percent-encoded traversal sequence stays a literal filename — no decode step exists', () => {
        const hostile = '..%2f..%2fetc%2fpasswd';
        assert.deepStrictEqual(safeRelPath(hostile), { ok: true, relPath: hostile });
    });

    test('rejects an empty path', () => {
        assert.strictEqual(safeRelPath('').ok, false);
    });

    test('rejects a bare "."', () => {
        assert.strictEqual(safeRelPath('.').ok, false);
    });
});

suite('resolveLinkTarget', () => {

    test('appends .md when the link has no extension', () => {
        assert.deepStrictEqual(resolveLinkTarget('dir_2/subdir1/Button'), { ok: true, relPath: 'dir_2/subdir1/Button.md' });
    });

    test('does not double-append .md when already present', () => {
        assert.deepStrictEqual(resolveLinkTarget('dir_2/subdir1/Button.test.md'), { ok: true, relPath: 'dir_2/subdir1/Button.test.md' });
    });

    test('.md detection is case-insensitive', () => {
        assert.deepStrictEqual(resolveLinkTarget('dir/Button.MD'), { ok: true, relPath: 'dir/Button.MD' });
    });

    // ── Same rejection authority as safeRelPath — never a rewritten path ──
    for (const [label, hostile] of [
        ['parent-directory traversal', '../etc/passwd'],
        ['absolute path', '/etc/passwd'],
        ['Windows drive letter', 'C:\\Windows\\evil'],
        ['backslash-separated path', 'dir\\sub\\file'],
        ['control character', 'dir/evil\u0000'],
        ['file: URI', 'file:///etc/passwd'],
    ] as const) {
        test(`rejects the same hostile input as safeRelPath: ${label}`, () => {
            const result = resolveLinkTarget(hostile);
            assert.strictEqual(result.ok, false, `expected rejection for: ${label}`);
            assert.ok(!('relPath' in result), 'never a rewritten path');
        });
    }

    test('a percent-encoded traversal sequence resolves as a literal filename, .md appended', () => {
        const hostile = '..%2f..%2fetc%2fpasswd';
        assert.deepStrictEqual(resolveLinkTarget(hostile), { ok: true, relPath: `${hostile}.md` });
    });
});

suite('isIndexArtifact', () => {

    const fm = (overrides: Partial<ParsedFrontmatter>): ParsedFrontmatter => ({ type: 'template', ...overrides });

    test('true for a template carrying index: true', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'template', index: true })), true);
    });

    test('true for an agent carrying index: true', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'agent', index: true })), true);
    });

    test('false for a snippet carrying index: true — a run can only write files', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'snippet', index: true })), false);
    });

    test('false for a command carrying index: true', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'command', index: true })), false);
    });

    test('false when index is absent', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'template' })), false);
    });

    test('false when index is explicitly false', () => {
        assert.strictEqual(isIndexArtifact(fm({ type: 'template', index: false })), false);
    });
});

suite('buildIndexPlan', () => {

    test('preserves document order and reports rejected entries with a reason', () => {
        const body = [
            '1. [[dir_2/subdir1/Button]]',
            '2. [T](dir_2/subdir1/Button.test.md)',
            '3. [[../escape]]',
            '4. [[dir_1/barrel]]',
        ].join('\n');

        const plan = buildIndexPlan(body);

        assert.deepStrictEqual(plan.steps.map(s => s.raw), [
            'dir_2/subdir1/Button',
            'dir_2/subdir1/Button.test.md',
            'dir_1/barrel',
        ]);
        assert.deepStrictEqual(plan.steps.map(s => s.relPath), [
            'dir_2/subdir1/Button.md',
            'dir_2/subdir1/Button.test.md',
            'dir_1/barrel.md',
        ]);
        assert.deepStrictEqual(plan.steps.map(s => s.relDir), ['dir_2/subdir1', 'dir_2/subdir1', 'dir_1']);

        assert.strictEqual(plan.rejected.length, 1);
        assert.strictEqual(plan.rejected[0].raw, '../escape');
        assert.ok(plan.rejected[0].reason.length > 0);
    });

    test('relDir is "" when the target sits beside the index', () => {
        const plan = buildIndexPlan('[[Button]]');
        assert.strictEqual(plan.steps[0].relDir, '');
    });

    test('duplicate links yield duplicate steps', () => {
        const plan = buildIndexPlan('[[dir/a]]\n[[dir/a]]');
        assert.strictEqual(plan.steps.length, 2);
        assert.deepStrictEqual(plan.steps.map(s => s.relPath), ['dir/a.md', 'dir/a.md']);
    });

    test('an index with no links yields an empty plan', () => {
        assert.deepStrictEqual(buildIndexPlan('just prose, no links'), { steps: [], rejected: [] });
    });
});

suite('buildDestCandidates', () => {

    test('the mirrored folder is first, labelled as the suggestion', () => {
        const candidates = buildDestCandidates({ mirroredRelDir: 'dir_2/subdir1', clickedRelPath: 'src/app', indexPaths: [] });
        assert.deepStrictEqual(candidates[0], {
            relPath: 'src/app/dir_2/subdir1',
            label: 'src/app/dir_2/subdir1',
            detail: 'Suggested — mirrors the index',
        });
    });

    test('the workspace root mirrors as "/"', () => {
        const candidates = buildDestCandidates({ mirroredRelDir: '', clickedRelPath: '', indexPaths: [] });
        assert.deepStrictEqual(candidates[0], { relPath: '', label: '/', detail: 'Suggested — mirrors the index' });
    });

    test('accepted paths: entries follow, in declaration order, labelled "From the index"', () => {
        const candidates = buildDestCandidates({
            mirroredRelDir: 'dir_2/subdir1',
            clickedRelPath: 'src/app',
            indexPaths: ['src/components', 'packages/ui/src'],
        });
        assert.deepStrictEqual(candidates.slice(1), [
            { relPath: 'src/components', label: 'src/components', detail: 'From the index' },
            { relPath: 'packages/ui/src', label: 'packages/ui/src', detail: 'From the index' },
        ]);
    });

    test('dedupes by relPath, first occurrence wins', () => {
        const candidates = buildDestCandidates({
            mirroredRelDir: 'dir_2/subdir1',
            clickedRelPath: 'src/app',
            indexPaths: ['src/app/dir_2/subdir1', 'src/components'],
        });
        assert.strictEqual(candidates.length, 2);
        assert.strictEqual(candidates[0].detail, 'Suggested — mirrors the index');
        assert.strictEqual(candidates[1].relPath, 'src/components');
    });

    test('a rejected paths: entry is silently dropped, not surfaced as a candidate', () => {
        const candidates = buildDestCandidates({
            mirroredRelDir: '',
            clickedRelPath: '',
            indexPaths: ['../escape', 'src/components'],
        });
        assert.deepStrictEqual(candidates.map(c => c.relPath), ['', 'src/components']);
    });

    // ── Same rejection authority as safeRelPath, exercised through this caller ──
    for (const [label, hostile] of [
        ['parent-directory traversal', '../escape'],
        ['absolute path', '/etc/passwd'],
        ['Windows drive letter', 'C:\\evil'],
        ['backslash-separated path', 'dir\\sub'],
        ['control character', 'dir/evil\u0000'],
        ['file: URI', 'file:///etc/passwd'],
    ] as const) {
        test(`drops a hostile paths: entry — ${label}`, () => {
            const candidates = buildDestCandidates({ mirroredRelDir: '', clickedRelPath: '', indexPaths: [hostile] });
            assert.strictEqual(candidates.length, 1, 'only the mirrored candidate should remain');
            assert.strictEqual(candidates[0].detail, 'Suggested — mirrors the index');
        });
    }

    test('a percent-encoded traversal paths: entry is accepted as a literal folder name', () => {
        const hostile = '..%2f..%2fetc';
        const candidates = buildDestCandidates({ mirroredRelDir: '', clickedRelPath: '', indexPaths: [hostile] });
        assert.deepStrictEqual(candidates[1], { relPath: hostile, label: hostile, detail: 'From the index' });
    });
});

suite('applyCarryOver', () => {

    test('overrides only vars whose name is an exact key of carry', () => {
        const vars: ParsedVar[] = [
            { name: 'VK-language', defaultValue: 'javascript' },
            { name: 'VK-port', defaultValue: '8080' },
        ];
        const result = applyCarryOver(vars, { 'VK-language': 'java' });
        assert.deepStrictEqual(result, [
            { name: 'VK-language', defaultValue: 'java' },
            { name: 'VK-port', defaultValue: '8080' },
        ]);
    });

    test('match is case-sensitive on the full VK-xxx token', () => {
        const vars: ParsedVar[] = [{ name: 'VK-language', defaultValue: 'javascript' }];
        const result = applyCarryOver(vars, { 'vk-language': 'java' });
        assert.strictEqual(result[0].defaultValue, 'javascript');
    });

    test('returns a new array and does not mutate the input vars', () => {
        const vars: ParsedVar[] = [{ name: 'VK-language', defaultValue: 'javascript' }];
        const result = applyCarryOver(vars, { 'VK-language': 'java' });
        assert.notStrictEqual(result, vars);
        assert.strictEqual(vars[0].defaultValue, 'javascript', 'input must be untouched');
    });

    test('does not mutate the carry map', () => {
        const carry = { 'VK-language': 'java' };
        const frozen = { ...carry };
        applyCarryOver([{ name: 'VK-language', defaultValue: 'javascript' }], carry);
        assert.deepStrictEqual(carry, frozen);
    });

    test('an empty carry leaves vars unchanged in value, but still a new array', () => {
        const vars: ParsedVar[] = [{ name: 'VK-language', defaultValue: 'javascript' }];
        const result = applyCarryOver(vars, {});
        assert.deepStrictEqual(result, vars);
        assert.notStrictEqual(result, vars);
    });
});

suite('summariseRun', () => {

    test('matches the closing-notification example verbatim', () => {
        assert.strictEqual(summariseRun({ written: 3, skipped: 0, aborted: false }), 'Multi-Template: 3 files written, 0 skipped.');
    });

    test('singular "file" for exactly one file written', () => {
        assert.strictEqual(summariseRun({ written: 1, skipped: 2, aborted: false }), 'Multi-Template: 1 file written, 2 skipped.');
    });

    test('notes an aborted run', () => {
        assert.strictEqual(
            summariseRun({ written: 1, skipped: 0, aborted: true }),
            'Multi-Template: 1 file written, 0 skipped. Run cancelled.',
        );
    });
});
