import { supabase, getCurrentUser, getCurrentProfile } from './supabase.js';
import { showToast } from './dashboard-ui.js';
import { switchToPanel } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';
import { performSignOut } from './guard.js';

export function setupProfilePanel() {
  loadProfileData();

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
      if (p.brand_name) document.getElementById('prof-brand').value = p.brand_name;
      if (p.address) document.getElementById('prof-address').value = p.address;
      if (p.bio) document.getElementById('prof-bio').value = p.bio;
      if (p.phone) document.getElementById('prof-phone').value = p.phone;
      if (p.website) document.getElementById('prof-website').value = p.website;
      if (p.payment_method) document.getElementById('prof-payment').value = p.payment_method;
      if (p.social) {
        if (p.social.instagram) document.getElementById('prof-ig').value = p.social.instagram;
        if (p.social.tiktok) document.getElementById('prof-tiktok').value = p.social.tiktok;
        if (p.social.facebook) document.getElementById('prof-fb').value = p.social.facebook;
        if (p.social.x) document.getElementById('prof-x').value = p.social.x;
        if (p.social.linkedin) document.getElementById('prof-linkedin').value = p.social.linkedin;
      }
    }
  } catch (_) { /* No profile data yet */ }
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
      <div style="width:48px;height:48px;border-radius:50%;background:rgba(37,99,235,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
      </div>
      <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:8px">Sign Out</h3>
      <p style="font-size:.85rem;color:var(--ev-text-sec);margin-bottom:24px">Are you sure you want to sign out of your account?</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="ev-btn ev-btn-outline" id="signout-cancel" style="flex:1;max-width:140px;padding:10px">Cancel</button>
        <button class="ev-btn" id="signout-confirm" style="flex:1;max-width:140px;padding:10px;background:#2563eb;color:#fff;border:none;font-weight:600">Sign Out</button>
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
