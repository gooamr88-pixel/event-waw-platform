/* ===================================
   EVENTSLI - Venue Template CRUD
   Decoupled Blueprint Management
   =================================== */

import { supabase, getCurrentUser } from './supabase.js';

/**
 * Sanitize a live layout_json into a reusable template blueprint.
 * Strips all tier_id references and adds tier_slot identifiers.
 *
 * @param {object} layoutJson - Raw layout from engine.toLayoutJSON()
 * @returns {object} Sanitized template layout JSON
 */
function sanitizeToTemplate(layoutJson) {
  const layout = JSON.parse(JSON.stringify(layoutJson));
  layout.template = true;

  // Strip tier_ids and assign slot identifiers
  let sectionSlot = 0;
  let tableSlot = 0;
  layout.elements = (layout.elements || []).map(el => {
    const copy = { ...el };
    if (copy.type === 'section') {
      copy.tier_id = null;
      copy.tier_slot = `section-${sectionSlot++}`;
    } else if (copy.type === 'table') {
      copy.tier_id = null;
      copy.tier_slot = `table-${tableSlot++}`;
    }
    return copy;
  });

  // Strip tier_ids from computed sections array
  layout.sections = (layout.sections || []).map(sec => ({
    ...sec, tier_id: null,
  }));

  // Flag background image for separate storage (base64 is too large for JSONB)
  if (layout.bgImage) {
    layout._bgImageBase64 = layout.bgImage; // Temporarily hold for upload
    layout.bgImage = null;
    layout.bgImageRef = true;
  }

  return layout;
}

/**
 * Calculate metadata stats from a template layout.
 * @param {object} templateJson - Sanitized template layout
 * @returns {{ totalSeats: number, sectionCount: number, tableCount: number }}
 */
function calcTemplateStats(templateJson) {
  const elements = templateJson.elements || [];
  const sections = elements.filter(e => e.type === 'section');
  const tables = elements.filter(e => e.type === 'table');

  const sectionSeats = sections.reduce((sum, s) => sum + (s.rows || 0) * (s.seatsPerRow || 0), 0);
  const tableSeats = tables.reduce((sum, t) => sum + (t.seats || 6), 0);

  return {
    totalSeats: sectionSeats + tableSeats,
    sectionCount: sections.length,
    tableCount: tables.length,
  };
}

/**
 * Auto-generate tags based on template content.
 * @param {object} templateJson - Template layout JSON
 * @returns {string[]} Array of tag strings
 */
function generateTemplateTags(templateJson) {
  const tags = [];
  const elements = templateJson.elements || [];
  const { totalSeats, tableCount } = calcTemplateStats(templateJson);

  // Seat count category
  if (totalSeats >= 1000) tags.push('1000+');
  else if (totalSeats >= 500) tags.push('500+');
  else if (totalSeats >= 100) tags.push('100+');
  else tags.push('<100');

  // Element-based tags
  if (tableCount > 0) tags.push('tables');
  if (elements.some(e => e.type === 'section' && (e.curve || 0) > 0)) tags.push('curved');
  if (elements.some(e => e.type === 'vip')) tags.push('vip');
  if (elements.some(e => e.type === 'bar')) tags.push('bar');
  if (elements.some(e => e.type === 'dj')) tags.push('dj');
  if (elements.some(e => e.type === 'food')) tags.push('food');

  return tags;
}

/**
 * Upload background image from base64 to Supabase Storage.
 * @param {string} base64Data - Base64 encoded image data
 * @param {string} userId - Organizer user ID
 * @param {string} templateId - Template UUID
 * @returns {string|null} Public URL of the uploaded image
 */
async function uploadTemplateBgImage(base64Data, userId, templateId) {
  if (!base64Data) return null;

  try {
    // Convert base64 to blob
    const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;

    const mimeType = match[1];
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const byteString = atob(match[2]);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });

    const path = `${userId}/${templateId}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('venue-template-bgs')
      .upload(path, blob, { upsert: true, contentType: mimeType });

    if (uploadErr) {
      console.warn('Template bg upload failed:', uploadErr.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('venue-template-bgs')
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('Template bg upload error:', err);
    return null;
  }
}

/**
 * Delete background image from Supabase Storage.
 * @param {string} userId - Organizer user ID
 * @param {string} templateId - Template UUID
 */
async function deleteTemplateBgImage(userId, templateId) {
  try {
    // Try both extensions
    await supabase.storage.from('venue-template-bgs').remove([
      `${userId}/${templateId}.jpg`,
      `${userId}/${templateId}.png`,
    ]);
  } catch (_) { /* non-critical */ }
}

// ═══════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════

/**
 * Save the current venue designer state as a reusable template.
 * Strips tier_ids, uploads background image to Storage, and inserts into venue_templates.
 *
 * @param {VenueDesignerEngine} engine - The venue designer engine instance
 * @param {string} name - Template name (must be unique per organizer)
 * @param {string} [description=''] - Optional template description
 * @returns {Promise<{ id: string, name: string, totalSeats: number }>}
 * @throws {Error} If not authenticated or save fails
 */
export async function saveVenueTemplate(engine, name, description = '') {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to save templates');

  if (!name || name.trim().length < 2) {
    throw new Error('Template name must be at least 2 characters');
  }

  // Sanitize layout: strip tier_ids, add tier_slots
  const templateJson = sanitizeToTemplate(engine.toLayoutJSON());
  const stats = calcTemplateStats(templateJson);

  // Insert template first to get the UUID
  const bgBase64 = templateJson._bgImageBase64 || null;
  delete templateJson._bgImageBase64;

  const { data, error } = await supabase.from('venue_templates').insert({
    organizer_id: user.id,
    name: name.trim(),
    description: description.trim() || null,
    layout_json: templateJson,
    total_seats: stats.totalSeats,
    section_count: stats.sectionCount,
    table_count: stats.tableCount,
    canvas_width: templateJson.canvas?.width || 1200,
    canvas_height: templateJson.canvas?.height || 800,
    tags: generateTemplateTags(templateJson),
  }).select('id, name').single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`A template named "${name.trim()}" already exists. Choose a different name.`);
    }
    throw new Error(`Failed to save template: ${error.message}`);
  }

  // Upload background image to Storage (async, non-blocking for the return)
  if (bgBase64 && data.id) {
    const bgUrl = await uploadTemplateBgImage(bgBase64, user.id, data.id);
    if (bgUrl) {
      // Update the template with the bg URL in layout_json
      const updatedJson = { ...templateJson, bgImage: bgUrl, bgImageRef: true };
      await supabase.from('venue_templates')
        .update({ layout_json: updatedJson })
        .eq('id', data.id);
    }
  }

  return { id: data.id, name: data.name, totalSeats: stats.totalSeats };
}

/**
 * Update an existing template that the organizer owns.
 * Re-sanitizes layout, handles background image, increments version.
 *
 * @param {string} templateId - UUID of the template to update
 * @param {VenueDesignerEngine} engine - The venue designer engine instance
 * @param {string} name - Updated template name
 * @param {string} [description=''] - Updated description
 * @returns {Promise<{ id: string, name: string, totalSeats: number, version: number }>}
 * @throws {Error} If not authenticated, not found, or update fails
 */
export async function updateVenueTemplate(templateId, engine, name, description = '') {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to update templates');

  // Fetch current version
  const { data: current, error: fetchErr } = await supabase
    .from('venue_templates')
    .select('version')
    .eq('id', templateId)
    .single();

  if (fetchErr || !current) throw new Error('Template not found or access denied');

  const templateJson = sanitizeToTemplate(engine.toLayoutJSON());
  const stats = calcTemplateStats(templateJson);
  const newVersion = (current.version || 1) + 1;

  const bgBase64 = templateJson._bgImageBase64 || null;
  delete templateJson._bgImageBase64;

  // Upload bg image if present
  if (bgBase64) {
    const bgUrl = await uploadTemplateBgImage(bgBase64, user.id, templateId);
    if (bgUrl) {
      templateJson.bgImage = bgUrl;
      templateJson.bgImageRef = true;
    }
  }

  const { data, error } = await supabase.from('venue_templates')
    .update({
      name: name.trim(),
      description: description.trim() || null,
      layout_json: templateJson,
      total_seats: stats.totalSeats,
      section_count: stats.sectionCount,
      table_count: stats.tableCount,
      canvas_width: templateJson.canvas?.width || 1200,
      canvas_height: templateJson.canvas?.height || 800,
      tags: generateTemplateTags(templateJson),
      version: newVersion,
    })
    .eq('id', templateId)
    .select('id, name')
    .single();

  if (error) throw new Error(`Failed to update template: ${error.message}`);

  return { id: data.id, name: data.name, totalSeats: stats.totalSeats, version: newVersion };
}

/**
 * Fetch ALL templates visible to the current user (own + system).
 * RLS automatically filters: user sees their own + system (organizer_id IS NULL).
 *
 * @returns {Promise<Array<{
 *   id: string, name: string, description: string, thumbnail_url: string,
 *   total_seats: number, section_count: number, table_count: number,
 *   tags: string[], is_system: boolean, created_at: string, updated_at: string
 * }>>}
 * @throws {Error} If not authenticated or query fails
 */
export async function loadUserTemplates() {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to view templates');

  const { data, error } = await supabase
    .from('venue_templates')
    .select('id, name, description, thumbnail_url, total_seats, section_count, table_count, tags, organizer_id, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to load templates: ${error.message}`);

  return (data || []).map(t => ({
    ...t,
    is_system: t.organizer_id === null,
  }));
}

/**
 * Fetch a single template's full data including layout_json.
 *
 * @param {string} templateId - UUID of the template
 * @returns {Promise<{
 *   id: string, name: string, description: string, layout_json: object,
 *   total_seats: number, section_count: number, table_count: number,
 *   tags: string[], organizer_id: string|null, version: number
 * }>}
 * @throws {Error} If not found or access denied
 */
export async function loadTemplate(templateId) {
  const { data, error } = await supabase
    .from('venue_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (error || !data) throw new Error('Template not found or access denied');
  return data;
}

/**
 * Delete a template. RLS ensures the user can only delete their own.
 * Also cleans up any background image from Storage.
 *
 * @param {string} templateId - UUID of the template to delete
 * @throws {Error} If deletion fails
 */
export async function deleteTemplate(templateId) {
  const user = await getCurrentUser();
  if (!user) throw new Error('You must be signed in to delete templates');

  // Clean up storage
  await deleteTemplateBgImage(user.id, templateId);

  const { error } = await supabase
    .from('venue_templates')
    .delete()
    .eq('id', templateId);

  if (error) throw new Error(`Failed to delete template: ${error.message}`);
}

/**
 * Load a template into the venue designer engine for a specific event.
 * Deep clones the template layout and injects tier mappings.
 *
 * @param {string} templateId - UUID of the template to apply
 * @param {VenueDesignerEngine} engine - The venue designer engine instance
 * @param {object} [tierMap={}] - Mapping of tier_slot -> tier_id (e.g. { 'section-0': 'uuid-...' })
 * @returns {Promise<{ templateName: string, seatCount: number }>}
 * @throws {Error} If template not found or load fails
 */
export async function applyTemplateToEvent(templateId, engine, tierMap = {}) {
  const template = await loadTemplate(templateId);
  const layout = JSON.parse(JSON.stringify(template.layout_json));

  // Inject tier mappings into elements
  if (layout.elements) {
    layout.elements = layout.elements.map(el => {
      if (el.tier_slot && tierMap[el.tier_slot]) {
        el.tier_id = tierMap[el.tier_slot];
      }
      return el;
    });
  }

  // Remove template flags so it saves as a normal venue map
  delete layout.template;
  delete layout.bgImageRef;

  // Load into the engine (this handles both v2 elements and legacy formats)
  engine.loadFromJSON(layout);

  return {
    templateName: template.name,
    seatCount: template.total_seats,
  };
}

/**
 * Fetch a template's tier slots for the Tier Assignment UI.
 * Returns an array of assignable slots with metadata.
 *
 * @param {string} templateId - UUID of the template
 * @returns {Promise<Array<{
 *   tier_slot: string, label: string, seats: number, type: 'section'|'table'
 * }>>}
 * @throws {Error} If template not found
 */
export async function getTemplateTierSlots(templateId) {
  const template = await loadTemplate(templateId);
  const elements = template.layout_json?.elements || [];

  return elements
    .filter(el => el.tier_slot)
    .map(el => ({
      tier_slot: el.tier_slot,
      label: el.label || el.tier_slot,
      seats: el.type === 'section'
        ? (el.rows || 0) * (el.seatsPerRow || 0)
        : (el.seats || 6),
      type: el.type,
    }));
}
