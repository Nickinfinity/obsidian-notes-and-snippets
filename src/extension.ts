import * as vscode from 'vscode';
import { registerOpenSettingsCommand } from './commands/openSettings.command.js';
import { registerInsertCommands } from './commands/insert.command.js';
import { registerCreateCommands } from './commands/create.command.js';
import { refreshVaultContext } from './services/context.service.js';
import { createVaultDirectory } from './services/vault.service.js';
import { sweepBlockEditOrphans } from './ui/panels/artifactPicker/blockEditor.js';
import { ARTIFACTS } from './types/constants.js';
import { CONFIG_SECTION, getVaultPath } from './services/config.service.js';

/**
 * Called by VS Code when the extension is first activated.
 *
 * Registers all commands, awaits context key initialisation (so menus are
 * correct before the user can interact), auto-opens Settings on first use,
 * and subscribes to configuration changes for Settings Sync / external edits.
 *
 * @param {vscode.ExtensionContext} context - Extension context provided by VS Code
 */
export async function activate(context: vscode.ExtensionContext) {
	// Register commands first so executeCommand calls below resolve correctly
	registerOpenSettingsCommand(context);
	registerInsertCommands(context);
	registerCreateCommands(context);

	// Clean up any block-edit temp files orphaned by a previous crash / hard-close.
	void sweepBlockEditOrphans(context.storageUri ?? context.globalStorageUri);

	// Await context key setup — ensures menus reflect vault state before first user interaction.
	// Without await the keys land asynchronously and the first right-click may show no items.
	await refreshVaultContext();

	// Auto-open Settings on first use (no vault configured yet)
	const vaultPath = getVaultPath();

	if (!vaultPath) {
		vscode.commands.executeCommand('obsidian-artifacts.settings');
	}

	// React to any obsidianArtifacts.* setting change (Settings Sync, manual edits, etc.)
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration(CONFIG_SECTION)) { return; }

			const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
			const changedVaultPath = getVaultPath();

			// When feature flags arrive via Settings Sync, ensure enabled dirs exist on disk.
			// Only CREATE — never auto-delete to prevent accidental data loss.
			const featuresKey = `${CONFIG_SECTION}.features`;
			if (changedVaultPath && e.affectsConfiguration(featuresKey)) {
				for (const artifact of ARTIFACTS) {
					const enabled = config.get<boolean>(
						`features.${artifact.dir.toLowerCase()}`,
						artifact.default
					);
					if (enabled) {
						createVaultDirectory(changedVaultPath, artifact.dir);
					}
				}
			}

			refreshVaultContext();
		})
	);
}

export function deactivate() {}
