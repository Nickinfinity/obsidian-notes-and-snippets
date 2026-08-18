import { getLanguageMode, getDefaultLanguage, canMultiBlock, getTypeSingular } from '../../../services/artifact-type-config.service.js';
import type { ArtifactFormModel } from '../../../types/artifact-form.types.js';
import { escHtml, styleLinkTags } from '../../../utils/html.js';
import { labelForAddBlock, labelForDeleteEntire } from './form.helpers.js';
import { buildSingleBlockContent, buildMultiBlockArea } from './form.blocks.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Arguments for `buildFormHtml`.
 *
 * @example
 * buildFormHtml({ model, cspSource: panel.webview.cspSource, cssUri, nonce, codeBlockHtml })
 */
export interface BuildFormHtmlArgs {
    /** Form data model — drives all rendered fields. */
    model: ArtifactFormModel;
    /** Webview CSP source token (e.g. `panel.webview.cspSource`). */
    cspSource: string;
    /** Webview URI(s) for this panel's stylesheets, in cascade order. */
    cssUri: string | string[];
    /** CSP nonce threaded into `<script>` tags (Phase 6b). */
    nonce: string;
    /** Produces editable code-block HTML for a given code + language pair. */
    codeBlockHtml: (code: string, lang: string) => string;
    /**
     * Client-side JS bundle injected into the webview `<script>` tag.
     * Omit in tests (no script produced). Provided by the controller in production.
     */
    clientJs?: string;
}

/**
 * Builds the full HTML document for the Artifact Form webview panel.
 *
 * Pure function — no VS Code API calls. The webview lifecycle lives in
 * `panel.ts` (Phase 6c); this module only produces the HTML string.
 * All per-type behaviour (language mode, labels) flows through
 * `artifact-type-config.service` helpers — no type-string comparisons.
 *
 * @param args - See `BuildFormHtmlArgs`.
 * @returns Complete HTML document string.
 *
 * @example
 * const html = buildFormHtml({ model, cspSource, cssUri, nonce, codeBlockHtml });
 * panel.webview.html = html;
 */
export function buildFormHtml(args: BuildFormHtmlArgs): string {
    const { model, cspSource, cssUri, nonce, codeBlockHtml } = args;
    const languageMode = getLanguageMode(model.type);
    const lockedLang   = getDefaultLanguage(model.type);
    const multi        = model.blocks.length > 1;
    const multiAllowed = canMultiBlock(model.type);

    const singular     = getTypeSingular(model.type);
    const head         = buildHead(nonce, cspSource, cssUri);
    const frontmatter  = buildFrontmatterSection(model);
    const blocksArea   = multi
        ? buildMultiBlockArea(model, languageMode, lockedLang, codeBlockHtml)
        : buildSingleBlockContent(model.blocks[0], 0, languageMode, lockedLang, codeBlockHtml);
    const addBtn       = multiAllowed ? buildAddBlockButton(model.type) : '';
    const footer       = buildFooter(model.type);
    const areaClass    = `blocks-area${multi ? ' multi-block' : ''}`;
    const areaAttrs    = `id="blocks-area" class="${areaClass}" data-lang-mode="${escHtml(languageMode)}" data-default-lang="${escHtml(lockedLang)}" data-type="${escHtml(model.type)}" data-singular="${escHtml(singular)}"`;

    const scriptTag = args.clientJs
        ? buildScriptTag(nonce, args.clientJs)
        : '';

    return `<!DOCTYPE html>
<html lang="en">
${head}
<body class="form-body">
<div class="form-panel">
${frontmatter}
<div ${areaAttrs}>
${blocksArea}
</div>
${addBtn}
${footer}
</div>
${scriptTag}
</body>
</html>`;
}

// ── Script tag ────────────────────────────────────────────────────────────────

/**
 * Wraps the client JS bundle in a nonced `<script>` tag inside one outer IIFE.
 *
 * @param nonce    - CSP nonce matching the `Content-Security-Policy` header.
 * @param clientJs - Full client JS string (e.g. `FORM_CLIENT_JS`).
 * @returns `<script>` element string.
 *
 * @example
 * buildScriptTag('abc123', FORM_CLIENT_JS)
 */
function buildScriptTag(nonce: string, clientJs: string): string {
    const safeNonce = escHtml(nonce);
    return `<script nonce="${safeNonce}">(function(){const vscode=acquireVsCodeApi();${clientJs}})()</script>`;
}

// ── Head ──────────────────────────────────────────────────────────────────────

/**
 * Builds the `<head>` section including CSP meta and stylesheet link.
 *
 * @param nonce     - CSP nonce for `<script>` tags.
 * @param cspSource - Webview CSP source token.
 * @param cssUri    - Webview URI for the shared stylesheet.
 * @returns `<head>…</head>` HTML string.
 *
 * @example
 * buildHead('abc123', panel.webview.cspSource, cssUri.toString())
 */
function buildHead(nonce: string, cspSource: string, cssUri: string | string[]): string {
    const csp = `default-src 'none'; script-src 'nonce-${escHtml(nonce)}'; style-src ${escHtml(cspSource)};`;
    const link = styleLinkTags(cssUri);
    return `<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
${link}
</head>`;
}

// ── Frontmatter section ───────────────────────────────────────────────────────

/**
 * Builds the title, description, and tags fields (file-level frontmatter).
 *
 * @param model - Form model supplying title, description, and tags.
 * @returns HTML string for the frontmatter fields.
 *
 * @example
 * buildFrontmatterSection(model)
 */
function buildFrontmatterSection(model: ArtifactFormModel): string {
    const titleVal = escHtml(model.title);
    const descVal  = escHtml(model.description);
    const chips    = buildTagChips(model.tags);
    return `<div class="form-section">
  <label class="slabel" for="title">Title</label>
  <input type="text" id="title" class="form-input" value="${titleVal}" placeholder="Artifact title">
</div>
<div class="form-section">
  <label class="slabel" for="description">Description</label>
  <textarea id="description" class="form-input form-textarea" rows="2" placeholder="Optional description">${descVal}</textarea>
</div>
<div class="form-section">
  <div class="slabel">Tags</div>
  <div class="tags-row" id="tags-row">
${chips}    <input type="text" id="tag-input" class="tag-input" placeholder="Add tag…">
  </div>
</div>`;
}

/**
 * Builds `<span>` chip elements for each tag.
 *
 * @param tags - Tag strings from the model.
 * @returns HTML string of tag chip spans (may be empty).
 *
 * @example
 * buildTagChips(['api', 'express']) // → '<span class="tag-chip">api<button …>×</button></span>…'
 */
function buildTagChips(tags: string[]): string {
    if (tags.length === 0) { return ''; }
    return tags.map(tag => {
        const safe = escHtml(tag);
        return `    <span class="tag-chip">${safe}<button class="tag-remove" data-tag="${safe}" aria-label="Remove ${safe}">×</button></span>\n`;
    }).join('');
}

// ── Add-block button ──────────────────────────────────────────────────────────

/**
 * Builds the "Add additional block" button below the blocks area.
 *
 * Label derived from `labelForAddBlock` so it reflects the type's singular noun.
 *
 * @param type - Canonical artifact type.
 * @returns HTML string for the add-block button.
 *
 * @example
 * buildAddBlockButton('snippet') // → '<button …>+ Add additional snippet</button>'
 */
function buildAddBlockButton(type: ArtifactFormModel['type']): string {
    const label = escHtml(labelForAddBlock(type));
    return `<button id="add-block-btn" class="add-block-btn">${label}</button>`;
}

// ── Footer ────────────────────────────────────────────────────────────────────

/**
 * Builds the form footer with Save, Cancel, and Delete buttons.
 *
 * "Delete entire" label derived from `labelForDeleteEntire` — no type-string
 * comparisons.
 *
 * @param type - Canonical artifact type (drives delete label).
 * @returns HTML string for the form footer.
 *
 * @example
 * buildFooter('snippet')
 */
function buildFooter(type: ArtifactFormModel['type']): string {
    const deleteLabel = escHtml(labelForDeleteEntire(type));
    return `<div class="form-footer">
  <button id="save-btn" class="btn btn-primary">Save</button>
  <button id="cancel-btn" class="btn">Cancel</button>
  <button id="delete-btn" class="btn btn-danger">${deleteLabel}</button>
</div>`;
}
