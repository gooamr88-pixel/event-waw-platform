/* ═══════════════════════════════════
   VIA — Auth Helpers
   ═══════════════════════════════════ */

import { supabase, getCurrentUser } from './supabase.js';

/**
 * Sign up with email & password.
 * Stores full_name and phone in user metadata,
 * which the DB trigger uses to populate the profiles table.
 */
export async function signUp({ email, password, firstName, lastName, phone, role }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: `${firstName} ${lastName}`.trim(),
        phone: phone || null,
        role: role || 'attendee',
      },
    },
  });

  if (error) throw error;
  return data;
}

/**
 * Sign in with email & password.
 */
export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data;
}

/**
 * Sign out the current user.
 * NOTE: For full sign-out with OTP clearing, use performSignOut() from guard.js.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Send password reset email.
 */
export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/forgot-password.html?type=recovery`,
  });

  if (error) throw error;
  return data;
}

/**
 * Update user password (used after reset link).
 */
export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;
  return data;
}
