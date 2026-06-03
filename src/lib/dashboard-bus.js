/**
 * src/lib/dashboard-bus.js
 * Lightweight event bus for cross-module dashboard communication.
 * Eliminates window.* globals while avoiding circular imports.
 */

const _handlers = new Map();

/**
 * Register a handler for a named action.
 * @param {string} action - Action name (e.g., 'refreshDashboard', 'editEvent')
 * @param {Function} handler - Async handler function
 */
export function onDashboardAction(action, handler) {
  if (!_handlers.has(action)) _handlers.set(action, new Set());
  _handlers.get(action).add(handler);
}

/**
 * Emit a named action, calling the registered handler.
 * @param {string} action - Action name
 * @param  {...any} args - Arguments to pass to the handler
 * @returns {Promise<any>}
 */
export async function emitDashboardAction(action, ...args) {
  const handlers = _handlers.get(action);
  if (handlers && handlers.size > 0) {
    const promises = Array.from(handlers).map(h => h(...args));
    // L FIX: Use allSettled so one handler failure doesn't lose all results
    const results = await Promise.allSettled(promises);
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[dashboard-bus] Handler ${i} for "${action}" failed:`, r.reason);
    });
    return results.filter(r => r.status === 'fulfilled').map(r => r.value);
  }
  console.warn(`[dashboard-bus] No handler for action: ${action}`);
}
