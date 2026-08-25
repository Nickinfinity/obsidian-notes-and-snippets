import * as assert from 'node:assert';
import { decideFormPanelAction } from '../src/ui/panels/artifactForm/panel.js';

/**
 * Guard for D5 — `openArtifactFormPanel`'s singleton used to `reveal()` and
 * drop `opts` entirely, so the *second* capture in a session silently reopened
 * the **first** capture's form. Every create-from-context path routes through
 * that one call, which is why the fix lives at the call site rather than in
 * five capture handlers.
 *
 * Only the decision is tested here. The panel itself is `vscode`-coupled and is
 * checked at the F5 gate; extracting the rule is what makes the rule testable
 * at all.
 */
suite('form panel prefill decision (D5)', () => {

	// ── No panel open ────────────────────────────────────────────────────────

	test('no controller → create, whatever else is true', () => {
		assert.strictEqual(
			decideFormPanelAction({ hasController: false, hasPrefill: false, isDirty: false }),
			'create',
		);
		assert.strictEqual(
			decideFormPanelAction({ hasController: false, hasPrefill: true, isDirty: true }),
			'create',
		);
	});

	// ── Panel open, no prefill ───────────────────────────────────────────────

	test('open panel + no prefill → reveal, and never prompts even when dirty', () => {
		assert.strictEqual(
			decideFormPanelAction({ hasController: true, hasPrefill: false, isDirty: false }),
			'reveal',
		);
		// A bare "open the form" carries nothing new to show, so unsaved work is
		// not at risk and the user must not be asked about it.
		assert.strictEqual(
			decideFormPanelAction({ hasController: true, hasPrefill: false, isDirty: true }),
			'reveal',
		);
	});

	// ── Panel open, prefill arriving — the D5 case ───────────────────────────

	test('open panel + prefill + clean → retarget', () => {
		assert.strictEqual(
			decideFormPanelAction({ hasController: true, hasPrefill: true, isDirty: false }),
			'retarget',
		);
	});

	test('open panel + prefill + dirty → confirm first', () => {
		assert.strictEqual(
			decideFormPanelAction({ hasController: true, hasPrefill: true, isDirty: true }),
			'confirm-then-retarget',
		);
	});

	test('THE REGRESSION: an arriving prefill is never answered with a bare reveal', () => {
		// This is the whole of D5. `reveal` here means the capture the user just
		// made is silently discarded and they are shown the previous one — no
		// error, no clue. Asserted over both dirty states so neither branch can
		// regress to the old behaviour independently.
		for (const isDirty of [false, true]) {
			const action = decideFormPanelAction({ hasController: true, hasPrefill: true, isDirty });
			assert.notStrictEqual(
				action, 'reveal',
				`a prefill must never be dropped (isDirty=${isDirty})`,
			);
			assert.ok(
				action === 'retarget' || action === 'confirm-then-retarget',
				`expected the prefill to be applied, got "${action}"`,
			);
		}
	});
});
