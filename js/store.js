/**
 * store.js
 * Persists registration entries to localStorage.
 *
 * Entry schema:
 * {
 *   id:           string   — unique identifier
 *   status:       'current' | 'previous'
 *   createdAt:    ISO date string
 *   completedAt:  ISO date string | null
 *   fields: {
 *     guestName, confirmationNumber, arrivalDate, departureDate,
 *     roomType, roomNumber, nightlyRate, adults, email
 *   },
 *   rateLines:  Array<{ startDate, endDate, rate }>
 * }
 */
const Store = (() => {

  const KEY = 'sl_registrations_v1';

  function getAll() {
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

  /** Insert a new entry at the front of the list. Returns the entry. */
  function add(entry) {
    const all = getAll();
    all.unshift(entry);
    _save(all);
    return entry;
  }

  /** Merge `changes` into an existing entry by id. Returns updated entry or null. */
  function update(id, changes) {
    const all = getAll();
    const i = all.findIndex(e => e.id === id);
    if (i === -1) return null;
    all[i] = { ...all[i], ...changes };
    _save(all);
    return all[i];
  }

  function getById(id) {
    return getAll().find(e => e.id === id) ?? null;
  }

  function remove(id) {
    _save(getAll().filter(e => e.id !== id));
  }

  function generateId() {
    return `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  return { getAll, add, update, getById, remove, generateId };
})();
