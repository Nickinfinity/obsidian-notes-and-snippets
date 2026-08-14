import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
    applyFrontmatterRewrite,
    applyMigration,
    buildLegacyTypeMap,
    planFrontmatterRewrite,
    planMigration,
} from '../src/services/frontmatter-migration.service.js';
import { getEntry } from '../src/services/artifact-type-config.service.js';

/**
 * Unit tests for the T4 vault frontmatter migration: `type: <legacy>` →
 * `artifactType: <PascalCase>`.
 *
 * `vscode`-free, in the same spirit as `multi-index.service.test.ts` — no
 * extension host required to exercise the rewrite or containment logic.
 */

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Creates a fresh temp directory rooted at the OS temp dir. */
function mkTempVault(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'frontmatter-migration-test-'));
}

/** Removes a directory tree previously returned from `mkTempVault`. */
function rmTempVault(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Writes `content` to `filePath`, creating parent directories as needed. */
function writeFile(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
}

// ── buildLegacyTypeMap ───────────────────────────────────────────────────────

suite('buildLegacyTypeMap', () => {
    test('derives exactly the five real legacy values — no AIPrompt entry', () => {
        const map = buildLegacyTypeMap();
        assert.deepStrictEqual(
            [...map.entries()].sort(),
            [
                ['agent', 'AIAgentsConfig'],
                ['command', 'Command'],
                ['snippet', 'Snippet'],
                ['template', 'Template'],
                ['variables', 'Variables'],
            ].sort(),
        );
    });

    test('AIPrompt is absent — it is new, never had a legacy spelling', () => {
        assert.strictEqual(buildLegacyTypeMap().get('aiprompt'), undefined);
    });
});

// ── planFrontmatterRewrite — pure rewriter ──────────────────────────────────

suite('planFrontmatterRewrite', () => {
    test('turns type: snippet into artifactType: Snippet', () => {
        const rewrite = planFrontmatterRewrite('---\ntype: snippet\n---\nbody');
        assert.deepStrictEqual(rewrite, { oldLine: 'type: snippet', newLine: 'artifactType: Snippet' });
    });

    test('applying the plan produces the exact expected content', () => {
        const before = '---\ntype: snippet\n---\nbody';
        const rewrite = planFrontmatterRewrite(before);
        assert.ok(rewrite);
        assert.strictEqual(applyFrontmatterRewrite(before, rewrite), '---\nartifactType: Snippet\n---\nbody');
    });

    test('agent -> AIAgentsConfig — the one irregular (rename, not case-fold) value', () => {
        const rewrite = planFrontmatterRewrite('---\ntype: agent\n---\nbody');
        assert.deepStrictEqual(rewrite, { oldLine: 'type: agent', newLine: 'artifactType: AIAgentsConfig' });
    });

    test('command -> Command', () => {
        assert.deepStrictEqual(
            planFrontmatterRewrite('---\ntype: command\n---\nbody'),
            { oldLine: 'type: command', newLine: 'artifactType: Command' },
        );
    });

    test('template -> Template', () => {
        assert.deepStrictEqual(
            planFrontmatterRewrite('---\ntype: template\n---\nbody'),
            { oldLine: 'type: template', newLine: 'artifactType: Template' },
        );
    });

    test('variables -> Variables', () => {
        assert.deepStrictEqual(
            planFrontmatterRewrite('---\ntype: variables\n---\nbody'),
            { oldLine: 'type: variables', newLine: 'artifactType: Variables' },
        );
    });

    // ── Hostile inputs (plan §T4 security surface) ─────────────────────────

    test('(b) a file with no frontmatter at all is left alone', () => {
        assert.strictEqual(planFrontmatterRewrite('# just a heading\n\nsome body text'), null);
    });

    test('(c) a body-only "type:" inside a fence is never read as frontmatter', () => {
        // No frontmatter block at the top of the file at all — the fenced
        // example lower down must not be mistaken for one.
        const content = 'Example:\n\n```yaml\ntype: snippet\n```\n';
        assert.strictEqual(planFrontmatterRewrite(content), null);
    });

    test('(c) a real frontmatter type: is migrated while a body fence documenting "type:" is untouched', () => {
        const before = '---\ntype: snippet\n---\n\nExample syntax:\n\n```yaml\ntype: snippet\n```\n';
        const rewrite = planFrontmatterRewrite(before);
        assert.ok(rewrite);
        const after = applyFrontmatterRewrite(before, rewrite);
        assert.strictEqual(after, '---\nartifactType: Snippet\n---\n\nExample syntax:\n\n```yaml\ntype: snippet\n```\n');
    });

    test('(d) a file already carrying artifactType: is skipped — never double-written', () => {
        assert.strictEqual(planFrontmatterRewrite('---\nartifactType: Snippet\ntitle: X\n---\nbody'), null);
    });

    test('(d) artifactType: present alongside a stray legacy type: is still skipped (idempotent, order-independent)', () => {
        assert.strictEqual(planFrontmatterRewrite('---\ntype: snippet\nartifactType: Snippet\n---\nbody'), null);
    });

    test('an unrecognised type: value is left untouched, never guessed at', () => {
        assert.strictEqual(planFrontmatterRewrite('---\ntype: bogus\n---\nbody'), null);
    });

    test('type: aiprompt is left untouched — AIPrompt has no legacy spelling to migrate from', () => {
        assert.strictEqual(planFrontmatterRewrite('---\ntype: aiprompt\n---\nbody'), null);
    });

    test('(e) index: true and paths: survive byte-identical after the rewrite', () => {
        const before = [
            '---',
            'type: agent',
            'target: CLAUDE.md',
            'index: true',
            'paths: [src/components, packages/ui/src]',
            '---',
            '',
            'Body content.',
            '',
        ].join('\n');
        const rewrite = planFrontmatterRewrite(before);
        assert.ok(rewrite);
        const after = applyFrontmatterRewrite(before, rewrite);
        // Byte-exact: the only difference from `before` is the one line —
        // every other byte, including index:/paths:, is untouched.
        assert.strictEqual(after, before.replace('type: agent', 'artifactType: AIAgentsConfig'));
    });

    test('(e) CRLF line endings are preserved exactly — only the changed line is touched', () => {
        const before = '---\r\ntype: agent\r\nindex: true\r\npaths: [src]\r\n---\r\n\r\nBody.\r\n';
        const rewrite = planFrontmatterRewrite(before);
        assert.ok(rewrite);
        const after = applyFrontmatterRewrite(before, rewrite);
        assert.strictEqual(after, before.replace('type: agent', 'artifactType: AIAgentsConfig'));
    });

    test('a frontmatter block with no trailing newline after the closing fence rewrites cleanly', () => {
        const before = '---\ntype: snippet\n---';
        const rewrite = planFrontmatterRewrite(before);
        assert.ok(rewrite);
        const after = applyFrontmatterRewrite(before, rewrite);
        assert.strictEqual(after, before.replace('type: snippet', 'artifactType: Snippet'));
        assert.strictEqual(after, '---\nartifactType: Snippet\n---');
    });

    test('applyFrontmatterRewrite is a no-op when the planned line is no longer present', () => {
        const content = '---\ntype: snippet\n---\nbody';
        const stale = { oldLine: 'type: command', newLine: 'artifactType: Command' };
        assert.strictEqual(applyFrontmatterRewrite(content, stale), content);
    });
});

// ── explainUnrecognisedFrontmatter — Finding 4, the reporting gap ──────────

suite('planMigration — skipped (unrecognised, not "nothing to do")', () => {
    let vaultRoot: string;

    setup(() => { vaultRoot = mkTempVault(); });
    teardown(() => { rmTempVault(vaultRoot); });

    test('a BOM before the frontmatter fence is reported as skipped, not silently ignored', () => {
        const filePath = path.join(vaultRoot, getEntry('Snippet').dir, 'bom.md');
        writeFile(filePath, '\uFEFF---\ntype: snippet\n---\nbody');
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.changes.length, 0);
        assert.strictEqual(plan.skipped.length, 1);
        assert.match(plan.skipped[0].reason, /byte-order mark/);
    });

    test('a blank line before the frontmatter fence is reported as skipped', () => {
        const filePath = path.join(vaultRoot, getEntry('Command').dir, 'blank.md');
        writeFile(filePath, '\n---\ntype: command\n---\nbody');
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.skipped.length, 1);
        assert.match(plan.skipped[0].reason, /blank line/);
    });

    test('a quoted type: value is reported as skipped', () => {
        const filePath = path.join(vaultRoot, getEntry('Template').dir, 'quoted.md');
        writeFile(filePath, '---\ntype: "template"\n---\nbody');
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.skipped.length, 1);
        assert.match(plan.skipped[0].reason, /quoted/);
    });

    test('an ordinary file with no type: key at all is not reported as skipped', () => {
        const filePath = path.join(vaultRoot, getEntry('Command').dir, 'plain.md');
        writeFile(filePath, '## heading\n```bash\necho hi\n```\n');
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.changes.length, 0);
        assert.strictEqual(plan.skipped.length, 0);
    });
});

// ── planMigration / applyMigration — filesystem layer ───────────────────────

suite('planMigration + applyMigration', () => {
    let vaultRoot: string;

    setup(() => {
        vaultRoot = mkTempVault();
    });

    teardown(() => {
        rmTempVault(vaultRoot);
    });

    test('finds legacy files across the ARTIFACTS directories, including nested subdirectories', () => {
        writeFile(path.join(vaultRoot, getEntry('Snippet').dir, 'a.md'), '---\ntype: snippet\n---\nbody');
        writeFile(
            path.join(vaultRoot, getEntry('AIAgentsConfig').dir, 'ai-harness', 'Template Index.md'),
            '---\ntype: agent\nindex: true\npaths: [src]\n---\nbody',
        );
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.changes.length, 2);
        assert.ok(plan.changes.some(c => c.relativePath === path.join(getEntry('Snippet').dir, 'a.md')));
        assert.ok(plan.changes.some(c => c.newLine === 'artifactType: AIAgentsConfig'));
    });

    test('a directory outside ARTIFACTS is out of scope by construction', () => {
        writeFile(path.join(vaultRoot, 'DBs', 'notes.md'), '---\ntype: snippet\n---\nbody');
        const plan = planMigration(vaultRoot);
        assert.strictEqual(plan.changes.length, 0);
    });

    test('dry run writes nothing to disk', () => {
        const filePath = path.join(vaultRoot, getEntry('Command').dir, 'deploy.md');
        const before = '---\ntype: command\n---\necho hi';
        writeFile(filePath, before);
        planMigration(vaultRoot);
        assert.strictEqual(fs.readFileSync(filePath, 'utf8'), before);
    });

    test('apply rewrites the file on disk', () => {
        const filePath = path.join(vaultRoot, getEntry('Template').dir, 't.md');
        writeFile(filePath, '---\ntype: template\n---\nbody');
        const plan = planMigration(vaultRoot);
        const result = applyMigration(plan);
        assert.strictEqual(result.changedFiles.length, 1);
        assert.strictEqual(fs.readFileSync(filePath, 'utf8'), '---\nartifactType: Template\n---\nbody');
    });

    test('idempotent: a second plan after apply reports zero changes (apply is then a no-op)', () => {
        const filePath = path.join(vaultRoot, getEntry('Variables').dir, 'v.md');
        writeFile(filePath, '---\ntype: variables\n---\nbody');

        const firstPlan = planMigration(vaultRoot);
        assert.strictEqual(firstPlan.changes.length, 1);
        applyMigration(firstPlan);

        const secondPlan = planMigration(vaultRoot);
        assert.strictEqual(secondPlan.changes.length, 0);
        const secondApply = applyMigration(secondPlan);
        assert.strictEqual(secondApply.changedFiles.length, 0);
    });

    // ── (a) hostile: a symlink escaping the vault root is refused, not sanitised ──

    test('(a) a symlink pointing outside the vault root is refused, never followed', function () {
        const outside = mkTempVault();
        try {
            writeFile(path.join(outside, 'evil.md'), '---\ntype: snippet\n---\nevil body');

            const snippetsDir = path.join(vaultRoot, getEntry('Snippet').dir);
            fs.mkdirSync(snippetsDir, { recursive: true });
            try {
                fs.symlinkSync(outside, path.join(snippetsDir, 'escape-link'));
            } catch {
                // Symlink creation can fail without elevated privileges on some
                // CI runners — skip rather than false-fail on an environment gap.
                this.skip();
                return;
            }

            const plan = planMigration(vaultRoot);
            assert.strictEqual(plan.changes.length, 0, 'the file reached only via the escaping symlink must not appear in the plan');
        } finally {
            rmTempVault(outside);
        }
    });
});
