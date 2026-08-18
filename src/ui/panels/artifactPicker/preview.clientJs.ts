import { CODE_BLOCK_CLIENT_JS } from './codeBlock.js';

/**
 * Client-side JavaScript bundle for the interactive artifact preview popup.
 *
 * Intended to be embedded inside one outer IIFE that provides
 * `const vscode = acquireVsCodeApi()` — call that exactly once per webview
 * (see `preview.render.ts:renderPreviewHtml`). Includes `CODE_BLOCK_CLIENT_JS`
 * first (which also carries the shared `esc`/`lbl` helpers — see
 * `webviewSnippets.ts`), then layers in preview-panel-specific interactivity:
 * variable inputs, Insert/Edit/Cancel buttons, and the Variable-Set apply/
 * save flow.
 *
 * Responsibilities:
 * 1. Include CODE_BLOCK_CLIENT_JS — exposes `window.__codeBlock` + shared
 *    `esc`/`lbl`.
 * 2. Collect `[data-var]` input values; wire Insert/Edit Block/Edit .md/
 *    Cancel buttons and Ctrl/Cmd+Enter to Insert.
 * 3. Apply/Save-as Variable Set buttons; clears a var's `from:` badge on
 *    manual edit.
 * 4. `updateVars` / `fileUpdated` messages → rebuild the variable inputs,
 *    preserving already-typed values.
 * 5. `showVarSetDiff` / `varSetApplied` / `varSetCancelled` messages → diff
 *    preview swap-in/restore.
 *
 * @example
 * panel.webview.html = `<script nonce="${nonce}">(function(){
 *   const vscode = acquireVsCodeApi();
 *   ${PREVIEW_CLIENT_JS}
 * })();</script>`;
 */
export const PREVIEW_CLIENT_JS: string = `${CODE_BLOCK_CLIENT_JS}
  const varInputs = document.getElementById('varInputs');

  // ── Buttons ──────────────────────────────────────────────────────────────
  function collectVars() {
    const out = {};
    document.querySelectorAll('[data-var]').forEach(function (el) { out[el.dataset.var] = el.value; });
    return out;
  }
  document.getElementById('insertBtn').addEventListener('click', function () {
    window.__codeBlock.flushPendingRender();
    vscode.postMessage({ command: 'insert', vars: collectVars(), code: window.__codeBlock.extractCode() });
  });
  document.getElementById('editBlockBtn').addEventListener('click', function () {
    vscode.postMessage({ command: 'editBlock' });
  });
  document.getElementById('editBtn').addEventListener('click', function () {
    vscode.postMessage({ command: 'fullEdit' });
  });
  document.getElementById('cancelBtn').addEventListener('click', function () {
    vscode.postMessage({ command: 'cancel' });
  });
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      document.getElementById('insertBtn').click();
    }
  });

  // ── Variable-set buttons ─────────────────────────────────────────────────
  const varsSection = document.getElementById('varsSection');
  let savedVarsHtml = null;  // snapshot of inputs HTML used to restore on cancelApply

  function refreshSaveBtn() {
    const btn = document.getElementById('saveAsVarSetBtn');
    if (!btn) { return; }
    const hasValue = Object.values(collectVars()).some(function (v) { return v && v.length > 0; });
    btn.style.display = hasValue ? '' : 'none';
  }

  const applyBtn = document.getElementById('applyVarSetBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      vscode.postMessage({ command: 'pickVarSet', values: collectVars() });
    });
  }
  const saveBtn = document.getElementById('saveAsVarSetBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      vscode.postMessage({ command: 'saveAsVarSet', values: collectVars() });
    });
  }
  varInputs.addEventListener('input', function (ev) {
    const t = ev.target;
    if (t && t.dataset && t.dataset.var) {
      // Manual edit removes the source badge for this var.
      const badge = varInputs.querySelector('[data-var-source="' + t.dataset.var + '"]');
      if (badge) {
        badge.remove();
        vscode.postMessage({ command: 'clearVarSource', name: t.dataset.var });
      }
    }
    refreshSaveBtn();
  });
  refreshSaveBtn();

  // ── updateVars / fileUpdated incoming messages ──────────────────────────
  function rebuildVarInputs(vars) {
    const existing = collectVars();
    if (!vars || vars.length === 0) {
      varInputs.innerHTML = '<p class="muted">No variables defined.</p>';
      return;
    }
    varInputs.innerHTML = vars.map(function (v) {
      const value = existing[v.name] !== undefined ? existing[v.name] : (v.defaultValue || '');
      return '<div class="input-row">' +
        '<label for="v-' + esc(v.name) + '">' + esc(lbl(v.name)) + '</label>' +
        '<input id="v-' + esc(v.name) + '" data-var="' + esc(v.name) + '" type="text" value="' + esc(value) + '" placeholder="' + esc(lbl(v.name)) + '">' +
      '</div>';
    }).join('');
  }
  // ── Var-set diff / applied / cancelled handlers ─────────────────────────
  function showDiffView(html) {
    if (!varsSection) { return; }
    if (savedVarsHtml === null) { savedVarsHtml = varsSection.innerHTML; }
    varsSection.innerHTML = html;
    const applyBtn  = document.getElementById('varSetApplyBtn');
    const cancelBtn = document.getElementById('varSetCancelBtn');
    if (applyBtn)  { applyBtn.addEventListener('click',  function () { vscode.postMessage({ command: 'confirmApply' }); }); }
    if (cancelBtn) { cancelBtn.addEventListener('click', function () { vscode.postMessage({ command: 'cancelApply'  }); }); }
  }
  function restoreVarsView() {
    if (!varsSection || savedVarsHtml === null) { return; }
    varsSection.innerHTML = savedVarsHtml;
    savedVarsHtml = null;
    refreshSaveBtn();
  }
  function applyValuesAndBadges(values, subSetName, varNames) {
    restoreVarsView();
    const inputs = document.querySelectorAll('[data-var]');
    inputs.forEach(function (el) {
      const name = el.dataset.var;
      if (Object.prototype.hasOwnProperty.call(values, name)) { el.value = values[name]; }
    });
    const flagged = new Set(varNames || []);
    flagged.forEach(function (name) {
      const input = varInputs.querySelector('[data-var="' + name + '"]');
      if (!input) { return; }
      const row = input.closest('.input-row');
      if (!row) { return; }
      const existing = row.querySelector('[data-var-source]');
      if (existing) { existing.remove(); }
      const badge = document.createElement('span');
      badge.className = 'var-source';
      badge.dataset.varSource = name;
      badge.textContent = 'from: ' + subSetName;
      row.appendChild(badge);
    });
    refreshSaveBtn();
  }

  window.addEventListener('message', function (event) {
    const msg = event.data || {};
    if (msg.command === 'updateVars')  { rebuildVarInputs(msg.vars); refreshSaveBtn(); }
    if (msg.command === 'fileUpdated' && msg.artifact) {
      window.__codeBlock.setCode(msg.artifact.code || '');
      rebuildVarInputs(msg.artifact.vars);
      refreshSaveBtn();
    }
    if (msg.command === 'showVarSetDiff') { showDiffView(msg.html); }
    if (msg.command === 'varSetApplied')  { applyValuesAndBadges(msg.values || {}, msg.subSetName || '', msg.varNames || []); }
    if (msg.command === 'varSetCancelled'){ restoreVarsView(); }
  });
`;
