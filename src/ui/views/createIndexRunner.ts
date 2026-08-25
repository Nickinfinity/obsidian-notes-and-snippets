/**
 * `runCreateIndex` — the batch write for a template-index scaffold (T12):
 * turns T11's `IndexArtifactPlan` (`services/create-index.service.ts`) into
 * real vault files.
 *
 * All I/O — picking the destination folder and writing one file — arrives
 * through `CreateIndexCallbacks`, the same callback-bag idiom
 * `MultiIndexRunner` (`ui/panels/artifactPicker/multiIndex.ts`) already uses,
 * so this module carries no extension-host dependency for its test to fake.
 *
 * 🔒 Security-critical: the first batch write into the **vault** driven by
 * workspace-derived names — every filename traces back to `safeRelPath`
 * inside T11. This runner does not re-validate those names; it asserts
 * containment exactly **once**, on the picked destination, before the write
 * loop starts, so a cancelled or unexpected `pickDest` result never reaches N
 * write calls. `writeArtifact` performs its own `isWithinRoot` check on every
 * call too — a second identical assertion inside the loop would be dead
 * weight (`CLAUDE.md` ponytail rule).
 */
import * as vscode from 'vscode';
import { serializeArtifact } from '../../services/artifact-serializer.service.js';
import { patchFrontmatterField } from '../../services/artifact-patcher.service.js';
import { summariseRun } from '../../services/multi-index.service.js';
import { deriveFileName } from '../../services/filename.service.js';
import { isWithinRoot } from '../panels/destFolderPicker.panel.js';
import type { WriteArgs, WriteResult } from '../../services/artifact-writer.service.js';
import type { IndexArtifactPlan } from '../../services/create-index.service.js';
import type { RunTally } from '../../types/multi-index.types.js';

/**
 * Callback bag `runCreateIndex` is composed with — keeps this module
 * `vscode`-Uri-aware but free of any real disk write, so its test runs
 * against fakes instead of an extension-host workspace.
 */
export interface CreateIndexCallbacks {
    /** Vault root Uri — the containment root for the one destination check. */
    vaultRoot: vscode.Uri;
    /** Writes one artifact's serialized content; the real implementation is `writeArtifact`. */
    writeArtifact: (args: WriteArgs) => Promise<WriteResult>;
    /** Prompts once for this run's destination folder; `undefined` means the user cancelled. */
    pickDest: () => Promise<vscode.Uri | undefined>;
}

/** `runCreateIndex`'s result — the tally plus the ready-to-show summary line. */
export interface CreateIndexRunResult {
    readonly tally: RunTally;
    readonly message: string;
}

/**
 * Writes every sibling of `plan` then `plan.index` itself into one
 * user-picked vault folder.
 *
 * The index's `index: true` marker cannot come from `serializeArtifact` —
 * `index`/`paths` are a read-side-only format (`ARTIFACT_FILE_FORMAT.md`
 * §8.7) the serializer deliberately never emits — so the index's content is
 * patched onto the serialized output via the already-exported
 * `patchFrontmatterField` (ledger #61). Siblings serialize unchanged.
 *
 * Sibling filenames are `plan.links[i]` **verbatim** — T11 already stripped
 * the extension and preserved directory structure when it derived the link,
 * and `writeArtifact`'s `fileName` is itself extension-less, so no further
 * transform is needed. The index's filename starts from its own title
 * (`'Index'` → `'index'`) but is bumped clear of every sibling link via
 * `pickIndexFileName` — a selection containing `index.ts` derives the
 * sibling link `index` too, and writing the index at that same name would
 * collide with (and silently skip) the index the whole feature exists to
 * produce (review finding).
 *
 * Collisions and write errors both degrade to a skip — this runner never
 * passes `force: true`, so an existing user file is never overwritten as a
 * side effect of a batch run. Only a cancelled or out-of-root destination
 * aborts the whole run, and in that case nothing is written at all.
 *
 * @param plan - T11's scaffold plan (`siblings`, `index`, `links`).
 * @param cb - Injected I/O: the destination prompt and the per-file writer.
 * @returns The run's tally and a ready-to-show summary line.
 *
 * @example
 * const { tally } = await runCreateIndex(plan, {
 *     vaultRoot,
 *     writeArtifact,
 *     pickDest: () => pickDestFolder(vaultRoot),
 * });
 */
export async function runCreateIndex(plan: IndexArtifactPlan, cb: CreateIndexCallbacks): Promise<CreateIndexRunResult> {
    const chosenDir = await cb.pickDest();
    if (!chosenDir || !isWithinRoot(cb.vaultRoot, chosenDir)) {
        return finish({ written: 0, skipped: 0, aborted: true });
    }

    let written = 0;
    let skipped = 0;

    for (let i = 0; i < plan.siblings.length; i++) {
        const outcome = await cb.writeArtifact({
            vaultRoot: cb.vaultRoot,
            type: plan.siblings[i].artifactType,
            chosenDir,
            fileName: plan.links[i],
            content: serializeArtifact(plan.siblings[i]),
        });
        if (outcome.kind === 'success') { written++; } else { skipped++; }
    }

    const indexOutcome = await cb.writeArtifact({
        vaultRoot: cb.vaultRoot,
        type: plan.index.artifactType,
        chosenDir,
        fileName: pickIndexFileName(plan.index.title, plan.links),
        content: patchFrontmatterField(serializeArtifact(plan.index), 'index', 'true'),
    });
    if (indexOutcome.kind === 'success') { written++; } else { skipped++; }

    return finish({ written, skipped, aborted: false });
}

/**
 * Picks a filename for the index that does not collide with any sibling's
 * link — the same bump-until-free shape `create-index.service.ts`'s
 * `deriveLink` already uses for sibling de-duplication, applied here so the
 * index itself never loses that same race (e.g. a selection containing
 * `index.ts` derives the sibling link `index`; the index must not also
 * claim `index`).
 *
 * @param title - The index model's own title (`'Index'`, from T11).
 * @param links - Every sibling filename already claimed in this run.
 * @returns A filename not present in `links`.
 *
 * @example
 * pickIndexFileName('Index', ['index']); // → 'index-2'
 */
function pickIndexFileName(title: string, links: readonly string[]): string {
    const base = deriveFileName(title);
    const used = new Set(links);
    let n = 0;
    let name: string;
    do {
        n += 1;
        name = n === 1 ? base : `${base}-${n}`;
    } while (used.has(name));
    return name;
}

/**
 * Builds the `{ tally, message }` result pair — the one spot that calls
 * `summariseRun`, so the `'Create index'` label cannot drift between the
 * abort-early return and the end-of-run return.
 *
 * @param tally - The run's final counts.
 * @returns `{ tally, message }`.
 *
 * @example
 * finish({ written: 2, skipped: 0, aborted: false });
 */
function finish(tally: RunTally): CreateIndexRunResult {
    return { tally, message: summariseRun(tally, 'Create index') };
}
