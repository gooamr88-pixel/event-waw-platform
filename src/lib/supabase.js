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

/**
 * Get a working URL for a file in Supabase Storage.
 * Tries public URL first; if the bucket is private (400/403),
 * falls back to a signed URL with 1-year expiry.
 */
async function getWorkingStorageUrl(storagePath, bucket = 'event-covers') {
  // 1. Public URL
  const { data: pubData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = pubData?.publicUrl;
  if (publicUrl) {
    try {
      const resp = await fetch(publicUrl, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) return publicUrl;
    } catch (_) { /* fall through */ }
  }

  // 2. Signed URL (1-year expiry)
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
    if (!error && data?.signedUrl) return data.signedUrl;
  } catch (_) { /* fall through */ }

  return publicUrl || null;
}

/**
 * Resolve an image URL stored in the database.
 * If it is a Supabase storage URL, re-generate a working (public or signed)
 * URL so the image loads correctly even when the bucket visibility changes.
 * Non-Supabase URLs are returned as-is.
 */
export async function resolveImageUrl(url) {
  if (!url) return null;
  const RE = /\/storage\/v1\/object\/(?:public|sign)\/event-covers\/(.+?)(?:\?.*)?$/;
  const m = url.match(RE);
  if (m && m[1]) {
    return await getWorkingStorageUrl(decodeURIComponent(m[1]));
  }
  return url;
}

/**
 * Batch-resolve multiple image URLs in parallel.
 * Returns an array of resolved URLs in the same order.
 */
export async function resolveImageUrls(urls) {
  if (!urls || !urls.length) return [];
  return Promise.all(urls.map(u => resolveImageUrl(u)));
}
