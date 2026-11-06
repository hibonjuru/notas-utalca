/* ==========================================================================
   Notas Utalca · preferencia de tema
   Se carga antes de styles.css para evitar el destello claro/oscuro.
   - system: sigue al dispositivo
   - light / dark: override manual
   ========================================================================== */

(function (root) {
  const STORAGE_KEY = 'notas_utalca_theme_v1';
  const VALID = ['system', 'light', 'dark'];
  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  const documentElement = root.document.documentElement;

  function getPreference() {
    try {
      const saved = root.localStorage.getItem(STORAGE_KEY);
      return VALID.includes(saved) ? saved : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function resolve(preference) {
    if (preference === 'system') return media && media.matches ? 'dark' : 'light';
    return preference;
  }

  function apply(preference) {
    const theme = resolve(preference);
    documentElement.dataset.theme = theme;
    documentElement.dataset.themePreference = preference;
    documentElement.style.colorScheme = theme;
    documentElement.style.backgroundColor = theme === 'dark' ? '#0e1116' : '#f5f6f8';

    const meta = root.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e1116' : '#be0f20');

    updateControls();
  }

  function getTheme() {
    return documentElement.dataset.theme || resolve(getPreference());
  }

  function updateControls() {
    const preference = getPreference();
    const isDark = getTheme() === 'dark';

    root.document.querySelectorAll('[data-action="set-theme"]').forEach((button) => {
      const active = button.dataset.themePref === preference;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    root.document.querySelectorAll('[data-action="toggle-theme"]').forEach((button) => {
      const label = isDark ? 'Activar modo claro' : 'Activar modo oscuro';
      button.setAttribute('aria-label', label);
      button.title = label;
    });
  }

  apply(getPreference());

  function setPreference(preference) {
    if (!VALID.includes(preference)) return;
    try {
      root.localStorage.setItem(STORAGE_KEY, preference);
    } catch (error) {
      /* noop */
    }
    apply(preference);
    root.dispatchEvent(
      new CustomEvent('notas-theme-change', {
        detail: { preference, theme: resolve(preference) }
      })
    );
  }

  function toggle() {
    setPreference(getTheme() === 'dark' ? 'light' : 'dark');
  }

  function handleSystemChange() {
    if (getPreference() === 'system') apply('system');
  }

  if (media) {
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleSystemChange);
    } else if (typeof media.addListener === 'function') {
      media.addListener(handleSystemChange);
    }
  }

  root.document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const setButton = target.closest('[data-action="set-theme"]');
    if (setButton) {
      event.preventDefault();
      setPreference(setButton.dataset.themePref);
      return;
    }

    const toggleButton = target.closest('[data-action="toggle-theme"]');
    if (toggleButton) {
      event.preventDefault();
      toggle();
    }
  });

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', updateControls);
  } else {
    updateControls();
  }

  root.NotasTheme = {
    getPreference,
    getTheme,
    setPreference,
    toggle
  };
})(typeof window !== 'undefined' ? window : globalThis);
