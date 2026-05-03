import { supabase, getCurrentUser } from './supabase.js';
import { showToast } from './dashboard-ui.js';

/* ══════════════════════════════════
   PAYOUT SETTINGS PANEL
   ══════════════════════════════════ */

export function setupPayoutPanel() {
  loadPayoutData();

  document.getElementById('payout-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

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
      btn.textContent = '💾 Save Payout Details';
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

/* ══════════════════════════════════
   🌙 DARK MODE
   ══════════════════════════════════ */
export function setupDarkMode() {
  const saved = localStorage.getItem('ev-dash-dark');
  if (saved === 'true') document.body.classList.add('dark-mode');

  document.getElementById('dark-mode-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('ev-dash-dark', document.body.classList.contains('dark-mode'));
  });
}
