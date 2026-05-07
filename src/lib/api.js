/**
 * src/lib/api.js
 * Secure API Wrapper
 */
import { supabase } from './supabase.js';

export async function safeQuery(queryPromise) {
  try {
    const { data, error } = await queryPromise;
    if (error) {
      console.error('[Supabase Error]:', error.message, error.details);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-error', { detail: error.message }));
      return { data: null, error };
    }
    return { data, error: null };
  } catch (err) {
    console.error('[Network/Runtime Error]:', err);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-error', { detail: 'Connection lost. Please check your network.' }));
    return { data: null, error: err };
  }
}

/** @deprecated Trigger via api-error event instead */
export function showGlobalToast(message, type = 'error') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}
