/**
 * auth.js
 * Staff authentication and session management.
 *
 * Public API:
 *   init()                        — restore session from storage, returns session or null
 *   signIn(email, password)       — returns { error } or {}
 *   getPropertiesPublic()         — returns { properties, error } for login/signup selectors
 *   requestAccess(payload)        — create pending signup request
 *   listSignupRequests(status)    — admin-only request queue
 *   decideSignupRequest(id, s)    — admin-only approve/reject
 *   signOut()                     — clears session
 *   getSession()                  — returns current session or null
 *   getProfile()                  — returns { id, full_name, role, property_id } or null
 *   getProperty()                 — returns { id, name, slug, ... } or null
 *   onAuthChange(callback)        — subscribe to login/logout events
 */
const Auth = (() => {

  let _session  = null;
  let _profile  = null;
  let _property = null;

  async function init() {
    const { data: { session } } = await _supabase.auth.getSession();
    if (session) {
      _session = session;
      await _loadProfile(session.user.id);
    }
    return _session;
  }

  async function signIn(email, password) {
    if (!email || !password) {
      return { error: 'Please enter both email and password.' };
    }

    try {
      const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };

      if (!data?.session || !data?.user?.id) {
        return { error: 'Sign-in did not return an active session. Please try again.' };
      }

      _session = data.session;
      const { profile, property, error: profileError } = await _loadProfile(data.user.id);
      if (profileError) {
        await signOut();
        return { error: profileError };
      }

      if (!profile || !property) {
        await signOut();
        return {
          error: 'Your account is authenticated but not assigned to a property yet. Ask an admin to create your staff record in Supabase.'
        };
      }

      return {};
    } catch (err) {
      console.error('[Auth] signIn unexpected error:', err);
      const details = err?.message ? ' (' + err.message + ')' : '';
      return { error: 'Unable to sign in right now. Check your connection and try again' + details + '.' };
    }
  }

  async function signOut() {
    await _supabase.auth.signOut();
    _session  = null;
    _profile  = null;
    _property = null;
  }

  async function getPropertiesPublic() {
    const { data, error } = await _supabase
      .from('properties')
      .select('id, name, slug')
      .order('name', { ascending: true });

    if (error) {
      console.error('[Auth] getPropertiesPublic error:', error);
      return { properties: [], error: 'Could not load properties right now.' };
    }
    return { properties: data ?? [], error: null };
  }

  async function requestAccess(payload) {
    const fullName = (payload?.fullName || '').trim();
    const email = (payload?.email || '').trim().toLowerCase();
    const requestedPropertyId = payload?.requestedPropertyId || null;
    const note = (payload?.note || '').trim() || null;

    if (!fullName) return { error: 'Please enter your full name.' };
    if (!email) return { error: 'Please enter your email address.' };
    if (!requestedPropertyId) return { error: 'Please choose a property.' };

    const { data, error } = await _supabase
      .from('signup_requests')
      .insert({
        full_name: fullName,
        email,
        requested_property_id: requestedPropertyId,
        note,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return { error: 'A pending request already exists for this email.' };
      }
      console.error('[Auth] requestAccess error:', error);
      return { error: 'Could not submit your request right now. Please try again.' };
    }

    return { requestId: data?.id ?? null, error: null };
  }

  async function listSignupRequests(status = 'pending') {
    if (_profile?.role !== 'admin') {
      return { requests: [], error: 'Only admins can view signup requests.' };
    }

    const { data, error } = await _supabase
      .from('signup_requests')
      .select(`
        id,
        full_name,
        email,
        note,
        status,
        requested_at,
        requested_property_id,
        reviewer_note,
        reviewed_at,
        requested_property:properties(name, slug)
      `)
      .eq('status', status)
      .order('requested_at', { ascending: true });

    if (error) {
      console.error('[Auth] listSignupRequests error:', error);
      return { requests: [], error: 'Could not load signup requests.' };
    }
    return { requests: data ?? [], error: null };
  }

  async function decideSignupRequest(requestId, decision, reviewerNote = null) {
    if (_profile?.role !== 'admin') {
      return { error: 'Only admins can approve or reject signup requests.' };
    }
    if (!requestId) return { error: 'Missing request id.' };
    if (decision !== 'approved' && decision !== 'rejected') {
      return { error: 'Decision must be approved or rejected.' };
    }

    const { data, error } = await _supabase
      .from('signup_requests')
      .update({
        status: decision,
        reviewer_note: reviewerNote || null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: _profile.id,
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id, status')
      .single();

    if (error) {
      console.error('[Auth] decideSignupRequest error:', error);
      return { error: 'Could not update request status right now.' };
    }
    if (!data) return { error: 'Request is no longer pending.' };
    return { error: null, request: data };
  }

  function getSession()  { return _session; }
  function getProfile()  { return _profile; }
  function getProperty() { return _property; }

  function onAuthChange(callback) {
    _supabase.auth.onAuthStateChange(async (event, session) => {
      _session = session;
      if (session) {
        await _loadProfile(session.user.id);
      } else {
        _profile  = null;
        _property = null;
      }
      callback(event, session);
    });
  }

  async function _loadProfile(userId) {
    const { data: profile, error: profileQueryError } = await _supabase
      .from('staff')
      .select('id, full_name, role, property_id')
      .eq('id', userId)
      .single();

    if (profileQueryError && profileQueryError.code !== 'PGRST116') {
      console.error('[Auth] _loadProfile staff query error:', profileQueryError);
      _profile = null;
      _property = null;
      return { profile: null, property: null, error: 'Could not load your staff profile.' };
    }

    if (!profile) {
      _profile = null;
      _property = null;
      return { profile: null, property: null, error: null };
    }

    _profile = profile;

    const { data: property, error: propertyQueryError } = await _supabase
      .from('properties')
      .select('*')
      .eq('id', profile.property_id)
      .single();

    if (propertyQueryError && propertyQueryError.code !== 'PGRST116') {
      console.error('[Auth] _loadProfile properties query error:', propertyQueryError);
      _property = null;
      return { profile, property: null, error: 'Could not load your property settings.' };
    }

    _property = property ?? null;
    return { profile, property: _property, error: null };
  }

  return {
    init,
    signIn,
    signOut,
    getPropertiesPublic,
    requestAccess,
    listSignupRequests,
    decideSignupRequest,
    getSession,
    getProfile,
    getProperty,
    onAuthChange
  };
})();
