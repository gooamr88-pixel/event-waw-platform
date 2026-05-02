/**
 * src/lib/state.js
 * Centralized Dashboard State Manager
 */

export const dashboardState = {
  events: [],
  user: null,
  revenue: null,
  listeners: new Map(),

  set(key, value) {
    this[key] = value;
    if (this.listeners.has(key)) {
      this.listeners.get(key).forEach(callback => callback(value));
    }
  },

  get(key) {
    return this[key];
  },

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
    // Return unsubscribe function
    return () => this.listeners.get(key).delete(callback);
  }
};
