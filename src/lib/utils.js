/* ===================================
   EVENT WAW - Shared Utilities
   =================================== */

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
 * Format a number as currency using the browser's Intl.NumberFormat.
 * Falls back to naive formatting if Intl is unavailable.
 */
export function formatCurrency(amount, currency = 'USD') {
  const num = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch (_) {
    // Fallback for unknown currency codes
    return `${num.toLocaleString()} ${currency}`;
  }
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
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}
