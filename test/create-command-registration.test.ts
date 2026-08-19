import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { buildCreateCommandIds } from '../src/commands/create-from-surface.command.js';

/**
 * Extension-host counterpart to `package-create-menus.test.ts`.
 *
 * That suite pins the **manifest** — every derived id has a `contributes`
 * entry, in the right group, with the right `when`. What a static pin cannot
 * catch is `extension.ts` never calling `registerCreateSurfaceCommands`, or the
 * view provider never being registered: the manifest stays perfectly correct,
 * every menu entry renders, and clicking one raises "command not found" with
 * the whole manifest suite green.
 *
 * That was the live state of this branch until Wave 1 close — eight contributed
 * menu entries, none of them wired, and no test that could tell. This suite is
 * what fails instead of the user.
 */
suite('create surface registration — extension host', () => {

	/**
	 * Activates the extension and returns every live command id.
	 *
	 * @returns The registered command ids, including built-ins.
	 * @example
	 * (await registeredCommands()).includes('obsidian-artifacts.create.snippets');
	 */
	async function registeredCommands(): Promise<string[]> {
		const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'obsidian-notes-and-snippets');
		await ext?.activate();
		return vscode.commands.getCommands(true);
	}

	test('every derived create command id is actually registered', async () => {
		const registered = await registeredCommands();
		const derived = buildCreateCommandIds();

		// Guard the guard: an empty derivation would make the loop below vacuous.
		assert.ok(derived.length >= 5, `derivation collapsed to ${derived.length} ids`);

		for (const id of derived) {
			assert.ok(
				registered.includes(id),
				`${id} is contributed in package.json but never registered — `
				+ 'extension.ts must call registerCreateSurfaceCommands',
			);
		}
	});

	test('every contributed webview view has a registered provider', async () => {
		const ext = vscode.extensions.all.find(e => e.packageJSON?.name === 'obsidian-notes-and-snippets');
		await ext?.activate();

		// Read the ids from the manifest rather than from the provider class.
		// VS Code resolves what `contributes.views` declares, so that is the id
		// whose provider must exist — asserting against the class's own constant
		// would pass happily while the two drifted apart and the pane stayed dead.
		const views = (ext?.packageJSON?.contributes?.views?.['obsidian-artifacts'] ?? []) as
			{ id: string; type?: string }[];
		const webviewIds = views.filter(v => v.type === 'webview').map(v => v.id);
		assert.ok(webviewIds.length > 0, 'no webview views contributed — expected obsidian-artifacts.mainView');

		for (const id of webviewIds) {
			// `registerWebviewViewProvider` throws on a duplicate id, so a second
			// registration *succeeding* proves the first never happened. Failing
			// to throw is the assertion — an unregistered view renders as a
			// permanent "no data provider registered" pane with no error anywhere.
			let alreadyRegistered = false;
			try {
				vscode.window.registerWebviewViewProvider(id, { resolveWebviewView: () => { /* probe */ } })
					.dispose();
			} catch {
				alreadyRegistered = true;
			}
			assert.ok(
				alreadyRegistered,
				`${id} is contributed but has no provider — extension.ts must call `
				+ 'registerWebviewViewProvider, or the pane shows "no data provider registered"',
			);
		}
	});
});
