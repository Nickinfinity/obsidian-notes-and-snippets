import * as path from 'node:path';
import { mapLanguageId } from '../services/language-map.service.js';
import { getFilenameField } from '../services/artifact-type-config.service.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';
import type { ArtifactFormModel } from '../types/artifact-form.types.js';

// ── Pure prefill builders (exported for unit tests) ───────────────────────────
//
// `buildSnippetPrefill` and `buildCommandPrefill` were lifted verbatim from the
// former `create.command.ts`, which Wave 2 deleted — **this module is now their
// only home.** `test/selection-entry.helpers.test.ts` carries that file's
// original assertions unchanged; they are the golden net proving the move was a
// move and not a rewrite. This module is `vscode`-free by design.

/**
 * Builds a `Partial<ArtifactFormModel>` prefill for a snippet created from an
 * editor selection. The VS Code `languageId` is mapped to the conventional
 * fence info-string via `mapLanguageId` (e.g. `typescriptreact` → `tsx`).
 *
 * @param text       - Selected text to prefill as `blocks[0].code`.
 * @param languageId - `editor.document.languageId` from the active editor.
 * @returns Partial model with a single prefilled block.
 *
 * @example
 * buildSnippetPrefill('const x = 1;', 'typescriptreact')
 * // → { blocks: [{ heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [] }] }
 */
export function buildSnippetPrefill(text: string, languageId: string): Partial<ArtifactFormModel> {
    return {
        blocks: [{ heading: '', description: '', language: mapLanguageId(languageId), code: text, vars: [] }],
    };
}

/**
 * Builds a `Partial<ArtifactFormModel>` prefill for a command created from a
 * terminal selection or clipboard text. Language is always `''` — the command
 * type locks to `bash` at serialise time via `constants.ts`.
 *
 * @param text - Terminal selection or clipboard text to prefill as `blocks[0].code`.
 * @returns Partial model with a single prefilled block.
 *
 * @example
 * buildCommandPrefill('git status')
 * // → { blocks: [{ heading: '', description: '', language: '', code: 'git status', vars: [] }] }
 */
export function buildCommandPrefill(text: string): Partial<ArtifactFormModel> {
    return {
        blocks: [{ heading: '', description: '', language: '', code: text, vars: [] }],
    };
}

// ── Whole-file prefill ─────────────────────────────────────────────────────────

/**
 * Builds a `Partial<ArtifactFormModel>` prefill for a whole file dropped/opened
 * into the create flow (e.g. a workspace file offered as a `Template` or
 * `AIAgentsConfig` source).
 *
 * The file's basename and extension are read from `fileName` with Node's
 * `path` module, independent of any directory components the caller passes.
 * `languageId` only feeds the block's fence language via `mapLanguageId`; the
 * `target`/`extension` prefill is decided by `getFilenameField`, reading the
 * `outputNameKey` declared on the `ARTIFACTS` row — never the type literal.
 *
 * @param fileName   - Source file name or path (only the basename is used).
 * @param contents   - Full file contents to prefill as `blocks[0].code`.
 * @param languageId - `editor.document.languageId` (or equivalent) for the source file.
 * @param type       - Target artifact type chosen for the new artifact.
 * @returns Partial model with a single prefilled block, plus `target` or
 *          `extension` when the type calls for one.
 *
 * @example
 * buildFilePrefill('CLAUDE.md', '# hi', 'markdown', 'AIAgentsConfig')
 * // → { target: 'CLAUDE.md', blocks: [{ heading: '', description: '', language: 'markdown', code: '# hi', vars: [] }] }
 *
 * @example
 * buildFilePrefill('Button.tsx', 'const x = 1;', 'typescriptreact', 'Template')
 * // → { extension: 'tsx', blocks: [{ heading: '', description: '', language: 'tsx', code: 'const x = 1;', vars: [] }] }
 */
export function buildFilePrefill(
    fileName: string,
    contents: string,
    languageId: string,
    type: ArtifactType,
): Partial<ArtifactFormModel> {
    const prefill: Partial<ArtifactFormModel> = {
        blocks: [{ heading: '', description: '', language: mapLanguageId(languageId), code: contents, vars: [] }],
    };

    const field = getFilenameField(type);
    if (field === 'target') {
        prefill.target = path.basename(fileName);
    } else if (field === 'extension') {
        prefill.extension = path.extname(fileName).slice(1);
    }

    return prefill;
}
