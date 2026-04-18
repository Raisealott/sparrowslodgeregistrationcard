/**
 * app.js
 * Main controller — manages step navigation and entry lifecycle.
 *
 * Steps:  dashboard → upload → processing → review → card
 *
 * Entry lifecycle:
 *   "Generate Card" → saved to store as 'current'
 *   "Complete"      → status updated to 'previous', back to dashboard
 *   "Save & Close"  → stays 'current', back to dashboard
 *   Tap dashboard row → open card for that entry
 */
const App = (() => {

  let _parsedData    = null;  // PDF parse result (holds rateLines)
  let _currentId     = null;  // store ID of the entry being viewed

  // ─── Init ────────────────────────────────────────────────────────────────────

  function init() {
    Uploader.init(onFileSelected);

    // Review step
    document.getElementById('btn-confirm')?.addEventListener('click', onConfirm);
    document.getElementById('btn-back-upload')?.addEventListener('click', () => goToStep('upload'));

    // Card step
    document.getElementById('btn-edit')?.addEventListener('click', () => goToStep('review'));
    document.getElementById('btn-save-draft')?.addEventListener('click', onSaveDraft);
    document.getElementById('btn-hand-to-guest')?.addEventListener('click', onHandToGuest);
    // Dashboard
    document.getElementById('btn-new-registration')?.addEventListener('click', startNewRegistration);

    // All "← Home" buttons across every step header
    document.querySelectorAll('.btn-go-dashboard').forEach(btn =>
      btn.addEventListener('click', () => { renderDashboard(); goToStep('dashboard'); })
    );

    // Seed today's date in the dashboard header
    const dateEl = document.getElementById('dashboard-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US',
        { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }

    renderDashboard();
    goToStep('dashboard');
  }

  // ─── Step navigation ─────────────────────────────────────────────────────────

  function goToStep(name) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`step-${name}`);
    if (target) {
      target.classList.add('active');
      target.querySelector('.step-body')?.scrollTo(0, 0);
    }
  }

  // ─── Dashboard ───────────────────────────────────────────────────────────────

  function renderDashboard() {
    const all      = Store.getAll();
    const current  = all.filter(e => e.status === 'current');
    const previous = all.filter(e => e.status === 'previous');

    renderGroup('list-current',  current,  'No current registrations');
    renderGroup('list-previous', previous, 'No previous entries');

    // Update count badges
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n > 0 ? `(${n})` : '';
    };
    setBadge('count-current',  current.length);
    setBadge('count-previous', previous.length);
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
      f.roomNumber  ? `Room ${f.roomNumber}` : null,
      f.roomType    || null,
      f.confirmationNumber ? `#${f.confirmationNumber}` : null,
    ].filter(Boolean).join(' · ');

    row.innerHTML = `
      <div class="entry-body">
        <div class="entry-name">${f.guestName || 'Unknown Guest'}</div>
        <div class="entry-meta">${meta || '—'}</div>
      </div>
      <div class="entry-right">
        <div class="entry-dates">${arrival} – ${departure}</div>
        <div class="entry-badge badge-${entry.status}">
          ${entry.status === 'current' ? 'In Progress' : 'Completed'}
        </div>
      </div>
      <div class="entry-chevron" aria-hidden="true">›</div>
    `;

    row.addEventListener('click',  () => openEntry(entry.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openEntry(entry.id);
    });

    return row;
  }

  /** "MM/DD/YYYY" → "Feb 22" */
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

  // ─── Start new registration ───────────────────────────────────────────────────

  function startNewRegistration() {
    _parsedData   = null;
    _currentId    = null;
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

  // ─── Open existing entry from dashboard ──────────────────────────────────────

  function openEntry(id) {
    const entry = Store.getById(id);
    if (!entry) return;

    _currentId  = id;
    _parsedData = { rateLines: entry.rateLines ?? [] };

    renderCard(entry.fields);
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

  // ─── PDF pipeline ────────────────────────────────────────────────────────────

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
      else                             showBanner('success', 'All fields detected. Review before generating the card.');

      goToStep('review');

    } catch (err) {
      console.error('[App] PDF processing error:', err);
      goToStep('upload');
      const el = document.getElementById('upload-error');
      if (el) { el.textContent = 'Could not read this PDF. Please check the file and try again.'; el.style.display = 'block'; }
    }
  }

  // ─── Review → Card ───────────────────────────────────────────────────────────

  function onConfirm() {
    const values = readReviewForm();
    renderCard(values);

    // Save or create entry in store (always 'current' on first generate)
    if (_currentId) {
      Store.update(_currentId, { fields: values, rateLines: _parsedData?.rateLines ?? [] });
    } else {
      const entry = Store.add({
        id:          Store.generateId(),
        status:      'current',
        createdAt:   new Date().toISOString(),
        completedAt: null,
        fields:      values,
        rateLines:   _parsedData?.rateLines ?? [],
      });
      _currentId = entry.id;
    }

    updateCardButtons('current');
    goToStep('card');
  }

  function readReviewForm() {
    const val = id => document.getElementById(id)?.value?.trim() ?? '';
    return {
      guestName:          val('field-guest-name'),
      confirmationNumber: val('field-confirmation'),
      arrivalDate:        val('field-arrival'),
      departureDate:      val('field-departure'),
      roomType:           val('field-room-type'),
      roomNumber:         val('field-room-number'),
      nightlyRate:        val('field-nightly-rate'),
      adults:             val('field-adults'),
      email:              val('field-email'),
    };
  }

  // ─── Card actions ─────────────────────────────────────────────────────────────

  function onSaveDraft() {
    renderDashboard();
    goToStep('dashboard');
  }

  function onHandToGuest() {
    const entry = _currentId ? Store.getById(_currentId) : null;

    // Reopen path: if this was a completed entry, move it back to current first
    if (entry?.status === 'previous') {
      Store.update(_currentId, { status: 'current', completedAt: null });
    }

    const fields = entry?.fields ?? {};
    const prefill = {
      guestName:    fields.guestName    || '',
      email:        '',   // never pre-fill — PDF email is the hotel's, not the guest's
      phone:        fields.phone        || '',
      arrivalDate:  fields.arrivalDate  || '',
      departureDate: fields.departureDate || '',
      roomType:     fields.roomType     || '',
      nightlyRate:  fields.nightlyRate  || '',
      carMake:      fields.carMake      || '',
      carModel:     fields.carModel     || '',
      carColor:     fields.carColor     || '',
    };

    GuestFlow.start(prefill, _currentId, onGuestFlowComplete);
    goToStep('guest');
  }

  function onGuestFlowComplete(guestState, entryId) {
    if (entryId) {
      const entry = Store.getById(entryId);
      if (entry) {
        Store.update(entryId, {
          status:      'previous',
          completedAt: new Date().toISOString(),
          fields: {
            ...entry.fields,
            email:     guestState.email     || entry.fields.email || '',
            phone:     guestState.phone     || '',
            carMake:   guestState.carMake   || '',
            carModel:  guestState.carModel  || '',
            carColor:  guestState.carColor  || '',
            signature: guestState.signature || null,
          },
        });
      }
    } else {
      // Guest flow started without a prior entry (direct kiosk check-in)
      Store.add({
        id:          Store.generateId(),
        status:      'previous',
        createdAt:   new Date().toISOString(),
        completedAt: new Date().toISOString(),
        fields: {
          guestName:          guestState.guestName          || '',
          confirmationNumber: guestState.confirmationNumber || '',
          arrivalDate:        guestState.arrivalDate        || '',
          departureDate:      guestState.departureDate      || '',
          roomType:           guestState.roomType           || '',
          roomNumber:         '',
          nightlyRate:        guestState.nightlyRate        || '',
          adults:             '',
          email:              guestState.email              || '',
          phone:              guestState.phone              || '',
          carMake:            guestState.carMake            || '',
          carModel:           guestState.carModel           || '',
          carColor:           guestState.carColor           || '',
          signature:          guestState.signature          || null,
        },
        rateLines: [],
      });
    }

    renderDashboard();
    goToStep('dashboard');
  }

  // ─── Card rendering ──────────────────────────────────────────────────────────

  function renderCard(fields) {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '—';
    };

    set('card-guest-name',   fields.guestName);
    set('card-email',        fields.email);
    set('card-confirmation', fields.confirmationNumber);
    set('card-room-number',  fields.roomNumber);
    set('card-arrival',      fields.arrivalDate);
    set('card-departure',    fields.departureDate);
    set('card-room-type',    fields.roomType);
    set('card-adults',       fields.adults);

    const rateNum = FieldNormalizer.normalizeRate(fields.nightlyRate);
    set('card-nightly-rate',
      rateNum !== null ? `${FieldNormalizer.formatRate(rateNum)} USD` : fields.nightlyRate || '—');

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

  // ─── Helpers ─────────────────────────────────────────────────────────────────

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
