import * as vscode from 'vscode';
import { serializeArtifact } from './artifact-serializer.service.js';
import { writeArtifact, type WriteResult } from './artifact-writer.service.js';
import type { ArtifactFormModel } from '../types/artifact-form.types.js';

/**
 * Renders an `artifactType: Variables` form model to `.md` file content.
 *
 * Thin wrapper over `serializeArtifact` — the sole `.md` emitter for every
 * artifact type, so a Variables file is never assembled a second way. Kept as
 * a named export (rather than each caller calling `serializeArtifact`
 * directly) so this module's "renders through `serializeArtifact` only"
 * contract is an importable fact, not a comment a caller has to trust.
 *
 * ponytail: a whole-file rewrite round-trips a **single**-sub-set model
 * cleanly (its vars land in `parsed.vars`), but a **multi**-sub-set (2+ `## `
 * headings) model does not fully: `parser.service.ts`'s `parseVars` /
 * `parseCodeBlock` scan the *whole file* for the first fence and are blind to
 * `## ` headings, so after a multi-block round-trip `parsed.vars` and
 * `parsed.frontmatter.language` are silently filled from sub-set 1, not left
 * empty — `parsed.blocks[i].vars` is scoped correctly and is what every
 * multi-block caller already reads. Also, this writer normalises a
 * hand-formatted vks file to `serializeArtifact`'s canonical emission
 * (blank-line placement, frontmatter key order) on first edit — accepted,
 * since a hand-authored `Variables` file is a rare, low-stakes edge case.
 * Upgrade path if either ceiling bites: a `patchVksBlock` in
 * `artifact-patcher.service.ts` for a surgical in-place edit instead of a
 * whole-file rewrite (mirrors that service's existing surgical-patch model).
 *
 * @param model - Variables-typed form model (`artifactType: 'Variables'`).
 * @returns UTF-8 markdown string ready for `writeVariablesFile`.
 *
 * @example
 * renderVariablesFile({
 *   artifactType: 'Variables', title: 'Local Dev', description: '', tags: [],
 *   blocks: [{ heading: '', description: '', language: '', code: '',
 *     vars: [{ name: 'VK-host', defaultValue: 'localhost' }] }],
 * });
 * // → '---\nartifactType: Variables\ntitle: Local Dev\n---\n\n```vks\nVK-host=localhost\n```\n'
 */
export function renderVariablesFile(model: ArtifactFormModel): string {
    return serializeArtifact(model);
}

/** Arguments for {@link writeVariablesFile}. */
export interface WriteVariablesFileArgs {
    /** Vault root Uri — passed straight through to `writeArtifact`'s containment checks. */
    vaultRoot: vscode.Uri;
    /** Destination directory — must resolve inside `vaultRoot`; typically the edited file's existing parent. */
    chosenDir: vscode.Uri;
    /** Filename **without** `.md` — handed to `writeArtifact` unmodified, which appends the extension and joins the path itself. */
    fileName: string;
    /** Variables-typed form model to render and write. */
    model: ArtifactFormModel;
}

/**
 * Renders and writes an edited `artifactType: Variables` file, overwriting
 * whatever is already there.
 *
 * `force: true` is deliberate here and is **not** the same decision as
 * elsewhere in this codebase: the create-index batch writer is explicitly
 * forbidden `force`, because overwriting a user's artifact must never be an
 * unattended batch decision. This writer is the **edit** path — the file
 * already exists and the user is editing it, so overwrite *is* the requested
 * action, not an accidental clobber. Do not "fix" this into consistency with
 * the batch writer; the two are answering different questions.
 *
 * `type` is read from `args.model.artifactType`, not hardcoded — the same
 * model already drives the `artifactType:` frontmatter via `serializeArtifact`,
 * so the base directory and the frontmatter agree by construction instead of
 * being two independently-spelled facts.
 *
 * Builds no path itself: `chosenDir` and `fileName` are handed to
 * `writeArtifact` exactly as received. `writeArtifact` is the one place that
 * joins them (`Uri.joinPath(chosenDir, fileName + '.md')`) and the one place
 * that runs both containment checks — `chosenDir` inside `vaultRoot`, then the
 * joined path inside `chosenDir` — before any write reaches disk. A `kind:
 * 'collision'` result is unreachable with `force: true` fixed on; it stays in
 * the return type because `WriteResult` is the one shared union every writer
 * caller already switches on.
 *
 * @param args - Destination and model to write.
 * @returns The `WriteResult` from `writeArtifact` — `'success'` or `'error'`
 *          (containment failure or I/O exception) in practice.
 *
 * @example
 * const result = await writeVariablesFile({ vaultRoot, chosenDir, fileName: 'dev', model });
 * if (result.kind === 'success') { console.log(result.filePath); }
 */
export async function writeVariablesFile(args: WriteVariablesFileArgs): Promise<WriteResult> {
    const content = renderVariablesFile(args.model);
    return writeArtifact({
        vaultRoot: args.vaultRoot,
        type: args.model.artifactType,
        chosenDir: args.chosenDir,
        fileName: args.fileName,
        content,
        force: true,
    });
}
