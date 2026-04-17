/* ═══════════════════════════════════
   EVENT WAW — Supabase Client
   ═══════════════════════════════════ */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '⚠️ Supabase credentials not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  }
);

/**
 * Get the current authenticated user, or null.
 */
export async function getCurrentUser() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (e) {
    console.warn('Auth check failed (Supabase not configured?):', e.message);
    return null;
  }
}

/**
 * Get the current user's profile from the profiles table.
 * Self-healing: if the DB trigger failed to create the profile,
 * this will auto-create one from the user's auth metadata.
 */
export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  // Use maybeSingle() instead of single() to avoid error on 0 rows
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }

  // Profile exists — return it
  if (data) return data;

  // ── Self-heal: profile missing, create from user metadata ──
  console.warn('Profile missing for user', user.id, '— auto-creating...');
  const meta = user.user_metadata || {};
  const newProfile = {
    id: user.id,
    email: user.email,
    full_name: meta.full_name || meta.name || '',
    phone: meta.phone || null,
    role: meta.role || 'attendee',
    avatar_url: meta.avatar_url || null,
  };

  const { data: created, error: createError } = await supabase
    .from('profiles')
    .upsert(newProfile, { onConflict: 'id' })
    .select()
    .single();

  if (createError) {
    console.error('Failed to auto-create profile:', createError);
    // Last resort: return a profile-like object from metadata
    return newProfile;
  }

  console.log('Profile auto-created successfully:', created);
  return created;
}

/**
 * Listen for auth state changes.
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
