import * as vscode from 'vscode';
import { detectVaultDirs } from './vault.service.js';
import { ARTIFACTS } from '../types/constants.js';
import { getVaultPath } from './config.service.js';

/** Prefix shared by all extension context keys — matches the VS Code settings namespace */
const CTX = 'obsidian-artifacts';

/** Shorthand: fire a setContext command for a key relative to the extension prefix */
const setCtx = (key: string, val: unknown): Thenable<unknown> =>
	vscode.commands.executeCommand('setContext', `${CTX}.${key}`, val);

/**
 * Derives the VS Code context key name for a given artifact directory.
 *
 * Pattern: `obsidian-artifacts.<dir.toLowerCase()>Active`
 * Must match the `when` clauses declared in package.json.
 *
 * @param {string} dir - The artifact `dir` field (e.g. `'Snippets'`, `'AgentsConf'`)
 * @returns {string} Fully-qualified context key
 */
export function artifactContextKey(dir: string): string {
	return `${CTX}.${dir.toLowerCase()}Active`;
}

/**
 * Returns true if an artifact belongs to the given VS Code context surface.
 * `'all'` in the artifact's `contexts` means it matches every surface.
 */
function artifactInContext(contexts: readonly string[], surface: string): boolean {
	return contexts.includes(surface) || contexts.includes('all');
}

/**
 * Sets all vault-related VS Code context keys based on the provided vault path.
 *
 * Keys are derived dynamically from `ARTIFACTS` — adding a new artifact to
 * constants.ts automatically produces the matching context key here.
 *
 * Keys set:
 * - `obsidian-artifacts.vaultConfigured`            — true when a vault path is configured
 * - `obsidian-artifacts.<dir.toLowerCase()>Active`  — true when that artifact dir exists on disk
 * - `obsidian-artifacts.editorHasMultiple`          — true when ≥2 editor artifacts are active
 * - `obsidian-artifacts.terminalHasMultiple`        — true when ≥2 terminal artifacts are active
 * - `obsidian-artifacts.explorerHasMultiple`        — true when ≥2 explorer artifacts are active
 *
 * The `*HasMultiple` keys drive the single-vs-submenu logic in package.json menus:
 * one active artifact → direct labelled entry, two or more → "Obsidian Artifacts" submenu.
 *
 * @param {string | null} vaultPath - Absolute path to the vault root, or null if unconfigured
 * @returns {Promise<void>}
 */
async function setVaultContextKeys(vaultPath: string | null): Promise<void> {
	await setCtx('vaultConfigured', vaultPath !== null);

	if (vaultPath === null) {
		// Vault not configured — clear all per-artifact and per-context keys
		for (const a of ARTIFACTS) {
			await vscode.commands.executeCommand('setContext', artifactContextKey(a.dir), false);
		}
		await setCtx('editorHasMultiple',   false);
		await setCtx('terminalHasMultiple', false);
		await setCtx('explorerHasMultiple', false);
		return;
	}

	// Check which artifact directories currently exist on disk
	const dirs = detectVaultDirs(vaultPath);

	// Set one context key per artifact based on whether its directory exists
	for (const d of dirs) {
		await vscode.commands.executeCommand('setContext', artifactContextKey(d.dir), d.exists);
	}

	// Count active artifacts per VS Code context surface.
	// Used by package.json `when` clauses to choose between direct entries and submenus.
	const countActive = (surface: string) =>
		dirs.filter(d => artifactInContext(d.contexts as readonly string[], surface) && d.exists).length;

	await setCtx('editorHasMultiple',   countActive('editor')   >= 2);
	await setCtx('terminalHasMultiple', countActive('terminal') >= 2);
	await setCtx('explorerHasMultiple', countActive('explorer') >= 2);
}

/**
 * Reads `obsidianArtifacts.vaultPath` from VS Code settings and refreshes
 * all vault-related VS Code context keys.
 *
 * VS Code settings are the single source of truth for the vault path — no
 * custom file storage is used. Settings Sync propagates the value across devices.
 *
 * Should be called:
 * 1. On extension activation — restores context from the previous session
 * 2. After any `obsidianArtifacts.*` setting changes (via onDidChangeConfiguration)
 * 3. After the config panel writes a new vault path or toggles a directory
 *
 * @returns {Promise<void>}
 *
 * @example
 * await refreshVaultContext();
 */
export async function refreshVaultContext(): Promise<void> {
	const vaultPath = getVaultPath();

	await setVaultContextKeys(vaultPath.length > 0 ? vaultPath : null);
}
