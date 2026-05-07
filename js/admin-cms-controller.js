/* ===================================
   EVENT WAW — Admin CMS Controller
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { renderCMSEditor } from '../src/lib/admin-cms.js';
import { showToast } from './admin-ui.js';

/**
 * Loads the CMS panel and sets up maintenance mode toggle.
 */
export async function loadCMSPanel() {
  const body = document.getElementById('cms-body');
  const mmToggle = document.getElementById('admin-maintenance-toggle');
  
  if (mmToggle && !mmToggle.dataset.initialized) {
    mmToggle.dataset.initialized = 'true';
    try {
      const { data } = await supabase.from('platform_settings').select('value').eq('key', 'maintenance_mode').single();
      if (data) mmToggle.checked = (data.value === true || data.value === 'true');
    } catch (e) { console.warn('Could not load maintenance mode state'); }

    mmToggle.addEventListener('change', async (e) => {
      const isEnabled = e.target.checked;
      try {
        const { error } = await supabase.from('platform_settings').upsert({ key: 'maintenance_mode', value: isEnabled });
        if (error) throw error;
        showToast(isEnabled ? 'Maintenance Mode ENABLED. Platform is offline.' : 'Maintenance Mode DISABLED. Platform is live.', isEnabled ? 'error' : 'success');
      } catch (err) {
        e.target.checked = !isEnabled;
        showToast('Failed to update maintenance mode: ' + err.message, 'error');
      }
    });
  }

  if (!body) return;
  await renderCMSEditor(body);
}

/**
 * Sets up listeners for CMS save/error events.
 */
export function setupCMSEvents() {
  window.addEventListener('cms-saved', (e) => {
    showToast(`${e.detail.label} saved successfully!`, 'success');
  });
  window.addEventListener('cms-error', (e) => {
    showToast(`Save failed: ${e.detail.message}`, 'error');
  });
}
