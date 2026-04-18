/**
 * fieldNormalizer.js
 * Converts raw parsed strings into consistent, display-ready formats.
 * No dependencies on other app modules.
 */
const FieldNormalizer = (() => {

  /**
   * Normalize a date string to MM/DD/YYYY.
   * Handles: MM-DD-YY, MM/DD/YY, MM-DD-YYYY, M/D/YY, etc.
   * Returns null if the format is unrecognized.
   */
  function normalizeDate(raw) {
    if (!raw) return null;
    const s = raw.trim();

    const m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
    if (!m) return null;

    const month = m[1].padStart(2, '0');
    const day   = m[2].padStart(2, '0');
    let year    = m[3];
    if (year.length === 2) year = '20' + year;

    return `${month}/${day}/${year}`;
  }

  /**
   * Normalize a rate string to a plain float (no currency symbols).
   * Handles: "426.00 USD", "$426", "389.00", "1,200.00"
   * Returns null if not parseable.
   */
  function normalizeRate(raw) {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : Math.round(num * 100) / 100;
  }

  /** Format a numeric rate for display: 406.50 → "$406.50" */
  function formatRate(num) {
    if (num === null || num === undefined) return '';
    return `$${num.toFixed(2)}`;
  }

  /**
   * Normalize a guest name to title case and trim whitespace.
   * "TONI HARRIS" → "Toni Harris"
   */
  function normalizeName(raw) {
    if (!raw) return null;
    return raw.trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return { normalizeDate, normalizeRate, formatRate, normalizeName };
})();
