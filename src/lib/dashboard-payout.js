import { supabase, getCurrentUser } from './supabase.js';
import { showToast, getSwitchId } from './dashboard-ui.js';

/* ==================================
   PAYOUT SETTINGS PANEL
   ================================== */

export function setupPayoutPanel() {
  loadPayoutData();

  document.getElementById('payout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    try {
      const user = await getCurrentUser();
      const payoutData = {
        bank_name: document.getElementById('bank-name').value.trim(),
        account_holder: document.getElementById('account-holder').value.trim(),
        account_number: document.getElementById('account-number').value.trim(),
        swift_code: document.getElementById('swift-code').value.trim(),
        payout_currency: document.getElementById('payout-currency').value,
        payout_email: document.getElementById('payout-email').value.trim(),
      };

      if (!payoutData.bank_name || !payoutData.account_holder || !payoutData.account_number) {
        showToast('Please fill all required fields', 'error');
        return;
      }

      // Store in profile metadata
      const { error } = await supabase
        .from('profiles')
        .update({ payout_info: payoutData })
        .eq('id', user.id);

      if (error) throw error;
      showToast('Payout details saved securely!', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Payout Details'; }
    }
  });
}

export async function loadPayoutData() {
  const mySwitch = getSwitchId();
  try {
    const user = await getCurrentUser();
    if (getSwitchId() !== mySwitch) return;
    const { data } = await supabase
      .from('profiles')
      .select('payout_info')
      .eq('id', user.id)
      .single();
    if (getSwitchId() !== mySwitch) return;

    if (data?.payout_info) {
      const p = data.payout_info;
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      
      if (p.bank_name) setVal('bank-name', p.bank_name);
      if (p.account_holder) setVal('account-holder', p.account_holder);
      if (p.account_number) setVal('account-number', p.account_number);
      if (p.swift_code) setVal('swift-code', p.swift_code);
      if (p.payout_currency) setVal('payout-currency', p.payout_currency);
      if (p.payout_email) setVal('payout-email', p.payout_email);
    }
  } catch (err) {
    // H-4: Proper error logging instead of silent swallow
    console.error('Error loading payout data:', err);
  }
}

/* ==================================
    DARK MODE — Unified with ui.js theme engine
    Uses 'theme' localStorage key + data-theme attribute
   ================================== */
export function setupDarkMode() {
  const toggle = document.getElementById('dark-mode-toggle');
  // Sync initial state from unified theme key
  const saved = localStorage.getItem('theme');
  const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  toggle?.addEventListener('click', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = nowDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  });
}
