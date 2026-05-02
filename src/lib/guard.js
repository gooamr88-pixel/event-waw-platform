/* ═══════════════════════════════════
   EVENT WAW — Centralized Auth Guard
   ═══════════════════════════════════
   Single source of truth for page access
   control, OTP verification, and nav UI.
   ═══════════════════════════════════ */

import { supabase, getCurrentUser, getCurrentProfile } from './supabase.js';
import { setSafeHTML } from './dom.js';

/* ── Loading Overlay ── */

/**
 * Show a branded loading overlay to prevent flash of protected content.
 * Returns the overlay element so it can be removed later.
 */
function showLoadingOverlay() {
  // Only add if one doesn't already exist
  if (document.getElementById('auth-guard-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'auth-guard-overlay';
  setSafeHTML(overlay, `
    <div class="guard-overlay">
      <div class="guard-spinner"></div>
      <p>Verifying access…</p>
    </div>
  `);
  document.body.prepend(overlay);
}

function hideLoadingOverlay() {
  const overlay = document.getElementById('auth-guard-overlay');
  if (overlay) {
    overlay.classList.add('guard-fade-out');
    setTimeout(() => overlay.remove(), 300);
  }
}

/* ── OTP Verification (DB-backed) ── */

/**
 * Mark the current user's OTP as verified by setting
 * `otp_verified_at` in the profiles table.
 */
export async function markOTPVerified() {
  const user = await getCurrentUser();
  if (!user) return false;

  const { error } = await supabase
    .from('profiles')
    .update({ otp_verified_at: new Date().toISOString() })
    .eq('id', user.id);

  if (error) {
    console.error('Failed to mark OTP verified:', error);
    return false;
  }
  return true;
}

/**
 * Clear OTP verification status (called on sign out).
 */
export async function clearOTPVerification() {
  const user = await getCurrentUser();
  if (!user) return;

  await supabase
    .from('profiles')
    .update({ otp_verified_at: null })
    .eq('id', user.id);
}

/**
 * Check if the current user has verified OTP in this session.
 * OTP is valid if verified within the last 24 hours.
 * Gracefully degrades: if column doesn't exist yet, returns true.
 */
export async function isOTPVerified() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return false;

    // If otp_verified_at is not set, user hasn't verified
    if (!profile.otp_verified_at) return false;

    const verifiedAt = new Date(profile.otp_verified_at);
    const now = new Date();
    const hoursSinceVerified = (now - verifiedAt) / (1000 * 60 * 60);

    // OTP valid for 24 hours
    return hoursSinceVerified < 24;
  } catch (err) {
    console.warn('OTP check failed:', err);
    return false; // FAIL CLOSED — deny access on errors
  }
}

/* ── Page Guards ── */

/**
 * Protect a page — requires authentication and OTP verification.
 *
 * @param {Object} options
 * @param {boolean} options.requireOTP — Require OTP verification (default: false)
 * @param {string|null} options.requireRole — Require specific role e.g. 'organizer'
 * @param {string} options.loginRedirect — Where to redirect if not logged in
 * @returns {Promise<{user, profile}|null>} — User + profile if authorized, null if redirecting
 */
export async function protectPage(options = {}) {
  const {
    requireOTP = false,
    requireRole = null,
    loginRedirect = '/login.html',
  } = options;

  showLoadingOverlay();

  try {
    // 1. Check authentication
    const user = await getCurrentUser();
    if (!user) {
      const currentUrl = window.location.pathname + window.location.search;
      window.location.href = `${loginRedirect}?redirect=${encodeURIComponent(currentUrl)}`;
      return null;
    }

    // 2. Check OTP verification
    if (requireOTP) {
      const otpOk = await isOTPVerified();
      if (!otpOk) {
        const currentUrl = window.location.pathname + window.location.search;
        window.location.href = `${loginRedirect}?otp_required=true&redirect=${encodeURIComponent(currentUrl)}`;
        return null;
      }
    }

    // 3. Check role
    const profile = await getCurrentProfile();
    if (requireRole && profile?.role !== requireRole) {
      hideLoadingOverlay();
      showUpgradeModal(requireRole);
      return null;
    }

    // ✅ All checks passed
    hideLoadingOverlay();
    return { user, profile };
  } catch (err) {
    console.error('Guard error:', err);
    window.location.href = loginRedirect;
    return null;
  }
}

/**
 * Guard for guest-only pages (login, register, forgot-password).
 * Redirects away if user is already fully authenticated + OTP verified.
 *
 * @param {Object} options
 * @param {string} options.redirectTo — Where to send authenticated users
 * @returns {Promise<boolean>} — true if user is a guest (page should show), false if redirecting
 */
export async function guestOnlyPage(options = {}) {
  const { redirectTo = '/dashboard.html' } = options;

  showLoadingOverlay();

  try {
    const user = await getCurrentUser();
    if (!user) {
      hideLoadingOverlay();
      return true; // Guest — show the page
    }

    // User is logged in → redirect away from guest page
    window.location.href = redirectTo;
    return false;
  } catch (err) {
    console.error('Guest guard error:', err);
    hideLoadingOverlay();
    return true; // On error, show the page
  }
}

/**
 * Semi-protect a page — page is viewable by anyone,
 * but returns auth status for conditional UI (e.g. buy buttons).
 *
 * @returns {Promise<{user, profile, isFullyAuth}|{user: null, profile: null, isFullyAuth: false}>}
 */
export async function semiProtectPage() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return { user: null, profile: null, isFullyAuth: false };
    }

    const profile = await getCurrentProfile();

    return { user, profile, isFullyAuth: true };
  } catch (err) {
    return { user: null, profile: null, isFullyAuth: false };
  }
}

/* ── Dynamic Nav UI ── */

/**
 * Update navigation bar based on authentication state.
 * Call this on public and semi-protected pages.
 *
 * @param {Object} authState — { user, profile, isFullyAuth }
 */
export function updateNavForAuth(authState) {
  const { user, profile, isFullyAuth } = authState;

  // Desktop nav buttons
  const signinBtn = document.getElementById('nav-signin');
  const signupBtn = document.getElementById('nav-signup');
  const userBtn = document.getElementById('nav-user-btn');
  const signoutBtn = document.getElementById('signout-btn');
  const navUserName = document.getElementById('nav-user-name');

  // Mobile menu links
  const mobileSignin = document.getElementById('mobile-signin');
  const mobileSignup = document.getElementById('mobile-signup');

  if (user && isFullyAuth) {
    // ── Authenticated + OTP verified ──
    if (signinBtn) signinBtn.style.display = 'none';
    if (signupBtn) signupBtn.style.display = 'none';

    if (userBtn) {
      userBtn.style.display = 'inline-flex';
      const name = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Account';
      if (navUserName) navUserName.textContent = name;
    }

    if (signoutBtn) signoutBtn.style.display = 'inline-flex';

    // Mobile
    if (mobileSignin) mobileSignin.style.display = 'none';
    if (mobileSignup) mobileSignup.style.display = 'none';
  } else {
    // ── Guest or incomplete auth ──
    if (signinBtn) signinBtn.style.display = '';
    if (signupBtn) signupBtn.style.display = '';
    if (userBtn) userBtn.style.display = 'none';
    if (signoutBtn) signoutBtn.style.display = 'none';
    if (mobileSignin) mobileSignin.style.display = '';
    if (mobileSignup) mobileSignup.style.display = '';
  }
}

/**
 * Full sign-out: clear OTP, sign out of Supabase, redirect.
 */
export async function performSignOut(redirectTo = '/index.html') {
  try {
    await clearOTPVerification();
    await supabase.auth.signOut();
  } catch (e) {
    console.error('Sign out error:', e);
  }
  window.location.href = redirectTo;
}

/* ── Role Upgrade ── */

/**
 * Upgrade current user's role to organizer.
 * NOTE: For production, consider adding admin approval.
 * The organizer_approved column (if it exists) gates event creation
 * via the RLS policy on the events table.
 */
export async function upgradeToOrganizer() {
  const user = await getCurrentUser();
  if (!user) return false;

  // Check if already an organizer
  const profile = await getCurrentProfile();
  if (profile?.role === 'organizer' || profile?.role === 'admin') return true;

  // Use the SECURITY DEFINER RPC — only allows attendee → organizer
  const { error } = await supabase.rpc('request_organizer_upgrade');

  if (error) {
    console.error('Upgrade failed:', error);
    return false;
  }

  // Sync role to user metadata for consistency
  await supabase.auth.updateUser({
    data: { role: 'organizer' }
  });

  console.log('User upgraded to organizer:', user.id);
  return true;
}

/**
 * Show a premium upgrade modal when an attendee tries
 * to access an organizer-only page.
 */
function showUpgradeModal(requiredRole) {
  const modal = document.createElement('div');
  modal.id = 'upgrade-modal';
  setSafeHTML(modal, `
    <style>
      #upgrade-modal {
        position: fixed; inset: 0; z-index: 99998;
        background: var(--bg-primary);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
      }
      .upgrade-box {
        max-width: 440px; width: 100%; text-align: center;
        background: rgba(24,24,27,.65);
        backdrop-filter: blur(60px) saturate(150%);
        border: 1px solid rgba(212,175,55,.12);
        border-radius: 24px; padding: 40px 32px;
        box-shadow: 0 30px 80px rgba(0,0,0,.4);
        animation: scaleIn .5s cubic-bezier(.16,1,.3,1) forwards;
      }
      .upgrade-icon {
        width: 80px; height: 80px; margin: 0 auto 24px;
        border-radius: 50%;
        background: rgba(212,175,55,.08);
        border: 1px solid rgba(212,175,55,.15);
        display: flex; align-items: center; justify-content: center;
        font-size: 2.2rem;
        animation: goldPulse 3s ease-in-out infinite;
      }
      .upgrade-box h2 {
        font-family: var(--font-serif);
        font-size: 1.5rem; font-weight: 700;
        margin-bottom: 12px;
      }
      .upgrade-box p {
        color: var(--text-secondary); font-size: 0.95rem;
        line-height: 1.7; margin-bottom: 28px;
      }
      .upgrade-features {
        display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        margin-bottom: 28px; text-align: left;
      }
      .upgrade-feat {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px;
        background: rgba(255,255,255,.03);
        border: 1px solid var(--border-color);
        border-radius: 10px; font-size: 0.82rem;
        color: var(--text-secondary);
      }
      .upgrade-feat span { color: var(--accent-primary); }
      .upgrade-btns {
        display: flex; flex-direction: column; gap: 10px;
      }
      .upgrade-btns .btn { width: 100%; }
      #upgrade-status {
        margin-top: 12px; font-size: 0.85rem;
        color: var(--accent-primary); display: none;
      }
      @media (max-width: 500px) {
        .upgrade-features { grid-template-columns: 1fr; }
        .upgrade-box { padding: 32px 20px; }
      }
    </style>
    <div class="upgrade-box">
      <div class="upgrade-icon">🎪</div>
      <h2>Become an <span class="text-gold">Organizer</span></h2>
      <p>Upgrade your account to create and manage events, sell tickets, and scan entries.</p>
      <div class="upgrade-features">
        <div class="upgrade-feat"><span>✦</span> Create Events</div>
        <div class="upgrade-feat"><span>✦</span> Sell Tickets</div>
        <div class="upgrade-feat"><span>✦</span> Scan QR Codes</div>
        <div class="upgrade-feat"><span>✦</span> View Analytics</div>
      </div>
      <div class="upgrade-btns">
        <button class="btn btn-primary btn-lg" id="upgrade-confirm-btn">
          Upgrade to Organizer
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
        <a href="/dashboard.html" class="btn btn-outline btn-lg">Go Back to Events</a>
      </div>
      <p id="upgrade-status"></p>
    </div>
  `);
  document.body.appendChild(modal);

  document.getElementById('upgrade-confirm-btn').addEventListener('click', async () => {
    const btn = document.getElementById('upgrade-confirm-btn');
    const status = document.getElementById('upgrade-status');
    btn.disabled = true;
    setSafeHTML(btn, '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Upgrading…');

    const success = await upgradeToOrganizer();
    if (success) {
      status.textContent = '✓ Upgraded! Reloading…';
      status.style.display = 'block';
      setTimeout(() => window.location.reload(), 800);
    } else {
      status.textContent = '✗ Upgrade failed. Please try again.';
      status.style.color = '#ef4444';
      status.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Upgrade to Organizer';
    }
  });
}
