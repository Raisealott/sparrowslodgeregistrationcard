/**
 * guestFlow.js
 * Step-by-step guest registration wizard (kiosk mode).
 *
 * Renders one question at a time with slide transitions.
 * Drives its UI entirely from the Questions.FLOW config array —
 * add/remove/reorder questions there without touching this file.
 *
 * Depends on: Questions, SignaturePad, FieldNormalizer
 */
const GuestFlow = (() => {

  let _state        = {};    // collected guest answers
  let _index        = 0;     // current position in the question flow
  let _busy         = false; // prevent double-tap during transitions
  let _onComplete   = null;  // callback(state, entryId) when guest finishes
  let _entryId      = null;

  const TRANSITION_MS = 320;

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Start the guest flow.
   * @param {object} prefill    — Pre-filled fields from parsed PDF (may be partial)
   * @param {string|null} entryId — Store entry to update on completion
   * @param {function} onComplete — Called with (finalState, entryId) when done
   */
  function start(prefill, entryId, onComplete) {
    _state      = { ...prefill };
    _entryId    = entryId;
    _onComplete = onComplete;
    _index      = 0;
    _busy       = false;

    // Wire nav buttons (safe to call multiple times — replaceWith clones)
    _bindNav();

    _renderSlide(0, 'none');
  }

  // ─── Navigation ──────────────────────────────────────────────

  function next() {
    if (_busy) return;

    const q     = _getFlow()[_index];
    const error = _validateAndSave(q);

    if (error) { _showError(error); return; }
    _clearError();

    // Last slide — hand off to the completion callback
    if (_index >= _getFlow().length - 1) {
      _onComplete?.(_state, _entryId);
      return;
    }

    _go(_index + 1, 'forward');
  }

  function back() {
    if (_busy || _index === 0) return;
    _clearError();
    _go(_index - 1, 'back');
  }

  // ─── Flow helpers ─────────────────────────────────────────────

  /**
   * Returns the active question array.
   * Confirm slides with no prefilled value are automatically downgraded
   * to text input slides so the guest isn't shown an empty confirm box.
   */
  function _getFlow() {
    return Questions.FLOW.map(q => {
      if (q.type === 'confirm' && !_state[q.field]) {
        return { ...q, type: 'text', inputType: q.inputType || 'text' };
      }
      return q;
    });
  }

  function _go(newIndex, direction) {
    _busy = true;

    const container = document.getElementById('guest-slides');
    const oldSlide  = container?.querySelector('.guest-slide.slide-active');
    const newSlide  = _buildSlide(_getFlow()[newIndex]);

    // Place incoming slide off-screen
    newSlide.classList.add(direction === 'back' ? 'slide-from-left' : 'slide-from-right');
    container?.appendChild(newSlide);

    // Force reflow so the CSS transition fires from the starting position
    void newSlide.offsetWidth;

    // Animate
    newSlide.classList.remove('slide-from-left', 'slide-from-right');
    newSlide.classList.add('slide-active');
    if (oldSlide) {
      oldSlide.classList.add(direction === 'back' ? 'slide-exit-right' : 'slide-exit-left');
    }

    _index = newIndex;
    _updateProgress();
    _updateNavButtons();

    setTimeout(() => {
      oldSlide?.remove();
      _busy = false;

      const q = _getFlow()[newIndex];

      // Auto-focus text inputs after transition
      if (q.type === 'text') {
        newSlide.querySelector('.guest-input')?.focus();
      }

      // Init signature pad after transition so canvas has final dimensions
      if (q.type === 'signature') {
        const canvas = newSlide.querySelector('#sig-canvas');
        if (canvas) {
          SignaturePad.init(canvas);
          newSlide.querySelector('.sig-clear-btn')
            ?.addEventListener('click', () => SignaturePad.clear());
        }
      }
    }, TRANSITION_MS);
  }

  // ─── Validation & state ───────────────────────────────────────

  function _validateAndSave(q) {
    // Signature: check canvas then save data URL
    if (q.type === 'signature') {
      if (SignaturePad.isEmpty()) return 'Please add your signature to continue.';
      _state.signature = SignaturePad.getDataUrl();
      return null;
    }

    // Stack: save each sub-field independently
    if (q.type === 'stack') {
      const slide = document.querySelector('.guest-slide.slide-active');
      q.inputs.forEach(inp => {
        const el = slide?.querySelector(`[data-field="${inp.field}"]`);
        _state[inp.field] = el?.value?.trim() || '';
      });
      if (q.requireOne) {
        const anyFilled = q.inputs.some(inp => _state[inp.field]);
        if (!anyFilled) return 'Please provide at least one contact method to continue.';
      }
      return null;
    }

    // Slides with no field (welcome, review, complete): nothing to validate
    if (!q.field) return null;

    const slide = document.querySelector('.guest-slide.slide-active');
    let value   = '';

    if (q.type === 'confirm') {
      // Value might be in an active edit input or the display element
      const editInput = slide?.querySelector('.confirm-edit-input');
      const display   = slide?.querySelector('.confirm-value');
      value = editInput
        ? (editInput.value ?? '')
        : (display?.dataset.value ?? display?.textContent ?? '');
    } else {
      value = slide?.querySelector('.guest-input')?.value ?? '';
    }

    value = value.trim();

    if (q.required && !value) {
      return `Please enter your ${q.label.toLowerCase()}.`;
    }

    if (q.inputType === 'email' && value) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
        return 'Please enter a valid email address.';
      }
    }

    _state[q.field] = value;
    return null;
  }

  // ─── Slide builders ───────────────────────────────────────────

  function _buildSlide(q) {
    const el = document.createElement('div');
    el.className    = 'guest-slide';
    el.dataset.qid  = q.id;

    const builders = {
      welcome:   _buildWelcome,
      confirm:   _buildConfirm,
      text:      _buildText,
      stack:     _buildStack,
      review:    _buildReview,
      signature: _buildSignature,
      complete:  _buildComplete,
    };

    el.innerHTML = (builders[q.type] ?? _buildText)(q);

    // Wire confirm "Edit" button
    if (q.type === 'confirm') _wireConfirm(el, q);

    // Allow Enter key to advance on single text inputs
    el.querySelector('.guest-input:not(.stack-input)')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); next(); }
    });

    // Stack inputs: Enter moves to next field, or advances on last field
    if (q.type === 'stack') {
      const stackInputs = [...el.querySelectorAll('.stack-input')];
      stackInputs.forEach((inp, i) => {
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (i < stackInputs.length - 1) stackInputs[i + 1].focus();
            else next();
          }
        });
      });

      // Autocomplete for inputs that declare a suggest type
      q.inputs.forEach((cfg, i) => {
        if (cfg.suggest) _attachCarAutocomplete(stackInputs[i], cfg.suggest, el);
      });
    }

    return el;
  }

  function _buildWelcome() {
    const name      = _state.guestName || '';
    const firstName = name.trim().split(/\s+/)[0] || '';
    return `
      <div class="guest-slide-inner guest-welcome">
        <div class="gw-hotel">SPARROWS LODGE</div>
        <div class="gw-hotel-sub">PALM SPRINGS</div>
        <div class="gw-greeting">
          ${firstName ? `Welcome,<br><strong>${_esc(firstName)}.</strong>` : 'Welcome.'}
        </div>
        <p class="gw-sub">Let's complete your check-in.<br>It'll only take a moment.</p>
      </div>`;
  }

  function _buildConfirm(q) {
    const value = _state[q.field] || '';
    return `
      <div class="guest-slide-inner">
        <div class="gs-label">${_esc(q.label)}</div>
        <div class="confirm-wrap">
          <div class="confirm-value" data-value="${_esc(value)}">${_esc(value) || '<span class="confirm-empty">—</span>'}</div>
          ${q.editable !== false ? `<button class="confirm-edit-btn" type="button">Edit</button>` : ''}
        </div>
        ${q.subLabel ? `<p class="gs-sub">${_esc(q.subLabel)}</p>` : ''}
      </div>`;
  }

  function _wireConfirm(slide, q) {
    const editBtn  = slide.querySelector('.confirm-edit-btn');
    const wrap     = slide.querySelector('.confirm-wrap');
    if (!editBtn) return;

    editBtn.addEventListener('click', function onEdit() {
      const display = wrap.querySelector('.confirm-value');
      const current = display?.dataset.value || display?.textContent || '';

      const input = document.createElement('input');
      input.type          = q.inputType || 'text';
      input.className     = 'confirm-edit-input guest-input';
      input.value         = current;
      input.autocomplete  = 'off';
      input.autocorrect   = 'off';
      input.spellcheck    = false;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); next(); } });

      wrap.replaceChild(input, display);
      editBtn.textContent = 'Done';
      input.focus();
      input.select();

      // Replace listener: "Done" commits edit back to a display element
      editBtn.removeEventListener('click', onEdit);
      editBtn.addEventListener('click', function onDone() {
        const newVal = input.value.trim();
        const newDisplay = document.createElement('div');
        newDisplay.className      = 'confirm-value';
        newDisplay.dataset.value  = newVal;
        newDisplay.textContent    = newVal || '—';
        wrap.replaceChild(newDisplay, input);
        editBtn.textContent = 'Edit';
        editBtn.removeEventListener('click', onDone);
        editBtn.addEventListener('click', onEdit);
      }, { once: false });
    });
  }

  function _buildStack(q) {
    const inputsHtml = q.inputs.map((inp, i) => `
      <div class="stack-field">
        <div class="stack-field-label">${_esc(inp.label)}</div>
        <input
          class="guest-input stack-input"
          type="text"
          placeholder="${_esc(inp.placeholder || '')}"
          value="${_esc(_state[inp.field] || '')}"
          data-field="${_esc(inp.field)}"
          data-stack-index="${i}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="words"
          spellcheck="false"
        >
      </div>`).join('');

    return `
      <div class="guest-slide-inner guest-stack">
        <div class="gs-label">${_esc(q.label)}</div>
        <div class="stack-inputs">${inputsHtml}</div>
        ${q.subLabel ? `<p class="gs-sub">${_esc(q.subLabel)}</p>` : ''}
      </div>`;
  }

  function _buildText(q) {
    const prefilled = _state[q.field] || '';
    return `
      <div class="guest-slide-inner">
        <div class="gs-label">${_esc(q.label)}</div>
        <input
          class="guest-input"
          type="${q.inputType || 'text'}"
          placeholder="${_esc(q.placeholder || '')}"
          value="${_esc(prefilled)}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="${q.inputType === 'email' || q.inputType === 'tel' ? 'none' : 'words'}"
          spellcheck="false"
        >
        ${q.subLabel ? `<p class="gs-sub">${_esc(q.subLabel)}</p>` : ''}
      </div>`;
  }

  function _buildReview() {
    const flow = _getFlow();
    const rows = flow
      .filter(q => q.showInReview)
      .map(q => {
        let val = '';

        if (q.type === 'stack') {
          val = q.inputs.map(inp => _state[inp.field] || '').filter(Boolean).join(' ').trim();
          if (!val) return ''; // skip if guest left both blank
        } else if (q.field) {
          val = _state[q.field] || '';
          if (!val) return '';
        } else {
          return '';
        }

        return `
          <div class="review-row">
            <span class="review-row-label">${_esc(q.reviewLabel || q.label)}</span>
            <span class="review-row-value">${_esc(val)}</span>
          </div>`;
      })
      .filter(Boolean);

    return `
      <div class="guest-slide-inner guest-review">
        <div class="gs-label">Review</div>
        <p class="gs-sub" style="margin-bottom:20px">Does everything look right?</p>
        <div class="review-list">${rows.join('')}</div>
      </div>`;
  }

  function _buildSignature() {
    return `
      <div class="guest-slide-inner guest-sig-slide">
        <div class="gs-label">Signature</div>
        <p class="gs-sub">By signing below you agree to Sparrows Lodge hotel policies.</p>
        <div class="sig-wrap">
          <canvas id="sig-canvas" class="sig-canvas" aria-label="Signature pad"></canvas>
          <div class="sig-baseline">
            <span class="sig-hint">sign above</span>
          </div>
        </div>
        <button class="sig-clear-btn" type="button">Clear</button>
      </div>`;
  }

  function _buildComplete() {
    const firstName = (_state.guestName || '').trim().split(/\s+/)[0] || '';
    return `
      <div class="guest-slide-inner guest-complete">
        <div class="guest-complete-mark">✓</div>
        <div class="guest-complete-heading">
          You're all set${firstName ? `, ${_esc(firstName)}` : ''}!
        </div>
        <p class="gs-sub">Welcome to Sparrows Lodge.<br>We hope you enjoy your stay.</p>
      </div>`;
  }

  // ─── UI state ─────────────────────────────────────────────────

  function _updateProgress() {
    const flow    = _getFlow();
    const counted = flow.filter(q => !['welcome', 'complete'].includes(q.type));
    const done    = flow.slice(0, _index).filter(q => !['welcome', 'complete'].includes(q.type)).length;
    const pct     = counted.length > 0 ? (done / counted.length) * 100 : 0;

    const bar = document.getElementById('guest-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
  }

  function _updateNavButtons() {
    const q       = _getFlow()[_index];
    const backBtn = document.getElementById('guest-btn-back');
    const nextBtn = document.getElementById('guest-btn-next');
    if (!backBtn || !nextBtn) return;

    backBtn.style.visibility = (_index === 0 || q.type === 'complete') ? 'hidden' : 'visible';

    const labels = {
      welcome:   'Begin Check-In  →',
      confirm:   'Yes, Continue  →',
      text:      'Continue  →',
      review:    'Looks Good  →',
      signature: 'I Agree & Sign  →',
      complete:  'Return to Front Desk',
    };
    nextBtn.textContent = labels[q.type] ?? 'Continue  →';
  }

  // ─── Error display ────────────────────────────────────────────

  function _showError(message) {
    const slide = document.querySelector('.guest-slide.slide-active');
    let el      = slide?.querySelector('.gs-error');
    if (!el) {
      el            = document.createElement('div');
      el.className  = 'gs-error';
      slide?.querySelector('.guest-slide-inner')?.appendChild(el);
    }
    el.textContent = message;

    const target = slide?.querySelector('.guest-input, .confirm-wrap, .sig-canvas');
    target?.classList.remove('gs-shake');
    void target?.offsetWidth;
    target?.classList.add('gs-shake');
  }

  function _clearError() {
    document.querySelector('.gs-error')?.remove();
  }

  // ─── First render ─────────────────────────────────────────────

  function _renderSlide(index) {
    const container = document.getElementById('guest-slides');
    if (!container) return;
    container.innerHTML = '';

    const slide = _buildSlide(_getFlow()[index]);
    slide.classList.add('slide-active');
    container.appendChild(slide);

    _updateProgress();
    _updateNavButtons();
  }

  // ─── Nav binding ──────────────────────────────────────────────

  function _bindNav() {
    const nb = document.getElementById('guest-btn-next');
    const bb = document.getElementById('guest-btn-back');

    // Clone to remove any prior listeners
    if (nb) {
      const fresh = nb.cloneNode(true);
      nb.parentNode.replaceChild(fresh, nb);
      fresh.addEventListener('click', next);
    }
    if (bb) {
      const fresh = bb.cloneNode(true);
      bb.parentNode.replaceChild(fresh, bb);
      fresh.addEventListener('click', back);
    }
  }

  // ─── Car autocomplete ─────────────────────────────────────────

  function _attachCarAutocomplete(input, suggestType, slideEl) {
    const dropdown = document.createElement('div');
    dropdown.className = 'car-suggestions';
    dropdown.hidden    = true;
    input.parentElement.appendChild(dropdown);

    function getSuggestions(val) {
      if (suggestType === 'carBrand') return CarData.suggestBrands(val);
      if (suggestType === 'carModel') {
        const makeInput = slideEl.querySelector('[data-field="carMake"]');
        return CarData.suggestModels(val, makeInput?.value || '');
      }
      return [];
    }

    function showDropdown(val) {
      const items = getSuggestions(val);
      if (!items.length) { dropdown.hidden = true; return; }

      dropdown.innerHTML = items
        .map(s => `<div class="car-suggestion">${_esc(s)}</div>`)
        .join('');
      dropdown.hidden = false;

      dropdown.querySelectorAll('.car-suggestion').forEach(item => {
        item.addEventListener('pointerdown', e => {
          e.preventDefault(); // keep focus on input; fires before blur
          input.value     = item.textContent;
          dropdown.hidden = true;
          if (suggestType === 'carBrand') {
            const modelInput = slideEl.querySelector('[data-field="carModel"]');
            if (modelInput) modelInput.value = '';
          }
          input.dispatchEvent(new Event('input'));
        });
      });
    }

    input.addEventListener('input', () => showDropdown(input.value.trim()));
    input.addEventListener('focus', () => { if (input.value.trim()) showDropdown(input.value.trim()); });
    input.addEventListener('blur',  () => setTimeout(() => { dropdown.hidden = true; }, 200));
  }

  // ─── Helpers ──────────────────────────────────────────────────

  function _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { start, next, back };
})();
