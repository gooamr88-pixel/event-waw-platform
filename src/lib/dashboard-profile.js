import { supabase, getCurrentUser, getCurrentProfile } from './supabase.js';
import { showToast } from './dashboard-ui.js';
import { switchToPanel } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';
import { performSignOut } from './guard.js';

export function setupProfilePanel() {
  loadProfileData();

  // Tax toggle: show/hide detail fields
  const taxToggle = document.getElementById('prof-tax-enabled');
  const taxWrap = document.getElementById('tax-fields-wrap');
  if (taxToggle && taxWrap) {
    taxToggle.addEventListener('change', () => {
      taxWrap.style.display = taxToggle.checked ? 'block' : 'none';
    });
  }

  // Manual payment methods: add row button
  document.getElementById('add-payment-method-btn')?.addEventListener('click', () => {
    const list = document.getElementById('manual-payment-methods-list');
    if (list) addPaymentMethodRow(list);
  });

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const user = await getCurrentUser();
      const profileData = {
        brand_name: document.getElementById('prof-brand').value.trim(),
        address: document.getElementById('prof-address').value.trim(),
        bio: document.getElementById('prof-bio').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        website: document.getElementById('prof-website').value.trim(),
        payment_method: document.getElementById('prof-payment').value,
        social: {
          instagram: document.getElementById('prof-ig').value.trim(),
          tiktok: document.getElementById('prof-tiktok').value.trim(),
          facebook: document.getElementById('prof-fb').value.trim(),
          x: document.getElementById('prof-x').value.trim(),
          linkedin: document.getElementById('prof-linkedin').value.trim(),
        }
      };

      if (!profileData.brand_name || !profileData.address || !profileData.bio) {
        showToast('Please fill all required fields', 'error');
        btn.disabled = false;
        btn.textContent = 'Save Profile';
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({ organizer_profile: profileData })
        .eq('id', user.id);

      if (error) throw error;

      // Also save tax configuration to organizers table
      const taxEnabled = document.getElementById('prof-tax-enabled')?.checked || false;
      const taxRate = parseFloat(document.getElementById('prof-tax-rate')?.value) || 0;
      const taxLabel = document.getElementById('prof-tax-label')?.value?.trim() || 'VAT';
      const taxInclusive = document.getElementById('prof-tax-inclusive')?.checked || false;

      const { error: taxErr } = await supabase
        .from('organizers')
        .update({
          tax_enabled: taxEnabled,
          tax_rate: taxRate,
          tax_label: taxLabel,
          tax_inclusive: taxInclusive,
          manual_payment_methods: getManualPaymentMethods(),
          manual_transfer_instructions: document.getElementById('prof-transfer-instructions')?.value?.trim() || '',
        })
        .eq('user_id', user.id);

      if (taxErr) {
        console.warn('Tax config save warning:', taxErr.message);
        // Non-fatal: organizers row may not exist yet
      }

      showToast('Profile saved successfully!', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Profile';
    }
  });
}

async function loadProfileData() {
  try {
    const user = await getCurrentUser();
    const { data } = await supabase
      .from('profiles')
      .select('organizer_profile')
      .eq('id', user.id)
      .single();

    if (data?.organizer_profile) {
      const p = data.organizer_profile;
      const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

      if (p.brand_name) setVal('prof-brand', p.brand_name);
      if (p.address) setVal('prof-address', p.address);
      if (p.bio) setVal('prof-bio', p.bio);
      if (p.phone) setVal('prof-phone', p.phone);
      if (p.website) setVal('prof-website', p.website);
      if (p.payment_method) setVal('prof-payment', p.payment_method);
      if (p.social) {
        if (p.social.instagram) setVal('prof-ig', p.social.instagram);
        if (p.social.tiktok) setVal('prof-tiktok', p.social.tiktok);
        if (p.social.facebook) setVal('prof-fb', p.social.facebook);
        if (p.social.x) setVal('prof-x', p.social.x);
        if (p.social.linkedin) setVal('prof-linkedin', p.social.linkedin);
      }
    }

    // Load tax config from organizers table
    const { data: org } = await supabase
      .from('organizers')
      .select('tax_enabled, tax_rate, tax_label, tax_inclusive, manual_payment_methods, manual_transfer_instructions')
      .eq('user_id', user.id)
      .maybeSingle();

    if (org) {
      const taxToggle = document.getElementById('prof-tax-enabled');
      const taxWrap = document.getElementById('tax-fields-wrap');
      if (taxToggle) {
        taxToggle.checked = org.tax_enabled || false;
        if (taxWrap) taxWrap.style.display = org.tax_enabled ? 'block' : 'none';
      }
      if (org.tax_rate) {
        const rateEl = document.getElementById('prof-tax-rate');
        if (rateEl) rateEl.value = org.tax_rate;
      }
      if (org.tax_label) {
        const labelEl = document.getElementById('prof-tax-label');
        if (labelEl) labelEl.value = org.tax_label;
      }
      const inclEl = document.getElementById('prof-tax-inclusive');
      if (inclEl) inclEl.checked = org.tax_inclusive || false;

      // Load manual payment methods
      const pmList = document.getElementById('manual-payment-methods-list');
      if (pmList && Array.isArray(org.manual_payment_methods)) {
        pmList.textContent = ''; // H25 FIX: Use textContent to clear (avoids HTML parser)
        org.manual_payment_methods.forEach(pm => {
          addPaymentMethodRow(pmList, pm.method || '', pm.destination || '');
        });
      }
      const instrEl = document.getElementById('prof-transfer-instructions');
      if (instrEl && org.manual_transfer_instructions) instrEl.value = org.manual_transfer_instructions;
    }
  } catch (err) {
    // H-5: Proper error logging instead of silent swallow
    console.error('Error loading profile data:', err);
  }
}

export function setupUserDropdown() {
  // "Organizer Profile" button in dropdown
  document.getElementById('goto-profile')?.addEventListener('click', () => {
    switchToPanel('profile');
  });

  // "Sign Out" in dropdown
  document.getElementById('dropdown-signout')?.addEventListener('click', async () => {
    // Professional sign-out confirmation
    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'z-index:10000';
    setSafeHTML(overlay, `<div class="ev-modal" style="max-width:380px;text-align:center;padding:32px 28px">
      <div style="width:48px;height:48px;border-radius:50%;background:rgba(5, 150, 105,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#059669" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </div>
      <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:8px">Sign Out</h3>
      <p style="font-size:.85rem;color:var(--ev-text-sec);margin-bottom:24px">Are you sure you want to sign out of your account?</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="ev-btn ev-btn-outline" id="signout-cancel" style="flex:1;max-width:140px;padding:10px">Cancel</button>
        <button class="ev-btn" id="signout-confirm" style="flex:1;max-width:140px;padding:10px;background:#059669;color:#fff;border:none;font-weight:600">Sign Out</button>
      </div>
    </div>`);
    document.body.appendChild(overlay);
    overlay.querySelector('#signout-cancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#signout-confirm').addEventListener('click', async () => {
      await performSignOut('/login.html');
    });
  });

  // "Payout Settings" link inside profile panel
  document.getElementById('goto-payout-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchToPanel('payout');
  });
}

// ── Manual Payment Method Helpers ──

function addPaymentMethodRow(container, method = '', destination = '') {
  const row = document.createElement('div');
  row.className = 'manual-pm-row';
  row.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px';

  const methods = [
    ['vodafone_cash', '📱 Vodafone Cash'],
    ['instapay', '🏦 InstaPay'],
    ['bank_transfer', '🏧 Bank Transfer'],
    ['fawry', '💳 Fawry'],
    ['other', 'Other'],
  ];

  const select = document.createElement('select');
  select.className = 'ev-form-input pm-method';
  select.style.cssText = 'flex:0 0 160px;font-size:.85rem';
  methods.forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === method) opt.selected = true;
    select.appendChild(opt);
  });

  const input = document.createElement('input');
  input.className = 'ev-form-input pm-destination';
  input.placeholder = 'Wallet number or account';
  input.style.cssText = 'flex:1;font-size:.85rem';
  input.value = destination;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'ev-btn ev-btn-outline';
  removeBtn.style.cssText = 'padding:6px 10px;font-size:.82rem;color:#ef4444;border-color:#ef4444';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(select);
  row.appendChild(input);
  row.appendChild(removeBtn);
  container.appendChild(row);
}

function getManualPaymentMethods() {
  const rows = document.querySelectorAll('.manual-pm-row');
  const methods = [];
  const labels = { vodafone_cash: 'Vodafone Cash', instapay: 'InstaPay', bank_transfer: 'Bank Transfer', fawry: 'Fawry', other: 'Other' };
  rows.forEach(row => {
    const method = row.querySelector('.pm-method')?.value;
    const destination = row.querySelector('.pm-destination')?.value?.trim();
    if (method && destination) {
      methods.push({ method, destination, label: labels[method] || method });
    }
  });
  return methods;
}
