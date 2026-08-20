import { VK_TOKEN_RE } from './parser.service.js';
import type { ArtifactFormModel, ArtifactFormBlock } from '../types/artifact-form.types.js';
import type { ParsedVar } from '../types/parsed-artifact.types.js';

/**
 * Pure, `vscode`-free mutators for the Variables create/edit form model
 * (T14, VSX-217).
 *
 * Every mutator's first parameter and return type is `ArtifactFormModel` —
 * never `ParsedArtifactFile` — and none mutates its input: each call builds a
 * new `blocks` array plus a new `vars` array on the one touched block, while
 * every untouched block/vars array stays shared by reference with the
 * original model (ARTIFACT_FILE_FORMAT.md §3, §6).
 *
 * One sub-set = one `ArtifactFormBlock`; its `heading` is the sub-set's
 * identity, its `vars` the `<VK-xxx>` entries. A variable's `name` is the
 * **full token without angle brackets** — `'VK-host'`, never `'<VK-host>'`
 * or `'host'` (§4) — validated against `VK_TOKEN_RE`'s hint rule, imported
 * from `parser.service.ts` rather than re-spelled here.
 */

/**
 * Reports whether `name` is a legal `<VK-xxx>` variable name — the bare
 * `VK-hint` spelling with no angle brackets, matching `VK_TOKEN_RE`'s hint
 * rule (`[A-Za-z]\w*` after the `VK-` prefix).
 *
 * Wraps the candidate as an opening tag and matches it against the shared
 * `VK_TOKEN_RE` — via `matchAll`, which resets `lastIndex` itself — rather
 * than re-spelling the hint pattern locally, so the two rules can never drift.
 *
 * @param name - Candidate bare variable name (no angle brackets).
 * @returns `true` when wrapping `name` in `<...>` yields exactly one token
 * spanning the whole wrapped string.
 *
 * @example
 * isValidVarName('VK-host')   // → true
 * isValidVarName('nope')      // → false — missing the VK- prefix
 * isValidVarName('VK-')       // → false — empty hint
 * isValidVarName('VK-1abc')   // → false — hint must start with a letter
 */
function isValidVarName(name: string): boolean {
    const wrapped = `<${name}>`;
    const matches = [...wrapped.matchAll(VK_TOKEN_RE)];
    return matches.length === 1 && matches[0][0] === wrapped;
}

/**
 * Throws when `name` fails the `VK-xxx` hint rule.
 *
 * @param name - Candidate bare variable name.
 * @returns void
 * @throws {Error} When `isValidVarName(name)` is `false`.
 *
 * @example
 * assertValidVarName('VK-host'); // ok
 * assertValidVarName('nope');    // throws
 */
function assertValidVarName(name: string): void {
    if (!isValidVarName(name)) {
        throw new Error(`Invalid variable name "${name}": must be a VK-xxx token (e.g. "VK-host").`);
    }
}

/**
 * Finds a sub-set's index by heading.
 *
 * @param model   - Model to search.
 * @param heading - Sub-set heading to find (`''` for a single-block file's sole block).
 * @returns The matching block's index.
 * @throws {Error} When no block carries `heading`.
 *
 * @example
 * findSubSetIndex(model, 'Development')
 */
function findSubSetIndex(model: ArtifactFormModel, heading: string): number {
    const index = model.blocks.findIndex(b => b.heading === heading);
    if (index === -1) {
        throw new Error(`Sub-set not found: "${heading}".`);
    }
    return index;
}

/**
 * Builds a new model with `blocks[index]` replaced by `block`. Every other
 * block stays shared by reference with `model` — only the touched block and
 * the top-level `blocks` array are new.
 *
 * @param model - Source model (never mutated).
 * @param index - Index of the block to replace.
 * @param block - Replacement block.
 * @returns New `ArtifactFormModel` with the one block swapped in.
 *
 * @example
 * withBlock(model, 0, { ...model.blocks[0], vars: [] })
 */
function withBlock(model: ArtifactFormModel, index: number, block: ArtifactFormBlock): ArtifactFormModel {
    const blocks = model.blocks.slice();
    blocks[index] = block;
    return { ...model, blocks };
}

/**
 * Adds a new variable to a sub-set.
 *
 * @param model         - Source model (never mutated).
 * @param subSetHeading - Heading of the target sub-set.
 * @param name          - Full `VK-xxx` token name, no angle brackets.
 * @param defaultValue  - Default value stored for the new var.
 * @returns New model with the var appended to the sub-set's `vars`.
 * @throws {Error} When `subSetHeading` has no matching block, `name` fails
 * the `VK-` hint rule, or `name` already exists in that sub-set.
 *
 * @example
 * addVar(model, 'Development', 'VK-port', '3000')
 */
export function addVar(
    model: ArtifactFormModel,
    subSetHeading: string,
    name: string,
    defaultValue: string,
): ArtifactFormModel {
    assertValidVarName(name);
    const index = findSubSetIndex(model, subSetHeading);
    const block = model.blocks[index];
    if (block.vars.some(v => v.name === name)) {
        throw new Error(`Variable "${name}" already exists in sub-set "${subSetHeading}".`);
    }
    const vars: ParsedVar[] = [...block.vars, { name, defaultValue }];
    return withBlock(model, index, { ...block, vars });
}

/**
 * Renames a variable within a sub-set, preserving its current value.
 *
 * @param model         - Source model (never mutated).
 * @param subSetHeading - Heading of the target sub-set.
 * @param oldName       - Current full token name.
 * @param newName       - New full token name.
 * @returns New model with the var renamed.
 * @throws {Error} When the sub-set or `oldName` is not found, `newName` fails
 * the `VK-` hint rule, or `newName` collides with another var in the sub-set.
 *
 * @example
 * renameVar(model, 'Development', 'VK-host', 'VK-hostname')
 */
export function renameVar(
    model: ArtifactFormModel,
    subSetHeading: string,
    oldName: string,
    newName: string,
): ArtifactFormModel {
    assertValidVarName(newName);
    const index = findSubSetIndex(model, subSetHeading);
    const block = model.blocks[index];
    const varIndex = block.vars.findIndex(v => v.name === oldName);
    if (varIndex === -1) {
        throw new Error(`Variable "${oldName}" not found in sub-set "${subSetHeading}".`);
    }
    if (newName !== oldName && block.vars.some(v => v.name === newName)) {
        throw new Error(`Variable "${newName}" already exists in sub-set "${subSetHeading}".`);
    }
    const vars = block.vars.slice();
    vars[varIndex] = { ...vars[varIndex], name: newName };
    return withBlock(model, index, { ...block, vars });
}

/**
 * Sets a variable's default value, leaving its name unchanged.
 *
 * @param model         - Source model (never mutated).
 * @param subSetHeading - Heading of the target sub-set.
 * @param name          - Full token name of the variable to update.
 * @param value         - New default value.
 * @returns New model with the var's value updated.
 * @throws {Error} When the sub-set or `name` is not found.
 *
 * @example
 * setVarValue(model, 'Development', 'VK-host', 'localhost')
 */
export function setVarValue(
    model: ArtifactFormModel,
    subSetHeading: string,
    name: string,
    value: string,
): ArtifactFormModel {
    const index = findSubSetIndex(model, subSetHeading);
    const block = model.blocks[index];
    const varIndex = block.vars.findIndex(v => v.name === name);
    if (varIndex === -1) {
        throw new Error(`Variable "${name}" not found in sub-set "${subSetHeading}".`);
    }
    const vars = block.vars.slice();
    vars[varIndex] = { ...vars[varIndex], defaultValue: value };
    return withBlock(model, index, { ...block, vars });
}

/**
 * Deletes a variable from a sub-set.
 *
 * @param model         - Source model (never mutated).
 * @param subSetHeading - Heading of the target sub-set.
 * @param name          - Full token name of the variable to delete.
 * @returns New model with the var removed from the sub-set's `vars`.
 * @throws {Error} When the sub-set or `name` is not found.
 *
 * @example
 * deleteVar(model, 'Development', 'VK-host')
 */
export function deleteVar(model: ArtifactFormModel, subSetHeading: string, name: string): ArtifactFormModel {
    const index = findSubSetIndex(model, subSetHeading);
    const block = model.blocks[index];
    if (!block.vars.some(v => v.name === name)) {
        throw new Error(`Variable "${name}" not found in sub-set "${subSetHeading}".`);
    }
    const vars = block.vars.filter(v => v.name !== name);
    return withBlock(model, index, { ...block, vars });
}

/**
 * Adds a new, empty sub-set (an `ArtifactFormBlock` with no vars).
 *
 * @param model   - Source model (never mutated).
 * @param heading - Heading for the new sub-set; must be non-empty and unique.
 * @returns New model with the sub-set appended.
 * @throws {Error} When `heading` is empty/whitespace-only or already used by
 * another block in `model`.
 *
 * @example
 * addSubSet(model, 'Production')
 */
export function addSubSet(model: ArtifactFormModel, heading: string): ArtifactFormModel {
    if (heading.trim().length === 0) {
        throw new Error('Sub-set heading cannot be empty.');
    }
    if (model.blocks.some(b => b.heading === heading)) {
        throw new Error(`Sub-set "${heading}" already exists.`);
    }
    const newBlock: ArtifactFormBlock = { heading, description: '', language: '', code: '', vars: [] };
    return { ...model, blocks: [...model.blocks, newBlock] };
}

/**
 * Renames a sub-set's heading.
 *
 * @param model      - Source model (never mutated).
 * @param oldHeading - Current heading of the sub-set to rename.
 * @param newHeading - New heading; must be non-empty and unique.
 * @returns New model with the sub-set's heading changed.
 * @throws {Error} When `oldHeading` has no matching block, `newHeading` is
 * empty/whitespace-only, or `newHeading` collides with another block.
 *
 * @example
 * renameSubSet(model, 'Development', 'Dev')
 */
export function renameSubSet(model: ArtifactFormModel, oldHeading: string, newHeading: string): ArtifactFormModel {
    if (newHeading.trim().length === 0) {
        throw new Error('Sub-set heading cannot be empty.');
    }
    const index = findSubSetIndex(model, oldHeading);
    if (newHeading !== oldHeading && model.blocks.some(b => b.heading === newHeading)) {
        throw new Error(`Sub-set "${newHeading}" already exists.`);
    }
    return withBlock(model, index, { ...model.blocks[index], heading: newHeading });
}

/**
 * Deletes a sub-set. Refuses to delete the last remaining sub-set in a
 * file — removing the file itself is a separate, confirmed command.
 *
 * @param model   - Source model (never mutated).
 * @param heading - Heading of the sub-set to delete.
 * @returns New model with the sub-set removed.
 * @throws {Error} When `heading` has no matching block, or it is the model's
 * only sub-set.
 *
 * @example
 * deleteSubSet(model, 'Production')
 */
export function deleteSubSet(model: ArtifactFormModel, heading: string): ArtifactFormModel {
    const index = findSubSetIndex(model, heading);
    if (model.blocks.length === 1) {
        throw new Error('Cannot delete the last sub-set of a file — delete the file instead.');
    }
    return { ...model, blocks: model.blocks.filter((_block, i) => i !== index) };
}
