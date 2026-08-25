import * as assert from 'node:assert';
import { captureTerminal, type TerminalCaptureBag } from '../src/commands/capture/terminal.capture.js';
import { getDefaultLanguage, getLanguageMode } from '../src/services/artifact-type-config.service.js';

/**
 * Unit tests for `captureTerminal` (VSX-210). Pure over an injected bag — no
 * `vscode` import in the module under test, so these run with plain fakes.
 */

/**
 * Builds a fake `TerminalCaptureBag` backed by a plain mutable clipboard
 * string, plus knobs for the scenarios below.
 */
function makeFakeBag(opts: {
    clipboard?: string;
    hasActiveTerminal?: boolean;
    onCopySelection?: () => void;
} = {}): TerminalCaptureBag & { clipboard: string } {
    const bag = {
        clipboard: opts.clipboard ?? '',
        async readClipboard(): Promise<string> {
            return bag.clipboard;
        },
        async writeClipboard(text: string): Promise<void> {
            bag.clipboard = text;
        },
        async copySelection(): Promise<void> {
            opts.onCopySelection?.();
        },
        hasActiveTerminal(): boolean {
            return opts.hasActiveTerminal ?? true;
        },
    };
    return bag;
}

suite('captureTerminal', () => {
    test('clipboard changed by copySelection → source selection, clipboard restored', async () => {
        const bag = {
            clipboard: 'user-had-this',
            async readClipboard() { return bag.clipboard; },
            async writeClipboard(text: string) { bag.clipboard = text; },
            async copySelection() { bag.clipboard = 'git status'; },
            hasActiveTerminal: () => true,
        };

        assert.deepStrictEqual(await captureTerminal(bag, 'Command'), {
            prefill: { blocks: [{ heading: '', description: '', language: '', code: 'git status', vars: [] }] },
            source: 'selection',
        });
        assert.strictEqual(bag.clipboard, 'user-had-this');
    });

    test('clipboard unchanged by copySelection → source clipboard (user’s own content)', async () => {
        const bag = makeFakeBag({ clipboard: 'echo hi' }); // copySelection is a no-op here

        const result = await captureTerminal(bag, 'Command');
        assert.deepStrictEqual(result, {
            prefill: { blocks: [{ heading: '', description: '', language: '', code: 'echo hi', vars: [] }] },
            source: 'clipboard',
        });
        assert.strictEqual(bag.clipboard, 'echo hi');
    });

    test('no active terminal → skips copySelection, uses saved clipboard as source clipboard', async () => {
        let copyCalled = false;
        const bag = makeFakeBag({
            clipboard: 'echo hi',
            hasActiveTerminal: false,
            onCopySelection: () => { copyCalled = true; },
        });

        const result = await captureTerminal(bag, 'Command');
        assert.strictEqual(copyCalled, false);
        assert.strictEqual(result?.source, 'clipboard');
    });

    test('nothing to capture → undefined', async () => {
        const bag = makeFakeBag({ clipboard: '', hasActiveTerminal: false });
        assert.strictEqual(await captureTerminal(bag, 'Command'), undefined);
    });

    test('language is table-driven via getLanguageMode/getDefaultLanguage, not a type literal', async () => {
        // Command: hidden-mode types are not this — language stays the
        // buildCommandPrefill default ('').
        assert.strictEqual(getLanguageMode('Command'), 'locked');
        const cmdBag = makeFakeBag({ clipboard: 'git status', hasActiveTerminal: false });
        const cmdResult = await captureTerminal(cmdBag, 'Command');
        assert.strictEqual(cmdResult?.prefill.blocks?.[0]?.language, '');

        // AIPrompt: hidden mode — language comes from the table, not a literal.
        assert.strictEqual(getLanguageMode('AIPrompt'), 'hidden');
        const promptBag = makeFakeBag({ clipboard: 'Review <VK-repo>.', hasActiveTerminal: false });
        const promptResult = await captureTerminal(promptBag, 'AIPrompt');
        assert.strictEqual(promptResult?.prefill.blocks?.[0]?.language, getDefaultLanguage('AIPrompt'));
    });

    test('clipboard restored even when copySelection throws', async () => {
        const bag = {
            clipboard: 'user-had-this',
            async readClipboard() { return bag.clipboard; },
            async writeClipboard(text: string) { bag.clipboard = text; },
            async copySelection() { throw new Error('boom'); },
            hasActiveTerminal: () => true,
        };

        await assert.rejects(() => captureTerminal(bag, 'Command'), /boom/);
        assert.strictEqual(bag.clipboard, 'user-had-this');
    });
});
