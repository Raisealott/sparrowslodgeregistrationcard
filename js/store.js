/**
 * store.js
 * Persists registration entries to localStorage.
 *
 * Entry schema:
 * {
 *   id:              string   — unique identifier
 *   status:          'current' | 'previous' | 'deleted'
 *   createdAt:       ISO date string
 *   completedAt:     ISO date string | null
 *   deletedAt:       ISO date string | null
 *   _preDeleteStatus: 'current' | 'previous' | null
 *   fields: {
 *     guestName, confirmationNumber, arrivalDate, departureDate,
 *     roomType, nightlyRate, adults, email
 *   },
 *   rateLines:  Array<{ startDate, endDate, rate }>
 * }
 */
const Store = (() => {

  const KEY = 'sl_registrations_v1';
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  function _rawGetAll() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return [];
    }
  }

  function _save(entries) {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('[Store] localStorage write failed:', e);
    }
  }

  function _purgeOld() {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    const all = _rawGetAll();
    const filtered = all.filter(e =>
      e.status !== 'deleted' || new Date(e.deletedAt).getTime() >= cutoff
    );
    if (filtered.length !== all.length) _save(filtered);
  }

  function getAll() {
    _purgeOld();
    return _rawGetAll().filter(e => e.status !== 'deleted');
  }

  function getDeleted() {
    _purgeOld();
    return _rawGetAll().filter(e => e.status === 'deleted');
  }

  /** Insert a new entry at the front of the list. Returns the entry. */
  function add(entry) {
    const all = _rawGetAll();
    all.unshift(entry);
    _save(all);
    return entry;
  }

  /** Merge `changes` into an existing entry by id. Returns updated entry or null. */
  function update(id, changes) {
    const all = _rawGetAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return null;
    all[i] = { ...all[i], ...changes };
    _save(all);
    return all[i];
  }

  function getById(id) {
    return _rawGetAll().find(e => e.id === id) ?? null;
  }

  function softDelete(id) {
    const all = _rawGetAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return;
    all[i] = {
      ...all[i],
      _preDeleteStatus: all[i].status,
      status:    'deleted',
      deletedAt: new Date().toISOString(),
    };
    _save(all);
  }

  function restore(id) {
    const all = _rawGetAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return;
    const { _preDeleteStatus, deletedAt, ...rest } = all[i];
    all[i] = { ...rest, status: _preDeleteStatus || 'current' };
    _save(all);
  }

  function remove(id) {
    _save(_rawGetAll().filter(e => e.id !== id));
  }

  function generateId() {
    return `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  return { getAll, getDeleted, add, update, getById, softDelete, restore, remove, generateId };
})();
