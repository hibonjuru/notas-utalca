/* ==========================================================================
   Notas Utalca · Adaptador de cuentas y persistencia
   Dos modos:
   - Supabase: autenticación real + Postgres con RLS.
   - Demo local: cuentas y datos en localStorage (solo para probar la UI).
   ========================================================================== */

(function (root) {
  const CONFIG_KEY = 'notas_supabase_config_v1';
  const DEMO_USERS_KEY = 'notas_demo_users_v1';
  const DEMO_SESSION_KEY = 'notas_demo_session_v1';
  const DEMO_STATE_PREFIX = 'notas_demo_state_v1:';
  const DEMO_EMAIL_DOMAIN = 'alumnos.utalca.cl';

  let client = null;
  let initError = null;

  function readJSON(key, fallback) {
    try {
      if (!root.localStorage) return fallback;
      const raw = root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      if (!root.localStorage) return false;
      root.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function userError(message) {
    const error = new Error(message);
    error.userFacing = true;
    return error;
  }

  function isValidConfig(config) {
    if (!config || !config.url || !config.anonKey) return false;
    const url = String(config.url).trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) return false;
    return String(config.anonKey).trim().length > 20;
  }

  function getConfig() {
    const base = root.NOTAS_CLOUD_CONFIG || {};
    const stored = readJSON(CONFIG_KEY, null) || {};
    const config = {
      url: String(base.url || stored.url || '').trim().replace(/\/+$/, ''),
      anonKey: String(base.anonKey || stored.anonKey || '').trim(),
      emailDomain: base.emailDomain || DEMO_EMAIL_DOMAIN
    };
    return isValidConfig(config) ? config : null;
  }

  function saveConfig(url, anonKey) {
    const config = {
      url: String(url || '').trim().replace(/\/+$/, ''),
      anonKey: String(anonKey || '').trim(),
      emailDomain: (root.NOTAS_CLOUD_CONFIG && root.NOTAS_CLOUD_CONFIG.emailDomain) || DEMO_EMAIL_DOMAIN
    };
    if (!isValidConfig(config)) {
      throw userError('Revisa la URL y la anon key. La URL debe ser https://tuproyecto.supabase.co y la key debe ser la anon public key.');
    }
    if (!writeJSON(CONFIG_KEY, config)) {
      throw userError('No se pudo guardar la configuración en este navegador.');
    }
  }

  function clearConfig() {
    try {
      if (root.localStorage) root.localStorage.removeItem(CONFIG_KEY);
    } catch (error) {
      /* noop */
    }
  }

  function getConfigSummary() {
    const config = getConfig();
    return config ? config.url.replace(/^https?:\/\//, '') : 'modo demo local';
  }

  function getMode() {
    return client ? 'supabase' : 'demo';
  }

  function getModeLabel() {
    return client ? 'Supabase (nube)' : 'Demo local (este navegador)';
  }

  function getInitError() {
    return initError;
  }

  async function init() {
    const config = getConfig();
    if (!config) {
      client = null;
      initError = null;
      return;
    }
    if (!root.supabase || typeof root.supabase.createClient !== 'function') {
      client = null;
      initError = 'No se pudo cargar vendor/supabase.js. Revisa que el archivo exista y vuelve a cargar la página.';
      throw userError(initError);
    }
    try {
      client = root.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      initError = null;
    } catch (error) {
      client = null;
      initError = 'La configuración de Supabase no es válida.';
      throw userError(initError);
    }
  }

  function requireClient() {
    if (!client) throw userError('Supabase no está configurado.');
    return client;
  }

  function syntheticEmail(rut) {
    if (root.AuthUtils && typeof root.AuthUtils.rutToSyntheticEmail === 'function') {
      const config = getConfig();
      const domain =
        (config && config.emailDomain) ||
        (root.NOTAS_CLOUD_CONFIG && root.NOTAS_CLOUD_CONFIG.emailDomain) ||
        DEMO_EMAIL_DOMAIN;
      return root.AuthUtils.rutToSyntheticEmail(rut, domain);
    }
    return `rut${rut}@${DEMO_EMAIL_DOMAIN}`;
  }

  function normalizeRut(rut) {
    if (root.AuthUtils && typeof root.AuthUtils.normalizeRut === 'function') {
      return root.AuthUtils.normalizeRut(rut);
    }
    const digits = String(rut || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
    return digits.length >= 6 && digits.length <= 8 ? digits : null;
  }

  function validatePassword(password) {
    if (root.AuthUtils && typeof root.AuthUtils.validatePassword === 'function') {
      return root.AuthUtils.validatePassword(password);
    }
    return password && String(password).length >= 8
      ? { ok: true, message: '' }
      : { ok: false, message: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  async function hashDemoPassword(rut, password) {
    const input = `notas-utalca-demo-v1|${rut}|${password}`;
    if (root.crypto && root.crypto.subtle && root.TextEncoder) {
      try {
        const data = new root.TextEncoder().encode(input);
        const digest = await root.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest))
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
      } catch (error) {
        /* fallback abajo */
      }
    }
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv-${(hash >>> 0).toString(16)}`;
  }

  async function getSession() {
    if (client) {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data || !data.session || !data.session.user) return null;
      const user = data.session.user;
      let rut = (user.user_metadata && user.user_metadata.rut) || '';
      try {
        const { data: profile } = await client
          .from('profiles')
          .select('rut')
          .eq('id', user.id)
          .maybeSingle();
        if (profile && profile.rut) rut = profile.rut;
      } catch (error) {
        /* si el perfil aún no está listo, usamos el metadata */
      }
      return { user: { id: user.id, rut } };
    }

    const session = readJSON(DEMO_SESSION_KEY, null);
    if (session && session.user && session.user.id) return session;
    return null;
  }

  async function signUp({ rut, password }) {
    const normalized = normalizeRut(rut);
    if (!normalized) {
      throw userError('Ingresa un RUT válido de 6 a 8 dígitos, sin dígito verificador.');
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) throw userError(passwordCheck.message);

    if (client) {
      const { data, error } = await client.auth.signUp({
        email: syntheticEmail(normalized),
        password,
        options: { data: { rut: normalized } }
      });
      if (error) throw error;
      if (!data || !data.session) {
        throw userError('La cuenta se creó, pero Supabase está pidiendo confirmar el correo. Desactiva "Confirm email" en Supabase o inicia sesión.');
      }
      return { user: { id: data.user.id, rut: normalized } };
    }

    const users = readJSON(DEMO_USERS_KEY, []);
    if (users.some((item) => item.rut === normalized)) {
      throw userError('Ya existe una cuenta con ese RUT en este navegador.');
    }
    const passHash = await hashDemoPassword(normalized, password);
    users.push({ rut: normalized, passHash, createdAt: new Date().toISOString() });
    writeJSON(DEMO_USERS_KEY, users);
    const session = { user: { id: `demo-${normalized}`, rut: normalized } };
    writeJSON(DEMO_SESSION_KEY, session);
    return session;
  }

  async function signIn({ rut, password }) {
    const normalized = normalizeRut(rut);
    if (!normalized) {
      throw userError('Ingresa un RUT válido de 6 a 8 dígitos, sin dígito verificador.');
    }

    if (client) {
      const { data, error } = await client.auth.signInWithPassword({
        email: syntheticEmail(normalized),
        password
      });
      if (error) throw error;
      return { user: { id: data.user.id, rut: normalized } };
    }

    const users = readJSON(DEMO_USERS_KEY, []);
    const user = users.find((item) => item.rut === normalized);
    if (!user) throw userError('RUT o contraseña incorrectos.');
    const passHash = await hashDemoPassword(normalized, password);
    if (passHash !== user.passHash) throw userError('RUT o contraseña incorrectos.');
    const session = { user: { id: `demo-${normalized}`, rut: normalized } };
    writeJSON(DEMO_SESSION_KEY, session);
    return session;
  }

  async function signOut() {
    if (client) {
      try {
        await client.auth.signOut();
      } catch (error) {
        /* la sesión local se limpia igual */
      }
      return;
    }
    try {
      if (root.localStorage) root.localStorage.removeItem(DEMO_SESSION_KEY);
    } catch (error) {
      /* noop */
    }
  }

  async function loadState(userId) {
    if (client) {
      const { data, error } = await client
        .from('user_state')
        .select('state,version,updated_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { state: data.state, version: data.version, updatedAt: data.updated_at };
    }

    const stored = readJSON(`${DEMO_STATE_PREFIX}${userId}`, null);
    return stored && stored.state ? stored : null;
  }

  async function saveState(userId, state, version) {
    if (client) {
      const currentVersion = Number(version) || 0;

      if (currentVersion <= 0) {
        const { data, error } = await client
          .from('user_state')
          .insert({
            user_id: userId,
            state,
            version: 1,
            updated_at: new Date().toISOString()
          })
          .select('version')
          .maybeSingle();
        if (error) {
          // 23505 = unique_violation: ya existe una fila; no la sobrescribas a ciegas.
          if (error.code === '23505' || /duplicate key/i.test(String(error.message || ''))) {
            return { conflict: true };
          }
          throw error;
        }
        return { version: (data && data.version) || 1 };
      }

      const nextVersion = currentVersion + 1;
      const { data, error } = await client
        .from('user_state')
        .update({
          state,
          version: nextVersion,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('version', currentVersion)
        .select('version')
        .maybeSingle();
      if (error) throw error;
      if (!data) return { conflict: true };
      return { version: data.version };
    }

    const key = `${DEMO_STATE_PREFIX}${userId}`;
    const previous = readJSON(key, null);
    const nextVersion = (Number(previous && previous.version) || 0) + 1;
    const saved = writeJSON(key, {
      state,
      version: nextVersion,
      updatedAt: new Date().toISOString()
    });
    if (!saved) throw userError('No se pudo guardar en este navegador.');
    return { version: nextVersion };
  }

  async function deleteState(userId) {
    if (client) {
      const { error } = await client.from('user_state').delete().eq('user_id', userId);
      if (error) throw error;
      return;
    }
    try {
      if (root.localStorage) root.localStorage.removeItem(`${DEMO_STATE_PREFIX}${userId}`);
    } catch (error) {
      /* noop */
    }
  }

  function friendlyError(error) {
    if (!error) return 'No se pudo completar la operación.';
    if (error.userFacing) return error.message;
    const message = String(error.message || error);

    if (/Invalid login credentials/i.test(message)) return 'RUT o contraseña incorrectos.';
    if (/User already registered|already been registered/i.test(message)) {
      return 'Ya existe una cuenta con ese RUT. Inicia sesión.';
    }
    if (/duplicate key|profiles_rut_key/i.test(message)) {
      return 'Ya existe una cuenta con ese RUT. Inicia sesión.';
    }
    if (/Database error saving new user/i.test(message)) {
      return 'No se pudo crear la cuenta. Puede que el RUT ya exista o que falte ejecutar supabase/schema.sql.';
    }
    if (/Email not confirmed/i.test(message)) {
      return 'La cuenta existe, pero el correo no está confirmado. Desactiva "Confirm email" en Supabase.';
    }
    if (/Password should be at least|weak password/i.test(message)) {
      return 'La contraseña es demasiado débil. Usa al menos 8 caracteres.';
    }
    if (/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(message)) {
      return 'Sin conexión con Supabase. Revisa tu internet e intenta nuevamente.';
    }
    if (/JWT|refresh token|session/i.test(message)) {
      return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    }
    return 'No se pudo completar la operación. Intenta nuevamente.';
  }

  function onAuthChange(callback) {
    if (!client) return;
    client.auth.onAuthStateChange((event, session) => callback(event, session));
  }

  root.NotasCloud = {
    init,
    getSession,
    signUp,
    signIn,
    signOut,
    loadState,
    saveState,
    deleteState,
    getMode,
    getModeLabel,
    getConfig,
    getConfigSummary,
    saveConfig,
    clearConfig,
    getInitError,
    friendlyError,
    onAuthChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
