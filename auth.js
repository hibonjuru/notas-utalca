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

  function hideBoot() {
    const boot = byId('boot-screen');
    if (boot) boot.hidden = true;
  }

  function showGate() {
    hideBoot();
    const gate = byId('auth-gate');
    const shell = byId('app-shell');
    if (gate) gate.hidden = false;
    if (shell) {
      shell.hidden = true;
      shell.setAttribute('inert', '');
    }
  }

  function showApp() {
    hideBoot();
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
    const modeLabel = byId('auth-mode-label');

    if (demoBanner) demoBanner.hidden = Boolean(config);
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

    if (!root.NotasCloud || !root.AuthUtils) {
      showGate();
      setError('No se pudieron cargar los módulos de cuentas. Revisa cloud.js y auth_utils.js.');
      return null;
    }

    try {
      await root.NotasCloud.init();
    } catch (error) {
      showGate();
      setError(root.NotasCloud.friendlyError(error));
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
