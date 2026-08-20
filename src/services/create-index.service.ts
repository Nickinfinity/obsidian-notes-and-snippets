import { posix } from 'node:path';
import { getFilenameField, writesWholeFile } from './artifact-type-config.service.js';
import { safeRelPath } from './multi-index.service.js';
import { slugify } from './filename.service.js';
import type { ArtifactType } from '../types/parsed-artifact.types.js';
import type { ArtifactFormModel } from '../types/artifact-form.types.js';

/**
 * Turns a multi-selection of workspace-relative paths into a template-index
 * scaffold plan (T11) — one sibling `ArtifactFormModel` per selected path plus
 * an index model whose body links them, using the **same** link syntax
 * `multi-index.service.ts` already reads (`ARTIFACT_FILE_FORMAT.md` §8).
 *
 * `vscode`-free and side-effect free: no disk I/O, no read of the selected
 * files' real content — that is T12's (Wave 4) job, which turns this plan
 * into actual vault writes.
 */

/** The plan's return shape: the sibling files to scaffold, the index that links them, and the raw link strings (exposed for assertions). */
export interface IndexArtifactPlan {
    /** One model per accepted input path, in input order. */
    readonly siblings: ArtifactFormModel[];
    /** The index artifact whose sole block body links every sibling. */
    readonly index: ArtifactFormModel;
    /** The link target strings written into the index body, in input order — same order as `siblings`. */
    readonly links: string[];
}

/**
 * Derives a safe, directory-preserving link target from one accepted input
 * path, de-duplicating against every link already emitted in this run.
 *
 * Slugging is applied **per path segment** (directory and basename
 * separately), never to the joined path as one string — `slugify('sub/b')`
 * would collapse the `/` into a dash and destroy the directory structure the
 * link is supposed to preserve. A segment with no `[a-z0-9]` characters slugs
 * to `''` — that is a **rejection**, not a silently-dropped segment: a
 * directory or basename that cannot be represented must not disappear from
 * the path or get promoted into a different role (a lost directory becomes a
 * root-level file; a lost basename makes the link resolve to a directory).
 *
 * De-duplication checks the **emitted** link, not just a same-base counter —
 * two different inputs slugging to the same base must never collide with an
 * already-suffixed link from a third input. The bump is a plain counter over
 * `used`, so it is input-order-driven and repeatable — no `Set` iteration
 * order, no timestamp.
 *
 * @param relPath - A path already accepted by `safeRelPath`.
 * @param used - Mutable set of every link already emitted in this run.
 * @returns A link target that has itself passed `safeRelPath` and is not in `used`.
 * @throws When a path segment slugs to `''`, or the derived link is rejected by `safeRelPath`.
 *
 * @example
 * deriveLink('sub/b.ts', new Set()); // → 'sub/b'
 */
function deriveLink(relPath: string, used: Set<string>): string {
    const parsed = posix.parse(relPath);
    const dirSegments = parsed.dir === '' ? [] : parsed.dir.split('/');
    const segments = [...dirSegments, parsed.name].map(seg => {
        const slug = slugify(seg);
        if (slug.length === 0) {
            throw new Error(`buildIndexArtifactPlan: path segment "${seg}" in "${relPath}" has no representable [a-z0-9] characters`);
        }
        return slug;
    });
    const base = segments.join('/');

    let n = 0;
    let link: string;
    do {
        n += 1;
        link = n === 1 ? base : `${base}-${n}`;
    } while (used.has(link));
    used.add(link);

    const validated = safeRelPath(link);
    if (!validated.ok) {
        throw new Error(`buildIndexArtifactPlan: derived link "${link}" from "${relPath}" is unsafe: ${validated.reason}`);
    }
    return validated.relPath;
}

/**
 * Builds the skeleton sibling model for one accepted link.
 *
 * Block content is intentionally empty — this service never reads the
 * selected file's real contents (that would be I/O, out of scope for T11);
 * T12 fills the block in when it does the actual read/write. The output
 * filename key (`extension` for `Template`, `target` for `AIAgentsConfig`) is
 * still set here, from the **raw** (pre-slug) path, because it is the only
 * layer that still has the source extension — `link` has already dropped it.
 * `getFilenameField` is the one reader of the `outputNameKey` declared on the
 * `ARTIFACTS` row; this never branches on the type literal.
 *
 * @param link - The derived, de-duplicated link target for this sibling.
 * @param rawRelPath - The `safeRelPath`-validated source path (pre-slug), extension intact.
 * @param artifactType - The type shared by every sibling and the index (caller-selected).
 * @returns A minimal single-block `ArtifactFormModel`.
 *
 * @example
 * buildSibling('dir/button', 'dir/Button.tsx', 'Template'); // → { ..., extension: 'tsx' }
 */
function buildSibling(link: string, rawRelPath: string, artifactType: ArtifactType): ArtifactFormModel {
    const model: ArtifactFormModel = {
        artifactType,
        title: posix.basename(link),
        description: '',
        tags: [],
        blocks: [{ heading: '', description: '', language: '', code: '', vars: [] }],
    };

    const field = getFilenameField(artifactType);
    if (field === 'target') {
        model.target = posix.basename(rawRelPath);
    } else if (field === 'extension') {
        model.extension = posix.extname(rawRelPath).slice(1);
    }

    return model;
}

/**
 * Renders the index body as a numbered wikilink list, document order = run order.
 *
 * @param links - Link targets in the order they should scaffold.
 * @returns Markdown body text, one `[[link]]` per line.
 *
 * @example
 * buildIndexBody(['a', 'sub/b']); // → '1. [[a]]\n2. [[sub/b]]'
 */
function buildIndexBody(links: string[]): string {
    return links.map((link, i) => `${i + 1}. [[${link}]]`).join('\n');
}

/**
 * Builds a template-index scaffold plan from N selected workspace-relative
 * paths (T11).
 *
 * Every input path is validated with `safeRelPath` — the single rejection
 * authority `multi-index.service.ts` owns — and a rejection **throws**; no
 * hostile path is ever trimmed or silently accepted (`ARTIFACT_FILE_FORMAT.md`
 * §8.3). The generated index body is verified, in this module's test, to
 * round-trip through the existing `extractIndexLinks` + `resolveLinkTarget`
 * readers rather than re-specifying the link syntax here.
 *
 * @param paths - Selected paths, relative to the workspace, one per sibling to scaffold.
 * @param artifactType - The shared type for every sibling and the index — must `writesWholeFile`.
 * @returns `{ siblings, index, links }`.
 * @throws When `artifactType` cannot write whole files, any path is rejected by `safeRelPath`,
 *         or a path segment has no representable `[a-z0-9]` characters to slug.
 *
 * @example
 * buildIndexArtifactPlan(['a.ts', 'sub/b.ts'], 'Template').links; // → ['a', 'sub/b']
 */
export function buildIndexArtifactPlan(paths: string[], artifactType: ArtifactType): IndexArtifactPlan {
    if (!writesWholeFile(artifactType)) {
        throw new Error(`buildIndexArtifactPlan: "${artifactType}" does not write whole files, so it cannot drive a template index`);
    }

    const used = new Set<string>();
    const links: string[] = [];
    const siblings: ArtifactFormModel[] = [];

    for (const raw of paths) {
        const safe = safeRelPath(raw);
        if (!safe.ok) {
            throw new Error(`buildIndexArtifactPlan: "${raw}" is not a safe path: ${safe.reason}`);
        }
        const link = deriveLink(safe.relPath, used);
        links.push(link);
        siblings.push(buildSibling(link, safe.relPath, artifactType));
    }

    const index: ArtifactFormModel = {
        artifactType,
        title: 'Index',
        description: '',
        tags: [],
        blocks: [{ heading: '', description: '', language: '', code: buildIndexBody(links), vars: [] }],
    };

    return { siblings, index, links };
}
