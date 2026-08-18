import { CODE_BLOCK_CLIENT_JS } from '../artifactPicker/codeBlock.js';

// ── Exported client JS bundle ─────────────────────────────────────────────────

/**
 * Client-side JavaScript bundle for the Artifact Form webview panel.
 *
 * Intended to be embedded inside one outer IIFE that provides
 * `const vscode = acquireVsCodeApi()` — call that exactly once per webview.
 * Includes `CODE_BLOCK_CLIENT_JS` (which sets up `window.__codeBlock` for
 * the first / only code area, and also carries the shared `esc`/`lbl`
 * helpers from `webviewSnippets.ts` — see `renderVarsSection` below) then
 * layers in all form-specific interactivity.
 *
 * Responsibilities:
 * 1. Include CODE_BLOCK_CLIENT_JS — exposes `window.__codeBlock` + `renderRows`
 *    + the shared `esc`/`lbl` helpers.
 * 2. Track dirty state; post `markDirty` once per session.
 * 3. Title blur → `validateName`; render `nameValidation` reply inline.
 * 4. Code changes → `detectVars { blockIndex, code }`; merge reply to var inputs.
 * 5. Tag input: Enter to commit, block `,`/`]`/newlines; `×` removes chip.
 * 6. `+` button → `addBlock` + locally append empty card; focus new heading.
 * 7. `×` on card → `removeBlock { blockIndex }`; splice DOM on `removeBlockConfirmed`.
 * 8. `↑`/`↓` → swap adjacent card DOM nodes locally (no round-trip).
 * 9. Save → §3.7 client-side validation; post `save { model }` on pass.
 * 10. Cancel → `cancel { dirty }`; dispose on `cancelConfirmed`.
 * 11. Delete entire → `deleteEntire`; dispose on `deleteEntireConfirmed`.
 * 12. Ext→webview messages: nameValidation, varsDetected, saveResult,
 *     removeBlockConfirmed, deleteEntireConfirmed, cancelConfirmed.
 *
 * @example
 * panel.webview.html = `<script nonce="${nonce}">(function(){
 *   const vscode = acquireVsCodeApi();
 *   ${FORM_CLIENT_JS}
 * })();</script>`;
 */
export const FORM_CLIENT_JS: string = `${CODE_BLOCK_CLIENT_JS}

  // ── Form client (Phase 6b) ───────────────────────────────────────────────

  // ── State ────────────────────────────────────────────────────────────────
  let dirty = false;
  let savePending = false;
  const pendingConfirm = {};   // { removeBlock, deleteEntire, cancel }
  let tags = [];

  // ── Dirty tracking ───────────────────────────────────────────────────────
  function markDirty() {
    if (dirty) { return; }
    dirty = true;
    vscode.postMessage({ command: 'markDirty', dirty: true });
  }

  // ── Per-block code extraction ────────────────────────────────────────────
  // renderRows is in scope from CODE_BLOCK_CLIENT_JS (line 0 shared helpers).
  function extractCodeFrom(wrapper) {
    const rows = wrapper.querySelectorAll('.code-line-row');
    if (rows.length === 0) { return wrapper.textContent || ''; }
    const parts = [];
    rows.forEach(function(r) {
      const c = r.querySelector('.code-content');
      parts.push(c ? (c.textContent || '') : '');
    });
    return parts.join('\\n');
  }

  // ── Block area helpers ───────────────────────────────────────────────────
  const blocksArea = document.getElementById('blocks-area');
  const langMode   = blocksArea ? blocksArea.dataset.langMode : 'free';
  const defLang    = blocksArea ? (blocksArea.dataset.defaultLang || '') : '';
  const singular   = blocksArea ? (blocksArea.dataset.singular || 'block') : 'block';

  function allCards() {
    return Array.from(document.querySelectorAll('.block-card'));
  }

  function cardAt(blockIndex) {
    return document.querySelector('.block-card[data-block-index="' + blockIndex + '"]');
  }

  function codeWrapperInCard(card) {
    return card ? card.querySelector('.code-block-wrapper') : null;
  }

  // ── Code area event setup ────────────────────────────────────────────────
  function initCodeArea(wrapper, blockIndex) {
    let detectTimer;
    wrapper.addEventListener('input', function() {
      markDirty();
      if (detectTimer) { clearTimeout(detectTimer); }
      detectTimer = setTimeout(function() {
        detectTimer = undefined;
        vscode.postMessage({ command: 'detectVars', blockIndex: blockIndex, code: extractCodeFrom(wrapper) });
      }, 300);
    });
    wrapper.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); document.execCommand('insertText', false, '\\n'); }
    });
    wrapper.addEventListener('paste', function(ev) {
      ev.preventDefault();
      const text = (ev.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
  }

  function initAllCodeAreas() {
    // Single-block: window.__codeBlock already covers #codeWrapper.
    // Multi-block: init each card's wrapper by card DOM order = block index.
    const single = document.getElementById('codeWrapper');
    if (single) {
      single.addEventListener('input', function() {
        markDirty();
        setTimeout(function() {
          vscode.postMessage({ command: 'detectVars', blockIndex: 0, code: extractCodeFrom(single) });
        }, 300);
      });
      return;
    }
    allCards().forEach(function(card, i) {
      const wrapper = codeWrapperInCard(card);
      if (wrapper) { initCodeArea(wrapper, i); }
    });
  }

  // ── Reorder button state ─────────────────────────────────────────────────
  function refreshReorderButtons() {
    const cards = allCards();
    const total = cards.length;
    cards.forEach(function(card, i) {
      const up   = card.querySelector('[data-action="up"]');
      const down = card.querySelector('[data-action="down"]');
      if (up)   { if (i === 0)          { up.setAttribute('disabled', ''); }   else { up.removeAttribute('disabled'); } }
      if (down) { if (i === total - 1)  { down.setAttribute('disabled', ''); } else { down.removeAttribute('disabled'); } }
    });
  }

  // ── New block card HTML ──────────────────────────────────────────────────
  function buildNewCardHtml(blockIndex, total) {
    const isFirst = blockIndex === 0;
    const isLast  = blockIndex === total - 1;
    const upDis   = isFirst ? ' disabled' : '';
    const downDis = isLast  ? ' disabled' : '';
    const langSelHtml = buildNewLangSelectHtml(blockIndex);
    return '<div class="block-card" data-block-index="' + blockIndex + '">' +
      '<div class="card-header">' +
        '<input type="text" id="block-' + blockIndex + '-heading" class="block-heading-input" value="" data-block="' + blockIndex + '" placeholder="Block heading">' +
        langSelHtml +
        '<button class="reorder-btn" data-action="up" data-block="' + blockIndex + '"' + upDis + '>↑</button>' +
        '<button class="reorder-btn" data-action="down" data-block="' + blockIndex + '"' + downDis + '>↓</button>' +
        '<button class="remove-block-btn" data-block="' + blockIndex + '">\xd7</button>' +
        '<button class="expand-btn" data-block="' + blockIndex + '" aria-label="Toggle block">⎾</button>' +
      '</div>' +
      '<div class="card-body expanded" data-block="' + blockIndex + '">' +
        '<div class="field-row">' +
          '<label class="slabel" for="block-' + blockIndex + '-desc">Description</label>' +
          '<textarea id="block-' + blockIndex + '-desc" class="form-input form-textarea" data-block="' + blockIndex + '" rows="2" placeholder="Optional block description"></textarea>' +
        '</div>' +
        '<div class="block-code">' +
          '<div class="code-block-wrapper editable" contenteditable="true" spellcheck="false" data-lang="' + defLang + '"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function buildNewLangSelectHtml(blockIndex) {
    if (langMode === 'hidden') { return ''; }
    if (langMode === 'locked') {
      return '<select id="block-' + blockIndex + '-lang" class="lang-select" data-block="' + blockIndex + '" disabled>' +
        '<option value="' + defLang + '" selected>' + defLang + '</option>' +
      '</select>';
    }
    // Clone options from first existing select
    const firstSel = document.querySelector('.lang-select');
    if (!firstSel) { return ''; }
    const clone = firstSel.cloneNode(true);
    clone.id = 'block-' + blockIndex + '-lang';
    clone.dataset.block = String(blockIndex);
    Array.from(clone.options).forEach(function(opt) { opt.selected = opt.value === defLang; });
    return clone.outerHTML;
  }

  // ── Re-index cards after splice/reorder ──────────────────────────────────
  function reindexCards() {
    allCards().forEach(function(card, i) {
      card.dataset.blockIndex = String(i);
      card.querySelectorAll('[data-block]').forEach(function(el) { el.dataset.block = String(i); });
      const heading = card.querySelector('.block-heading-input');
      if (heading) { heading.id = 'block-' + i + '-heading'; }
      const langSel = card.querySelector('.lang-select');
      if (langSel) { langSel.id = 'block-' + i + '-lang'; }
      const desc = card.querySelector('.form-textarea');
      if (desc) { desc.id = 'block-' + i + '-desc'; }
    });
    refreshReorderButtons();
  }

  // ── Transition: single → multi-block ────────────────────────────────────
  function activateMultiBlock() {
    if (!blocksArea) { return; }
    blocksArea.classList.add('multi-block');
  }

  function deactivateMultiBlock() {
    if (!blocksArea) { return; }
    blocksArea.classList.remove('multi-block');
  }

  // ── Tag management ───────────────────────────────────────────────────────
  function renderTags() {
    const row = document.getElementById('tags-row');
    if (!row) { return; }
    const input = document.getElementById('tag-input');
    const chips = tags.map(function(t) {
      return '<span class="tag-chip">' + t +
        '<button class="tag-remove" data-tag="' + t + '" aria-label="Remove ' + t + '">\xd7</button>' +
        '</span>';
    }).join('');
    row.innerHTML = chips + (input ? input.outerHTML : '<input type="text" id="tag-input" class="tag-input" placeholder="Add tag…">');
    wireTagInput();
  }

  function wireTagInput() {
    const input = document.getElementById('tag-input');
    if (!input) { return; }
    input.addEventListener('keydown', function(ev) {
      if (ev.key === ',' || ev.key === ']' || ev.key === 'Enter') {
        ev.preventDefault();
        const val = input.value.trim();
        if (val && !tags.includes(val)) { tags.push(val); markDirty(); renderTags(); }
        else { input.value = ''; }
      }
    });
    document.querySelectorAll('.tag-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const tag = btn.dataset.tag;
        tags = tags.filter(function(t) { return t !== tag; });
        markDirty();
        renderTags();
      });
    });
  }

  // ── Name validation ──────────────────────────────────────────────────────
  const titleInput = document.getElementById('title');
  const nameError  = document.getElementById('name-error') || (function() {
    const el = document.createElement('div');
    el.id = 'name-error';
    el.className = 'field-error';
    el.style.display = 'none';
    if (titleInput && titleInput.parentNode) { titleInput.parentNode.insertBefore(el, titleInput.nextSibling); }
    return el;
  })();

  let validateTimer;
  if (titleInput) {
    titleInput.addEventListener('input', markDirty);
    titleInput.addEventListener('blur', function() {
      if (validateTimer) { clearTimeout(validateTimer); }
      validateTimer = setTimeout(function() {
        validateTimer = undefined;
        vscode.postMessage({ command: 'validateName', name: titleInput.value });
      }, 200);
    });
  }

  // ── Model extraction ─────────────────────────────────────────────────────
  function extractModel() {
    const type      = blocksArea ? (blocksArea.dataset.type || 'snippet') : 'snippet';
    const title     = titleInput ? titleInput.value : '';
    const descEl    = document.getElementById('description');
    const desc      = descEl ? descEl.value : '';
    const blockEls  = allCards();
    let blocks;
    if (blockEls.length === 0) {
      // single-block (inline, no cards)
      const wrapper = document.getElementById('codeWrapper');
      const langSel = document.getElementById('block-0-lang');
      blocks = [{
        heading:     '',
        description: '',
        language:    langSel ? langSel.value : defLang,
        code:        wrapper ? extractCodeFrom(wrapper) : '',
        vars:        extractVarsForBlock(0),
      }];
    } else {
      blocks = blockEls.map(function(card, i) {
        const headingEl = card.querySelector('.block-heading-input');
        const descEl2   = card.querySelector('.form-textarea');
        const langEl    = card.querySelector('.lang-select');
        const wrapper   = codeWrapperInCard(card);
        return {
          heading:     headingEl ? headingEl.value : '',
          description: descEl2  ? descEl2.value  : '',
          language:    langEl   ? langEl.value   : defLang,
          code:        wrapper  ? extractCodeFrom(wrapper) : '',
          vars:        extractVarsForBlock(i),
        };
      });
    }
    return { type: type, title: title, description: desc, tags: tags.slice(), blocks: blocks };
  }

  function extractVarsForBlock(blockIndex) {
    const rows = document.querySelectorAll('.var-row[data-block="' + blockIndex + '"]');
    const vars = [];
    rows.forEach(function(row) {
      const name  = row.dataset.var || '';
      const input = row.querySelector('.var-input');
      vars.push({ name: name, defaultValue: input ? input.value : '' });
    });
    return vars;
  }

  // ── §3.7 Client-side validation ──────────────────────────────────────────
  function validateForSave(model) {
    const errors = [];
    if (!model.title.trim()) { errors.push({ field: 'title', msg: 'Title is required.' }); }
    const hasCode = model.blocks.some(function(b) { return b.code.trim().length > 0; });
    if (!hasCode) { errors.push({ field: 'blocks', msg: 'At least one block must have code.' }); }
    if (model.blocks.length > 1) {
      const allHeadings = model.blocks.every(function(b) { return b.heading.trim().length > 0; });
      if (!allHeadings) { errors.push({ field: 'headings', msg: 'Every block must have a heading.' }); }
    }
    return errors;
  }

  function showValidationErrors(errors) {
    const saveError = document.getElementById('save-error') || (function() {
      const el = document.createElement('div');
      el.id = 'save-error';
      el.className = 'field-error';
      const footer = document.querySelector('.form-footer');
      if (footer) { footer.insertBefore(el, footer.firstChild); }
      return el;
    })();
    if (errors.length === 0) { saveError.style.display = 'none'; saveError.textContent = ''; return; }
    saveError.style.display = '';
    saveError.textContent = errors.map(function(e) { return e.msg; }).join(' ');
    if (nameError && errors.some(function(e) { return e.field === 'title'; })) {
      nameError.style.display = '';
      nameError.textContent = 'Title is required.';
    }
  }

  // ── Message dispatcher ───────────────────────────────────────────────────
  window.addEventListener('message', function(event) {
    const msg = event.data;
    switch (msg.command) {
      case 'nameValidation': {
        if (!nameError) { break; }
        if (msg.ok) { nameError.style.display = 'none'; nameError.textContent = ''; }
        else { nameError.style.display = ''; nameError.textContent = msg.reason || 'Invalid name.'; }
        break;
      }
      case 'varsDetected': {
        mergeVarsDetected(msg.blockIndex, msg.vars || []);
        break;
      }
      case 'saveResult': {
        savePending = false;
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) { saveBtn.removeAttribute('disabled'); }
        if (!msg.ok && msg.error) {
          showValidationErrors([{ field: 'save', msg: msg.error }]);
        }
        break;
      }
      case 'removeBlockConfirmed': {
        if (!msg.confirmed) { break; }
        const card = cardAt(msg.blockIndex);
        if (card) { card.remove(); }
        if (allCards().length === 1) { deactivateMultiBlock(); }
        reindexCards();
        break;
      }
      case 'deleteEntireConfirmed': {
        if (msg.confirmed) { vscode.postMessage({ command: 'cancel', dirty: false }); }
        break;
      }
      case 'cancelConfirmed': {
        if (msg.confirmed) { vscode.postMessage({ command: 'cancel', dirty: false }); }
        break;
      }
    }
  });

  function mergeVarsDetected(blockIndex, detectedVars) {
    // Preserve existing typed defaults; add new detected names; orphans kept.
    const existing = {};
    document.querySelectorAll('.var-row[data-block="' + blockIndex + '"]').forEach(function(row) {
      const input = row.querySelector('.var-input');
      existing[row.dataset.var || ''] = input ? input.value : '';
    });
    const merged = detectedVars.map(function(v) {
      return { name: v.name, defaultValue: existing[v.name] !== undefined ? existing[v.name] : '' };
    });
    // Keep orphans with non-empty defaults
    Object.keys(existing).forEach(function(name) {
      const inCode = detectedVars.some(function(v) { return v.name === name; });
      if (!inCode && existing[name]) { merged.push({ name: name, defaultValue: existing[name] }); }
    });
    renderVarsSection(blockIndex, merged);
  }

  function renderVarsSection(blockIndex, vars) {
    const container = blockIndex === 0 && !document.querySelector('.block-card')
      ? document.querySelector('.block')
      : cardAt(blockIndex);
    if (!container) { return; }
    let varsSec = container.querySelector('.vars-section');
    if (!varsSec) {
      varsSec = document.createElement('div');
      varsSec.className = 'vars-section';
      const codeDiv = container.querySelector('.block-code');
      if (codeDiv && codeDiv.parentNode) { codeDiv.parentNode.insertBefore(varsSec, codeDiv.nextSibling); }
      else { container.appendChild(varsSec); }
    }
    if (vars.length === 0) { varsSec.style.display = 'none'; return; }
    varsSec.style.display = '';
    const rows = vars.map(function(v) {
      // esc() is mandatory here: v.name/v.defaultValue come from vault-file
      // content re-parsed after a save round-trip (fileUpdated), so they are
      // untrusted input crossing the webview boundary — an unescaped quote
      // would break out of the data-var/value attributes.
      const safeName = esc(v.name);
      return '<tr class="var-row" data-var="' + safeName + '" data-block="' + blockIndex + '">' +
        '<td class="var-name">' + esc(lbl(v.name)) + '</td>' +
        '<td class="var-default">' +
          '<input type="text" class="var-input" data-var="' + safeName + '" data-block="' + blockIndex + '" value="' + esc(v.defaultValue) + '" placeholder="Default value">' +
        '</td></tr>';
    }).join('');
    varsSec.innerHTML = '<div class="slabel">Variables</div><table class="vars-table"><tbody>' + rows + '</tbody></table>';
  }

  // ── Button wiring ────────────────────────────────────────────────────────
  function wireButtons() {
    // Save
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function() {
        if (savePending) { return; }
        const model  = extractModel();
        const errors = validateForSave(model);
        if (errors.length > 0) { showValidationErrors(errors); return; }
        showValidationErrors([]);
        savePending = true;
        saveBtn.setAttribute('disabled', '');
        vscode.postMessage({ command: 'save', model: model });
      });
    }

    // Cancel
    const cancelBtn = document.getElementById('cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        vscode.postMessage({ command: 'cancel', dirty: dirty });
      });
    }

    // Delete entire
    const deleteBtn = document.getElementById('delete-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        vscode.postMessage({ command: 'deleteEntire' });
      });
    }

    // Add block
    const addBtn = document.getElementById('add-block-btn');
    if (addBtn) {
      addBtn.addEventListener('click', function() {
        const cards = allCards();
        const newIndex = cards.length;
        if (newIndex === 1) { activateMultiBlock(); }
        const total    = newIndex + 1;
        const newHtml  = buildNewCardHtml(newIndex, total);
        const tmp      = document.createElement('div');
        tmp.innerHTML  = newHtml;
        const newCard  = tmp.firstElementChild;
        if (blocksArea && newCard) {
          blocksArea.appendChild(newCard);
          reindexCards();
          const wrapper = codeWrapperInCard(newCard);
          if (wrapper) { initCodeArea(wrapper, newIndex); }
          const headingInput = newCard.querySelector('.block-heading-input');
          if (headingInput) { headingInput.focus(); }
          markDirty();
          vscode.postMessage({ command: 'addBlock' });
        }
      });
    }

    // Remove block + reorder (delegated on blocksArea)
    if (blocksArea) {
      blocksArea.addEventListener('click', function(ev) {
        const target = ev.target;
        if (!target) { return; }
        if (target.classList.contains('remove-block-btn')) {
          const blockIndex = parseInt(target.dataset.block || '0', 10);
          vscode.postMessage({ command: 'removeBlock', blockIndex: blockIndex });
        }
        if (target.classList.contains('reorder-btn')) {
          const action     = target.dataset.action;
          const blockIndex = parseInt(target.dataset.block || '0', 10);
          const cards      = allCards();
          if (action === 'up' && blockIndex > 0) {
            const a = cards[blockIndex - 1];
            const b = cards[blockIndex];
            if (a && b && a.parentNode) { a.parentNode.insertBefore(b, a); }
            reindexCards();
            markDirty();
          }
          if (action === 'down' && blockIndex < cards.length - 1) {
            const a = cards[blockIndex];
            const b = cards[blockIndex + 1];
            if (a && b && b.nextSibling) { b.parentNode.insertBefore(a, b.nextSibling); }
            else if (a && b) { b.parentNode.appendChild(a); }
            reindexCards();
            markDirty();
          }
        }
        if (target.classList.contains('expand-btn')) {
          const blockIndex = parseInt(target.dataset.block || '0', 10);
          const card = cardAt(blockIndex);
          if (card) {
            const body = card.querySelector('.card-body');
            if (body) { body.classList.toggle('expanded'); }
          }
        }
      });
    }

    // Wire any input change → dirty
    document.querySelectorAll('.form-input, .form-textarea, .lang-select, .block-heading-input').forEach(function(el) {
      el.addEventListener('input', markDirty);
      el.addEventListener('change', markDirty);
    });
  }

  // ── Initialise ───────────────────────────────────────────────────────────
  // Read initial tags from existing chips in the DOM
  document.querySelectorAll('.tag-chip').forEach(function(chip) {
    const btn = chip.querySelector('.tag-remove');
    if (btn && btn.dataset.tag) { tags.push(btn.dataset.tag); }
  });
  wireTagInput();
  wireButtons();
  initAllCodeAreas();
`;
