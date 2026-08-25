import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Guards T22's narrow-pane sheet (VSX-223).
 *
 * The file-existence check is the actual gate: it fails until
 * `src/ui/main-view.css` exists, and it is what makes
 * `npx vsce ls --no-dependencies | grep -E 'src/ui/.*\.(css|ttf)'` print 10
 * matched lines instead of 9 (see CLAUDE.md's packaging check — the
 * `(css|ttf)` form is canonical: a sheet-only grep can't see a missing
 * `codicon.ttf`, which ships a pane of tofu boxes with no error).
 *
 * The colour-literal check pins the "both themes work untouched" contract —
 * every colour must route through a `var(--vscode-…)` token, never a hex
 * literal, or dark/light parity silently breaks.
 */
suite('main-view.css — narrow-pane sheet (T22, VSX-223)', () => {

    test('src/ui/main-view.css exists', () => {
        const dir = path.join(__dirname, '..', '..', 'src', 'ui');
        assert.ok(fs.readdirSync(dir).includes('main-view.css'));
    });

    test('declares no colour literal — every colour is a var(--vscode-…) token', () => {
        const sheet = fs.readFileSync(
            path.join(__dirname, '..', '..', 'src', 'ui', 'main-view.css'),
            'utf8',
        );
        assert.strictEqual(/#[0-9a-fA-F]{3,8}\b/.exec(sheet), null);
    });
});
