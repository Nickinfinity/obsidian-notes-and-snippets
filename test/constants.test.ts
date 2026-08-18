import * as assert from 'node:assert';
import { ARTIFACTS } from '../src/types/constants.js';
import { getAllTypes } from '../src/services/artifact-type-config.service.js';
import { parseFromContent } from '../src/services/parser.service.js';
import type { ArtifactType } from '../src/types/parsed-artifact.types.js';

/**
 * Unit tests for the per-type form configuration carried on ARTIFACTS entries.
 *
 * Phase 0.5 of the artifact-form feature requires each entry to advertise:
 *   - `type: ArtifactType` — direct lookup key (replaces dir.toLowerCase() parsing)
 *   - `createForm?: boolean` — gates the create-flow type picker
 *   - `form?: ArtifactTypeFormConfig` — language mode/default, label.singular, multiBlock
 *
 * See ARTIFACT_FORM_PLAN.md §1.6 for the full spec.
 */
suite('ARTIFACTS per-type form config', () => {

    function findByType(t: ArtifactType) {
        return ARTIFACTS.find(a => a.type === t);
    }

    // ── type field present on every entry ────────────────────────────────────

    test('every entry has a typed `type` field', () => {
        for (const entry of ARTIFACTS) {
            assert.ok(typeof entry.type === 'string' && entry.type.length > 0,
                `ARTIFACTS entry ${entry.dir} missing type literal`);
        }
    });

    test('snippet entry exists with type Snippet', () => {
        assert.ok(findByType('Snippet'), 'no ARTIFACTS entry with type === "Snippet"');
    });

    test('command entry exists with type Command', () => {
        assert.ok(findByType('Command'), 'no ARTIFACTS entry with type === "Command"');
    });

    // ── snippet form config ──────────────────────────────────────────────────

    test('snippet: createForm === true', () => {
        assert.strictEqual(findByType('Snippet')!.createForm, true);
    });

    test('snippet: form.language.mode === free', () => {
        assert.strictEqual(findByType('Snippet')!.form!.language.mode, 'free');
    });

    test('snippet: form.language.default === "" (plain text)', () => {
        assert.strictEqual(findByType('Snippet')!.form!.language.default, '');
    });

    test('snippet: form.label.singular === "snippet"', () => {
        assert.strictEqual(findByType('Snippet')!.form!.label.singular, 'snippet');
    });

    test('snippet: form.multiBlock === true', () => {
        assert.strictEqual(findByType('Snippet')!.form!.multiBlock, true);
    });

    // ── command form config ──────────────────────────────────────────────────

    test('command: createForm === true', () => {
        assert.strictEqual(findByType('Command')!.createForm, true);
    });

    test('command: form.language.mode === locked', () => {
        assert.strictEqual(findByType('Command')!.form!.language.mode, 'locked');
    });

    test('command: form.language.default === "bash"', () => {
        assert.strictEqual(findByType('Command')!.form!.language.default, 'bash');
    });

    test('command: form.label.singular === "command"', () => {
        assert.strictEqual(findByType('Command')!.form!.label.singular, 'command');
    });

    test('command: form.multiBlock === true', () => {
        assert.strictEqual(findByType('Command')!.form!.multiBlock, true);
    });

    // ── template form config (Templates-as-files) ────────────────────────────

    test('template: contexts === ["explorer"] (leaves the editor menu, D4)', () => {
        assert.deepStrictEqual(findByType('Template')!.contexts, ['explorer']);
    });

    test('template: createForm === true', () => {
        assert.strictEqual(findByType('Template')!.createForm, true);
    });

    test('template: form.language.mode === free', () => {
        assert.strictEqual(findByType('Template')!.form!.language.mode, 'free');
    });

    test('template: form.multiBlock === false (single-block only, D1)', () => {
        assert.strictEqual(findByType('Template')!.form!.multiBlock, false);
    });

    // ── agent form config (create-form + provider/model/version) ─────────────

    test('agent: createForm === true', () => {
        assert.strictEqual(findByType('AIAgentsConfig')!.createForm, true);
    });

    test('agent: form.language.mode === free', () => {
        assert.strictEqual(findByType('AIAgentsConfig')!.form!.language.mode, 'free');
    });

    test('agent: form.multiBlock === true (D4)', () => {
        assert.strictEqual(findByType('AIAgentsConfig')!.form!.multiBlock, true);
    });

    // ── whole-file types (template + agent share one flow) ───────────────────

    test('template: writesFile === true (Explorer Create File flow)', () => {
        assert.strictEqual(findByType('Template')!.writesFile, true);
    });

    test('agent: writesFile === true — same flow as template, target:-named', () => {
        assert.strictEqual(findByType('AIAgentsConfig')!.writesFile, true);
    });

    /**
     * The registry, not a service literal, decides who writes a file. Dropping
     * `writesFile` from a row must flip the behaviour (guarded downstream by
     * `artifact-type-config.test.ts`), and a cursor-insert type must never
     * acquire it by accident.
     */
    test('cursor-insert types declare no writesFile flag', () => {
        for (const type of ['Snippet', 'Command', 'Variables'] as const) {
            assert.notStrictEqual(findByType(type)!.writesFile, true,
                `${type} must not declare writesFile — it inserts, it does not write a file`);
        }
    });

    // ── excluded types: createForm !== true ──────────────────────────────────

    test('variables: createForm !== true (own save-as flow)', () => {
        assert.notStrictEqual(findByType('Variables')!.createForm, true);
    });

    // ── invariants ───────────────────────────────────────────────────────────

    test('every createForm === true entry has a form object', () => {
        for (const entry of ARTIFACTS) {
            if (entry.createForm === true) {
                assert.ok(entry.form, `entry ${entry.dir} has createForm but no form config`);
            }
        }
    });

    test('every entry with form defined has non-empty form.label.singular', () => {
        for (const entry of ARTIFACTS) {
            if (entry.form) {
                assert.ok(entry.form.label.singular.length > 0,
                    `entry ${entry.dir} form.label.singular is empty`);
            }
        }
    });

    test('every locked language mode has a non-empty default', () => {
        for (const entry of ARTIFACTS) {
            if (entry.form?.language.mode === 'locked') {
                assert.ok(entry.form.language.default !== undefined && entry.form.language.default.length > 0,
                    `entry ${entry.dir} is locked but has no language.default`);
            }
        }
    });
});

// ── Drift guard: ARTIFACTS ↔ parser (services-dry Phase 2) ───────────────────

/**
 * `parser.service.ts` used to carry its own hardcoded set of the five valid
 * `artifactType:` values. A type added to ARTIFACTS but missing from that list
 * was *silently* downgraded to 'Snippet' on parse — no error, no warning, just
 * wrong data. VALID_TYPES is now derived, and this suite is what keeps the two
 * bound: it fails loudly if any future change re-hardcodes the list.
 */
suite('ARTIFACTS ↔ parser type agreement', () => {

    /**
     * @example
     * parseFromContent('---\nartifactType: Variables\n---\n').frontmatter.artifactType === 'Variables'
     */
    test('the parser accepts every type declared in ARTIFACTS', () => {
        for (const entry of ARTIFACTS) {
            const parsed = parseFromContent(`---\nartifactType: ${entry.type}\n---\n`, '/v/x.md', '/v');
            assert.strictEqual(parsed.frontmatter.artifactType, entry.type,
                `parser rejected declared type '${entry.type}' and fell back to '${parsed.frontmatter.artifactType}'`);
        }
    });

    test('an undeclared type still falls back to the directory-derived default', () => {
        const parsed = parseFromContent('---\nartifactType: not-a-real-type\n---\n', '/v/x.md', '/v');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Snippet');
    });

    test('a legacy `type:` key is ignored entirely — never read as artifactType', () => {
        const parsed = parseFromContent('---\ntype: Command\n---\n', '/v/x.md', '/v');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Snippet');
    });

    test('a value differing only in case does not match — no case-insensitive fallback', () => {
        // '/vault/Commands' resolves a different directory-derived default ('Command')
        // than the hardcoded 'Snippet' fallback, so a case-insensitive bug (wrongly
        // accepting 'snippet' as 'Snippet') is distinguishable from correct behaviour.
        const parsed = parseFromContent('---\nartifactType: snippet\n---\n', '/vault/Commands/x.md', '/vault/Commands');
        assert.strictEqual(parsed.frontmatter.artifactType, 'Command');
    });

    test('getAllTypes covers ARTIFACTS exactly — no extras, no omissions', () => {
        assert.deepStrictEqual([...getAllTypes()].sort(), ARTIFACTS.map(e => e.type).sort());
    });
});
