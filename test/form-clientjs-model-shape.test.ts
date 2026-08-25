import * as assert from 'node:assert';
import { FORM_CLIENT_JS } from '../src/ui/panels/artifactForm/form.clientJs.js';
import { getAllTypes } from '../src/services/artifact-type-config.service.js';
import type { ArtifactFormModel } from '../src/types/artifact-form.types.js';

/**
 * Drift guard: the create form's client-side `extractModel()` ↔ `ArtifactFormModel`.
 *
 * The webview has no module system, so `extractModel()` builds the save payload
 * as an object literal inside a template-literal string — invisible to `tsc`.
 * `panel.ts` then casts the posted value `as ArtifactFormModel` without
 * narrowing, so a key that drifts from the interface does not fail to compile:
 * the field simply arrives `undefined` at runtime.
 *
 * That is not hypothetical. The `type` → `artifactType` rename (D1a) renamed the
 * interface field and every TypeScript reader, but not the key the webview
 * posts. The result compiled clean and broke **every** create-form save with
 * "Unknown artifact type." — `getEntry(undefined)` throwing behind a catch. This
 * suite is what fails instead of the user.
 */
suite('form client JS model shape ↔ ArtifactFormModel', () => {

	/**
	 * Pulls the key names out of `extractModel()`'s returned object literal.
	 *
	 * @returns The payload keys the webview actually posts, in source order.
	 * @example
	 * modelKeysFromClientJs() // → ['artifactType', 'title', 'description', …]
	 */
	function modelKeysFromClientJs(): string[] {
		// Anchored on `title:`, the one key the rename never touches, so a drifted
		// first key still gets extracted and named in the failure rather than
		// silently turning this guard into "literal not found".
		const ret = /return \{ ([^{}]*\btitle\s*:[^{}]*)\};/.exec(FORM_CLIENT_JS);
		assert.ok(ret, 'extractModel() return literal not found in FORM_CLIENT_JS');
		return [...ret[1].matchAll(/(\w+)\s*:/g)].map(m => m[1]);
	}

	// Compile-time half of the bind: renaming a field on the interface makes this
	// array stop compiling, which is what forces the runtime half below to be
	// updated in the same change.
	const MODEL_KEYS: readonly (keyof ArtifactFormModel)[] = [
		'artifactType', 'title', 'description', 'tags',
		'extension', 'target', 'provider', 'model', 'version', 'blocks',
	];

	test('every posted key is a real ArtifactFormModel field', () => {
		for (const key of modelKeysFromClientJs()) {
			assert.ok(
				(MODEL_KEYS as readonly string[]).includes(key),
				`extractModel() posts "${key}", which is not a field of ArtifactFormModel`,
			);
		}
	});

	test('the required fields are all posted', () => {
		const posted = modelKeysFromClientJs();
		for (const key of ['artifactType', 'title', 'description', 'tags', 'blocks']) {
			assert.ok(posted.includes(key), `extractModel() never posts required field "${key}"`);
		}
	});

	test('every id in TYPE_FIELD_IDS is also posted by extractModel', () => {
		// The two client-side lists are separate and neither compiles: TYPE_FIELD_IDS
		// only wires the dirty-tracking listener, while the payload is built by
		// extractModel's own readTypeField calls. Adding a key to one and not the
		// other marks the form dirty and posts nothing — which is precisely what
		// D6's `target` would have done, since an *optional* field's absence slips
		// past both existing tests here.
		const ids = /const TYPE_FIELD_IDS = \[([^\]]*)\]/.exec(FORM_CLIENT_JS);
		assert.ok(ids, 'TYPE_FIELD_IDS not found in FORM_CLIENT_JS');
		const listed = [...ids[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
		assert.ok(listed.length > 0, 'TYPE_FIELD_IDS parsed to an empty list');
		const posted = modelKeysFromClientJs();
		for (const id of listed) {
			assert.ok(posted.includes(id), `TYPE_FIELD_IDS lists "${id}" but extractModel() never posts it`);
		}
	});

	test('the artifactType fallback literal is a real ArtifactType', () => {
		// `dataset.type || '<fallback>'` fires when the blocks area is missing.
		// A stale lowercase spelling here reaches getEntry and throws.
		const fallbacks = [...FORM_CLIENT_JS.matchAll(/dataset\.type \|\| '([^']+)'\) : '([^']+)'/g)];
		assert.ok(fallbacks.length > 0, 'dataset.type fallback not found in FORM_CLIENT_JS');
		const types: readonly string[] = getAllTypes();
		for (const [, orFallback, elseFallback] of fallbacks) {
			assert.ok(types.includes(orFallback), `fallback "${orFallback}" is not a registered ArtifactType`);
			assert.ok(types.includes(elseFallback), `fallback "${elseFallback}" is not a registered ArtifactType`);
		}
	});
});
