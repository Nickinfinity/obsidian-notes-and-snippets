import { getCreateFormTypes, getEntry } from '../../services/artifact-type-config.service.js';
import { escHtml, styleLinkTags } from '../../utils/html.js';
import type { ArtifactType } from '../../types/parsed-artifact.types.js';

/**
 * One row in the main pane's idle-mode create list.
 */
export interface CreateItem {
    /** Canonical artifact type this row creates. */
    type: ArtifactType;
    /** Row label — literal `Create ` prefix + `getEntry(type).name`. */
    label: string;
}

// ── Data ─────────────────────────────────────────────────────────────────────

/**
 * Builds the idle-mode "create" row data, one row per create-form-enabled
 * artifact type.
 *
 * Order and membership come from `getCreateFormTypes()` (`ARTIFACTS`
 * declaration order) — the main pane never hardcodes a type list, so a new
 * create-form type in `ARTIFACTS` surfaces here automatically.
 *
 * @returns One `CreateItem` per create-form-enabled type, in `ARTIFACTS` order.
 *
 * @example
 * buildCreateItems()[0] // → { type: 'Snippet', label: 'Create Snippets' }
 */
export function buildCreateItems(): CreateItem[] {
    return getCreateFormTypes().map(type => ({ type, label: `Create ${getEntry(type).name}` }));
}

/**
 * Resolves the base create command id for a `createType` webview message,
 * or `undefined` when `type` is not a create-form type.
 *
 * `type` crosses the webview boundary untrusted: `getEntry` alone would
 * accept any of the six `ArtifactType` literals (including `Variables`,
 * which has no create form), resolving to an `obsidian-artifacts.create.*`
 * id that is never registered. Gating on membership in the same
 * `getCreateFormTypes()` list the rows are built from keeps the two in
 * lockstep — a type can never be clickable here without also being a valid
 * target.
 *
 * @param type - Raw `type` value from a `{ command: 'createType', type }` message.
 * @returns `obsidian-artifacts.create.<dir>` for a create-form type, else `undefined`.
 *
 * @example
 * resolveCreateCommandId('Snippet')   // → 'obsidian-artifacts.create.snippets'
 * resolveCreateCommandId('Variables') // → undefined — not a create-form type
 */
export function resolveCreateCommandId(type: string): string | undefined {
    const createType = getCreateFormTypes().find(t => t === type);
    if (!createType) {
        return undefined;
    }
    return `obsidian-artifacts.create.${getEntry(createType).dir.toLowerCase()}`;
}

// ── HTML ─────────────────────────────────────────────────────────────────────

/**
 * Renders the idle-mode webview HTML — one clickable row per create item.
 *
 * Every interpolated value is escaped via `escHtml`. Clicking (or pressing
 * Enter/Space on) a row posts `{ command: 'createType', type }` to the
 * extension host.
 *
 * Every row uses the same vendored codicon "add" glyph
 * (`Artifact.icon` is unpopulated by every `ARTIFACTS` entry today, so a
 * per-type icon branch would be five identical fallbacks dressed up as a
 * feature that does not exist).
 *
 * @param items     - Rows to render, from `buildCreateItems()`.
 * @param cssUris   - Webview URIs for the stylesheets — `base.css` first.
 * @param cspSource - Webview CSP source token (`webview.cspSource`).
 * @param nonce     - CSP nonce shared by the `<style>` and `<script>` tags.
 * @returns Complete HTML document string for `webview.html`.
 *
 * @example
 * renderIdleHtml(buildCreateItems(), [baseCssUri, codiconCssUri], webview.cspSource, getNonce())
 */
export function renderIdleHtml(
    items: CreateItem[],
    cssUris: string | string[],
    cspSource: string,
    nonce: string,
): string {
    const rows = items.map(item => `
      <button class="create-row" data-type="${escHtml(item.type)}">
        <span class="codicon codicon-add" aria-hidden="true"></span>
        <span class="create-row-label">${escHtml(item.label)}</span>
      </button>`).join('');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${cspSource};">
${styleLinkTags(cssUris)}
<style nonce="${nonce}">
  .create-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin-bottom: 4px;
    text-align: left;
  }
  .create-row-label { flex: 1; }
</style>
</head>
<body class="popup-body">
  <div class="create-list">${rows}</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('.create-row').forEach(function (el) {
    el.addEventListener('click', function () {
      vscode.postMessage({ command: 'createType', type: el.dataset.type });
    });
  });
})();
</script>
</body>
</html>`;
}

/**
 * Renders the empty preview-mode placeholder.
 *
 * The main pane is one webview with two modes (`idle` | `preview`); `preview`
 * lands in Wave 7. This is the seam `MainViewProvider.setMode('preview')`
 * switches to today — no content beyond the shared stylesheets, so the CSP
 * declares only what those stylesheets need: linked styles and (via
 * `codicon.css`'s `@font-face`) the vendored font. No `script-src` — the
 * placeholder has no `<script>` tag, and `default-src 'none'` already blocks
 * one if it appeared.
 *
 * @param cssUris   - Webview URIs for the stylesheets — `base.css` first.
 * @param cspSource - Webview CSP source token (`webview.cspSource`).
 * @returns Complete HTML document string for `webview.html`.
 *
 * @example
 * renderPreviewPlaceholderHtml([baseCssUri], webview.cspSource)
 */
export function renderPreviewPlaceholderHtml(
    cssUris: string | string[],
    cspSource: string,
): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource}; font-src ${cspSource};">
${styleLinkTags(cssUris)}
</head>
<body class="popup-body"></body>
</html>`;
}
