import type { ParsedArtifactFile, ParsedVar } from '../../../types/parsed-artifact.types.js';
import { escHtml, styleLinkTags } from '../../../utils/html.js';
import { buildCodeBlockHtml } from './codeBlock.js';
import { PREVIEW_CLIENT_JS } from './preview.clientJs.js';
import { labelForVar, popupShell } from './preview.helpers.js';

// ── Var-merge helper ─────────────────────────────────────────────────────────

/**
 * Three-tier resolution: user-typed value → defaultValue → omit (so `resolveVars`
 * leaves the `<VK-xxx>` token intact).
 *
 * @param raw  - Raw `{ name → value }` map collected from the webview inputs.
 * @param vars - Parsed vars from the artifact (each carries a `defaultValue`).
 * @returns Resolved `{ name → value }` map, omitting vars with no effective value.
 *
 * @example
 * mergeVarsWithDefaults({ 'VK-host': '' }, [{ name: 'VK-host', defaultValue: 'localhost' }])
 * // → { 'VK-host': 'localhost' }
 */
export function mergeVarsWithDefaults(raw: Record<string, string>, vars: ParsedVar[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const v of vars) {
        const collected = raw[v.name] ?? '';
        const effective = collected || v.defaultValue;
        if (effective) { out[v.name] = effective; }
    }
    return out;
}

// ── HTML renderers ──────────────────────────────────────────────────────────

/**
 * Renders the interactive artifact preview HTML.
 *
 * Embeds the editable code block (Part 2) inside the outer preview script
 * (`PREVIEW_CLIENT_JS`); both share the same `vscode = acquireVsCodeApi()` IIFE.
 *
 * @param a            - Artifact to render.
 * @param codeRowsHtml - Pre-rendered code row HTML (see `renderCodeRowsHtml`).
 * @param nonce        - CSP nonce for the `<script>` tag.
 * @param cssUri       - Webview URI for the shared stylesheet.
 * @param cspSource    - Webview CSP source token.
 * @param varSources   - `{ varName → setName }` map for `from:` badges (Variable Sets).
 * @returns Complete HTML document string.
 *
 * @example
 * renderPreviewHtml(artifact, codeRowsHtml, nonce, cssUri, cspSource, {})
 */
export function renderPreviewHtml(
    a: ParsedArtifactFile,
    codeRowsHtml: string,
    nonce: string,
    cssUri: string | string[],
    cspSource: string,
    varSources: Record<string, string> = {},
): string {
    const e = escHtml;
    const title    = e(a.frontmatter.title || a.fileName);
    const type     = e(a.frontmatter.type);
    const lang     = a.frontmatter.language ? e(a.frontmatter.language) : '';
    const desc     = a.frontmatter.description ? e(a.frontmatter.description) : '';
    const env      = a.frontmatter.env ? `<span class="pill">env: ${e(a.frontmatter.env)}</span>` : '';
    const target   = a.frontmatter.target ? `<span class="pill">target: ${e(a.frontmatter.target)}</span>` : '';
    const tagsHtml = (a.frontmatter.tags ?? []).map(t => `<span class="tag">${e(t)}</span>`).join('');

    const inputsHtml = a.vars.length > 0
        ? a.vars.map(v => {
            const src = varSources[v.name];
            const badge = src ? `<span class="var-source" data-var-source="${e(v.name)}">from: ${e(src)}</span>` : '';
            return `
             <div class="input-row">
               <label for="v-${e(v.name)}">${e(labelForVar(v.name))}</label>
               <input id="v-${e(v.name)}" data-var="${e(v.name)}" type="text"
                      value="${e(v.defaultValue)}" placeholder="${e(labelForVar(v.name))}">
               ${badge}
             </div>`;
          }).join('')
        : '<p class="muted">No variables defined.</p>';

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
${styleLinkTags(cssUri)}
</head>
<body class="popup-body">
  <h1>${title}</h1>
  <div class="badges">
    <span class="badge">${type}</span>
    ${lang ? `<span class="badge lang">${lang}</span>` : ''}
    ${env}${target}
  </div>
  ${desc ? `<p class="desc">${desc}</p>` : ''}
  ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
  ${buildCodeBlockHtml(codeRowsHtml, lang)}
  <div class="slabel">Variables</div>
  <div id="varsSection">
    <div class="inputs" id="varInputs">${inputsHtml}</div>
    <div class="actions varset-actions">
      <button class="btn btn-secondary" id="applyVarSetBtn">Apply Variable Set</button>
      <button class="btn btn-secondary" id="saveAsVarSetBtn" style="display:none;">Save as Variable Set</button>
    </div>
  </div>
  <div class="actions">
    <button class="btn btn-insert"    id="insertBtn">Insert</button>
    <button class="btn btn-secondary" id="editBlockBtn">Edit Block</button>
    <button class="btn btn-secondary" id="editBtn">Edit .md</button>
    <button class="btn btn-cancel"    id="cancelBtn">Cancel</button>
  </div>
  <p class="path">${e(a.relativePath)}</p>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  ${PREVIEW_CLIENT_JS}
})();
</script>
</body>
</html>`;
}

/**
 * Renders a stacked read-only preview of all blocks in a multi-block artifact.
 *
 * @param a                 - Multi-block artifact to preview.
 * @param highlightedBlocks - Per-block pre-rendered code HTML + metadata.
 * @param cssUri            - Webview URI for the shared stylesheet.
 * @param cspSource         - Webview CSP source token.
 * @returns Complete HTML document string.
 *
 * @example
 * renderMultiBlockPreviewHtml(artifact, highlightedBlocks, cssUri, cspSource)
 */
export function renderMultiBlockPreviewHtml(
    a: ParsedArtifactFile,
    highlightedBlocks: { heading: string; codeHtml: string; vars: ParsedVar[]; description: string }[],
    cssUri: string | string[],
    cspSource: string,
): string {
    const e = escHtml;
    const title    = e(a.frontmatter.title || a.fileName);
    const type     = e(a.frontmatter.type);
    const lang     = a.frontmatter.language ? e(a.frontmatter.language) : '';
    const tagsHtml = (a.frontmatter.tags ?? []).map(t => `<span class="tag">${e(t)}</span>`).join('');

    const blocksHtml = highlightedBlocks.map(b => {
        const varCodes = b.vars.map(v => `<code>${e(v.name)}</code>`).join(' · ');
        const varsRow  = b.vars.length > 0 ? `<p class="muted block-vars">${varCodes}</p>` : '';
        return /* html */`
    <h2 class="block-heading">${e(b.heading)}</h2>
    ${b.description ? `<p class="desc">${e(b.description)}</p>` : ''}
    ${b.codeHtml}
    ${varsRow}`;
    }).join('\n');

    return popupShell(/* html */`
    <h1>${title}</h1>
    <div class="badges">
      <span class="badge">${type}</span>
      ${lang ? `<span class="badge lang">${lang}</span>` : ''}
    </div>
    ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
    ${blocksHtml}
    <p class="path">${e(a.relativePath)}</p>
    <p class="hint">Press Enter to choose a block.</p>`,
    cssUri, cspSource);
}

/**
 * Renders the popup's empty-state placeholder ("Select a file to preview").
 *
 * @param cssUri    - Webview URI for the shared stylesheet.
 * @param cspSource - Webview CSP source token.
 * @returns Complete HTML document string.
 *
 * @example
 * renderPopupEmptyHtml(cssUri, cspSource)
 */
export function renderPopupEmptyHtml(cssUri: string | string[], cspSource: string): string {
    return popupShell(
        '<p style="text-align:center;margin-top:40px">Select a file to preview</p>',
        cssUri,
        cspSource,
    );
}
