/**
 * app.js
 * Main controller — manages step navigation and entry lifecycle.
 *
 * Steps:  login → dashboard → upload → processing → review → card → guest
 *
 * Entry lifecycle:
 *   "Generate Card" → saved to DB as 'current'
 *   "Complete"      → status updated to 'previous', back to dashboard
 *   "Save & Close"  → stays 'current', back to dashboard
 *   Tap dashboard row → open card for that entry
 */
const App = (() => {

  let _parsedData    = null;  // PDF parse result (holds rateLines)
  let _currentId     = null;  // DB id of the entry being viewed
  let _unsubscribe   = null;  // real-time subscription cleanup

  // ─── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    Uploader.init(onFileSelected);

    // Review step
    document.getElementById('btn-confirm')?.addEventListener('click', onConfirm);
    document.getElementById('btn-back-upload')?.addEventListener('click', () => goToStep('upload'));

    // Card step
    document.getElementById('btn-edit')?.addEventListener('click', async () => {
      if (_currentId) {
        const entry = await DB.getById(_currentId);
        if (entry) populateReviewForm(entry.fields);
      }
      goToStep('review');
    });
    document.getElementById('btn-save-draft')?.addEventListener('click', onSaveDraft);
    document.getElementById('btn-hand-to-guest')?.addEventListener('click', onHandToGuest);

    // Dashboard
    document.getElementById('btn-new-registration')?.addEventListener('click', startNewRegistration);
    document.getElementById('btn-sign-out')?.addEventListener('click', onSignOut);

    // Recently deleted toggle
    document.getElementById('btn-deleted-toggle')?.addEventListener('click', () => {
      const list    = document.getElementById('list-deleted');
      const chevron = document.querySelector('#btn-deleted-toggle .deleted-chevron');
      if (!list) return;
      list.hidden = !list.hidden;
      if (chevron) chevron.textContent = list.hidden ? '▾' : '▴';
    });

    // All "← Home" buttons
    document.querySelectorAll('.btn-go-dashboard').forEach(btn =>
      btn.addEventListener('click', () => { renderDashboard(); goToStep('dashboard'); })
    );
    window.addEventListener('guestflow:home', () => { renderDashboard(); goToStep('dashboard'); });

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', onLoginSubmit);

    // Auth: restore session or show login
    const session = await Auth.init();
    if (session) {
      await _onAuthenticated();
    } else {
      goToStep('login');
    }

    // Listen for future auth changes (e.g., session expiry)
    Auth.onAuthChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
        goToStep('login');
      }
    });
  }

  async function _onAuthenticated() {
    // Update property name in header
    const property = Auth.getProperty();
    document.querySelectorAll('.hotel-name').forEach(el => {
      if (property?.name) el.textContent = property.name;
    });

    // Seed today's date in the dashboard header
    const dateEl = document.getElementById('dashboard-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US',
        { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    await renderDashboard();
    goToStep('dashboard');

    // Real-time sync: re-render dashboard whenever another device makes a change
    _unsubscribe = DB.subscribeToChanges(() => renderDashboard());
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  async function onLoginSubmit(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email')?.value?.trim() ?? '';
    const password = document.getElementById('login-password')?.value ?? '';
    const errorEl  = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login');

    if (errorEl) errorEl.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

    const { error } = await Auth.signIn(email, password);

    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }

    if (error) {
      if (errorEl) { errorEl.textContent = error; errorEl.hidden = false; }
      return;
    }

    await _onAuthenticated();
  }

  async function onSignOut() {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    await Auth.signOut();
    goToStep('login');
  }

  // ─── Step navigation ──────────────────────────────────────────────────────

  function goToStep(name) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`step-${name}`);
    if (target) {
      target.classList.add('active');
      target.querySelector('.step-body')?.scrollTo(0, 0);
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  async function renderDashboard() {
    const all      = await DB.getAll();
    const current  = all.filter(e => e.status === 'current');
    const previous = all.filter(e => e.status === 'previous');

    renderGroup('list-current',  current,  'No current registrations');
    renderGroup('list-previous', previous, 'No previous entries');
    await renderDeletedGroup();

    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n > 0 ? `(${n})` : '';
    };
    setBadge('count-current',  current.length);
    setBadge('count-previous', previous.length);
  }

  async function renderDeletedGroup() {
    const deleted    = await DB.getDeleted();
    const container  = document.getElementById('list-deleted');
    const countEl    = document.getElementById('count-deleted');

    if (countEl) countEl.textContent = deleted.length > 0 ? `(${deleted.length})` : '';
    if (!container) return;
    container.innerHTML = '';

    if (deleted.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'entry-empty';
      empty.textContent = 'No recently deleted entries';
      container.appendChild(empty);
      return;
    }
    deleted.forEach(entry => container.appendChild(createDeletedEntryRow(entry)));
  }

  function renderGroup(containerId, entries, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = emptyMessage;
      container.appendChild(empty);
      return;
    }

    entries.forEach(entry => container.appendChild(createEntryRow(entry)));
  }

  function createEntryRow(entry) {
    const f = entry.fields;

    const row = document.createElement('div');
    row.className = 'entry-row';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.dataset.id = entry.id;

    const arrival   = formatDateShort(f.arrivalDate);
    const departure = formatDateShort(f.departureDate);
    const meta      = [
      f.roomType    || null,
      f.confirmationNumber ? `#${f.confirmationNumber}` : null,
    ].filter(Boolean).join(' · ');

    const ts = entry.lastModifiedAt || entry.createdAt;
    const tsLabel = ts ? formatTimestamp(ts) : '';

    row.innerHTML = `
      <div class="entry-body">
        <div class="entry-name">${f.guestName || 'Unknown Guest'}</div>
        <div class="entry-meta">${meta || '—'}</div>
        ${tsLabel ? `<div class="entry-timestamp">${tsLabel}</div>` : ''}
      </div>
      <div class="entry-right">
        <div class="entry-dates">${arrival} – ${departure}</div>
        <div class="entry-badge badge-${entry.status}">
          ${entry.status === 'current' ? 'In Progress' : 'Completed'}
        </div>
        <button class="entry-delete-btn" type="button" data-id="${entry.id}" aria-label="Delete entry">
          Delete
        </button>
      </div>
      <div class="entry-chevron" aria-hidden="true">›</div>
    `;

    row.addEventListener('click',  () => openEntry(entry.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openEntry(entry.id);
    });

    const deleteBtn = row.querySelector('.entry-delete-btn');
    deleteBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      const ok = window.confirm('Delete this entry? It will be kept in Recently Deleted for 30 days.');
      if (!ok) return;
      await DB.softDelete(entry.id);
      if (_currentId === entry.id) {
        _currentId = null;
        _parsedData = null;
      }
      await renderDashboard();
    });

    return row;
  }

  function createDeletedEntryRow(entry) {
    const f         = entry.fields;
    const arrival   = formatDateShort(f.arrivalDate);
    const departure = formatDateShort(f.departureDate);
    const deletedOn = entry.deletedAt
      ? new Date(entry.deletedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';

    const row = document.createElement('div');
    row.className = 'entry-row entry-row-deleted';
    row.innerHTML = `
      <div class="entry-body">
        <div class="entry-name">${f.guestName || 'Unknown Guest'}</div>
        <div class="entry-meta">Deleted ${deletedOn}</div>
      </div>
      <div class="entry-right">
        <div class="entry-dates">${arrival} – ${departure}</div>
        <button class="entry-restore-btn" type="button" data-id="${entry.id}">Restore</button>
      </div>
    `;

    row.querySelector('.entry-restore-btn')?.addEventListener('click', async e => {
      e.stopPropagation();
      await DB.restore(entry.id);
      await renderDashboard();
    });

    return row;
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    const normalized = FieldNormalizer.normalizeDate(dateStr) ?? dateStr;
    const parts = normalized.split('/');
    if (parts.length < 2) return dateStr;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = parseInt(parts[0], 10) - 1;
    const d = parseInt(parts[1], 10);
    return `${months[m] ?? ''} ${d}`;
  }

  // ─── Start new registration ───────────────────────────────────────────────

  function startNewRegistration() {
    _parsedData = null;
    _currentId  = null;
    clearReviewForm();
    goToStep('upload');
  }

  function clearReviewForm() {
    document.querySelectorAll('#step-review .field-input').forEach(el => (el.value = ''));
    document.querySelectorAll('#step-review .field-wrapper').forEach(el =>
      el.classList.remove('status-ok', 'status-missing', 'status-uncertain'));
    document.querySelectorAll('#step-review .field-hint').forEach(el => (el.textContent = ''));
    const rld = document.getElementById('rate-lines-display');
    if (rld) { rld.innerHTML = ''; rld.style.display = 'none'; }
    const banner = document.getElementById('validation-banner');
    if (banner) banner.style.display = 'none';
  }

  // ─── Open existing entry from dashboard ──────────────────────────────────

  async function openEntry(id) {
    const entry = await DB.getById(id);
    if (!entry) return;

    _currentId  = id;
    _parsedData = { rateLines: entry.rateLines ?? [] };

    renderCard(entry.fields, entry);
    updateCardButtons(entry.status);
    goToStep('card');
  }

  function updateCardButtons(status) {
    const btnHandToGuest = document.getElementById('btn-hand-to-guest');
    const btnSaveDraft   = document.getElementById('btn-save-draft');
    const btnEdit        = document.getElementById('btn-edit');

    if (status === 'previous') {
      if (btnHandToGuest) { btnHandToGuest.textContent = 'Reopen'; btnHandToGuest.className = 'btn-secondary'; }
      if (btnSaveDraft)   btnSaveDraft.style.display   = 'none';
      if (btnEdit)        btnEdit.style.display        = 'none';
    } else {
      if (btnHandToGuest) { btnHandToGuest.textContent = 'Hand to Guest →'; btnHandToGuest.className = 'btn-complete'; }
      if (btnSaveDraft)   btnSaveDraft.style.display   = '';
      if (btnEdit)        btnEdit.style.display        = '';
    }
  }

  // ─── PDF pipeline ─────────────────────────────────────────────────────────

  async function onFileSelected(file) {
    goToStep('processing');
    try {
      const { text, isImagePdf } = await PdfExtractor.extractText(file);

      if (isImagePdf) {
        showBanner('warning',
          'This PDF appears to be a scanned image — text could not be extracted. Please fill in the fields manually.');
        _parsedData = Parser.parse('');
      } else {
        _parsedData = Parser.parse(text);
      }

      const validation = Validator.validateAll(_parsedData);
      FormPrefiller.fillAll(_parsedData, validation);

      if (validation.hasErrors)        showBanner('error',   'Some required fields could not be detected — fields in red need manual entry.');
      else if (validation.hasWarnings) showBanner('warning', 'Most fields were detected. Please review fields in yellow before confirming.');
      else {
        const banner = document.getElementById('validation-banner');
        if (banner) banner.style.display = 'none';
      }

      goToStep('review');

    } catch (err) {
      console.error('[App] PDF processing error:', err);
      goToStep('upload');
      const el = document.getElementById('upload-error');
      if (el) { el.textContent = 'Could not read this PDF. Please check the file and try again.'; el.style.display = 'block'; }
    }
  }

  // ─── Review → Card ────────────────────────────────────────────────────────

  async function onConfirm() {
    const values   = readReviewForm();
    const existing = _currentId ? await DB.getById(_currentId) : null;
    const merged   = { ...(existing?.fields ?? {}), ...values };
    const now      = new Date().toISOString();

    if (_currentId) {
      await DB.update(_currentId, { fields: merged, rateLines: _parsedData?.rateLines ?? [] });
    } else {
      const entry = await DB.add({
        id:          DB.generateId(),
        status:      'current',
        createdAt:   now,
        completedAt: null,
        fields:      merged,
        rateLines:   _parsedData?.rateLines ?? [],
      });
      _currentId = entry.id;
    }

    const saved = await DB.getById(_currentId);
    renderCard(merged, saved);
    updateCardButtons('current');
    goToStep('card');
  }

  function populateReviewForm(fields) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    set('field-guest-name',   fields.guestName);
    set('field-confirmation', fields.confirmationNumber);
    set('field-arrival',      fields.arrivalDate);
    set('field-departure',    fields.departureDate);
    set('field-room-type',    fields.roomType);
    set('field-nightly-rate', fields.nightlyRate);
    set('field-adults',       fields.adults);
    set('field-email',        fields.email);
    set('field-phone',        fields.phone);
    set('field-car-make',     fields.carMake);
    set('field-car-model',    fields.carModel);
    set('field-car-color',    fields.carColor);
    const resortEl = document.getElementById('field-resort-fee');
    if (resortEl) resortEl.value = fields.resortFeeConsent || '';
  }

  function readReviewForm() {
    const val = id => document.getElementById(id)?.value?.trim() ?? '';
    return {
      guestName:          val('field-guest-name'),
      confirmationNumber: val('field-confirmation'),
      arrivalDate:        val('field-arrival'),
      departureDate:      val('field-departure'),
      roomType:           val('field-room-type'),
      nightlyRate:        val('field-nightly-rate'),
      adults:             val('field-adults'),
      email:              val('field-email'),
      phone:              val('field-phone'),
      carMake:            val('field-car-make'),
      carModel:           val('field-car-model'),
      carColor:           val('field-car-color'),
      resortFeeConsent:   val('field-resort-fee'),
    };
  }

  // ─── Card actions ─────────────────────────────────────────────────────────

  function onSaveDraft() {
    renderDashboard();
    goToStep('dashboard');
  }

  async function onHandToGuest() {
    const entry = _currentId ? await DB.getById(_currentId) : null;

    if (entry?.status === 'previous') {
      await DB.update(_currentId, { status: 'current', completedAt: null });
    }

    const fields = entry?.fields ?? {};
    const prefill = {
      guestName:        fields.guestName        || '',
      email:            fields.email            || '',
      phone:            fields.phone            || '',
      resortFeeConsent: fields.resortFeeConsent || '',
      arrivalDate:      fields.arrivalDate      || '',
      departureDate:    fields.departureDate    || '',
      roomType:         fields.roomType         || '',
      nightlyRate:      fields.nightlyRate      || '',
      carMake:          fields.carMake          || '',
      carModel:         fields.carModel         || '',
      carColor:         fields.carColor         || '',
    };

    GuestFlow.start(prefill, _currentId, onGuestFlowComplete);
    goToStep('guest');
  }

  async function onGuestFlowComplete(guestState, entryId) {
    const now = new Date().toISOString();

    if (entryId) {
      const entry = await DB.getById(entryId);
      if (entry) {
        await DB.update(entryId, {
          status:      'previous',
          completedAt: now,
          signature:   guestState.signature || null,
          fields: {
            ...entry.fields,
            email:            guestState.email            ?? '',
            phone:            guestState.phone            ?? '',
            resortFeeConsent: guestState.resortFeeConsent || '',
            carMake:          guestState.carMake          || '',
            carModel:         guestState.carModel         || '',
            carColor:         guestState.carColor         || '',
          },
        });
      }
    } else {
      await DB.add({
        id:          DB.generateId(),
        status:      'previous',
        createdAt:   now,
        completedAt: now,
        signature:   guestState.signature || null,
        fields: {
          guestName:          guestState.guestName          || '',
          confirmationNumber: guestState.confirmationNumber || '',
          arrivalDate:        guestState.arrivalDate        || '',
          departureDate:      guestState.departureDate      || '',
          roomType:           guestState.roomType           || '',
          nightlyRate:        guestState.nightlyRate        || '',
          adults:             '',
          email:              guestState.email              || '',
          phone:              guestState.phone              || '',
          resortFeeConsent:   guestState.resortFeeConsent   || '',
          carMake:            guestState.carMake            || '',
          carModel:           guestState.carModel           || '',
          carColor:           guestState.carColor           || '',
        },
        rateLines: [],
      });
    }

    if (entryId) {
      const updated = await DB.getById(entryId);
      if (updated) {
        _currentId  = entryId;
        _parsedData = { rateLines: updated.rateLines ?? [] };
        renderCard(updated.fields, updated);
        updateCardButtons('previous');
        goToStep('card');
        return;
      }
    }

    await renderDashboard();
    goToStep('dashboard');
  }

  // ─── Card rendering ───────────────────────────────────────────────────────

  function renderCard(fields, entry) {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '—';
    };

    set('card-guest-name',   fields.guestName);
    set('card-email',        fields.email);
    set('card-phone',        fields.phone);
    set('card-confirmation', fields.confirmationNumber);
    set('card-arrival',      fields.arrivalDate);
    set('card-departure',    fields.departureDate);
    set('card-room-type',    fields.roomType);
    set('card-adults',       fields.adults);

    const rateNum = FieldNormalizer.normalizeRate(fields.nightlyRate);
    set('card-nightly-rate',
      rateNum !== null ? `${FieldNormalizer.formatRate(rateNum)} USD` : fields.nightlyRate || '—');

    // Timestamps
    const createdEl  = document.getElementById('card-created-at');
    const modifiedEl = document.getElementById('card-modified-at');
    if (createdEl) {
      createdEl.textContent = entry?.createdAt
        ? `Submitted ${formatTimestamp(entry.createdAt)}`
        : '';
    }
    if (modifiedEl) {
      const showModified = entry?.lastModifiedAt && entry.lastModifiedAt !== entry?.createdAt;
      modifiedEl.textContent = showModified
        ? `· Last edited ${formatTimestamp(entry.lastModifiedAt)}`
        : '';
    }

    // Resort fee consent
    const resortFeeRow = document.getElementById('card-resort-fee-row');
    const resortFeeVal = document.getElementById('card-resort-fee-value');
    if (resortFeeRow && resortFeeVal) {
      const consent = fields.resortFeeConsent;
      if (consent === 'Approved' || consent === 'Declined') {
        resortFeeVal.textContent = consent === 'Approved' ? 'Opted In' : 'Opted Out';
        resortFeeRow.style.display = '';
      } else {
        resortFeeRow.style.display = 'none';
      }
    }

    // Vehicle info
    const carMakeEl  = document.getElementById('card-car-make');
    const carModelEl = document.getElementById('card-car-model');
    const carColorEl = document.getElementById('card-car-color');
    if (carMakeEl)  carMakeEl.value  = fields.carMake  || '';
    if (carModelEl) carModelEl.value = fields.carModel || '';
    if (carColorEl) carColorEl.value = fields.carColor || '';

    // Signature — stroke data lives at entry.signature (top-level column)
    const sigLine = document.getElementById('card-signature-line');
    if (sigLine) {
      sigLine.innerHTML = '';
      sigLine.classList.remove('has-signature');
      const strokes = entry?.signature;
      if (strokes && strokes.length) {
        const canvas = document.createElement('canvas');
        canvas.className = 'card-signature-img';
        sigLine.appendChild(canvas);
        sigLine.classList.add('has-signature');
        requestAnimationFrame(() => _replaySignature(canvas, strokes));
      }
    }

    // Rate change lines
    const linesContainer = document.getElementById('card-rate-lines');
    const rateSection    = linesContainer?.closest('.rate-changes-section');
    const lines          = _parsedData?.rateLines ?? [];
    if (linesContainer) {
      if (lines.length > 0) {
        linesContainer.innerHTML = lines
          .map(l => `<div class="card-rate-line">${l.startDate} – ${l.endDate} &nbsp; <strong>$${l.rate.toFixed(2)} USD</strong></div>`)
          .join('');
        if (rateSection) rateSection.style.display = '';
      } else {
        linesContainer.innerHTML = '';
        if (rateSection) rateSection.style.display = 'none';
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function _replaySignature(canvas, strokes) {
    if (!strokes || !strokes.length) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    strokes.forEach(stroke => {
      if (!stroke.length) return;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    });
  }

  function formatTimestamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' at '
      + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function showBanner(type, message) {
    const el = document.getElementById('validation-banner');
    if (!el) return;
    el.className = `validation-banner banner-${type}`;
    el.textContent = message;
    el.style.display = 'block';
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
