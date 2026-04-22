/**
 * auth.js
 * Staff authentication and session management.
 *
 * Public API:
 *   init()                        — restore session from storage, returns session or null
 *   signIn(email, password)       — returns { error } or {}
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
    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    _session = data.session;
    await _loadProfile(data.user.id);
    return {};
  }

  async function signOut() {
    await _supabase.auth.signOut();
    _session  = null;
    _profile  = null;
    _property = null;
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
    const { data: profile } = await _supabase
      .from('staff')
      .select('id, full_name, role, property_id')
      .eq('id', userId)
      .single();

    if (!profile) { _profile = null; _property = null; return; }
    _profile = profile;

    const { data: property } = await _supabase
      .from('properties')
      .select('*')
      .eq('id', profile.property_id)
      .single();

    _property = property ?? null;
  }

  return { init, signIn, signOut, getSession, getProfile, getProperty, onAuthChange };
})();
