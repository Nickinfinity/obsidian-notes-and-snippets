import type { Uri } from 'vscode';
import type { BatchOutcome } from '../../../types/multi-index.types.js';

/**
 * One-shot promise gate that lets the (future) multi-index runner `await` a
 * step's outcome from the preview webview, without the webview or its
 * message handlers knowing anything about promises.
 *
 * `vscode` is imported **type-only** — this module holds no runtime
 * dependency on the extension host, so its tests run without one.
 *
 * Exactly one slot is armed at a time. `settle` is idempotent: a successful
 * write, a user cancel, and panel disposal can all race to decide the same
 * step, and only the first call may win — the rest are no-ops.
 *
 * @example
 * const gate = new BatchGate();
 * const outcome = gate.arm(destDir); // shows the preview, then...
 * gate.settle({ kind: 'skipped' });
 * await outcome; // { kind: 'skipped' }
 */
export class BatchGate {
    private resolveFn: ((outcome: BatchOutcome) => void) | undefined;
    private armedDestDir: Uri | undefined;

    /** `true` once `arm` has been called and no `settle` has resolved it yet. */
    get isArmed(): boolean {
        return this.resolveFn !== undefined;
    }

    /** The `Uri` passed to `arm`, or `undefined` before arming and after settling. */
    get destDir(): Uri | undefined {
        return this.armedDestDir;
    }

    /**
     * Arms the gate for one step, returning the promise that `settle` resolves.
     *
     * @param destDir - Destination directory this step is running against; read
     *                  back via `destDir` while armed.
     * @returns Promise resolving to the outcome passed to the next `settle` call.
     * @throws Never — rejects the returned promise instead, so a caller that
     *         already holds a prior armed promise is unaffected.
     * @example
     * const outcome = gate.arm(vscode.Uri.file('/ws/dest'));
     */
    arm(destDir: Uri): Promise<BatchOutcome> {
        if (this.isArmed) {
            return Promise.reject(new Error('BatchGate: already armed — settle the current step first'));
        }
        this.armedDestDir = destDir;
        return new Promise<BatchOutcome>(resolve => {
            this.resolveFn = resolve;
        });
    }

    /**
     * Resolves the armed promise and disarms the gate. A second call — from a
     * race between a write, a cancel, and panel disposal — is a no-op, so only
     * the first outcome is ever observed.
     *
     * @param outcome - The result to resolve the armed promise with.
     * @example
     * gate.settle({ kind: 'aborted' });
     */
    settle(outcome: BatchOutcome): void {
        if (!this.resolveFn) { return; }
        const resolve = this.resolveFn;
        this.resolveFn    = undefined;
        this.armedDestDir = undefined;
        resolve(outcome);
    }
}
