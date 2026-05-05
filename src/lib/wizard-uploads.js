/**
 * src/lib/wizard-uploads.js
 * Domain: Cover, Logo, Gallery, Sponsors file handling and Supabase Storage uploads
 * Extracted from dashboard-modals.js (Operation Defuse)
 */
import { supabase } from './supabase.js';
import { showToast } from './dashboard-ui.js';

/* ── Shared state ── */
let pendingCoverFile = null;

/* ── State accessors ── */
export function getPendingCoverFile() { return pendingCoverFile; }
export function setPendingCoverFile(file) { pendingCoverFile = file; }
export function clearPendingCoverFile() { pendingCoverFile = null; }

/**
 * Wire up a file input + upload area pair for image preview.
 */
export function setupCeUpload(inputId, areaId) {
  const input = document.getElementById(inputId);
  const area = document.getElementById(areaId);
  if (!input || !area) return;
  input.addEventListener('change', (e) => handleCeFileUpload(e, area));
}

/**
 * Handle file selection: validate, preview, and store reference for cover.
 */
export function handleCeFileUpload(e, area) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB', 'error'); return; }
  // Store for main photo upload
  if (area.id === 'ce-main-photo-area') pendingCoverFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let img = area.querySelector('img');
    if (!img) { img = document.createElement('img'); area.appendChild(img); }
    img.src = ev.target.result;
    area.classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

/**
 * Upload cover image to Supabase Storage.
 * Returns the stable public URL or null on failure.
 */
export async function uploadCoverImage(eventId) {
  if (!pendingCoverFile) return null;
  try {
    const ext = pendingCoverFile.name.split('.').pop();
    const path = `events/${eventId}/cover.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, pendingCoverFile, { upsert: true });
    if (error) { console.warn('Cover upload failed:', error.message); return null; }
    // Store the STABLE public URL (not a resolved/signed URL) so it can be
    // re-resolved correctly each time via resolveImageUrl()
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    pendingCoverFile = null;
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('Cover upload error:', err);
    return null;
  }
}

/**
 * Upload a generic event file (logo, gallery, sponsor) to Supabase Storage.
 * Returns the stable public URL or null on failure.
 */
export async function uploadEventFile(eventId, file, label) {
  if (!file) return null;
  try {
    const ext = file.name.split('.').pop();
    const path = `events/${eventId}/${label}.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, file, { upsert: true });
    if (error) { console.warn(`Upload ${label} failed:`, error.message); return null; }
    // Store the STABLE public URL (not a resolved/signed URL)
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn(`Upload ${label} error:`, err);
    return null;
  }
}
