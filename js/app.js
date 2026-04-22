/**
 * app.js
 * Main controller â€” manages step navigation and entry lifecycle.
 *
 * Steps:  login â†’ dashboard â†’ upload â†’ processing â†’ review â†’ card â†’ guest
 *
 * Entry lifecycle:
 *   "Generate Card" â†’ saved to DB as 'current'
 *   "Complete"      â†’ status updated to 'previous', back to dashboard
 *   "Save & Close"  â†’ stays 'current', back to dashboard
 *   Tap dashboard row â†’ open card for that entry
 */
const App = (() => {

  let _parsedData    = null;  // PDF parse result (holds rateLines)
  let _currentId     = null;  // DB id of the entry being viewed
  let _unsubscribe   = null;  // real-time subscription cleanup
  let _dashboardSearchEntries = []; // in-memory source for name suggestions
  let _requestPanelOpen = false;

  // â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€ Delete modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  let _deleteResolve = null;

  function _initDeleteModal() {
    const modal   = document.getElementById('delete-modal');
    const confirm = document.getElementById('delete-modal-confirm');
    const cancel  = document.getElementById('delete-modal-cancel');
    confirm?.addEventListener('click', () => { modal.hidden = true; _deleteResolve?.(true);  });
    cancel?.addEventListener('click',  () => { modal.hidden = true; _deleteResolve?.(false); });
    modal?.addEventListener('click', e => {
      if (e.target === modal) { modal.hidden = true; _deleteResolve?.(false); }
    });
  }

  function _confirmDelete() {
    return new Promise(resolve => {
      _deleteResolve = resolve;
      document.getElementById('delete-modal').hidden = false;
    });
  }

  // â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function init() {
    _initDeleteModal();
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
    document.getElementById('dashboard-search-input')?.addEventListener('input', e => {
      _renderNameSuggestions(e.target.value);
      renderDashboard();
    });
    document.getElementById('dashboard-search-input')?.addEventListener('focus', e => {
      _renderNameSuggestions(e.target.value);
    });
    document.addEventListener('click', e => {
      if (!e.target?.closest?.('.dashboard-search-wrap')) _hideNameSuggestions();
    });

    // Recently deleted toggle
    document.getElementById('btn-deleted-toggle')?.addEventListener('click', () => {
      const list    = document.getElementById('list-deleted');
      const chevron = document.querySelector('#btn-deleted-toggle .deleted-chevron');
      if (!list) return;
      list.hidden = !list.hidden;
      if (chevron) chevron.textContent = list.hidden ? 'v' : '^';
    });

    // All "â† Home" buttons
    document.querySelectorAll('.btn-go-dashboard').forEach(btn =>
      btn.addEventListener('click', () => { renderDashboard(); goToStep('dashboard'); })
    );
    window.addEventListener('guestflow:home', () => { renderDashboard(); goToStep('dashboard'); });

    // Login form
    document.getElementById('login-form')?.addEventListener('submit', onLoginSubmit);
    document.getElementById('btn-show-request-access')?.addEventListener('click', toggleRequestAccessPanel);
    document.getElementById('request-access-form')?.addEventListener('submit', onRequestAccessSubmit);
    await _initRequestAccessForm();

    // Admin access requests
    document.getElementById('btn-refresh-access-requests')?.addEventListener('click', renderAccessRequests);
    document.getElementById('list-access-requests')?.addEventListener('click', onAccessRequestActionClick);

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

    // Real-time sync should never block sign-in if it fails.
    try {
      _unsubscribe = DB.subscribeToChanges(() => renderDashboard());
    } catch (err) {
      console.error('[App] realtime subscription error:', err);
      _unsubscribe = null;
    }
  }

  // â”€â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function onLoginSubmit(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email')?.value?.trim() ?? '';
    const password = document.getElementById('login-password')?.value ?? '';
    const errorEl  = document.getElementById('login-error');
    const btn      = document.getElementById('btn-login');

    if (errorEl) errorEl.hidden = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

    try {
      const { error } = await Auth.signIn(email, password);
      if (error) {
        if (errorEl) { errorEl.textContent = error; errorEl.hidden = false; }
        return;
      }
      await _onAuthenticated();
    } catch (err) {
      console.error('[App] onLoginSubmit unexpected error:', err);
      if (errorEl) {
        const details = err?.message ? ` (${err.message})` : '';
        const signedIn = Boolean(Auth.getSession());
        errorEl.textContent = signedIn
          ? `Sign-in worked, but dashboard loading failed${details}.`
          : `Unable to complete sign in right now${details}.`;
        errorEl.hidden = false;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    }
  }
  async function onSignOut() {
    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    await Auth.signOut();
    goToStep('login');
  }

  async function _initRequestAccessForm() {
    const select = document.getElementById('request-property');
    if (!select) return;

    select.innerHTML = '<option value="">Loading properties...</option>';
    const { properties, error } = await Auth.getPropertiesPublic();
    if (error) {
      select.innerHTML = '<option value="">Unable to load properties</option>';
      return;
    }

    const options = ['<option value="">Select property</option>']
      .concat(properties.map(p => `<option value="${p.id}">${p.name}</option>`));
    select.innerHTML = options.join('');
  }

  function toggleRequestAccessPanel() {
    const panel = document.getElementById('request-access-panel');
    const btn = document.getElementById('btn-show-request-access');
    if (!panel || !btn) return;

    _requestPanelOpen = !_requestPanelOpen;
    panel.hidden = !_requestPanelOpen;
    btn.textContent = _requestPanelOpen ? 'Hide Sign-up Form' : 'Sign Up';
    if (_requestPanelOpen) panel.querySelector('input,select,textarea')?.focus();
  }

  function _setRequestAccessFeedback(message, type = 'error') {
    const feedback = document.getElementById('request-access-feedback');
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.textContent = message || '';
    feedback.className = type === 'success' ? 'login-success' : 'login-error';
  }

  async function onRequestAccessSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-request-access-submit');
    const fullName = document.getElementById('request-full-name')?.value?.trim() ?? '';
    const email = document.getElementById('request-email')?.value?.trim() ?? '';
    const requestedPropertyId = document.getElementById('request-property')?.value ?? '';
    const note = document.getElementById('request-note')?.value?.trim() ?? '';

    _setRequestAccessFeedback('');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    try {
      const { error } = await Auth.requestAccess({ fullName, email, requestedPropertyId, note });
      if (error) {
        _setRequestAccessFeedback(error, 'error');
        return;
      }

      document.getElementById('request-access-form')?.reset();
      _setRequestAccessFeedback(
        'Sign-up request sent. An admin must approve it before account setup.',
        'success'
      );
    } catch (err) {
      console.error('[App] onRequestAccessSubmit unexpected error:', err);
      _setRequestAccessFeedback('Unable to submit request right now. Please try again.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Request'; }
    }
  }

  async function renderAccessRequests() {
    const section = document.getElementById('access-requests-section');
    const container = document.getElementById('list-access-requests');
    const countEl = document.getElementById('count-access-requests');
    if (!section || !container || !countEl) return;

    if (Auth.getProfile()?.role !== 'admin') {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    container.innerHTML = '';

    const { requests, error } = await Auth.listSignupRequests('pending');
    if (error) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = error;
      container.appendChild(empty);
      countEl.textContent = '';
      return;
    }

    countEl.textContent = requests.length > 0 ? `(${requests.length})` : '';
    if (!requests.length) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = 'No pending sign-up requests';
      container.appendChild(empty);
      return;
    }

    requests.forEach(req => container.appendChild(createAccessRequestRow(req)));
  }

  function createAccessRequestRow(req) {
    const row = document.createElement('div');
    row.className = 'access-request-row';
    const requestedDate = req.requested_at
      ? new Date(req.requested_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Unknown';
    const propertyName = req.requested_property?.name || 'Unknown property';
    const safeNote = req.note ? `<div class="access-request-note">${req.note}</div>` : '';

    row.innerHTML = `
      <div class="entry-name">${req.full_name || 'Unknown Name'}</div>
      <div class="entry-meta">${req.email || ''}</div>
      <div class="access-request-meta">${propertyName} · Requested ${requestedDate}</div>
      ${safeNote}
      <div class="access-request-actions">
        <button class="access-request-btn approve" type="button" data-access-action="approved" data-request-id="${req.id}">Approve</button>
        <button class="access-request-btn reject" type="button" data-access-action="rejected" data-request-id="${req.id}">Reject</button>
      </div>
    `;
    return row;
  }

  async function onAccessRequestActionClick(e) {
    const btn = e.target?.closest?.('[data-access-action]');
    if (!btn) return;

    const requestId = btn.getAttribute('data-request-id');
    const decision = btn.getAttribute('data-access-action');
    if (!requestId || !decision) return;

    const note = window.prompt('Optional internal note for this decision:', '')?.trim() || null;
    btn.disabled = true;
    try {
      const { error } = await Auth.decideSignupRequest(requestId, decision, note);
      if (error) window.alert(error);
      await renderAccessRequests();
    } finally {
      btn.disabled = false;
    }
  }

  // â”€â”€â”€ Step navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function goToStep(name) {
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`step-${name}`);
    if (target) {
      target.classList.add('active');
      target.querySelector('.step-body')?.scrollTo(0, 0);
    }
  }

  // â”€â”€â”€ Dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function renderDashboard() {
    const all = await DB.getAll();
    _dashboardSearchEntries = all;
    const search = _readDashboardSearch();
    const filtered = _filterDashboardEntries(all, search);
    const current  = filtered.filter(e => e.status === 'current');
    const previous = filtered.filter(e => e.status === 'previous');
    const hasSearch = Boolean(search.query);

    renderGroup('list-current', current,
      hasSearch ? 'No matching current registrations' : 'No current registrations');
    renderGroupByDate('list-previous', previous,
      hasSearch ? 'No matching previous entries' : 'No previous entries');
    await renderDeletedGroup();

    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n > 0 ? `(${n})` : '';
    };
    setBadge('count-current',  current.length);
    setBadge('count-previous', previous.length);
    await renderAccessRequests();
  }

  function _readDashboardSearch() {
    const query = document.getElementById('dashboard-search-input')?.value?.trim() || '';
    return { query };
  }

  function _filterDashboardEntries(entries, search) {
    if (!search?.query) return entries;
    return entries.filter(entry => _entryMatchesSearch(entry, search));
  }

  function _entryMatchesSearch(entry, search) {
    const query = search.query.toLowerCase();
    const compactQuery = query.replace(/[^a-z0-9]/g, '');
    const searchValues = _collectSearchValues(entry);
    return searchValues.some(value => {
      const raw = value.toLowerCase();
      const compact = raw.replace(/[^a-z0-9]/g, '');
      return raw.includes(query) || (compactQuery ? compact.includes(compactQuery) : false);
    });
  }

  function _collectSearchValues(entry) {
    const values = [];

    const add = value => {
      if (!value) return;
      const raw = String(value);
      values.push(raw);

      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) {
        values.push(date.toISOString().slice(0, 10));
        values.push(date.toLocaleDateString('en-US'));
        values.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
      }
    };

    add(entry?.fields?.guestName);
    add(entry?.fields?.confirmationNumber);
    add(entry?.fields?.arrivalDate);
    add(entry?.fields?.departureDate);
    add(entry?.createdAt);
    add(entry?.completedAt);

    return values;
  }

  function _renderNameSuggestions(inputValue) {
    const container = document.getElementById('dashboard-name-suggestions');
    const query = (inputValue || '').trim().toLowerCase();
    if (!container) return;

    if (!query) {
      _hideNameSuggestions();
      return;
    }

    const uniqueNames = [...new Set(
      _dashboardSearchEntries
        .map(entry => entry?.fields?.guestName?.trim())
        .filter(Boolean)
    )];

    const nameMatches = uniqueNames
      .filter(name => name.toLowerCase().includes(query))
      .sort((a, b) => {
        const aStarts = a.toLowerCase().startsWith(query) ? 0 : 1;
        const bStarts = b.toLowerCase().startsWith(query) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      })
      .slice(0, 6);

    const uniqueConfNums = [...new Set(
      _dashboardSearchEntries
        .map(entry => entry?.fields?.confirmationNumber?.trim())
        .filter(Boolean)
    )];

    const confMatches = uniqueConfNums
      .filter(n => n.toLowerCase().includes(query))
      .sort((a, b) => (a.toLowerCase().startsWith(query) ? 0 : 1) - (b.toLowerCase().startsWith(query) ? 0 : 1))
      .slice(0, 4);

    if (nameMatches.length === 0 && confMatches.length === 0) {
      _hideNameSuggestions();
      return;
    }

    const makeSuggestion = (value, label) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dashboard-name-suggestion';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const inputEl = document.getElementById('dashboard-search-input');
        if (inputEl) inputEl.value = value;
        _hideNameSuggestions();
        renderDashboard();
      });
      return btn;
    };

    container.innerHTML = '';
    nameMatches.forEach(name => container.appendChild(makeSuggestion(name, name)));
    confMatches.forEach(conf => container.appendChild(makeSuggestion(conf, `#${conf}`)));
    container.hidden = false;
  }

  function _hideNameSuggestions() {
    const container = document.getElementById('dashboard-name-suggestions');
    if (!container) return;
    container.hidden = true;
    container.innerHTML = '';
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

  function renderGroupByDate(containerId, entries, emptyMessage) {
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

    // Group by calendar date of completedAt (fall back to createdAt)
    const groups = new Map();
    entries.forEach(entry => {
      const ts  = entry.completedAt || entry.createdAt;
      const key = ts ? new Date(ts).toDateString() : 'Unknown Date';
      const label = ts
        ? new Date(ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'Unknown Date';
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key).items.push(entry);
    });

    groups.forEach(({ label, items }) => {
      const header = document.createElement('div');
      header.className = 'entry-date-header';
      header.textContent = label;
      container.appendChild(header);
      items.forEach(entry => container.appendChild(createEntryRow(entry)));
    });
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
    ].filter(Boolean).join(' - ');

    const ts = entry.lastModifiedAt || entry.createdAt;
    const tsLabel = ts ? formatTimestamp(ts) : '';

    row.innerHTML = `
      <div class="entry-body">
        <div class="entry-name">${f.guestName || 'Unknown Guest'}</div>
        <div class="entry-meta">${meta || '--'}</div>
        ${tsLabel ? `<div class="entry-timestamp">${tsLabel}</div>` : ''}
      </div>
      <div class="entry-right">
        <div class="entry-dates">${arrival} - ${departure}</div>
        <div class="entry-badge badge-${entry.status}">
          ${entry.status === 'current' ? 'In Progress' : 'Completed'}
        </div>
        <button class="entry-delete-btn" type="button" data-id="${entry.id}" aria-label="Delete entry">
          Delete
        </button>
      </div>
      <div class="entry-chevron" aria-hidden="true">&rsaquo;</div>
    `;

    row.addEventListener('click',  () => openEntry(entry.id));
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') openEntry(entry.id);
    });

    const deleteBtn = row.querySelector('.entry-delete-btn');
    deleteBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      const ok = await _confirmDelete();
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
        <div class="entry-dates">${arrival} - ${departure}</div>
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
    if (!dateStr) return '--';
    const normalized = FieldNormalizer.normalizeDate(dateStr) ?? dateStr;
    const parts = normalized.split('/');
    if (parts.length < 2) return dateStr;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const m = parseInt(parts[0], 10) - 1;
    const d = parseInt(parts[1], 10);
    return `${months[m] ?? ''} ${d}`;
  }

  // â”€â”€â”€ Start new registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€â”€ Open existing entry from dashboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function openEntry(id) {
    const entry = await DB.getById(id);
    if (!entry) return;

    _currentId  = id;
    _parsedData = { rateLines: entry.rateLines ?? [] };

    goToStep('card');
    renderCard(entry.fields, entry);
    updateCardButtons(entry.status);
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
      if (btnHandToGuest) { btnHandToGuest.textContent = 'Hand to Guest ->'; btnHandToGuest.className = 'btn-complete'; }
      if (btnSaveDraft)   btnSaveDraft.style.display   = '';
      if (btnEdit)        btnEdit.style.display        = '';
    }
  }

  // â”€â”€â”€ PDF pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function onFileSelected(file) {
    goToStep('processing');
    try {
      const { text, isImagePdf } = await PdfExtractor.extractText(file);

      if (isImagePdf) {
        showBanner('warning',
          'This PDF appears to be a scanned image - text could not be extracted. Please fill in the fields manually.');
        _parsedData = Parser.parse('');
      } else {
        _parsedData = Parser.parse(text);
      }

      const validation = Validator.validateAll(_parsedData);
      FormPrefiller.fillAll(_parsedData, validation);

      if (validation.hasErrors)        showBanner('error',   'Some required fields could not be detected - fields in red need manual entry.');
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

  // â”€â”€â”€ Review â†’ Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    goToStep('card');
    renderCard(merged, saved);
    updateCardButtons('current');
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

  // â”€â”€â”€ Card actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        goToStep('card');
        renderCard(updated.fields, updated);
        updateCardButtons('previous');
        return;
      }
    }

    await renderDashboard();
    goToStep('dashboard');
  }

  // â”€â”€â”€ Card rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function renderCard(fields, entry) {
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '--';
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
      rateNum !== null ? `${FieldNormalizer.formatRate(rateNum)} USD` : fields.nightlyRate || '--');

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
        ? `- Last edited ${formatTimestamp(entry.lastModifiedAt)}`
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

    // Signature â€” stroke data lives at entry.signature (top-level column)
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
          .map(l => `<div class="card-rate-line">${l.startDate} - ${l.endDate} &nbsp; <strong>$${l.rate.toFixed(2)} USD</strong></div>`)
          .join('');
        if (rateSection) rateSection.style.display = '';
      } else {
        linesContainer.innerHTML = '';
        if (rateSection) rateSection.style.display = 'none';
      }
    }
  }

  // â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _replaySignature(canvas, strokes) {
    if (!strokes || !strokes.length) return;

    // Compute bounding box of all strokes in the original CSS-pixel space
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    strokes.forEach(stroke => stroke.forEach(pt => {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }));

    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width  * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    // Scale strokes to fit inside the canvas with padding, then render slightly smaller
    // so the saved signature does not stretch edge-to-edge.
    const pad  = 10;
    const visualScalePercent = '100%';
    const visualScale = Math.max(0.1, Math.min(1, parseFloat(visualScalePercent) / 100 || 1));
    const srcW = maxX - minX || 1;
    const srcH = maxY - minY || 1;
    const fitScale = Math.min((rect.width - pad * 2) / srcW, (rect.height - pad * 2) / srcH);
    const scale = fitScale * visualScale;
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const offX  = pad - minX * scale;
    const offY  = (rect.height - drawH) / 2 - minY * scale;

    strokes.forEach(stroke => {
      if (!stroke.length) return;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * scale + offX, stroke[0].y * scale + offY);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i].x * scale + offX, stroke[i].y * scale + offY);
      }
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


