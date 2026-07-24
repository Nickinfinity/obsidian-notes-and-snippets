import { ARTIFACTS } from '../types/constants.js';
import type { Artifact, ArtifactTypeFormConfig, LanguageMode } from '../types/artifact.types.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';

/**
 * Locates the `ARTIFACTS` entry for a given type literal.
 *
 * **This is the only place that traverses `ARTIFACTS` by type.** Six other call
 * sites used to open-code `ARTIFACTS.find(a => a.type === …)` — including one
 * that re-threw a character-identical error message — so this is enforced by
 * `test/artifact-type-config.test.ts` rather than asserted in prose.
 *
 * Throws on miss so a caller passing an unrecognised type fails loudly instead
 * of silently receiving `undefined`.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns The matching `Artifact` entry.
 * @throws When no entry has a matching `type` field.
 *
 * @example
 * getEntry('snippet'); // → { type: 'snippet', dir: 'Snippets', form: { ... }, ... }
 * getEntry('snippet').dir; // → 'Snippets'
 */
export function getEntry(type: ArtifactType): Artifact {
    const entry = ARTIFACTS.find(e => e.type === type);
    if (!entry) {
        throw new Error(`Unknown artifact type: ${type}`);
    }
    return entry;
}

/**
 * Returns the per-type form configuration for a create-form-enabled type.
 *
 * Throws when the requested type is not create-form-enabled (e.g.
 * `variables`) — the form UI should never reach this code path
 * for an excluded type. Use `getCreateFormTypes()` to drive the type picker
 * so excluded types are never offered.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns The `ArtifactTypeFormConfig` for the type.
 * @throws When the type is unknown or `createForm !== true`.
 *
 * @example
 * getFormConfig('command'); // → { language: { mode: 'locked', default: 'bash' }, label: { singular: 'command' }, multiBlock: true }
 */
export function getFormConfig(type: ArtifactType): ArtifactTypeFormConfig {
    const entry = getEntry(type);
    if (entry.createForm !== true || !entry.form) {
        throw new Error(`Artifact type "${type}" is not create-form-enabled`);
    }
    return entry.form;
}

/**
 * Returns the language-selector mode (`free` | `locked` | `hidden`) for a
 * create-form-enabled type.
 *
 * Drives whether the form renders an enabled dropdown, a disabled pre-filled
 * field, or no language field at all.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns The `LanguageMode` for the type.
 * @throws When the type is not create-form-enabled.
 *
 * @example
 * getLanguageMode('snippet'); // → 'free'
 * getLanguageMode('command'); // → 'locked'
 */
export function getLanguageMode(type: ArtifactType): LanguageMode {
    return getFormConfig(type).language.mode;
}

/**
 * Returns the default language for a create-form-enabled type.
 *
 * For `locked` mode this is the serializer's emitted language (e.g. `bash`
 * for `command`). For `free` mode this is the language new blocks start
 * with (`''` for plain text on `snippet`). For `hidden` mode this is the
 * fence info-string the serializer emits unconditionally.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns The default language string (may be empty).
 * @throws When the type is not create-form-enabled.
 *
 * @example
 * getDefaultLanguage('command'); // → 'bash'
 * getDefaultLanguage('snippet'); // → ''
 */
export function getDefaultLanguage(type: ArtifactType): string {
    return getFormConfig(type).language.default ?? '';
}

/**
 * Returns the singular noun label for a create-form-enabled type.
 *
 * Drives dynamic UI strings such as `+ Add additional <singular>`,
 * `× This <singular> block will be deleted`, and `Delete entire <singular>`.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns The singular noun (e.g. `'snippet'`, `'command'`).
 * @throws When the type is not create-form-enabled.
 *
 * @example
 * getTypeSingular('snippet'); // → 'snippet'
 */
export function getTypeSingular(type: ArtifactType): string {
    return getFormConfig(type).label.singular;
}

/**
 * Returns whether a create-form-enabled type allows multiple blocks.
 *
 * `true` → the form renders the `+ Add additional <singular>` button.
 * `false` → single block forced; `+` and per-block `×` buttons never render.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns `true` when multi-block is allowed.
 * @throws When the type is not create-form-enabled.
 *
 * @example
 * canMultiBlock('snippet'); // → true
 */
export function canMultiBlock(type: ArtifactType): boolean {
    return getFormConfig(type).multiBlock;
}

/**
 * Returns every artifact type declared in `ARTIFACTS`, in declaration order.
 *
 * The parser uses this to decide which frontmatter `type:` values are valid,
 * so a type added to `ARTIFACTS` is accepted immediately. Before this existed
 * the parser carried its own hardcoded list and silently downgraded any type
 * missing from it to `'snippet'`.
 *
 * @returns Array of every `ArtifactType` literal.
 *
 * @example
 * getAllTypes(); // → ['snippet', 'agent', 'command', 'template', 'variables']
 */
export function getAllTypes(): ArtifactType[] {
    return ARTIFACTS.map(e => e.type);
}

/**
 * Returns the list of types that surface in the create-flow type picker.
 *
 * Derived from `ARTIFACTS` — any entry with `createForm === true` is
 * included. Adding a new create-form type is a `constants.ts` change only;
 * downstream pickers and tests pick it up automatically.
 *
 * @returns Array of `ArtifactType` literals (order matches `ARTIFACTS` order).
 *
 * @example
 * getCreateFormTypes(); // → ['snippet', 'agent', 'command', 'template']
 */
export function getCreateFormTypes(): ArtifactType[] {
    return ARTIFACTS.filter(e => e.createForm === true).map(e => e.type);
}

/**
 * Reports whether invoking this artifact type writes a whole file into the
 * workspace (the Explorer "Create File" flow) instead of inserting at the cursor.
 *
 * Two types write files today: `template` (filename from the D3
 * extension-precedence chain) and `agent` (filename seeded from the `target:`
 * frontmatter key, e.g. `CLAUDE.md`). Every other type inserts at the cursor or
 * sends to the terminal.
 *
 * **Derived from `ARTIFACTS.writesFile`, never a type-literal check** — a
 * hardcoded `type === 'template' || type === 'agent'` is the enumeration class
 * that silently drifts when a third file-writing type is added.
 *
 * **Single source for the behaviour** — the preview's primary-button label
 * (`Create File` vs `Insert`) and the insert handler's write-vs-paste branch both
 * call this, so they can never disagree. Guarded by `artifact-type-config.test.ts`.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns `true` for `template` and `agent`; `false` otherwise.
 * @throws When the type is unknown (via `getEntry`).
 *
 * @example
 * writesWholeFile('template'); // → true
 * writesWholeFile('agent');    // → true
 * writesWholeFile('snippet');  // → false
 */
export function writesWholeFile(type: ArtifactType): boolean {
    return getEntry(type).writesFile === true;
}

/**
 * Reports whether a type is restricted to a single code block (D1).
 *
 * Derived from the same `form.multiBlock` flag `canMultiBlock` reads, but
 * **non-throwing**: types with no create form (`variables`) answer `false`, so
 * navigation code can ask about any parsed file without a try/catch.
 *
 * The picker uses it to route a malformed 2+ block template to the single
 * preview, where the Create File handler surfaces the D1 error.
 *
 * @param type - Canonical `ArtifactType` literal.
 * @returns `true` only when the type declares `form.multiBlock === false`.
 * @throws When the type is unknown (via `getEntry`) — a *missing form* is not an error.
 *
 * @example
 * forcesSingleBlock('template');  // → true
 * forcesSingleBlock('agent');     // → false
 * forcesSingleBlock('variables'); // → false — no form config, no throw
 */
export function forcesSingleBlock(type: ArtifactType): boolean {
    return getEntry(type).form?.multiBlock === false;
}

/**
 * Resolves the artifact type that owns a vault directory name.
 *
 * The directory is the type declaration for files that carry no frontmatter —
 * a real vault `Commands/` file usually starts straight at `## heading`, and
 * the user already declared its kind by filing it there. `ARTIFACTS` treats the
 * directory as authoritative for menus, context keys and command registration;
 * this makes parsing agree with them.
 *
 * @param dirName - Bare directory name as it appears in the vault (e.g. `'Commands'`). Case-insensitive.
 * @returns The owning `ArtifactType`, or `undefined` when no entry claims that directory.
 *
 * @example
 * getTypeForDir('Commands'); // → 'command'
 * getTypeForDir('Whatever'); // → undefined
 */
export function getTypeForDir(dirName: string): ArtifactType | undefined {
    const target = dirName.toLowerCase();
    return ARTIFACTS.find(a => a.dir.toLowerCase() === target)?.type;
}
