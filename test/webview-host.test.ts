import * as assert from 'node:assert';
import { WebviewHost, type WebviewHostTarget, type HostMessage } from '../src/ui/panels/artifactPicker/webviewHost.js';

/**
 * Unit tests for `WebviewHost` — the vscode-free seam wrapping a
 * webview-shaped target with two behaviours the raw API lacks:
 * queue-while-hidden (H1, last-write-wins per command, `sectionSaved` /
 * `blockUpdated` exempt) and dispose-vs-teardown (H2).
 *
 * Every posted command below is a real one this extension actually sends
 * (`fileUpdated`, `updateVars`, `sectionSaved`, `blockUpdated`) — not a
 * placeholder — so the suite doubles as a true inventory.
 *
 * `FakeTarget` implements `WebviewHostTarget` structurally — no `vscode`
 * import needed, proving the host really is extension-host-free.
 */

class FakeTarget implements WebviewHostTarget {
    visible: boolean;
    html = '';
    cspSource = 'fake-csp:';
    posted: HostMessage[] = [];
    private viewStateListeners: Array<() => void> = [];
    private disposeListeners: Array<() => void> = [];

    constructor(visible: boolean) { this.visible = visible; }

    postMessage(message: HostMessage): void { this.posted.push(message); }
    asWebviewUri(uri: { toString(): string }): { toString(): string } { return uri; }
    // Disposables here really unregister, the way a real `vscode.Event`'s
    // does — a fake that "dispose"s without removing the listener would let
    // a swapped-away target keep firing into the host (the exact leak the
    // swap tests below exist to catch).
    onDidChangeViewState(listener: () => void): { dispose(): void } {
        this.viewStateListeners.push(listener);
        return { dispose: () => { this.viewStateListeners = this.viewStateListeners.filter(l => l !== listener); } };
    }
    onDidDispose(listener: () => void): { dispose(): void } {
        this.disposeListeners.push(listener);
        return { dispose: () => { this.disposeListeners = this.disposeListeners.filter(l => l !== listener); } };
    }

    /** Test helper: flips `visible` and fires the view-state listeners, the
     *  way a real `WebviewPanel.onDidChangeViewState` would. */
    setVisible(visible: boolean): void {
        this.visible = visible;
        for (const l of this.viewStateListeners) { l(); }
    }

    /** Test helper: fires the raw dispose listeners (simulates the target
     *  itself going away — a real close, or a WebviewView hide-triggered dispose). */
    fireDispose(): void {
        for (const l of this.disposeListeners) { l(); }
    }
}

function hostWithFake(opts: { visible: boolean }): WebviewHost {
    return new WebviewHost(new FakeTarget(opts.visible));
}

suite('WebviewHost', () => {

    test('post while hidden queues; flushOnVisible drains it', () => {
        assert.deepStrictEqual(
            hostWithFake({ visible: false }).post({ command: 'fileUpdated', artifact: 'a' }).flushOnVisible(),
            [{ command: 'fileUpdated', artifact: 'a' }],
        );
    });

    test('H1: two fileUpdated posted while hidden collapse to one on flush — the later, not both', () => {
        const host = hostWithFake({ visible: false });
        host.post({ command: 'fileUpdated', artifact: 'stale' });
        host.post({ command: 'fileUpdated', artifact: 'fresh' });
        assert.deepStrictEqual(host.flushOnVisible(), [{ command: 'fileUpdated', artifact: 'fresh' }]);
    });

    test('last-write-wins keeps queue position of the first post, not appended at the end', () => {
        const host = hostWithFake({ visible: false });
        host.post({ command: 'fileUpdated', artifact: 'stale' });
        host.post({ command: 'updateVars', vars: [] });
        host.post({ command: 'fileUpdated', artifact: 'fresh' });
        assert.deepStrictEqual(host.flushOnVisible(), [
            { command: 'fileUpdated', artifact: 'fresh' },
            { command: 'updateVars', vars: [] },
        ]);
    });

    test('sectionSaved is exempt: two acknowledgements queue in order, neither dropped', () => {
        const host = hostWithFake({ visible: false });
        host.post({ command: 'sectionSaved', section: 'title', success: true });
        host.post({ command: 'sectionSaved', section: 'description', success: true });
        assert.deepStrictEqual(host.flushOnVisible(), [
            { command: 'sectionSaved', section: 'title', success: true },
            { command: 'sectionSaved', section: 'description', success: true },
        ]);
    });

    test('blockUpdated is exempt: two saved blocks (different index) both queue, neither lost', () => {
        const host = hostWithFake({ visible: false });
        host.post({ command: 'blockUpdated', index: 0, code: 'block-0-code' });
        host.post({ command: 'blockUpdated', index: 1, code: 'block-1-code' });
        assert.deepStrictEqual(host.flushOnVisible(), [
            { command: 'blockUpdated', index: 0, code: 'block-0-code' },
            { command: 'blockUpdated', index: 1, code: 'block-1-code' },
        ]);
    });

    test('post while visible goes straight through, no queueing', () => {
        const fake = new FakeTarget(true);
        const host = new WebviewHost(fake);
        host.post({ command: 'fileUpdated', artifact: 'live' });
        assert.deepStrictEqual(fake.posted, [{ command: 'fileUpdated', artifact: 'live' }]);
        assert.deepStrictEqual(host.flushOnVisible(), []);
    });

    test('becoming visible via the target auto-flushes the queue to postMessage', () => {
        const fake = new FakeTarget(false);
        const host = new WebviewHost(fake);
        host.post({ command: 'fileUpdated', artifact: 'a' });
        assert.deepStrictEqual(fake.posted, []);
        fake.setVisible(true);
        assert.deepStrictEqual(fake.posted, [{ command: 'fileUpdated', artifact: 'a' }]);
    });

    test('teardown clears the queue — no cross-session leakage into the next artifact', () => {
        const fake = new FakeTarget(false);
        const host = new WebviewHost(fake);
        host.post({ command: 'fileUpdated', artifact: 'artifact-A' });
        host.teardown();
        fake.setVisible(true);
        assert.deepStrictEqual(fake.posted, []);
    });

    test('post after teardown is a dropped no-op, not queued and not sent', () => {
        const fake = new FakeTarget(false);
        const host = new WebviewHost(fake);
        host.teardown();
        host.post({ command: 'fileUpdated', artifact: 'late' });
        assert.deepStrictEqual(fake.posted, []);
        fake.setVisible(true);
        assert.deepStrictEqual(fake.posted, []);
    });

    test('H2: onDidDispose (view gone) and onTeardown (session done) are separate events', () => {
        const fake = new FakeTarget(true);
        const host = new WebviewHost(fake);
        let disposedCount = 0;
        let teardownCount = 0;
        host.onDidDispose(() => { disposedCount += 1; });
        host.onTeardown(() => { teardownCount += 1; });

        fake.fireDispose(); // the view was merely hidden/closed
        assert.strictEqual(disposedCount, 1);
        assert.strictEqual(teardownCount, 0);

        host.teardown(); // the extension is genuinely done
        assert.strictEqual(teardownCount, 1);
    });

    test('setHtml/asWebviewUri/cspSource pass through to the target', () => {
        const fake = new FakeTarget(true);
        const host = new WebviewHost(fake);
        host.setHtml('<html></html>');
        assert.strictEqual(fake.html, '<html></html>');
        assert.strictEqual(host.cspSource, 'fake-csp:');
        const uri = { toString: () => 'file:///x' };
        assert.strictEqual(host.asWebviewUri(uri), uri);
    });

    test('onVisibilityChange reports the target visibility on change', () => {
        const fake = new FakeTarget(false);
        const host = new WebviewHost(fake);
        const seen: boolean[] = [];
        host.onVisibilityChange((v: boolean) => seen.push(v));
        fake.setVisible(true);
        fake.setVisible(false);
        assert.deepStrictEqual(seen, [true, false]);
    });

    // ── Target replacement (review #2): a WebviewView resolves lazily, and a
    // hide can dispose it outright, so the queue must survive both gaps. ──────

    test('pre-resolve: post before any target is attached queues, then flushes on attach', () => {
        const host = new WebviewHost();
        host.post({ command: 'updateVars', vars: [] });
        const fake = new FakeTarget(true);
        host.attachTarget(fake);
        assert.deepStrictEqual(fake.posted, [{ command: 'updateVars', vars: [] }]);
    });

    test('attachTarget with a hidden target does not flush until it becomes visible', () => {
        const host = new WebviewHost();
        host.post({ command: 'updateVars', vars: [] });
        const fake = new FakeTarget(false);
        host.attachTarget(fake);
        assert.deepStrictEqual(fake.posted, []);
        fake.setVisible(true);
        assert.deepStrictEqual(fake.posted, [{ command: 'updateVars', vars: [] }]);
    });

    test('swap: a message queued against a disposed target flushes into the replacement, never the old one', () => {
        const stale = new FakeTarget(false);
        const host = new WebviewHost(stale);
        host.post({ command: 'fileUpdated', artifact: 'x' });
        stale.fireDispose(); // context-menu hide disposed the view outright

        const fresh = new FakeTarget(true);
        host.attachTarget(fresh);

        assert.deepStrictEqual(fresh.posted, [{ command: 'fileUpdated', artifact: 'x' }]);
        assert.deepStrictEqual(stale.posted, []);
    });

    test('after a swap, further visibility changes on the old target no longer flush anything', () => {
        const stale = new FakeTarget(true);
        const host = new WebviewHost(stale);
        const fresh = new FakeTarget(false);
        host.attachTarget(fresh);

        host.post({ command: 'updateVars', vars: [] }); // fresh is hidden — queues
        stale.setVisible(false); // firing the old target's own listener must not touch the new queue/target
        stale.setVisible(true);
        assert.deepStrictEqual(fresh.posted, []);
        assert.deepStrictEqual(stale.posted, []);

        fresh.setVisible(true);
        assert.deepStrictEqual(fresh.posted, [{ command: 'updateVars', vars: [] }]);
    });
});
