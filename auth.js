/* ==========================================================================
   Notas Utalca · Pantalla de acceso
   Login/registro con RUT sin dígito verificador.
   ========================================================================== */

(function (root) {
  let wired = false;
  let mode = 'login';

  function byId(id) {
    return document.getElementById(id);
  }

  function setError(message) {
    const el = byId('auth-error');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function setBusy(busy) {
    const submit = byId('auth-submit');
    const rut = byId('auth-rut');
    const password = byId('auth-password');
    const confirm = byId('auth-confirm');
    if (submit) {
      submit.disabled = busy;
      submit.textContent = busy
        ? 'Procesando…'
        : mode === 'login'
        ? 'Entrar'
        : 'Crear cuenta';
    }
    [rut, password, confirm].forEach((el) => {
      if (el) el.disabled = busy;
    });
  }

  function setMode(nextMode) {
    mode = nextMode === 'signup' ? 'signup' : 'login';
    const loginTab = byId('auth-tab-login');
    const signupTab = byId('auth-tab-signup');
    const confirmWrap = byId('auth-confirm-wrap');
    const password = byId('auth-password');

    loginTab?.classList.toggle('active', mode === 'login');
    signupTab?.classList.toggle('active', mode === 'signup');
    if (confirmWrap) confirmWrap.hidden = mode !== 'signup';
    if (password) password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    setError('');
    setBusy(false);
  }

  function showGate() {
    const gate = byId('auth-gate');
    const shell = byId('app-shell');
    if (gate) gate.hidden = false;
    if (shell) {
      shell.hidden = true;
      shell.setAttribute('inert', '');
    }
  }

  function showApp() {
    const gate = byId('auth-gate');
    const shell = byId('app-shell');
    if (gate) gate.hidden = true;
    if (shell) {
      shell.hidden = false;
      shell.removeAttribute('inert');
    }
  }

  function refreshModeUI() {
    const config = root.NotasCloud ? root.NotasCloud.getConfig() : null;
    const demoBanner = byId('auth-demo-banner');
    const configToggle = byId('auth-config-toggle');
    const configStatus = byId('auth-config-status');
    const urlInput = byId('auth-config-url');
    const keyInput = byId('auth-config-key');
    const modeLabel = byId('auth-mode-label');

    if (demoBanner) demoBanner.hidden = Boolean(config);
    if (configToggle) {
      configToggle.textContent = config
        ? 'Configuración de Supabase'
        : 'Conectar con Supabase (cuentas reales)';
    }
    if (configStatus) {
      configStatus.textContent = config
        ? `Conectado a ${config.url.replace(/^https?:\/\//, '')}`
        : 'Sin Supabase: modo demo local.';
    }
    if (urlInput && config) urlInput.value = config.url;
    if (keyInput && config) keyInput.value = config.anonKey;
    if (modeLabel) {
      modeLabel.textContent = config ? 'Cuenta en la nube' : 'Modo demo local';
    }
  }

  function wire() {
    if (wired) return;
    wired = true;

    byId('auth-tab-login')?.addEventListener('click', () => setMode('login'));
    byId('auth-tab-signup')?.addEventListener('click', () => setMode('signup'));

    byId('auth-toggle-pass')?.addEventListener('click', () => {
      const input = byId('auth-password');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      const button = byId('auth-toggle-pass');
      if (button) {
        button.textContent = showing ? 'Ver' : 'Ocultar';
        button.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
      }
    });

    byId('auth-config-toggle')?.addEventListener('click', () => {
      const panel = byId('auth-config-panel');
      if (panel) panel.hidden = !panel.hidden;
    });

    byId('auth-config-save')?.addEventListener('click', () => {
      const url = byId('auth-config-url')?.value || '';
      const key = byId('auth-config-key')?.value || '';
      const status = byId('auth-config-status');
      try {
        root.NotasCloud.saveConfig(url, key);
        if (status) status.textContent = 'Configuración guardada. Recargando…';
        root.location.reload();
      } catch (error) {
        if (status) status.textContent = root.NotasCloud.friendlyError(error);
      }
    });

    byId('auth-config-demo')?.addEventListener('click', () => {
      root.NotasCloud.clearConfig();
      root.location.reload();
    });

    byId('auth-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      setError('');

      const rut = byId('auth-rut')?.value || '';
      const password = byId('auth-password')?.value || '';
      const confirm = byId('auth-confirm')?.value || '';

      if (!root.AuthUtils.normalizeRut(rut)) {
        setError('Ingresa un RUT válido de 6 a 8 dígitos, sin dígito verificador.');
        return;
      }
      const passwordCheck = root.AuthUtils.validatePassword(password);
      if (!passwordCheck.ok) {
        setError(passwordCheck.message);
        return;
      }
      if (mode === 'signup' && password !== confirm) {
        setError('Las contraseñas no coinciden.');
        return;
      }

      setBusy(true);
      try {
        if (mode === 'signup') {
          await root.NotasCloud.signUp({ rut, password });
        } else {
          await root.NotasCloud.signIn({ rut, password });
        }
        root.location.reload();
      } catch (error) {
        setError(root.NotasCloud.friendlyError(error));
        setBusy(false);
      }
    });

    const passwordInput = byId('auth-password');
    passwordInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        byId('auth-form')?.requestSubmit();
      }
    });
  }

  async function init() {
    wire();
    refreshModeUI();
    setMode('login');

    try {
      await root.NotasCloud.init();
    } catch (error) {
      showGate();
      setError(root.NotasCloud.friendlyError(error));
      const panel = byId('auth-config-panel');
      if (panel) panel.hidden = false;
      return null;
    }

    refreshModeUI();

    root.NotasCloud.onAuthChange((event) => {
      if (event === 'SIGNED_OUT') root.location.reload();
    });

    try {
      const session = await root.NotasCloud.getSession();
      if (session) {
        showApp();
        return session;
      }
    } catch (error) {
      setError(root.NotasCloud.friendlyError(error));
    }

    showGate();
    return null;
  }

  async function logout() {
    if (root.NotasCloud) await root.NotasCloud.signOut();
    root.location.reload();
  }

  root.NotasAuth = { init, logout, showGate, showApp };
})(typeof window !== 'undefined' ? window : globalThis);
