import * as assert from 'node:assert';
import {
    validateArtifactFilename,
    validateFolderName,
    slugify,
    deriveFileName,
} from '../src/services/filename.service.js';

/**
 * Unit tests for filename / folder-name validation + slug derivation.
 *
 * Pure service — no VS Code API. Used by the create-form panel for file-name
 * input live-validation and by the destination folder picker for new-folder
 * names. Rules are per `ARTIFACT_FORM_PLAN.md` §5.
 */
suite('filename.service', () => {

    // ── validateArtifactFilename ─────────────────────────────────────────────

    suite('validateArtifactFilename', () => {
        test('plain ASCII name → ok', () => {
            assert.strictEqual(validateArtifactFilename('express-route').ok, true);
        });

        test('unicode name → ok (Obsidian supports them)', () => {
            assert.strictEqual(validateArtifactFilename('café-utils').ok, true);
        });

        test('empty string → reject', () => {
            assert.strictEqual(validateArtifactFilename('').ok, false);
        });

        test('whitespace-only → reject', () => {
            assert.strictEqual(validateArtifactFilename('   ').ok, false);
        });

        test('illegal char / → reject', () => {
            assert.strictEqual(validateArtifactFilename('a/b').ok, false);
        });

        test('illegal char \\ → reject', () => {
            assert.strictEqual(validateArtifactFilename('a\\b').ok, false);
        });

        test('illegal char : → reject', () => {
            assert.strictEqual(validateArtifactFilename('a:b').ok, false);
        });

        test('illegal chars * ? " < > | → reject', () => {
            for (const ch of ['*', '?', '"', '<', '>', '|']) {
                assert.strictEqual(validateArtifactFilename(`a${ch}b`).ok, false, `expected reject for ${ch}`);
            }
        });

        test('ASCII control char → reject', () => {
            assert.strictEqual(validateArtifactFilename('a\x01b').ok, false);
        });

        test('leading dot → reject', () => {
            assert.strictEqual(validateArtifactFilename('.hidden').ok, false);
        });

        test('trailing dot → reject', () => {
            assert.strictEqual(validateArtifactFilename('name.').ok, false);
        });

        test('leading space → reject', () => {
            assert.strictEqual(validateArtifactFilename(' name').ok, false);
        });

        test('trailing space → reject', () => {
            assert.strictEqual(validateArtifactFilename('name ').ok, false);
        });

        test('reserved name CON (uppercase) → reject', () => {
            assert.strictEqual(validateArtifactFilename('CON').ok, false);
        });

        test('reserved name con (lowercase) → reject', () => {
            assert.strictEqual(validateArtifactFilename('con').ok, false);
        });

        test('reserved name Con (mixed case) → reject', () => {
            assert.strictEqual(validateArtifactFilename('Con').ok, false);
        });

        test('reserved name COM1 → reject', () => {
            assert.strictEqual(validateArtifactFilename('COM1').ok, false);
        });

        test('reserved name LPT9 → reject', () => {
            assert.strictEqual(validateArtifactFilename('LPT9').ok, false);
        });

        test('reserved-name prefix only (CONsole) → ok', () => {
            assert.strictEqual(validateArtifactFilename('CONsole').ok, true);
        });

        test('.md extension typed (lowercase) → reject (caller appends)', () => {
            assert.strictEqual(validateArtifactFilename('foo.md').ok, false);
        });

        test('.MD extension typed (uppercase) → reject', () => {
            assert.strictEqual(validateArtifactFilename('foo.MD').ok, false);
        });

        test('.Md extension typed (mixed) → reject', () => {
            assert.strictEqual(validateArtifactFilename('foo.Md').ok, false);
        });

        test('reject returns user-facing reason string', () => {
            const r = validateArtifactFilename('a/b');
            assert.strictEqual(r.ok, false);
            assert.ok(r.reason && r.reason.length > 0);
        });
    });

    // ── validateFolderName ───────────────────────────────────────────────────

    suite('validateFolderName', () => {
        test('plain ASCII → ok', () => {
            assert.strictEqual(validateFolderName('Web').ok, true);
        });

        test('unicode → ok', () => {
            assert.strictEqual(validateFolderName('café').ok, true);
        });

        test('empty → reject', () => {
            assert.strictEqual(validateFolderName('').ok, false);
        });

        test('dot . → reject (traversal)', () => {
            assert.strictEqual(validateFolderName('.').ok, false);
        });

        test('dot-dot .. → reject (traversal)', () => {
            assert.strictEqual(validateFolderName('..').ok, false);
        });

        test('contains / → reject (nested path)', () => {
            assert.strictEqual(validateFolderName('a/b').ok, false);
        });

        test('contains \\ → reject (nested path)', () => {
            assert.strictEqual(validateFolderName('a\\b').ok, false);
        });

        test('illegal char : → reject', () => {
            assert.strictEqual(validateFolderName('a:b').ok, false);
        });

        test('reserved name CON → reject', () => {
            assert.strictEqual(validateFolderName('CON').ok, false);
        });

        test('reserved name LPT3 → reject', () => {
            assert.strictEqual(validateFolderName('lpt3').ok, false);
        });

        test('leading dot → reject', () => {
            assert.strictEqual(validateFolderName('.hidden').ok, false);
        });

        test('trailing space → reject', () => {
            assert.strictEqual(validateFolderName('name ').ok, false);
        });

        test('folder named foo.md → ok (no .md rejection for folders)', () => {
            assert.strictEqual(validateFolderName('foo.md').ok, true);
        });
    });

    // ── slugify ──────────────────────────────────────────────────────────────

    suite('slugify', () => {
        test('Hello World → hello-world', () => {
            assert.strictEqual(slugify('Hello World'), 'hello-world');
        });

        test('punctuation collapses to single dash', () => {
            assert.strictEqual(slugify('Hello World!!'), 'hello-world');
        });

        test('multiple internal runs collapse to single dash', () => {
            assert.strictEqual(slugify('foo   bar___baz'), 'foo-bar-baz');
        });

        test('leading / trailing dashes stripped', () => {
            assert.strictEqual(slugify('---hello---'), 'hello');
        });

        test('whitespace-only → empty string', () => {
            assert.strictEqual(slugify('   '), '');
        });

        test('alphanumeric preserved', () => {
            assert.strictEqual(slugify('Phase 0.5'), 'phase-0-5');
        });

        test('unicode reduced to dashes (ASCII slug)', () => {
            // No transliteration — non-[a-z0-9] runs become a single dash.
            assert.strictEqual(slugify('café'), 'caf');
        });

        // ── Relocated from block-edit-helpers.test.ts ─────────────────────────
        // These covered `blockEditor.helpers.slug`, a byte-identical third copy
        // deleted in Phase 1 of the services-dry refactor. Kept verbatim so the
        // surviving implementation still answers for every case the copy did.

        test('lowercases and hyphenates spaced words', () => {
            assert.strictEqual(slugify('My Snippet Title'), 'my-snippet-title');
        });

        test('strips punctuation', () => {
            assert.strictEqual(slugify('Hello, World!'), 'hello-world');
        });

        test('trims and collapses surrounding whitespace', () => {
            assert.strictEqual(slugify('  Trim  Me  '), 'trim-me');
        });

        test('leaves an already-slugged string unchanged', () => {
            assert.strictEqual(slugify('already-slug'), 'already-slug');
        });

        // ── Relocated from varSetController's private slugify ─────────────────
        // Its empty-input fallback ('untitled-variable-set') now lives at the
        // call site, so the shared function's contract is: empty in, empty out.

        test('punctuation-only title yields an empty slug (caller supplies the fallback)', () => {
            assert.strictEqual(slugify('!!!'), '');
        });

        test('Local Development! → local-development', () => {
            assert.strictEqual(slugify('Local Development!'), 'local-development');
        });
    });

    // ── deriveFileName ───────────────────────────────────────────────────────

    suite('deriveFileName', () => {
        test('valid title slugifies', () => {
            assert.strictEqual(deriveFileName('My New Snippet'), 'my-new-snippet');
        });

        test('empty title → untitled', () => {
            assert.strictEqual(deriveFileName(''), 'untitled');
        });

        test('whitespace-only title → untitled', () => {
            assert.strictEqual(deriveFileName('   '), 'untitled');
        });

        test('title that slugifies to empty → untitled', () => {
            assert.strictEqual(deriveFileName('!!!'), 'untitled');
        });
    });
});
