import * as assert from 'node:assert';
import { getAllTypes, getFilenameField, writesWholeFile } from '../src/services/artifact-type-config.service.js';

/**
 * Drift guard binding `writesFile` to `outputNameKey` (ORCH-3, wave 3).
 *
 * A whole-file type decides its output filename from exactly one frontmatter
 * key — `target:` verbatim, or `extension:` through the D3 chain. A
 * `writesFile: true` row that forgets to declare which one does not fail: it
 * scaffolds **extension-less files**, silently, which is precisely how T11
 * shipped its first draft. The pairing is the invariant, so the pairing is
 * what gets asserted — for every type, not for the two that exist today.
 */
suite('outputNameKey ↔ writesFile', () => {
    test('a type declares an output-name key iff it writes a whole file', () => {
        for (const type of getAllTypes()) {
            assert.strictEqual(
                getFilenameField(type) !== undefined,
                writesWholeFile(type),
                `${type}: outputNameKey and writesFile disagree — a whole-file type must name the key that supplies its filename, and only a whole-file type may.`,
            );
        }
    });

    test('the two whole-file types name the keys their resolvers read', () => {
        assert.strictEqual(getFilenameField('AIAgentsConfig'), 'target');
        assert.strictEqual(getFilenameField('Template'), 'extension');
    });
});
