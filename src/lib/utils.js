/* ═══════════════════════════════════
   EVENT WAW — Shared Utilities
   ═══════════════════════════════════ */

/**
 * Sanitize a string for safe HTML insertion.
 * Prevents XSS when using innerHTML / template literals.
 */
export function escapeHTML(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * Format a number as currency (USD by default).
 */
export function formatCurrency(amount, currency = 'USD') {
  const num = Number(amount).toLocaleString();
  return currency === 'USD' ? `$${num}` : `${num} ${currency}`;
}

/**
 * Format a date for display.
 */
export function formatDate(dateStr, options = {}) {
  const defaults = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  return new Date(dateStr).toLocaleDateString('en-US', { ...defaults, ...options });
}

/**
 * Truncate a string and add ellipsis.
 */
export function truncate(str, maxLen = 32) {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}
