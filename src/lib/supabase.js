/* ===================================
   EVENT WAW - Supabase Client
   =================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Hardcoded for production (no build tool to inject env vars)
const supabaseUrl = 'https://bmtwdwoibvoewbesohpu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJtdHdkd29pYnZvZXdiZXNvaHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMzY0NjYsImV4cCI6MjA5MTkxMjQ2Nn0.YIuyd2y34UHkrAp9nZM_O2yVuaMAT-XWdSrex6eATjQ';



export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
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

  // Profile exists - return it
  if (data) return data;

  // -- Self-heal: profile missing, create from user metadata --
  console.warn('Profile missing for user', user.id, '- auto-creating...');
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
