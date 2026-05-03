import { supabase, getCurrentUser } from './supabase.js';
import { showToast } from './dashboard-ui.js';

/* ==================================
   PAYOUT SETTINGS PANEL
   ================================== */

export function setupPayoutPanel() {
  loadPayoutData();

  document.getElementById('payout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';

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
      btn.disabled = false;
      btn.textContent = 'Save Payout Details';
    }
  });
}

export async function loadPayoutData() {
  try {
    const user = await getCurrentUser();
    const { data } = await supabase
      .from('profiles')
      .select('payout_info')
      .eq('id', user.id)
      .single();

    if (data?.payout_info) {
      const p = data.payout_info;
      if (p.bank_name) document.getElementById('bank-name').value = p.bank_name;
      if (p.account_holder) document.getElementById('account-holder').value = p.account_holder;
      if (p.account_number) document.getElementById('account-number').value = p.account_number;
      if (p.swift_code) document.getElementById('swift-code').value = p.swift_code;
      if (p.payout_currency) document.getElementById('payout-currency').value = p.payout_currency;
      if (p.payout_email) document.getElementById('payout-email').value = p.payout_email;
    }
  } catch (_) { /* No payout info yet */ }
}

/* ==================================
    DARK MODE
   ================================== */
export function setupDarkMode() {
  const toggle = document.getElementById('dark-mode-toggle');
  // Sync initial state (FOUC script in HTML already set data-theme on <html>)
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) document.body.classList.add('dark-mode');

  toggle?.addEventListener('click', () => {
    const nowDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (nowDark) {
      document.documentElement.removeAttribute('data-theme');
      document.body.classList.remove('dark-mode');
      localStorage.setItem('ev-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark-mode');
      localStorage.setItem('ev-theme', 'dark');
    }
  });
}
