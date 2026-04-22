/**
 * db.js
 * Async database layer — Supabase replacement for store.js.
 * Mirrors the Store API so app.js can swap Store → DB with minimal changes.
 *
 * All operations are scoped to the authenticated staff member's property_id.
 *
 * Public API (all async):
 *   getAll()                     — active entries (current + previous)
 *   getDeleted()                 — soft-deleted entries
 *   getById(id)                  — single entry or null
 *   add(entry)                   — insert new entry, returns saved entry
 *   update(id, changes)          — merge changes into entry, returns updated entry
 *   softDelete(id)               — mark deleted
 *   restore(id)                  — restore from deleted
 *   remove(id)                   — permanent delete
 *   generateId()                 — synchronous, no DB call needed
 *   subscribeToChanges(onUpdate) — real-time subscription for multi-iPad sync
 */
const DB = (() => {

  const TABLE = 'registrations';

  // ─── Field mapping ─────────────────────────────────────────
  // JS camelCase <-> DB snake_case

  function _toRow(entry) {
    const f = entry.fields || {};
    return {
      id:                   entry.id,
      property_id:          entry.property_id ?? Auth.getProperty()?.id,
      status:               entry.status,
      guest_name:           f.guestName          ?? null,
      confirmation_number:  f.confirmationNumber ?? null,
      arrival_date:         f.arrivalDate        ?? null,
      departure_date:       f.departureDate      ?? null,
      room_type:            f.roomType           ?? null,
      nightly_rate:         f.nightlyRate        ?? null,
      adults:               f.adults             ?? null,
      email:                f.email              ?? null,
      phone:                f.phone              ?? null,
      car_make:             f.carMake            ?? null,
      car_model:            f.carModel           ?? null,
      car_color:            f.carColor           ?? null,
      resort_fee_consent:   f.resortFeeConsent   ?? null,
      rate_lines:           entry.rateLines      ?? null,
      signature:            entry.signature      ?? null,
      completed_at:         entry.completedAt    ?? null,
      deleted_at:           entry.deletedAt      ?? null,
      pre_delete_status:    entry._preDeleteStatus ?? null,
      created_by:           Auth.getProfile()?.id ?? null,
    };
  }

  function _fromRow(row) {
    return {
      id:               row.id,
      property_id:      row.property_id,
      status:           row.status,
      createdAt:        row.created_at,
      completedAt:      row.completed_at,
      deletedAt:        row.deleted_at,
      lastModifiedAt:   row.last_modified_at,
      _preDeleteStatus: row.pre_delete_status,
      fields: {
        guestName:          row.guest_name,
        confirmationNumber: row.confirmation_number,
        arrivalDate:        row.arrival_date,
        departureDate:      row.departure_date,
        roomType:           row.room_type,
        nightlyRate:        row.nightly_rate,
        adults:             row.adults,
        email:              row.email,
        phone:              row.phone,
        carMake:            row.car_make,
        carModel:           row.car_model,
        carColor:           row.car_color,
        resortFeeConsent:   row.resort_fee_consent,
      },
      rateLines: row.rate_lines  ?? [],
      signature: row.signature   ?? null,
    };
  }

  // ─── Queries ───────────────────────────────────────────────

  async function getAll() {
    const { data, error } = await _supabase
      .from(TABLE)
      .select('*')
      .in('status', ['current', 'previous'])
      .order('created_at', { ascending: false });

    if (error) { console.error('[DB] getAll:', error); return []; }
    return (data ?? []).map(_fromRow);
  }

  async function getDeleted() {
    const { data, error } = await _supabase
      .from(TABLE)
      .select('*')
      .eq('status', 'deleted')
      .order('deleted_at', { ascending: false });

    if (error) { console.error('[DB] getDeleted:', error); return []; }
    return (data ?? []).map(_fromRow);
  }

  async function getById(id) {
    const { data, error } = await _supabase
      .from(TABLE)
      .select('*')
      .eq('id', id)
      .single();

    if (error) { console.error('[DB] getById:', error); return null; }
    return data ? _fromRow(data) : null;
  }

  async function add(entry) {
    const row = _toRow(entry);
    const { data, error } = await _supabase
      .from(TABLE)
      .insert(row)
      .select()
      .single();

    if (error) { console.error('[DB] add:', error); return entry; }
    return _fromRow(data);
  }

  async function update(id, changes) {
    // changes may use camelCase JS shape — convert fields sub-object if present
    const row = {};
    if (changes.status)           row.status           = changes.status;
    if (changes.completedAt)      row.completed_at     = changes.completedAt;
    if (changes.deletedAt)        row.deleted_at       = changes.deletedAt;
    if (changes._preDeleteStatus) row.pre_delete_status = changes._preDeleteStatus;
    if (changes.signature  !== undefined) row.signature   = changes.signature;
    if (changes.rateLines  !== undefined) row.rate_lines  = changes.rateLines;

    if (changes.fields) {
      const f = changes.fields;
      if (f.guestName          !== undefined) row.guest_name          = f.guestName;
      if (f.confirmationNumber !== undefined) row.confirmation_number = f.confirmationNumber;
      if (f.arrivalDate        !== undefined) row.arrival_date        = f.arrivalDate;
      if (f.departureDate      !== undefined) row.departure_date      = f.departureDate;
      if (f.roomType           !== undefined) row.room_type           = f.roomType;
      if (f.nightlyRate        !== undefined) row.nightly_rate        = f.nightlyRate;
      if (f.adults             !== undefined) row.adults              = f.adults;
      if (f.email              !== undefined) row.email               = f.email;
      if (f.phone              !== undefined) row.phone               = f.phone;
      if (f.carMake            !== undefined) row.car_make            = f.carMake;
      if (f.carModel           !== undefined) row.car_model           = f.carModel;
      if (f.carColor           !== undefined) row.car_color           = f.carColor;
      if (f.resortFeeConsent   !== undefined) row.resort_fee_consent  = f.resortFeeConsent;
    }

    const { data, error } = await _supabase
      .from(TABLE)
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) { console.error('[DB] update:', error); return null; }
    return _fromRow(data);
  }

  async function softDelete(id) {
    const entry = await getById(id);
    if (!entry) return;
    await update(id, {
      _preDeleteStatus: entry.status,
      status:    'deleted',
      deletedAt: new Date().toISOString(),
    });
  }

  async function restore(id) {
    const entry = await getById(id);
    if (!entry) return;
    const { data, error } = await _supabase
      .from(TABLE)
      .update({
        status:            entry._preDeleteStatus || 'current',
        deleted_at:        null,
        pre_delete_status: null,
      })
      .eq('id', id);

    if (error) console.error('[DB] restore:', error);
  }

  async function remove(id) {
    const { error } = await _supabase
      .from(TABLE)
      .delete()
      .eq('id', id);

    if (error) console.error('[DB] remove:', error);
  }

  function generateId() {
    return `reg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  // ─── Real-time ─────────────────────────────────────────────

  /**
   * Subscribe to INSERT/UPDATE/DELETE on this property's registrations.
   * onUpdate() is called whenever a change is detected on another device.
   * Returns an unsubscribe function.
   */
  function subscribeToChanges(onUpdate) {
    const propertyId = Auth.getProperty()?.id;
    if (!propertyId) return () => {};

    const channel = _supabase
      .channel('registrations-sync')
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  TABLE,
          filter: `property_id=eq.${propertyId}`,
        },
        () => onUpdate()
      )
      .subscribe();

    return () => _supabase.removeChannel(channel);
  }

  return {
    getAll, getDeleted, getById,
    add, update, softDelete, restore, remove,
    generateId, subscribeToChanges,
  };
})();
