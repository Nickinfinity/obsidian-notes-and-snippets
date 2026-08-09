/**
 * Contract types for **template indexes** — a `writesFile` artifact carrying
 * `index: true`, whose body links sibling artifacts that a single run scaffolds.
 *
 * Deliberately `vscode`-free (`CLAUDE.md`: no `vscode` imports in `src/types/`).
 * The runner's callback bag needs `Uri` and therefore lives beside the runner,
 * exactly as `PreviewCallbacks` lives beside the preview controller.
 */

/**
 * One resolved entry of a template index, in document order.
 *
 * @example
 * { raw: 'dir_2/subdir1/Button', relPath: 'dir_2/subdir1/Button.md', relDir: 'dir_2/subdir1' }
 */
export interface IndexStep {
    /** Raw link text as written in the index body — used in messages. */
    readonly raw: string;
    /** Vault path of the target, relative to the index file's own directory. POSIX. */
    readonly relPath: string;
    /** Directory part of `relPath`; `''` when the target sits beside the index. POSIX. */
    readonly relDir: string;
}

/**
 * A link or declared path that will not be used, and why.
 *
 * Rejections are reported to the user by name — a vault-authored path is never
 * silently sanitised into a different path.
 *
 * @example
 * { raw: '/etc/hosts', reason: 'absolute path' }
 */
export interface RejectedEntry {
    /** The offending entry exactly as authored. */
    readonly raw: string;
    /** Human-readable refusal reason, shown in the warning. */
    readonly reason: string;
}

/**
 * Result of scanning an index: the steps to run and everything refused.
 *
 * @example
 * { steps: [{ raw: 'a', relPath: 'a.md', relDir: '' }], rejected: [] }
 */
export interface IndexPlan {
    /** Accepted steps, in document order, duplicates preserved. */
    readonly steps: readonly IndexStep[];
    /** Entries refused by the path-safety rule, in document order. */
    readonly rejected: readonly RejectedEntry[];
}

/**
 * One offered destination folder, workspace-folder-relative (POSIX, `''` = workspace root).
 *
 * @example
 * { relPath: 'src/app/dir_1', label: 'src/app/dir_1', detail: 'Suggested — mirrors the index' }
 */
export interface DestCandidate {
    /** Workspace-folder-relative POSIX path; `''` means the workspace root. */
    readonly relPath: string;
    /** QuickPick label — the path as shown, or `/` for the workspace root. */
    readonly label: string;
    /** QuickPick detail — `'Suggested — mirrors the index'` or `'From the index'`. */
    readonly detail: string;
}

/**
 * Variable values carried between steps. Keys are full `VK-xxx` names.
 *
 * In-memory and per-run by design — durable bundles are what Variable Sets are for.
 *
 * @example
 * const carry: CarryOver = { 'VK-language': 'java' };
 */
export type CarryOver = Readonly<Record<string, string>>;

/**
 * How one step finished — the value the batch gate resolves with.
 *
 * `written` carries the submitted values so the runner can extend its carry-over
 * map; `skipped` advances to the next step; `aborted` ends the run.
 *
 * @example
 * const outcome: BatchOutcome = { kind: 'written', vars: { 'VK-a': '1' }, filePath: '/ws/a.ts' };
 */
export type BatchOutcome =
    | { readonly kind: 'written'; readonly vars: Record<string, string>; readonly filePath: string }
    | { readonly kind: 'skipped' }
    | { readonly kind: 'aborted' };

/**
 * Tally for the closing notification.
 *
 * @example
 * { written: 3, skipped: 0, aborted: false }
 */
export interface RunTally {
    /** Files successfully written during the run. */
    readonly written: number;
    /** Steps the user skipped, or that failed their own validation. */
    readonly skipped: number;
    /** `true` when the run ended early because the preview panel was closed. */
    readonly aborted: boolean;
}
