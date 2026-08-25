/**
 * `WebviewHost` — the single choke point every extension→webview message
 * passes through. It wraps a target that combines a webview's transport
 * (`postMessage`/`html`/`asWebviewUri`/`cspSource`) with its visibility and
 * dispose signals — see {@link WebviewHostTarget} for the exact shape and
 * why a bare `vscode.Webview` or `WebviewView` does not satisfy it as-is.
 * It adds two behaviours the raw API lacks:
 *
 * - **H1 — queue while hidden.** `post` on a hidden (or not-yet-attached)
 *   target buffers instead of dropping the message; it flushes once a live,
 *   visible target is attached. Last-write-wins per `command` — a stale
 *   `fileUpdated` replaced by a fresh one is never replayed — except
 *   {@link QUEUE_AS_EVENTS}, which queue in arrival order because each one
 *   is a distinct fact, not a state snapshot. The queue belongs to the
 *   host, not to any one target instance: see `attachTarget`.
 * - **H2 — dispose is not cancel.** `onDidDispose` forwards the target's own
 *   dispose (the *view* is gone — for a `WebviewView` this fires on a mere
 *   hide, not necessarily "done"). `teardown()` is the separate, explicit
 *   "the extension is done with this host" signal; it clears the queue (so
 *   a message queued for one artifact's session can never leak into the
 *   next) and fires `onTeardown`. Callers that must abort on a genuine end
 *   (an armed batch step, say) should listen to `onTeardown`, not
 *   `onDidDispose`.
 *
 * `vscode`-free by construction — the target is taken through the
 * structural {@link WebviewHostTarget} interface, so the whole module
 * unit-tests against a fake with no extension host.
 *
 * This is a **transport only** — it escapes nothing. Callers of `setHtml`
 * remain responsible for escaping their own interpolations.
 *
 * @example
 * // A `WebviewView` (this wave's target) has no `onDidChangeViewState` —
 * // adapt its `onDidChangeVisibility` into that slot:
 * function adapt(view: vscode.WebviewView): WebviewHostTarget {
 *     return {
 *         postMessage: m => view.webview.postMessage(m),
 *         get html()  { return view.webview.html; },
 *         set html(v) { view.webview.html = v; },
 *         get cspSource() { return view.webview.cspSource; },
 *         asWebviewUri: uri => view.webview.asWebviewUri(uri as vscode.Uri),
 *         get visible() { return view.visible; },
 *         onDidChangeViewState: view.onDidChangeVisibility,
 *         onDidDispose: view.onDidDispose,
 *     };
 * }
 * const host = new WebviewHost();
 * host.post({ command: 'fileUpdated', artifact });
 * host.onTeardown(() => runner.abort());
 * // once resolveWebviewView hands us the live view:
 * host.attachTarget(adapt(view));
 * // ... later, when the extension is done with this session:
 * host.teardown();
 */

/** Minimal structural mirror of `vscode.Uri` — declared locally so this
 *  module never imports `vscode` for types. */
export interface UriLike {
    toString(): string;
}

/** Minimal structural mirror of `vscode.Disposable`. */
export interface DisposableLike {
    dispose(): void;
}

/**
 * Shape of one extension→webview message. Every message posted across the
 * picker (`webview-messages.types.ts` plus the raw `{ command, ... }`
 * objects `varSetController.ts` / `preview.ts` post today) carries at least
 * a `command` field — that's all the queue needs to key on.
 */
export interface HostMessage {
    command: string;
    [key: string]: unknown;
}

/**
 * Structural shape of the target `WebviewHost` wraps: a webview's transport
 * (`postMessage`, `html`, `asWebviewUri`, `cspSource`) plus the
 * visibility/dispose signals that live on the *container* around a webview
 * (`WebviewPanel` or `WebviewView`), not on `vscode.Webview` itself — so
 * neither a bare `Webview` nor a bare container satisfies this alone; a
 * caller composes the two. `onDidChangeViewState` is a bare "something
 * about visibility may have changed, go re-read `.visible`" hook: a
 * `WebviewPanel` caller passes its own `onDidChangeViewState` here, but a
 * `WebviewView` has no such event — pass `onDidChangeVisibility` instead
 * (see the module `@example`).
 */
export interface WebviewHostTarget {
    postMessage(message: HostMessage): unknown;
    html: string;
    readonly cspSource: string;
    asWebviewUri(uri: UriLike): UriLike;
    readonly visible: boolean;
    onDidChangeViewState(listener: () => void): DisposableLike;
    onDidDispose(listener: () => void): DisposableLike;
}

/**
 * Commands exempt from last-write-wins collapsing, queued in arrival order
 * instead. **The rule:** exempt any command whose payload carries a
 * discriminator naming *which one* of several targets it acknowledges —
 * collapsing two of those loses a fact, not just a stale render. `section`
 * (`sectionSaved`) and `index` (`blockUpdated`) are both such
 * discriminators: two `blockUpdated` messages for different block indices
 * are two edits, and colliding them on the bare `command` key would silently
 * drop one block's saved code. A command with no such discriminator (e.g.
 * `varSetApplied`/`varSetCancelled`) stays out of this set — it is a
 * snapshot of current state, and `varSetController.ts`'s `pending` guard
 * keeps at most one in flight anyway, so there is nothing for last-write-wins
 * to lose.
 */
export const QUEUE_AS_EVENTS: ReadonlySet<string> = new Set(['sectionSaved', 'blockUpdated']);

/**
 * Wraps a webview-shaped target with hidden-queueing and a teardown/dispose
 * distinction. See the module doc for the full contract and a compiling
 * adapter example. The target may be attached later (`attachTarget`) —
 * useful for a `WebviewView`, which resolves lazily and has no live webview
 * at all until the first reveal.
 *
 * @example
 * const host = new WebviewHost();
 * host.post({ command: 'updateVars', vars }); // queues — no target yet
 * host.attachTarget(myTarget); // flushes into it if already visible
 */
export class WebviewHost {
    private queue: HostMessage[] = [];
    private torndown = false;
    private target: WebviewHostTarget | undefined;
    private viewStateSub: DisposableLike | undefined;
    private disposeSub: DisposableLike | undefined;
    private readonly visibilityListeners = new Set<(visible: boolean) => void>();
    private readonly disposeListeners = new Set<() => void>();
    private readonly teardownListeners = new Set<() => void>();

    /** @param target - Optional; omit when the underlying view (a `WebviewView`) has not resolved yet and attach it later via `attachTarget`. */
    constructor(target?: WebviewHostTarget) {
        if (target) { this.attachTarget(target); }
    }

    /**
     * Binds (or rebinds) the live target. The queue belongs to the host, not
     * to any one target instance, so this is how the host survives the two
     * gaps a plain `!visible` check misses: before a `WebviewView`'s first
     * `resolveWebviewView` (no target exists yet) and after a hide that
     * *disposes* the view outright (the next reveal hands back a brand-new
     * instance that never saw the old messages). Re-subscribes to the new
     * target's own visibility/dispose events, disposing any prior
     * subscription first, and flushes the queue immediately if the new
     * target is already visible.
     * @param target - The newly live target.
     * @example host.attachTarget(view.webview and friends, adapted);
     */
    attachTarget(target: WebviewHostTarget): void {
        if (this.torndown) { return; }
        this.viewStateSub?.dispose();
        this.disposeSub?.dispose();
        this.target = target;
        this.viewStateSub = target.onDidChangeViewState(() => {
            const visible = target.visible;
            if (visible) { this.flushOnVisible(); }
            for (const listener of this.visibilityListeners) { listener(visible); }
        });
        this.disposeSub = target.onDidDispose(() => {
            for (const listener of this.disposeListeners) { listener(); }
        });
        if (target.visible) { this.flushOnVisible(); }
    }

    /**
     * Posts a message to the webview, or queues it if there is no target
     * yet or the target is currently hidden (H1). Chainable so callers can
     * `.post(...).post(...)`.
     * @param message - The extension→webview message to send.
     * @returns `this`, for chaining.
     * @example host.post({ command: 'fileUpdated', artifact });
     */
    post(message: HostMessage): this {
        if (this.torndown) { return this; }
        if (!this.target?.visible) {
            this.enqueue(message);
            return this;
        }
        void this.target.postMessage(message);
        return this;
    }

    /** Sets the webview's HTML. A transport passthrough — escapes nothing.
     *  No-op before a target is attached or after `teardown()`. */
    setHtml(html: string): void {
        if (this.torndown || !this.target) { return; }
        this.target.html = html;
    }

    /** Passthrough to the target's `asWebviewUri`. Throws if no target is
     *  attached yet — there is nothing to resolve the URI against. */
    asWebviewUri(uri: UriLike): UriLike {
        if (!this.target) { throw new Error('WebviewHost: asWebviewUri called before attachTarget'); }
        return this.target.asWebviewUri(uri);
    }

    /** Passthrough to the target's `cspSource`; `''` before a target is attached. */
    get cspSource(): string {
        return this.target?.cspSource ?? '';
    }

    /**
     * Drops every queued message without posting it.
     *
     * Non-terminal, unlike {@link teardown}: the host stays usable. Called
     * when the *session* changes while the host does not — previewing a
     * second artifact in the same pane, where anything still queued for the
     * first is addressed to a document that no longer exists. Without it, a
     * message queued during artifact A's preview flushes into artifact B
     * (ledger #116).
     *
     * @example
     * host.clearQueue();   // artifact swapped; the old queue is meaningless
     */
    clearQueue(): void {
        this.queue = [];
    }

    /**
     * Drains the queue and posts every remaining message to whatever target
     * is currently attached. This is the flush operation's result, returned
     * so a caller (or a test) can inspect exactly what went out. Called
     * automatically when the attached target's view-state reports visible,
     * and again from `attachTarget` when a newly-attached target is already
     * visible; safe to call directly at any other time too (a no-op if the
     * queue is empty or the host is torn down).
     * @returns The messages that were flushed, in the order posted.
     * @example const flushed = host.flushOnVisible();
     */
    flushOnVisible(): HostMessage[] {
        if (this.torndown || !this.target) { return []; }
        const flushed = this.queue;
        this.queue = [];
        for (const message of flushed) { void this.target.postMessage(message); }
        return flushed;
    }

    /**
     * Subscribes to target visibility changes.
     * @param listener - Called with the new `visible` value.
     * @returns A disposable that unsubscribes.
     * @example host.onVisibilityChange(v => out.appendLine(`visible=${v}`));
     */
    onVisibilityChange(listener: (visible: boolean) => void): DisposableLike {
        this.visibilityListeners.add(listener);
        return { dispose: () => { this.visibilityListeners.delete(listener); } };
    }

    /**
     * Fires whenever the wrapped target itself is disposed. For a
     * `WebviewView` this can fire on a mere hide — it is **not** a signal
     * that the session ended (see `onTeardown`).
     * @param listener - Called with no arguments when the target disposes.
     * @returns A disposable that unsubscribes.
     * @example host.onDidDispose(() => out.appendLine('view instance gone'));
     */
    onDidDispose(listener: () => void): DisposableLike {
        this.disposeListeners.add(listener);
        return { dispose: () => { this.disposeListeners.delete(listener); } };
    }

    /**
     * Fires only when `teardown()` is called explicitly — the "extension is
     * done with this host" signal. An armed batch step should abort on
     * this, not on `onDidDispose`.
     * @param listener - Called with no arguments when `teardown()` runs.
     * @returns A disposable that unsubscribes.
     * @example host.onTeardown(() => runner.abort());
     */
    onTeardown(listener: () => void): DisposableLike {
        this.teardownListeners.add(listener);
        return { dispose: () => { this.teardownListeners.delete(listener); } };
    }

    /**
     * The extension is fully done with this host: unsubscribes from the
     * target and drops the queue (H1's cross-session guard — a message
     * queued for one artifact's session must never flush into the next),
     * then fires `onTeardown`. `post`/`setHtml`/`flushOnVisible` become
     * no-ops afterwards. Idempotent.
     * @example host.teardown();
     */
    teardown(): void {
        if (this.torndown) { return; }
        this.torndown = true;
        this.queue = [];
        this.viewStateSub?.dispose();
        this.disposeSub?.dispose();
        const listeners = [...this.teardownListeners];
        this.visibilityListeners.clear();
        this.disposeListeners.clear();
        this.teardownListeners.clear();
        for (const listener of listeners) { listener(); }
    }

    /** `vscode.Disposable`-compatible alias for `teardown()`. */
    dispose(): void {
        this.teardown();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /**
     * Adds a message to the hidden-queue: last-write-wins per `command`
     * (replacing an existing queued entry in place, keeping its position),
     * except {@link QUEUE_AS_EVENTS} commands, which always append.
     */
    private enqueue(message: HostMessage): void {
        if (QUEUE_AS_EVENTS.has(message.command)) {
            this.queue.push(message);
            return;
        }
        const idx = this.queue.findIndex(m => m.command === message.command);
        if (idx === -1) {
            this.queue.push(message);
        } else {
            this.queue[idx] = message;
        }
    }
}
