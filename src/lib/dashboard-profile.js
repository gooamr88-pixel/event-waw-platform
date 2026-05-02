import { supabase, getCurrentUser, getCurrentProfile } from './supabase.js';
import { showToast } from './dashboard-ui.js';
import { safeQuery } from './api.js';

export function setupProfilePanel() {
  loadProfileData();

  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

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
        btn.textContent = '💾 Save Profile';
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
      btn.textContent = '💾 Save Profile';
    }
  });
}

export function setupUserDropdown() {
  // "Organizer Profile" button in dropdown
  document.getElementById('goto-profile')?.addEventListener('click', () => {
    switchToPanel('profile');
  });

  // "Sign Out" in dropdown
  document.getElementById('dropdown-signout')?.addEventListener('click', async () => {
    if (confirm('Are you sure you want to sign out?')) {
      await supabase.auth.signOut();
      window.location.href = 'login.html';
    }
  });

  // "Payout Settings" link inside profile panel
  document.getElementById('goto-payout-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchToPanel('payout');
  });
}

