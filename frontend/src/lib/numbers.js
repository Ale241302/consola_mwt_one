// =====================================================================
// MWT.ONE · numbers.js
// Parseo y formateo de números con separadores locales.
// Locale por defecto: es-CR  (miles = ".", decimal = ",")
// =====================================================================

const DEFAULT_LOCALE = "es-CR";

/**
 * Normaliza un valor numérico escrito en locale latinoamericano.
 * Reglas para es-CR:
 *   - Punto (.)  -> separador de miles  -> se elimina.
 *   - Coma  (,)  -> separador decimal  -> se convierte a punto.
 *   - "26.924,66"  -> 26924.66
 *   - "26,924.66"  -> 26924.66  (mixto invertido, tolerado)
 *   - "2.994"      -> 2994      (punto = miles en es-CR)
 *   - "2,994"      -> 2.994     (coma = decimal)
 * Devuelve null si no es un número finito.
 *
 * @param {any} value
 * @param {string} locale
 * @returns {number|null}
 */
export function parseLocaleNumber(value, locale = DEFAULT_LOCALE) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  let s = String(value).trim();
  if (s === "") return null;

  // Quitar símbolos de moneda y espacios.
  s = s.replace(/\s/g, "").replace(/[₡$€£¥]/g, "");

  if (locale === "es-CR" || locale === "es") {
    const hasDot = s.includes(".");
    const hasComma = s.includes(",");

    if (hasDot && hasComma) {
      // El separador que aparece MÁS a la derecha es el decimal.
      const lastDot = s.lastIndexOf(".");
      const lastComma = s.lastIndexOf(",");
      if (lastComma > lastDot) {
        // 26.924,66  -> punto miles, coma decimal
        s = s.replace(/\./g, "").replace(/,/g, ".");
      } else {
        // 26,924.66  -> coma miles, punto decimal
        s = s.replace(/,/g, "");
      }
    } else if (hasComma) {
      // En es-CR la coma es decimal. "1,234" -> 1.234
      const parts = s.split(",");
      if (parts.length > 2) return null; // múltiples comas sin sentido
      s = s.replace(/,/g, ".");
    } else if (hasDot) {
      // Solo punto: puede ser separador de miles (es-CR) o decimal invertido.
      const parts = s.split(".");
      if (parts.length === 2) {
        const decimals = parts[1].length;
        if (decimals <= 2) {
          // 26924.66 -> decimal (tolerado)
          s = s;
        } else if (decimals === 3) {
          // 2.994 -> separador de miles
          s = s.replace(/\./g, "");
        } else {
          // >3 decimales: punto decimal
          s = s;
        }
      } else {
        // Múltiples puntos: solo válido si todos los grupos intermedios/finales son de 3 dígitos
        if (parts.slice(1).every((p) => p.length === 3)) {
          s = s.replace(/\./g, "");
        } else {
          return null;
        }
      }
    }
  } else {
    // en-US y similares: coma de miles, punto decimal
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formatea un número con separadores de miles y coma decimal.
 * @param {any} value
 * @param {string} locale
 * @param {number} decimals
 * @returns {string}
 */
export function formatLocaleNumber(value, locale = DEFAULT_LOCALE, decimals = 2) {
  const n = typeof value === "number" ? value : parseLocaleNumber(value, locale);
  if (!Number.isFinite(n)) return "";

  if (locale === "es-CR" || locale === "es") {
    const fixed = Math.abs(n).toFixed(decimals);
    const [intPart, decPart] = fixed.split(".");
    const intWithSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const sign = n < 0 ? "-" : "";
    return `${sign}${intWithSep},${decPart}`;
  }

  return n.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Devuelve true si el string parece ambiguo y necesita revisión humana.
 * Ej.: "2.994" en es-CR podría ser 2994 (miles) o 2.994 (decimal),
 *      aunque según locale es-CR el punto es miles.
 * @param {string} value
 * @param {string} locale
 * @returns {boolean}
 */
export function isAmbiguousNumberString(value, locale = DEFAULT_LOCALE) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim().replace(/\s/g, "").replace(/[₡$€£¥]/g, "");
  if (!/[.,]/.test(s)) return false;

  if (locale === "es-CR" || locale === "es") {
    // "2.994" sin coma y con exactamente 3 decimales => potencialmente ambiguo
    // si el usuario vino de locale en-US.
    if (!s.includes(",") && /\.\d{3}$/.test(s) && (s.match(/\./g) || []).length === 1) {
      return true;
    }
  } else {
    if (!s.includes(".") && /,\d{3}$/.test(s) && (s.match(/,/g) || []).length === 1) {
      return true;
    }
  }
  return false;
}
