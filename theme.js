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

  root.NotasTheme = {
    getPreference,
    getTheme: () => documentElement.dataset.theme || resolve(getPreference()),
    setPreference
  };
})(typeof window !== 'undefined' ? window : globalThis);
