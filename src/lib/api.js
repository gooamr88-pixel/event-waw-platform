/**
 * src/lib/api.js
 * Secure API Wrapper
 */
import { supabase } from './supabase.js';
import { showToast } from './dashboard-ui.js';

export async function safeQuery(queryPromise) {
  try {
    const { data, error } = await queryPromise;
    if (error) {
      console.error('[Supabase Error]:', error.message, error.details);
      showToast(error.message, 'error');
      return { data: null, error };
    }
    return { data, error: null };
  } catch (err) {
    console.error('[Network/Runtime Error]:', err);
    showToast('Connection lost. Please check your network.', 'error');
    return { data: null, error: err };
  }
}

/** @deprecated Use showToast from dashboard-ui.js directly */
export function showGlobalToast(message, type = 'error') {
  showToast(message, type);
}
