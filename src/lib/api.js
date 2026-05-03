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
      showGlobalToast(error.message, 'error');
      return { data: null, error };
    }
    return { data, error: null };
  } catch (err) {
    console.error('[Network/Runtime Error]:', err);
    showGlobalToast('Connection lost. Please check your network.', 'error');
    return { data: null, error: err };
  }
}

export function showGlobalToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `ev-toast ${type}`;
  toast.textContent = ` ${type === 'error' ? '[X]' : '[OK]'} ${message}`;
  container.appendChild(toast);
  
  // Prevent memory leaks by cleaning up the element
  setTimeout(() => { 
    toast.classList.add('out'); 
    setTimeout(() => toast.remove(), 300); 
  }, 3500);
}
