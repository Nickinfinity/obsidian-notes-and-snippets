import type { ArtifactType } from './parsed-artifact.types.js';

/**
 * All VS Code UI surfaces where an artifact's command can appear.
 *
 * - `editor`   — main editor context menu
 * - `terminal` — integrated terminal context menu
 * - `explorer` — Explorer (file tree) context menu
 * - `all`      — every standard VS Code context menu surface
 */
export type ArtifactContext = 'editor' | 'terminal' | 'explorer' | 'all';

/**
 * Language selector behaviour for an artifact type in the create form.
 *
 * - `free`   — enabled dropdown, user-selectable (snippet)
 * - `locked` — disabled, pre-filled with `language.default` (command → `bash`)
 * - `hidden` — not rendered; fence info-string is always `language.default`
 */
export type LanguageMode = 'free' | 'locked' | 'hidden';

/**
 * Per-type form behaviour for the artifact create form.
 *
 * Read by `artifact-type-config.service` helpers. Form code never
 * branches on a type string literal — all per-type variation lives here.
 *
 * @example
 * { language: { mode: 'locked', default: 'bash' }, label: { singular: 'command' }, multiBlock: true }
 */
export interface ArtifactTypeFormConfig {
	/** Language selector configuration. */
	language: {
		/** Selector rendering mode. */
		mode: LanguageMode;
		/** Required when `mode === 'locked'`; default for new blocks when `'free'`; fence value when `'hidden'`. */
		default?: string;
		/** Optional curated dropdown list for `mode === 'free'`. */
		options?: string[];
	};
	/** Type-singular labels used in UI buttons and confirm prompts. */
	label: {
		/** Singular noun — drives `+ Add additional <singular>`, `Delete entire <singular>`, etc. */
		singular: string;
	};
	/** `true` → multi-block allowed (`+` button visible); `false` → single block forced. */
	multiBlock: boolean;
}

/** A single Obsidian vault artifact directory and its VS Code UI configuration */
export interface Artifact {
	/** Canonical artifact type literal — direct lookup key for parser/serializer/services. */
	type: ArtifactType;
	/** Human-readable display name */
	name: string;
	/** Folder name on disk inside the vault root */
	dir: string;
	/** Auto-create this directory on first vault selection when true */
	default: boolean;
	/** Context menu surfaces where this artifact's action should appear */
	contexts: readonly ArtifactContext[];
	/** Optional VS Code codicon id used in QuickPick / preview headers */
	icon?: string;
	/** Gate this type into the create-flow type picker. */
	createForm?: boolean;
	/** Per-type form behaviour — required when `createForm === true`. */
	form?: ArtifactTypeFormConfig;
}

export type ArtifactsArray = readonly Artifact[];
