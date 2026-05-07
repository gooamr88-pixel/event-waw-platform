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
 * CACHED: Results are cached in-memory for 30 minutes to avoid redundant HEAD requests.
 */
const _storageUrlCache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_SIZE = 100;

/**
 * Evict expired entries from the storage URL cache.
 * If still over CACHE_MAX_SIZE, drop the oldest half.
 */
function _evictStorageCache() {
  if (_storageUrlCache.size <= CACHE_MAX_SIZE) return;
  const now = Date.now();
  // Pass 1: remove expired
  for (const [key, entry] of _storageUrlCache) {
    if (now - entry.ts >= CACHE_TTL) _storageUrlCache.delete(key);
  }
  // Pass 2: if still too large, remove oldest entries
  if (_storageUrlCache.size > CACHE_MAX_SIZE) {
    const sorted = [..._storageUrlCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = Math.floor(sorted.length / 2);
    for (let i = 0; i < toRemove; i++) _storageUrlCache.delete(sorted[i][0]);
  }
}

async function getWorkingStorageUrl(storagePath, bucket = 'event-covers') {
  const cacheKey = `${bucket}/${storagePath}`;
  const cached = _storageUrlCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.url;

  // 1. Public URL
  const { data: pubData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  const publicUrl = pubData?.publicUrl;
  if (publicUrl) {
    // M-2: Skip HEAD check for known public buckets to prevent waterfall
    const publicBuckets = ['event-covers', 'avatars', 'sponsor-logos', 'public'];
    if (publicBuckets.includes(bucket)) {
      _evictStorageCache();
      _storageUrlCache.set(cacheKey, { url: publicUrl, ts: Date.now() });
      return publicUrl;
    }

    try {
      const resp = await fetch(publicUrl, { method: 'HEAD', mode: 'cors' });
      if (resp.ok) {
        _evictStorageCache();
        _storageUrlCache.set(cacheKey, { url: publicUrl, ts: Date.now() });
        return publicUrl;
      }
    } catch (_) { /* fall through */ }
  }

  // 2. Signed URL (1-year expiry)
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365);
    if (!error && data?.signedUrl) {
      _evictStorageCache();
      _storageUrlCache.set(cacheKey, { url: data.signedUrl, ts: Date.now() });
      return data.signedUrl;
    }
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
  // M-1: Dynamically capture the bucket name instead of hardcoding 'event-covers'
  const RE = /\/storage\/v1\/object\/(?:public|sign)\/([^\/]+)\/(.+?)(?:\?.*)?$/;
  const m = url.match(RE);
  if (m && m[1] && m[2]) {
    return await getWorkingStorageUrl(decodeURIComponent(m[2]), m[1]);
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
