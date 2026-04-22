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
  let _policyFitRaf = null;

  const TRANSITION_MS = 320;
  const CONTACT_STEP_ID = 'contact';

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

      if (q.type === 'policy') {
        _schedulePolicyFit(newSlide);
      }
    }, TRANSITION_MS);
  }

  // ─── Validation & state ───────────────────────────────────────

  function _validateAndSave(q) {
    // Signature: check canvas then save stroke data
    if (q.type === 'signature') {
      if (SignaturePad.isEmpty()) return 'Please add your signature to continue.';
      _state.signature = SignaturePad.getStrokes();
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

    if (q.type === 'policy') {
      const value = (_state[q.field] || '').trim();
      if (q.required && !value) {
        return 'Please choose Approve or Decline to continue.';
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
      policy:    _buildPolicy,
      confirm:   _buildConfirm,
      text:      _buildText,
      stack:     _buildStack,
      review:    _buildReview,
      signature: _buildSignature,
      complete:  _buildComplete,
    };

    el.innerHTML = (builders[q.type] ?? _buildText)(q);

    // Wire type-specific controls
    if (q.type === 'confirm') _wireConfirm(el, q);
    if (q.type === 'policy') _wirePolicy(el, q);

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

      if (q.id === CONTACT_STEP_ID) {
        _wireContactPrefillControls(el, q);
      }
    }

    // Auto-capitalize first typed character for text-like inputs.
    el.querySelectorAll('.guest-input').forEach(_bindAutoCapitalizeFirstLetter);

    return el;
  }

  function _buildWelcome() {
    const name      = _state.guestName || '';
    const firstName = name.trim().split(/\s+/)[0] || '';
    return `
      <div class="guest-slide-inner guest-welcome">
        <div class="gw-greeting">
          ${firstName ? `Welcome,<br><strong>${_esc(firstName)}.</strong>` : 'Welcome.'}
        </div>
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
      _bindAutoCapitalizeFirstLetter(input);

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

  function _bindAutoCapitalizeFirstLetter(input) {
    if (!input) return;
    const type = String(input.type || 'text').toLowerCase();
    if (type === 'email' || type === 'tel' || type === 'password') return;

    input.addEventListener('input', () => {
      const original = input.value ?? '';
      const updated  = _capitalizeFirstLetter(original);
      if (updated === original) return;

      const start = input.selectionStart;
      const end   = input.selectionEnd;
      input.value = updated;
      if (start !== null && end !== null) input.setSelectionRange(start, end);
    });
  }

  function _capitalizeFirstLetter(value) {
    return String(value).replace(/^([a-z])/, c => c.toUpperCase());
  }

  function _buildStack(q) {
    const isContactStep = q.id === CONTACT_STEP_ID;

    const inputsHtml = q.inputs.map((inp, i) => {
      const inputHtml = `
        <input
          class="guest-input stack-input${isContactStep && _state[inp.field] ? ' is-prefilled' : ''}"
          type="${_esc(inp.inputType || 'text')}"
          placeholder="${_esc(inp.placeholder || '')}"
          value="${_esc(_state[inp.field] || '')}"
          data-field="${_esc(inp.field)}"
          data-stack-index="${i}"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="${(inp.inputType === 'email' || inp.inputType === 'tel') ? 'none' : 'words'}"
          spellcheck="false"
        >`;

      return `
        <div class="stack-field">
          <div class="stack-field-label">${_esc(inp.label)}</div>
          ${isContactStep
            ? `<div class="stack-field-row">${inputHtml}${_buildContactPrefillControls(inp)}</div>`
            : inputHtml}
        </div>`;
    }).join('');

    return `
      <div class="guest-slide-inner guest-stack">
        <div class="gs-label">${_esc(q.label)}</div>
        <div class="stack-inputs">${inputsHtml}</div>
        ${q.subLabel ? `<p class="gs-sub">${_esc(q.subLabel)}</p>` : ''}
      </div>`;
  }

  function _buildPolicy(q) {
    const selected = _state[q.field] || 'Approved';
    if (!_state[q.field]) _state[q.field] = 'Approved';
    const isApproved = selected === 'Approved';
    const isDeclined = selected === 'Declined';

    return `
      <div class="guest-slide-inner guest-policy">
        <div class="guest-policy-card">
          <div class="policy-copy">
            <div class="policy-box-title">Greetings from Sparrow's Lodge!</div>
            <p>Sparrow's Lodge has a 48-hour cancellation policy. In the event of an early departure, one night's room and tax will be applied to your bill. Payment of all charges must be secured at check-in. Sparrow's Lodge offers physical room keys - you may be charged $100 for any lost keys.</p>
            <p>Payment may be made by acceptable credit, debit card, or other management-approved billing methods. Guests paying by credit card acknowledge that their card will be preauthorized for all room and tax charges. Additional authorization is taken to secure guest incidental charges. This includes incidentals or guests whose room and tax charges are being paid by a third party. Any unused authorization is released at the time of check-out. Please note that your financial institution will determine how quickly the authorization is released back to your account.</p>
            <p>For your convenience, Sparrow's Lodge will create a running account for your charges made at the lobby bar/restaurant. Unless instructed otherwise, a 20% auto gratuity will be automatically added to your account.</p>
            <p>Pool Hours: 6 am - 11 pm | Flotation devices, any type of ball, and/or amplified music are not permitted in the pool area. Pool use is exclusive to registered guests. There is no glass by the pool at any time. All outside Food and Beverages are strictly prohibited in public areas.</p>
            <p>Sparrow's Lodge is not responsible for property lost, stolen, or left behind on the property. Sparrow's Lodge offers outdoor parking for guests' convenience and is not responsible for any lost or stolen items from vehicles or damage to vehicles parked on the property.</p>
            <p>Sparrow's Lodge is 100% non-smoking. A smoking and cleaning fee of $250 will be charged to any room where evidence of smoking is found.</p>
            <p>We welcome dogs less than 40 pounds with a one-time fee of $100 per stay, per dog. All dogs are required to be on a leash at all times.</p>
            <p>For your convenience and to enhance your guest experience, we welcome you to participate in the daily resort fee upon arrival. The resort fee includes access to the property Wi-Fi, the Sparrows Lodge breakfast, overnight self-parking, and more. Valued at $75, these amenities are available to our guests for $40 per night.</p>
          </div>
          <div class="policy-choice-row">
            <button class="policy-choice-btn${isApproved ? ' selected' : ''}" data-policy-choice="Approved" type="button">Opt In - welcome drink, breakfast, bikes, smores, wifi &amp; more ($40 per night)</button>
            <button class="policy-choice-btn${isDeclined ? ' selected' : ''}" data-policy-choice="Declined" type="button">Opt Out - welcome drink, breakfast, bikes, smores, wifi &amp; more</button>
          </div>
        </div>
      </div>`;
  }

  function _wirePolicy(slide, q) {
    const buttons = [...slide.querySelectorAll('.policy-choice-btn')];
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.policyChoice || '';
        _state[q.field] = choice;
        buttons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        _clearError();
      });
    });

    _schedulePolicyFit(slide);
  }

  function _schedulePolicyFit(slide) {
    if (!slide) return;
    if (_policyFitRaf) cancelAnimationFrame(_policyFitRaf);
    _policyFitRaf = requestAnimationFrame(() => {
      _fitPolicyTypography(slide);
      _fitPolicyChoiceButtons(slide);
      _policyFitRaf = requestAnimationFrame(() => {
        _fitPolicyTypography(slide);
        _fitPolicyChoiceButtons(slide);
      });
    });
  }

  function _fitPolicyTypography(slide) {
    const copy = slide?.querySelector('.policy-copy');
    if (!copy) return;

    // Reset to defaults before measuring.
    copy.style.removeProperty('--policy-body-size');
    copy.style.removeProperty('--policy-title-size');
    copy.style.removeProperty('--policy-body-line-height');

    // Find the largest readable font that fully fits inside the copy area.
    let low = 12;
    let high = 40;
    let best = 12;

    const apply = (sizePx) => {
      copy.style.setProperty('--policy-body-size', `${sizePx}px`);
      copy.style.setProperty('--policy-title-size', `${Math.max(13, sizePx - 1)}px`);
      copy.style.setProperty('--policy-body-line-height', sizePx >= 18 ? '1.4' : '1.45');
    };

    for (let i = 0; i < 11; i++) {
      const mid = (low + high) / 2;
      apply(mid);
      if (copy.scrollHeight <= copy.clientHeight) {
        best = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    apply(Math.round(best * 10) / 10);
  }

  function _fitPolicyChoiceButtons(slide) {
    const buttons = [...(slide?.querySelectorAll('.policy-choice-btn') || [])];
    if (!buttons.length) return;

    buttons.forEach(btn => {
      const width = btn.getBoundingClientRect().width;
      if (!width) return;

      // Scale button label size by button width for iPad/readability,
      // with sane bounds so it stays legible but doesn't overflow.
      const sizePx = Math.max(14, Math.min(22, width * 0.022));
      btn.style.setProperty('--policy-choice-size', `${Math.round(sizePx * 10) / 10}px`);
    });
  }

  function _buildContactPrefillControls(inp) {
    const hasPrefilled = Boolean(_state[inp.field]);
    if (!hasPrefilled) return '';

    return `
      <div class="contact-prefill-controls" data-contact-field="${_esc(inp.field)}">
        <button class="contact-confirm-btn contact-confirm-decline" type="button" title="Clear and re-enter">✕</button>
      </div>`;
  }

  function _wireContactPrefillControls(slide, q) {
    function clearPrefilledField(input) {
      const field = input.dataset.field;
      _state[field] = '';
      input.value = '';
      input.classList.remove('is-prefilled');
      input.dataset.quickClearArmed = '0';
      const row = slide.querySelector(`.contact-prefill-controls[data-contact-field="${field}"]`);
      row?.remove();
      input.focus();
    }

    const rows = [...slide.querySelectorAll('.contact-prefill-controls')];
    rows.forEach(row => {
      const field = row.dataset.contactField;
      if (!field) return;

      const input = slide.querySelector(`.stack-input[data-field="${field}"]`);
      const declineBtn = row.querySelector('.contact-confirm-decline');
      if (!input || !declineBtn) return;

      declineBtn.addEventListener('click', () => {
        clearPrefilledField(input);
      });
    });

    // First Backspace/Delete on a prefilled contact field clears it entirely.
    const prefilledInputs = [...slide.querySelectorAll('.stack-input.is-prefilled')];
    prefilledInputs.forEach(input => {
      input.dataset.quickClearArmed = '1';

      input.addEventListener('keydown', e => {
        if ((e.key === 'Backspace' || e.key === 'Delete') && input.dataset.quickClearArmed === '1') {
          e.preventDefault();
          clearPrefilledField(input);
        }
      });

      input.addEventListener('input', () => {
        input.dataset.quickClearArmed = '0';
      });
    });
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
        <div class="sig-wrap">
          <canvas id="sig-canvas" class="sig-canvas" aria-label="Signature pad"></canvas>
          <div class="sig-baseline"></div>
        </div>
        <button class="sig-clear-btn" type="button">Clear</button>
        <p class="gs-sub sig-agreement">By signing above you agree to Sparrows Lodge hotel policies.</p>
      </div>`;
  }

  function _buildComplete() {
    const fullName = (_state.guestName || '').trim();
    const guestName = (fullName.split(/\s+/)[0] || '').trim() || 'Guest';
    return `
      <div class="guest-slide-inner guest-complete">
        <img src="assets/youre all set bird.png" alt="You're all set" class="guest-complete-img">
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
    const artSlot = document.getElementById('guest-welcome-art');
    if (!backBtn || !nextBtn) return;

    const showBack = !(_index === 0 || q.type === 'complete');
    backBtn.style.display = showBack ? '' : 'none';
    if (artSlot) artSlot.style.display = (q.type === 'welcome') ? 'flex' : 'none';

    const labels = {
      welcome:   'Begin Check-In  →',
      policy:    'Continue  →',
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

    const q = _getFlow()[index];
    if (q?.type === 'policy') _schedulePolicyFit(slide);
  }

  // ─── Nav binding ──────────────────────────────────────────────

  function _bindNav() {
    const nb = document.getElementById('guest-btn-next');
    const bb = document.getElementById('guest-btn-back');
    const art = document.getElementById('guest-welcome-art');

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
    if (art) {
      const fresh = art.cloneNode(true);
      art.parentNode.replaceChild(fresh, art);
      fresh.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('guestflow:home'));
      });
    }
  }

  window.addEventListener('resize', () => {
    const active = document.querySelector('.guest-slide.slide-active[data-qid="policy"]');
    if (active) _schedulePolicyFit(active);
  });

  // ─── Car autocomplete ─────────────────────────────────────────

  function _attachCarAutocomplete(input, suggestType, slideEl) {
    const dropdown = document.createElement('div');
    dropdown.className = 'car-suggestions';
    dropdown.hidden    = true;
    input.parentElement.appendChild(dropdown);
    let suppressNextInputDropdown = false;

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
          suppressNextInputDropdown = true;
          if (suggestType === 'carBrand') {
            const modelInput = slideEl.querySelector('[data-field="carModel"]');
            if (modelInput) modelInput.value = '';
          }
          input.dispatchEvent(new Event('input'));
        });
      });
    }

    input.addEventListener('input', () => {
      if (suppressNextInputDropdown) {
        suppressNextInputDropdown = false;
        return;
      }
      showDropdown(input.value.trim());
    });
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


