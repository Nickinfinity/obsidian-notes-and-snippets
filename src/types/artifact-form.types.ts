import type { ArtifactType } from './parsed-artifact.types.js';
import type { ParsedVar } from './parsed-artifact.types.js';

/**
 * Controls whether the artifact create/edit form is in create or edit mode.
 *
 * - `create` — new file; destination folder picker shown before save.
 * - `edit`   — existing file; destination is fixed to the source file's path.
 */
export type ArtifactFormMode = 'create' | 'edit';

/**
 * One content block within an artifact form. A single-block file has exactly
 * one entry; a multi-block file has two or more.
 *
 * @example
 * // Single-block snippet
 * { heading: '', description: '', language: 'javascript', code: 'console.log("hi");', vars: [] }
 *
 * // One block of a multi-block snippet
 * { heading: 'Development', description: 'Local dev server.', language: 'javascript', code: '...', vars: [...] }
 */
export interface ArtifactFormBlock {
    /** `##` heading text — always `''` for the sole block of a single-block file. */
    heading: string;
    /** Per-block description (text between heading and code fence). `''` in single-block mode. */
    description: string;
    /** Fence language / language selector value — `''` means plain text (bare fence). */
    language: string;
    /** Raw code content. Emitted verbatim; trailing whitespace trimmed on save. */
    code: string;
    /** Detected `<VK-xxx>` vars plus any user-declared defaults for this block. */
    vars: ParsedVar[];
}

/**
 * Top-level data model for the artifact create/edit form.
 *
 * `multiBlock` is **derived** (`blocks.length > 1`) and never stored here.
 * The serializer reads `blocks.length` directly to choose the output shape.
 *
 * @example
 * {
 *   type: 'snippet',
 *   title: 'Express Route',
 *   description: 'Basic GET handler.',
 *   tags: ['express', 'api'],
 *   blocks: [{ heading: '', description: '', language: 'javascript', code: '...', vars: [] }],
 * }
 */
export interface ArtifactFormModel {
    /** Artifact category — drives serializer language rules and destination directory. */
    type: ArtifactType;
    /** File-level title — emitted in frontmatter `title:`. */
    title: string;
    /** File-level description — emitted in frontmatter `description:`. */
    description: string;
    /** Tag list — emitted as `tags: [a, b]`; omitted when empty. */
    tags: string[];
    /** Content blocks — at least one entry is always required. */
    blocks: ArtifactFormBlock[];
}
