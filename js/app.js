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
  let _isGeneratingCard = false;
  let _dashboardRenderTimer = null;
  let _deletedExpanded = false;
  let _submissionsArchiveEntries = [];

  const SUBMISSIONS_PREVIEW_DATE_LIMIT = 12;

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
    _applyPropertyConfig(PropertyConfig.current());
    Uploader.init(onFilesSelected);

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
      _scheduleDashboardRender();
    });
    document.getElementById('dashboard-search-input')?.addEventListener('focus', e => {
      _renderNameSuggestions(e.target.value);
    });
    document.addEventListener('click', e => {
      if (!e.target?.closest?.('.dashboard-search-wrap')) _hideNameSuggestions();
    });

    // Date filter panel
    document.getElementById('btn-filter-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('dashboard-filter-panel');
      const btn   = document.getElementById('btn-filter-toggle');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      btn.classList.toggle('is-active', !panel.hidden);
    });
    document.getElementById('filter-date-from')?.addEventListener('change', () => renderDashboard());
    document.getElementById('filter-date-to')?.addEventListener('change',   () => renderDashboard());
    document.getElementById('btn-filter-clear')?.addEventListener('click',  () => {
      const from = document.getElementById('filter-date-from');
      const to   = document.getElementById('filter-date-to');
      if (from) from.value = '';
      if (to)   to.value   = '';
      renderDashboard();
    });

    // Recently deleted toggle
    document.getElementById('btn-deleted-toggle')?.addEventListener('click', () => {
      const toggle = document.getElementById('btn-deleted-toggle');
      const list    = document.getElementById('list-deleted');
      const chevron = document.querySelector('#btn-deleted-toggle .deleted-chevron');
      if (!list) return;
      _deletedExpanded = !_deletedExpanded;
      list.hidden = !_deletedExpanded;
      if (chevron) chevron.textContent = _deletedExpanded ? '^' : 'v';
      if (toggle) toggle.setAttribute('aria-expanded', String(_deletedExpanded));
    });

    document.getElementById('btn-submissions-see-more')?.addEventListener('click', () => {
      renderSubmissionsArchive(_submissionsArchiveEntries);
      goToStep('submissions');
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
    _applyPropertyConfig(PropertyConfig.current());

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
    const btn = document.getElementById('btn-sign-out');
    if (btn?.disabled) return;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing Out...';
    }

    if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
    try {
      await Auth.signOut();
    } catch (err) {
      console.error('[App] onSignOut error:', err);
    } finally {
      goToStep('login');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign Out';
      }
    }
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

  // ─── Step navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const previous = _sortSubmissionsByDateDesc(filtered.filter(e => e.status === 'previous'));
    const hasFilter = Boolean(search.query || search.dateFrom || search.dateTo);
    _submissionsArchiveEntries = previous;

    renderGroup('list-current', current,
      hasFilter ? 'No matching arrivals' : 'No arrivals');
    renderSubmissionsPreview(previous, hasFilter);
    await renderDeletedGroup();

    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n > 0 ? `(${n})` : '';
    };
    setBadge('count-current',  current.length);
    setBadge('count-previous', previous.length);
  }

  function _readDashboardSearch() {
    const query     = document.getElementById('dashboard-search-input')?.value?.trim() || '';
    const dateFrom  = document.getElementById('filter-date-from')?.value || '';
    const dateTo    = document.getElementById('filter-date-to')?.value   || '';
    return { query, dateFrom, dateTo };
  }

  function _scheduleDashboardRender(delay = 120) {
    if (_dashboardRenderTimer) clearTimeout(_dashboardRenderTimer);
    _dashboardRenderTimer = setTimeout(() => {
      _dashboardRenderTimer = null;
      renderDashboard();
    }, delay);
  }

  function _filterDashboardEntries(entries, search) {
    let result = entries;
    if (search?.query) {
      result = result.filter(entry => _entryMatchesSearch(entry, search));
    }
    if (search?.dateFrom) {
      const from = new Date(search.dateFrom);
      result = result.filter(entry => {
        const arrival = entry.fields?.arrivalDate ? new Date(entry.fields.arrivalDate) : null;
        return arrival && arrival >= from;
      });
    }
    if (search?.dateTo) {
      const to = new Date(search.dateTo);
      result = result.filter(entry => {
        const arrival = entry.fields?.arrivalDate ? new Date(entry.fields.arrivalDate) : null;
        return arrival && arrival <= to;
      });
    }
    return result;
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
    const toggle     = document.getElementById('btn-deleted-toggle');
    const container  = document.getElementById('list-deleted');
    const countEl    = document.getElementById('count-deleted');
    const chevron    = document.querySelector('#btn-deleted-toggle .deleted-chevron');

    if (countEl) countEl.textContent = deleted.length > 0 ? `(${deleted.length})` : '';
    if (!container) return;
    container.hidden = !_deletedExpanded;
    if (chevron) chevron.textContent = _deletedExpanded ? '^' : 'v';
    if (toggle) toggle.setAttribute('aria-expanded', String(_deletedExpanded));
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

  function renderSubmissionsPreview(entries, hasFilter) {
    const container = document.getElementById('list-previous');
    const seeMoreBtn = document.getElementById('btn-submissions-see-more');
    if (!container) return;

    const groups = _buildSubmissionDateGroups(entries);
    const limitedGroups = groups.slice(0, SUBMISSIONS_PREVIEW_DATE_LIMIT);
    container.innerHTML = '';

    if (groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = hasFilter ? 'No matching submissions' : 'No submissions yet';
      container.appendChild(empty);
      if (seeMoreBtn) seeMoreBtn.hidden = true;
      return;
    }

    limitedGroups.forEach((groupData, index) => {
      _appendDateGroup(container, groupData.label, groupData.items, index === 0);
    });

    if (seeMoreBtn) {
      seeMoreBtn.hidden = groups.length <= SUBMISSIONS_PREVIEW_DATE_LIMIT;
      if (!seeMoreBtn.hidden) {
        const extra = groups.length - SUBMISSIONS_PREVIEW_DATE_LIMIT;
        seeMoreBtn.textContent = `See More (${extra} more date${extra === 1 ? '' : 's'})`;
      }
    }
  }

  function renderSubmissionsArchive(entries) {
    const container = document.getElementById('submissions-archive-list');
    if (!container) return;
    container.innerHTML = '';

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'entry-empty';
      empty.textContent = 'No submissions yet';
      container.appendChild(empty);
      return;
    }

    const dateGroups = _buildSubmissionDateGroups(entries);
    const monthGroups = new Map();

    dateGroups.forEach(groupData => {
      const monthKey = groupData.date
        ? `${groupData.date.getUTCFullYear()}-${String(groupData.date.getUTCMonth() + 1).padStart(2, '0')}`
        : 'unknown';
      const monthLabel = groupData.date
        ? groupData.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : 'Unknown Month';

      if (!monthGroups.has(monthKey)) monthGroups.set(monthKey, { monthLabel, days: [] });
      monthGroups.get(monthKey).days.push(groupData);
    });

    [...monthGroups.values()].forEach(month => {
      const monthSection = document.createElement('section');
      monthSection.className = 'submissions-archive-month';

      const monthHeader = document.createElement('h3');
      monthHeader.className = 'submissions-archive-month-title';
      monthHeader.textContent = month.monthLabel;
      monthSection.appendChild(monthHeader);

      const monthBody = document.createElement('div');
      monthBody.className = 'entry-list submissions-archive-month-list';

      month.days.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'entry-date-header submissions-archive-day-header';
        dayHeader.textContent = day.label;
        monthBody.appendChild(dayHeader);

        day.items.forEach(entry => monthBody.appendChild(createEntryRow(entry)));
      });

      monthSection.appendChild(monthBody);
      container.appendChild(monthSection);
    });
  }

  function _buildSubmissionDateGroups(entries) {
    const groups = new Map();

    entries.forEach(entry => {
      const date = _getSubmissionDate(entry);
      const key = date ? date.toISOString().slice(0, 10) : 'unknown-date';
      if (!groups.has(key)) {
        groups.set(key, {
          date,
          label: date
            ? date.toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })
            : 'Unknown Date',
          items: [],
        });
      }
      groups.get(key).items.push(entry);
    });

    return [...groups.values()];
  }

  function _appendDateGroup(container, label, items, isOpenByDefault) {
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'entry-date-header entry-date-toggle';
    header.setAttribute('aria-expanded', isOpenByDefault ? 'true' : 'false');
    header.innerHTML = `<span>${label}</span><span class="entry-date-chevron">${isOpenByDefault ? '▴' : '▾'}</span>`;

    const group = document.createElement('div');
    group.className = 'entry-date-group';
    group.hidden = !isOpenByDefault;
    items.forEach(entry => group.appendChild(createEntryRow(entry)));

    header.addEventListener('click', () => {
      const open = group.hidden;
      group.hidden = !open;
      header.setAttribute('aria-expanded', String(open));
      header.querySelector('.entry-date-chevron').textContent = open ? '▴' : '▾';
    });

    container.appendChild(header);
    container.appendChild(group);
  }

  function _sortSubmissionsByDateDesc(entries) {
    return [...entries].sort((a, b) => {
      const aDate = _getSubmissionDate(a);
      const bDate = _getSubmissionDate(b);
      if (aDate && bDate) return bDate - aDate;
      if (bDate) return 1;
      if (aDate) return -1;
      return 0;
    });
  }

  function _getSubmissionDate(entry) {
    const raw = entry?.completedAt || entry?.lastModifiedAt || entry?.createdAt || null;
    if (!raw) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
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

  async function onFilesSelected(files) {
    const selectedFiles = Array.isArray(files) ? files : [files];
    if (selectedFiles.length === 1) {
      await onFileSelected(selectedFiles[0]);
      return;
    }

    await onBatchFilesSelected(selectedFiles);
  }

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

  function _applyPropertyConfig(config) {
    if (!config) return;

    document.title = 'Hotel Guest Registration';
    const slug = config.slug || '';
    if (slug) {
      document.documentElement.setAttribute('data-property-slug', slug);
      document.body?.setAttribute('data-property-slug', slug);
    } else {
      document.documentElement.removeAttribute('data-property-slug');
      document.body?.removeAttribute('data-property-slug');
    }

    document.querySelectorAll('.hotel-name').forEach(el => {
      el.textContent = config.name;
    });
    document.querySelectorAll('.hotel-sub').forEach(el => {
      el.textContent = config.subTitle || '';
    });

    const loginLogo = document.querySelector('.login-logo');
    const loginSub = document.querySelector('.login-sub');
    if (loginLogo) loginLogo.textContent = 'Hotel Guest Registration';
    if (loginSub) loginSub.textContent = '';

    const cardLogo = document.getElementById('card-brand-logo');
    const cardLogoText = document.getElementById('card-logo-text');
    if (cardLogo && cardLogoText) {
      if (config.logoSrc) {
        cardLogo.src = config.logoSrc;
        cardLogo.alt = config.logoAlt || `${config.name} logo`;
        cardLogo.hidden = false;
        cardLogoText.hidden = true;
      } else {
        cardLogo.hidden = true;
        cardLogoText.textContent = config.name;
        cardLogoText.hidden = false;
      }
    }

    const guestHomeImg = document.querySelector('.guest-welcome-art-img');
    if (guestHomeImg) {
      if (config.guestHomeLogoSrc) {
        guestHomeImg.src = config.guestHomeLogoSrc;
        guestHomeImg.hidden = false;
      } else {
        guestHomeImg.hidden = true;
      }
    }

    const policyGreeting = document.getElementById('card-policy-greeting');
    const policyText = document.getElementById('card-policy-text');
    if (policyGreeting) policyGreeting.textContent = config.policyGreeting || '';
    if (policyText) {
      policyText.innerHTML = (config.policyParagraphs || [])
        .map(text => `<p>${_escapeHtml(text)}</p>`)
        .join('');
    }

    const address = document.getElementById('card-hotel-address');
    if (address) {
      address.innerHTML = (config.addressLines || [])
        .map(_escapeHtml)
        .join('<br>');
    }
  }

  async function onBatchFilesSelected(files) {
    goToStep('processing');
    updateProcessingText(`Extracting ${files.length} Reservation PDFs`, 'Saving each document as a current registration...');

    try {
      const results = await Promise.all(files.map(file => processPdfForBatch(file)));
      const successful = results.filter(result => result.ok);
      const failed = results.filter(result => !result.ok);

      if (successful.length === 0) {
        goToStep('upload');
        showUploadError('Could not read these PDFs. Please check the files and try again.');
        return;
      }

      await Promise.all(successful.map(result => DB.add(result.entry)));

      _parsedData = null;
      _currentId = null;
      await renderDashboard();
      goToStep('dashboard');

      if (failed.length > 0) {
        window.alert(`${successful.length} PDF${successful.length === 1 ? '' : 's'} uploaded. ${failed.length} could not be read.`);
      }
    } catch (err) {
      console.error('[App] Batch PDF processing error:', err);
      goToStep('upload');
      showUploadError('Could not read these PDFs. Please check the files and try again.');
    } finally {
      updateProcessingText('Extracting Reservation Details', 'This usually takes just a moment...');
    }
  }

  async function processPdfForBatch(file) {
    try {
      const { text, isImagePdf } = await PdfExtractor.extractText(file);
      if (isImagePdf) return { ok: false, file, reason: 'image-pdf' };

      const parsed = Parser.parse(text);
      const validation = Validator.validateAll(parsed);
      const now = new Date().toISOString();

      return {
        ok: true,
        file,
        validation,
        entry: {
          id:          DB.generateId(),
          status:      'current',
          createdAt:   now,
          completedAt: null,
          fields:      parsedToFields(parsed),
          rateLines:   sanitizeRateLines(parsed.rateLines),
        },
      };
    } catch (err) {
      console.error('[App] Batch PDF item failed:', file?.name, err);
      return { ok: false, file, reason: 'error' };
    }
  }

  function parsedToFields(parsed) {
    const value = key => parsed[key]?.value ?? '';
    const rateNum = FieldNormalizer.normalizeRate(value('nightlyRate'));

    return {
      guestName:          value('guestName'),
      confirmationNumber: value('confirmationNumber'),
      arrivalDate:        FieldNormalizer.normalizeDate(value('arrivalDate')) ?? value('arrivalDate'),
      departureDate:      FieldNormalizer.normalizeDate(value('departureDate')) ?? value('departureDate'),
      roomType:           value('roomType'),
      nightlyRate:        rateNum !== null ? rateNum.toFixed(2) : value('nightlyRate'),
      adults:             value('adults'),
      email:              value('email'),
      phone:              value('phone'),
      carMake:            '',
      carModel:           '',
      carColor:           '',
      resortFeeConsent:   '',
    };
  }

  function updateProcessingText(label, sub) {
    const labelEl = document.querySelector('#step-processing .processing-label');
    const subEl = document.querySelector('#step-processing .processing-sub');
    if (labelEl) labelEl.textContent = label;
    if (subEl) subEl.textContent = sub;
  }

  function showUploadError(message) {
    const el = document.getElementById('upload-error');
    if (el) { el.textContent = message; el.style.display = 'block'; }
  }

  // â”€â”€â”€ Review â†’ Card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function onConfirm() {
    if (_isGeneratingCard) return;

    const btn = document.getElementById('btn-confirm');
    _isGeneratingCard = true;
    if (btn) {
      btn.disabled = true;
      btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
      btn.textContent = 'Generating...';
    }

    try {
      const values       = readReviewForm();
      const existing     = _currentId ? await DB.getById(_currentId) : null;
      const merged       = { ...(existing?.fields ?? {}), ...values };
      const now          = new Date().toISOString();
      const rateLines    = sanitizeRateLines(_parsedData?.rateLines);
      const id           = _currentId || DB.generateId();
      const previewEntry = {
        ...(existing ?? {}),
        id,
        status:      'current',
        createdAt:   existing?.createdAt || now,
        completedAt: existing?.completedAt ?? null,
        fields:      merged,
        rateLines,
      };

      _currentId  = id;
      _parsedData = { ...(_parsedData ?? {}), rateLines };

      goToStep('card');
      renderCard(merged, previewEntry);
      updateCardButtons('current');

      if (existing) {
        const saved = await DB.update(id, { fields: merged, rateLines });
        if (saved) renderCard(saved.fields, saved);
      } else {
        const saved = await DB.add(previewEntry);
        if (saved) {
          _currentId = saved.id;
          renderCard(saved.fields, saved);
        }
      }
    } catch (err) {
      console.error('[App] Generate card failed:', err);
      goToStep('review');
      showBanner('error', 'Could not generate this card. Please check the fields and try again.');
    } finally {
      _isGeneratingCard = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || 'Generate Card ->';
      }
    }
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
    const lines          = sanitizeRateLines(_parsedData?.rateLines);
    if (linesContainer) {
      if (lines.length > 0) {
        linesContainer.innerHTML = lines
          .map(l => `<div class="card-rate-line">${l.startDate} - ${l.endDate} &nbsp; <strong>${FieldNormalizer.formatRate(l.rate)} USD</strong></div>`)
          .join('');
        if (rateSection) rateSection.style.display = '';
      } else {
        linesContainer.innerHTML = '';
        if (rateSection) rateSection.style.display = 'none';
      }
    }
  }

  function sanitizeRateLines(lines) {
    if (!Array.isArray(lines)) return [];
    return lines
      .map(line => ({
        startDate: line?.startDate || '',
        endDate:   line?.endDate   || '',
        rate:      FieldNormalizer.normalizeRate(line?.rate),
      }))
      .filter(line => line.startDate && line.endDate && line.rate !== null);
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

  function _escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());



