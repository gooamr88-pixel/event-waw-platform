/* ===================================
   EVENTSLI - Venue Template UI
   Modals, Choosers & Tier Assignment
   =================================== */

import { supabase, getCurrentUser } from './supabase.js';
import {
  saveVenueTemplate, updateVenueTemplate, loadUserTemplates,
  loadTemplate, deleteTemplate, applyTemplateToEvent, getTemplateTierSlots,
} from './vd-templates.js';

/**
 * Create the modal overlay container (shared across all template modals).
 * Injects once into the DOM. Returns the existing container if already present.
 * @returns {HTMLElement} The modal overlay element
 */
function getOrCreateOverlay() {
  let overlay = document.getElementById('vd-tpl-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'vd-tpl-overlay';
  overlay.className = 'vd-tpl-overlay';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
  });

  return overlay;
}

/**
 * Show the modal overlay with the given content.
 * @param {string} html - HTML string for the modal body
 */
function showModal(html) {
  const overlay = getOrCreateOverlay();
  overlay.innerHTML = `<div class="vd-tpl-modal">${html}</div>`;
  overlay.style.display = '';
  requestAnimationFrame(() => {
    overlay.classList.add('vd-tpl-overlay--visible');
    overlay.querySelector('.vd-tpl-modal')?.classList.add('vd-tpl-modal--visible');
  });
  // Focus first input
  setTimeout(() => {
    overlay.querySelector('input, select, button')?.focus();
  }, 100);
}

/** Close and hide the modal overlay */
function closeModal() {
  const overlay = document.getElementById('vd-tpl-overlay');
  if (!overlay) return;
  overlay.classList.remove('vd-tpl-overlay--visible');
  const modal = overlay.querySelector('.vd-tpl-modal');
  if (modal) modal.classList.remove('vd-tpl-modal--visible');
  setTimeout(() => {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }, 250);
}

/**
 * Show a toast message in the venue designer.
 * Re-uses the existing toast element from venue-designer.html.
 * @param {string} msg - Toast message
 * @param {'success'|'error'|'info'} type - Toast type
 */
function toast(msg, type = 'info') {
  const t = document.getElementById('vd-toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'vd-toast vd-toast-' + type;
  t.style.display = '';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.display = 'none', 4000);
}

// ═══════════════════════════════════════════
// SAVE TEMPLATE MODAL (Phase 2)
// ═══════════════════════════════════════════

/**
 * Show the "Save as Template" modal.
 * @param {VenueDesignerEngine} engine - The engine instance
 * @param {Function} [onSuccess] - Callback after successful save
 */
export function showSaveTemplateModal(engine, onSuccess) {
  const secs = engine.elements.filter(e => e.type === 'section');
  const tbls = engine.elements.filter(e => e.type === 'table');
  const totalSeats = secs.reduce((s, e) => s + (e.rows * e.seatsPerRow), 0)
                   + tbls.reduce((s, e) => s + (e.seats || 6), 0);

  const html = `
    <div class="vd-tpl-modal-header">
      <div class="vd-tpl-modal-icon">📐</div>
      <h2 class="vd-tpl-modal-title">Save as Venue Template</h2>
      <p class="vd-tpl-modal-desc">Save this layout as a reusable blueprint. Pricing tiers will be stripped — assign them when loading into a new event.</p>
    </div>

    <div class="vd-tpl-modal-stats">
      <span class="vd-tpl-stat-pill"><strong>${engine.elements.length}</strong> elements</span>
      <span class="vd-tpl-stat-pill"><strong>${secs.length}</strong> sections</span>
      <span class="vd-tpl-stat-pill"><strong>${tbls.length}</strong> tables</span>
      <span class="vd-tpl-stat-pill vd-tpl-stat-accent"><strong>${totalSeats}</strong> seats</span>
    </div>

    <div class="vd-tpl-modal-form">
      <div class="vd-tpl-field">
        <label class="vd-tpl-label" for="tpl-name">Template Name *</label>
        <input type="text" id="tpl-name" class="vd-tpl-input" placeholder="e.g. Grand Theater Main Hall" maxlength="100" autocomplete="off" />
      </div>
      <div class="vd-tpl-field">
        <label class="vd-tpl-label" for="tpl-desc">Description</label>
        <textarea id="tpl-desc" class="vd-tpl-textarea" rows="3" placeholder="Optional description for this template..." maxlength="500"></textarea>
      </div>
    </div>

    <div class="vd-tpl-modal-actions">
      <button class="vd-tpl-btn-cancel" id="tpl-cancel">Cancel</button>
      <button class="vd-tpl-btn-save" id="tpl-save" disabled>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save Template
      </button>
    </div>
  `;

  showModal(html);

  // Wire events
  const nameInput = document.getElementById('tpl-name');
  const saveBtn = document.getElementById('tpl-save');
  const cancelBtn = document.getElementById('tpl-cancel');

  nameInput.addEventListener('input', () => {
    saveBtn.disabled = nameInput.value.trim().length < 2;
  });

  cancelBtn.addEventListener('click', closeModal);

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const desc = document.getElementById('tpl-desc')?.value?.trim() || '';
    if (name.length < 2) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const result = await saveVenueTemplate(engine, name, desc);
      closeModal();
      toast(`✅ Template "${result.name}" saved (${result.totalSeats} seats)`, 'success');
      if (onSuccess) onSuccess(result);
    } catch (err) {
      toast('❌ ' + err.message, 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Template`;
    }
  });
}

// ═══════════════════════════════════════════
// TEMPLATE CHOOSER (Phase 3)
// ═══════════════════════════════════════════

/**
 * Show the template chooser modal.
 * @param {VenueDesignerEngine} engine - The engine instance
 * @param {Array} tiers - Current event's ticket tiers
 * @param {Function} [onApply] - Callback after template is applied
 */
export async function showTemplateChooser(engine, tiers = [], onApply) {
  // Show loading state
  showModal(`
    <div class="vd-tpl-modal-header">
      <div class="vd-tpl-modal-icon">📂</div>
      <h2 class="vd-tpl-modal-title">My Venue Templates</h2>
      <p class="vd-tpl-modal-desc">Select a template to load, then assign pricing tiers to each section.</p>
    </div>
    <div class="vd-tpl-loading">
      <div class="vd-tpl-spinner"></div>
      <span>Loading templates…</span>
    </div>
    <div class="vd-tpl-modal-actions">
      <button class="vd-tpl-btn-cancel" id="tpl-cancel">Cancel</button>
    </div>
  `);
  document.getElementById('tpl-cancel')?.addEventListener('click', closeModal);

  try {
    const templates = await loadUserTemplates();

    if (templates.length === 0) {
      showModal(`
        <div class="vd-tpl-modal-header">
          <div class="vd-tpl-modal-icon">📂</div>
          <h2 class="vd-tpl-modal-title">No Templates Yet</h2>
          <p class="vd-tpl-modal-desc">Design a venue layout and save it as a template to reuse across events.</p>
        </div>
        <div class="vd-tpl-empty">
          <div class="vd-tpl-empty-icon">🏗️</div>
          <p>Build your first venue layout, then click <strong>"Save as Template"</strong> in the top bar.</p>
        </div>
        <div class="vd-tpl-modal-actions">
          <button class="vd-tpl-btn-cancel" id="tpl-cancel">Close</button>
        </div>
      `);
      document.getElementById('tpl-cancel')?.addEventListener('click', closeModal);
      return;
    }

    // Separate system and user templates
    const systemTemplates = templates.filter(t => t.is_system);
    const userTemplates = templates.filter(t => !t.is_system);

    const renderCard = (t) => {
      const icon = getTemplateIcon(t);
      const seatLabel = t.total_seats === 1 ? '1 seat' : `${t.total_seats} seats`;
      const sectionLabel = t.section_count > 0 ? `${t.section_count} sections` : '';
      const tableLabel = t.table_count > 0 ? `${t.table_count} tables` : '';
      const meta = [seatLabel, sectionLabel, tableLabel].filter(Boolean).join(' · ');
      const tagHtml = (t.tags || []).slice(0, 3).map(tag =>
        `<span class="vd-tpl-tag">${tag}</span>`
      ).join('');

      return `
        <div class="vd-tpl-card" data-template-id="${t.id}" tabindex="0">
          <div class="vd-tpl-card-icon">${icon}</div>
          <div class="vd-tpl-card-body">
            <div class="vd-tpl-card-name">${escapeHTML(t.name)}</div>
            <div class="vd-tpl-card-meta">${meta}</div>
            ${tagHtml ? `<div class="vd-tpl-card-tags">${tagHtml}</div>` : ''}
          </div>
          ${t.is_system ? '<span class="vd-tpl-badge-system">SYSTEM</span>' : `<button class="vd-tpl-card-del" data-del-id="${t.id}" title="Delete template">×</button>`}
        </div>
      `;
    };

    let gridHtml = '';
    if (userTemplates.length > 0) {
      gridHtml += `<div class="vd-tpl-section-label">My Templates</div>`;
      gridHtml += `<div class="vd-tpl-grid">${userTemplates.map(renderCard).join('')}</div>`;
    }
    if (systemTemplates.length > 0) {
      gridHtml += `<div class="vd-tpl-section-label vd-tpl-section-label--system">System Templates</div>`;
      gridHtml += `<div class="vd-tpl-grid">${systemTemplates.map(renderCard).join('')}</div>`;
    }

    showModal(`
      <div class="vd-tpl-modal-header">
        <div class="vd-tpl-modal-icon">📂</div>
        <h2 class="vd-tpl-modal-title">My Venue Templates</h2>
        <p class="vd-tpl-modal-desc">Select a template to load. Pricing tiers will be assigned in the next step.</p>
      </div>
      <div class="vd-tpl-chooser-scroll">
        ${gridHtml}
      </div>
      <div class="vd-tpl-modal-actions">
        <button class="vd-tpl-btn-cancel" id="tpl-cancel">Cancel</button>
      </div>
    `);

    document.getElementById('tpl-cancel')?.addEventListener('click', closeModal);

    // Card click → tier assignment
    const chooserScroll = document.querySelector('.vd-tpl-chooser-scroll');
    if (chooserScroll) {
      chooserScroll.addEventListener('click', async (e) => {
        // Delete button
        const delBtn = e.target.closest('[data-del-id]');
        if (delBtn) {
          e.stopPropagation();
          const delId = delBtn.dataset.delId;
          const card = delBtn.closest('.vd-tpl-card');
          const name = card?.querySelector('.vd-tpl-card-name')?.textContent || 'this template';
          if (!confirm(`Delete template "${name}"? This cannot be undone.`)) return;
          try {
            await deleteTemplate(delId);
            card?.remove();
            toast(`🗑️ Template "${name}" deleted`, 'info');
            // If no cards left, close modal
            if (!chooserScroll.querySelector('.vd-tpl-card')) closeModal();
          } catch (err) {
            toast('❌ ' + err.message, 'error');
          }
          return;
        }

        // Card click → select template
        const card = e.target.closest('.vd-tpl-card');
        if (!card) return;
        const templateId = card.dataset.templateId;
        if (!templateId) return;

        // If tiers exist, show tier assignment modal
        if (tiers.length > 0) {
          await showTierAssignmentModal(templateId, engine, tiers, onApply);
        } else {
          // No tiers → apply directly
          if (engine.elements.length > 1 && !confirm('Replace current layout with this template?')) return;
          try {
            const result = await applyTemplateToEvent(templateId, engine, {});
            closeModal();
            toast(`✨ Template "${result.templateName}" applied (${result.seatCount} seats)`, 'success');
            if (onApply) onApply(result);
          } catch (err) {
            toast('❌ ' + err.message, 'error');
          }
        }
      });
    }

  } catch (err) {
    toast('❌ Failed to load templates: ' + err.message, 'error');
    closeModal();
  }
}

// ═══════════════════════════════════════════
// TIER ASSIGNMENT MODAL (Phase 3)
// ═══════════════════════════════════════════

/**
 * Show the tier assignment modal for a selected template.
 * @param {string} templateId - UUID of the selected template
 * @param {VenueDesignerEngine} engine - The engine instance
 * @param {Array} tiers - Event's ticket tiers [{id, name, price}, ...]
 * @param {Function} [onApply] - Callback after apply
 */
async function showTierAssignmentModal(templateId, engine, tiers, onApply) {
  try {
    const slots = await getTemplateTierSlots(templateId);
    const template = await loadTemplate(templateId);

    const tierOptions = tiers.map(t =>
      `<option value="${t.id}">${escapeHTML(t.name)} — $${Number(t.price).toLocaleString()}</option>`
    ).join('');

    const slotRows = slots.map(slot => {
      const icon = slot.type === 'table' ? '🍽️' : '💺';
      const seatLabel = slot.seats === 1 ? '1 seat' : `${slot.seats} seats`;
      return `
        <div class="vd-tpl-tier-row">
          <div class="vd-tpl-tier-info">
            <span class="vd-tpl-tier-icon">${icon}</span>
            <div>
              <div class="vd-tpl-tier-name">${escapeHTML(slot.label)}</div>
              <div class="vd-tpl-tier-seats">${seatLabel}</div>
            </div>
          </div>
          <select class="vd-tpl-tier-select" data-slot="${slot.tier_slot}">
            ${tierOptions}
          </select>
        </div>
      `;
    }).join('');

    showModal(`
      <div class="vd-tpl-modal-header">
        <div class="vd-tpl-modal-icon">🎯</div>
        <h2 class="vd-tpl-modal-title">Assign Pricing Tiers</h2>
        <p class="vd-tpl-modal-desc">Map each section of <strong>"${escapeHTML(template.name)}"</strong> to a pricing tier for this event.</p>
      </div>

      <div class="vd-tpl-tier-scroll">
        ${slotRows}
      </div>

      <div class="vd-tpl-modal-actions">
        <button class="vd-tpl-btn-cancel" id="tier-cancel">Back</button>
        <button class="vd-tpl-btn-apply" id="tier-apply">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
          Apply Template
        </button>
      </div>
    `);

    document.getElementById('tier-cancel')?.addEventListener('click', () => {
      showTemplateChooser(engine, tiers, onApply);
    });

    document.getElementById('tier-apply')?.addEventListener('click', async () => {
      const btn = document.getElementById('tier-apply');
      btn.disabled = true;
      btn.textContent = 'Applying…';

      // Collect tier mappings
      const tierMap = {};
      document.querySelectorAll('.vd-tpl-tier-select').forEach(sel => {
        tierMap[sel.dataset.slot] = sel.value;
      });

      try {
        if (engine.elements.length > 1 && !confirm('Replace current layout with this template?')) {
          btn.disabled = false;
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Apply Template`;
          return;
        }

        const result = await applyTemplateToEvent(templateId, engine, tierMap);
        closeModal();
        toast(`✨ Template "${result.templateName}" applied (${result.seatCount} seats)`, 'success');
        if (onApply) onApply(result);
      } catch (err) {
        toast('❌ ' + err.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Apply Template`;
      }
    });

  } catch (err) {
    toast('❌ Failed to load template details: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// TOOLBOX: USER TEMPLATES SECTION (Phase 3)
// ═══════════════════════════════════════════

/**
 * Populate the "My Templates" section in the toolbox sidebar.
 * Shows up to 4 user templates as compact cards, with a "Browse All" button.
 *
 * @param {VenueDesignerEngine} engine - The engine instance
 * @param {Array} tiers - Current event's ticket tiers
 */
export async function populateToolboxTemplates(engine, tiers = []) {
  const container = document.getElementById('user-templates-list');
  if (!container) return;

  try {
    const templates = await loadUserTemplates();
    if (templates.length === 0) {
      container.innerHTML = `
        <div class="vd-tpl-toolbox-empty">
          <span class="vd-tpl-toolbox-empty-icon">📐</span>
          <span>No saved templates yet</span>
        </div>
      `;
      return;
    }

    // Show up to 4 in the sidebar
    const preview = templates.slice(0, 4);
    container.innerHTML = preview.map(t => {
      const icon = getTemplateIcon(t);
      return `
        <button class="vd-tpl-mini-card" data-template-id="${t.id}" title="${escapeHTML(t.name)} (${t.total_seats} seats)">
          <span class="vd-tpl-mini-icon">${icon}</span>
          <span class="vd-tpl-mini-name">${escapeHTML(truncate(t.name, 14))}</span>
          ${t.is_system ? '<span class="vd-tpl-mini-badge">SYS</span>' : ''}
        </button>
      `;
    }).join('');

    // Wire mini-card clicks
    container.querySelectorAll('.vd-tpl-mini-card').forEach(card => {
      card.addEventListener('click', async () => {
        const templateId = card.dataset.templateId;
        if (tiers.length > 0) {
          await showTierAssignmentModal(templateId, engine, tiers);
        } else {
          if (engine.elements.length > 1 && !confirm('Replace current layout with this template?')) return;
          try {
            const result = await applyTemplateToEvent(templateId, engine, {});
            toast(`✨ "${result.templateName}" applied`, 'success');
            document.getElementById('btn-save').disabled = false;
          } catch (err) {
            toast('❌ ' + err.message, 'error');
          }
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="vd-tpl-toolbox-empty"><span>Failed to load</span></div>`;
  }
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/** Get an appropriate emoji icon for a template */
function getTemplateIcon(template) {
  const tags = template.tags || [];
  if (tags.includes('theater')) return '🎭';
  if (tags.includes('arena') || tags.includes('circular')) return '🏟️';
  if (tags.includes('classroom') || tags.includes('conference')) return '🏫';
  if (tags.includes('tables') || tags.includes('banquet')) return '🍽️';
  if (tags.includes('stadium') || tags.includes('sports')) return '⚽';
  if (template.table_count > 0 && template.section_count === 0) return '🍽️';
  if (template.section_count > 4) return '🏟️';
  return '🗺️';
}

/** Escape HTML entities */
function escapeHTML(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Truncate string with ellipsis */
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}
