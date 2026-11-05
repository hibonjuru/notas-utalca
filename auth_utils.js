/* ==========================================================================
   Notas Utalca · Utilidades de cuenta
   Funciones puras para RUT y contraseña. Se pueden probar con Node.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AuthUtils = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const RUT_MIN = 6;
  const RUT_MAX = 8;
  const EMAIL_DOMAIN = 'notas-utalca.app';

  /**
   * Deja solo los dígitos del RUT, sin dígito verificador.
   * Acepta "12.345.678", "12345678" o "12 345 678".
   * Rechaza letras, largos fuera de 6-8 y valores vacíos.
   */
  function normalizeRut(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!text) return null;
    if (/[^0-9.\-\s]/.test(text)) return null;
    let digits = text.replace(/[^0-9]/g, '');
    if (!digits) return null;
    digits = digits.replace(/^0+/, '');
    if (digits.length < RUT_MIN || digits.length > RUT_MAX) return null;
    return digits;
  }

  /**
   * Email interno determinista para Supabase Auth.
   * No se envía correo: el RUT sigue siendo el identificador visible.
   */
  function rutToSyntheticEmail(rut) {
    const normalized = normalizeRut(rut);
    if (!normalized) return null;
    return `rut${normalized}@${EMAIL_DOMAIN}`;
  }

  function maskRut(rut) {
    const normalized = normalizeRut(rut);
    if (!normalized) return '—';
    if (normalized.length <= 3) return normalized;
    return `${'•'.repeat(normalized.length - 3)}${normalized.slice(-3)}`;
  }

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8) {
      return { ok: false, message: 'La contraseña debe tener al menos 8 caracteres.' };
    }
    if (password.length > 72) {
      return { ok: false, message: 'La contraseña no puede superar los 72 caracteres.' };
    }
    return { ok: true, message: '' };
  }

  return {
    RUT_MIN,
    RUT_MAX,
    EMAIL_DOMAIN,
    normalizeRut,
    rutToSyntheticEmail,
    maskRut,
    validatePassword
  };
});
