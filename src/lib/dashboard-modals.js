import { supabase, getCurrentUser } from './supabase.js';
import { createEvent, updateEvent } from './events.js';
import { escapeHTML } from './utils.js';
import { showToast, switchToPanel } from './dashboard-ui.js';
import { safeQuery } from './api.js';
import { loadDashboard } from '../js/eveenty-dashboard.js';

let pendingCoverFile = null;
export function setupCreateModal() {
  // Open create event panel instead of modal
  const openPanel = () => { resetCreateEventForm(); switchToPanel('create-event'); };

  document.getElementById('header-create-event')?.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
  document.getElementById('welcome-create-btn')?.addEventListener('click', openPanel);

  // Back to home
  document.getElementById('ce-back-home')?.addEventListener('click', (e) => { e.preventDefault(); switchToPanel('events'); });

  // Initialize Google Places when create-event panel is opened
  const initGoogleOnShow = () => {
    if (!googleAutocompleteInitialized) {
      // Small delay to ensure DOM is ready
      setTimeout(() => initGooglePlacesAutocomplete(), 300);
    }
  };
  document.getElementById('header-create-event')?.addEventListener('click', initGoogleOnShow);
  document.getElementById('welcome-create-btn')?.addEventListener('click', initGoogleOnShow);

  // ── Listing Type Chooser ──
  let ceListingType = null; // 'display_only' or 'display_and_sell'

  const listingRadios = document.querySelectorAll('input[name="ce-listing-type"]');
  const listingContinueBtn = document.getElementById('ce-listing-continue');
  const listingChooser = document.getElementById('ce-listing-chooser');
  const tabsWrap = document.getElementById('ce-tabs-wrap');
  const ticketsTab = document.getElementById('ce-tab-tickets');
  const ticketsStep = document.getElementById('ce-step-tickets');

  listingRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      ceListingType = radio.value;
      if (listingContinueBtn) listingContinueBtn.disabled = false;
    });
  });

  listingContinueBtn?.addEventListener('click', () => {
    if (!ceListingType) return;
    // Hide chooser, show entire wizard content
    if (listingChooser) listingChooser.style.display = 'none';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'block';

    // Update banner content
    const bannerIcon = document.getElementById('ce-banner-icon');
    const bannerLabel = document.getElementById('ce-banner-label');
    const bannerDesc = document.getElementById('ce-banner-desc');
    if (ceListingType === 'display_only') {
      if (bannerIcon) bannerIcon.textContent = '📢';
      if (bannerLabel) bannerLabel.textContent = 'Display Only';
      if (bannerDesc) bannerDesc.textContent = 'Event showcase — no ticket sales';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
    }

    // Currency field — only relevant when selling tickets
    const currencyGroup = document.getElementById('ce-currency-group');

    if (ceListingType === 'display_only') {
      // Hide tickets tab, step, and currency
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
    } else {
      // Show tickets tab, step, and currency
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
    }

    // Reset tabs
    document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');

    // Ensure basic step is active
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.getElementById('ce-step-basic')?.classList.add('active');

    // Update progress
    const progress = document.getElementById('ce-progress-bar');
    const totalSteps = ceListingType === 'display_only' ? 2 : 3;
    if (progress) progress.style.width = `${(1 / totalSteps) * 100}%`;
  });

  // "Change Type" button — go back to chooser
  document.getElementById('ce-listing-change')?.addEventListener('click', () => {
    if (listingChooser) listingChooser.style.display = '';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'none';
  });

  // Make listing type accessible to publish handler
  window.__ceListingType = () => ceListingType;

  // ── Tab switching ──
  const tabs = document.querySelectorAll('[data-ce-tab]');
  const steps = { basic: 'ce-step-basic', tickets: 'ce-step-tickets', publishing: 'ce-step-publishing' };

  function getTabOrder() {
    return ceListingType === 'display_only' ? ['basic', 'publishing'] : ['basic', 'tickets', 'publishing'];
  }

  function switchCeTab(tabName) {
    const tabOrder = getTabOrder();
    // Skip tickets tab if display_only
    if (ceListingType === 'display_only' && tabName === 'tickets') return;

    tabs.forEach(t => t.classList.remove('active'));
    Object.values(steps).forEach(id => document.getElementById(id)?.classList.remove('active'));
    const tab = document.querySelector(`[data-ce-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    document.getElementById(steps[tabName])?.classList.add('active');
    // Mark completed tabs
    const idx = tabOrder.indexOf(tabName);
    tabOrder.forEach((t, i) => {
      const el = document.querySelector(`[data-ce-tab="${t}"]`);
      if (i < idx) el?.classList.add('completed');
      else el?.classList.remove('completed');
    });
    // Update progress
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = `${((idx + 1) / tabOrder.length) * 100}%`;
    // Update preview when switching to publishing
    if (tabName === 'publishing') updateCePreview();
  }

  tabs.forEach(tab => tab.addEventListener('click', () => switchCeTab(tab.dataset.ceTab)));

  // Save & Continue buttons
  document.getElementById('ce-save-basic')?.addEventListener('click', () => {
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) { showToast('Event name must be at least 3 characters', 'error'); return; }
    // If display_only, skip to publishing; otherwise go to tickets
    switchCeTab(ceListingType === 'display_only' ? 'publishing' : 'tickets');
  });
  document.getElementById('ce-save-tickets')?.addEventListener('click', () => switchCeTab('publishing'));

  // ── Rich Text Editor ──
  document.querySelectorAll('.ce-editor-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = prompt('Enter URL:');
        if (url) document.execCommand(cmd, false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  // ── Keywords ──
  const keywordsInput = document.getElementById('ce-keywords');
  const keywordsWrap = document.getElementById('ce-keywords-tags');
  keywordsInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = keywordsInput.value.trim();
      if (val && !ceKeywords.includes(val)) {
        ceKeywords.push(val);
        renderKeywords();
      }
      keywordsInput.value = '';
    }
  });
  function renderKeywords() {
    setSafeHTML(keywordsWrap, ceKeywords.map((k, i) =>
      `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">x</button></span>`
    ).join(''));
    keywordsWrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => { ceKeywords.splice(Number(btn.dataset.idx), 1); renderKeywords(); });
    });
  }

  // ── Social Links ──
  document.getElementById('ce-add-social')?.addEventListener('click', () => {
    const container = document.getElementById('ce-social-links');
    const row = document.createElement('div');
    row.className = 'ce-social-row';
    setSafeHTML(row, `<select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">🗑️</button>`);
    container.appendChild(row);
  });
  document.getElementById('ce-social-links')?.addEventListener('click', (e) => {
    const del = e.target.closest('.ce-social-del');
    if (del) del.closest('.ce-social-row')?.remove();
  });

  // ── Image Uploads ──
  setupCeUpload('ce-main-photo', 'ce-main-photo-area');
  setupCeUpload('ce-logo', 'ce-logo-area');

  // ── Gallery ──
  document.getElementById('ce-add-gallery')?.addEventListener('click', () => {
    ceGalleryCount++;
    const grid = document.getElementById('ce-gallery-grid');
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    setSafeHTML(item, `<label>Photo ${ceGalleryCount}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`);
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // ── Sponsors ──
  document.getElementById('ce-add-sponsor')?.addEventListener('click', () => {
    const grid = document.getElementById('ce-sponsors-grid');
    const count = grid.children.length + 1;
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    setSafeHTML(item, `<label>Sponsor ${count}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Logo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`);
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // Initial gallery upload listener
  const initialGalleryInput = document.querySelector('#ce-gallery-grid input[type="file"]');
  const initialGalleryArea = document.querySelector('#ce-gallery-grid .ce-upload-area');
  if (initialGalleryInput && initialGalleryArea) {
    initialGalleryInput.addEventListener('change', (e) => handleCeFileUpload(e, initialGalleryArea));
  }

  // ── Ticket Type Cards ──
  document.querySelectorAll('.ce-ticket-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    });
  });

  // ── Ticket Category Modal ──
  const ticketCatModal = document.getElementById('ticket-cat-modal');
  document.getElementById('ce-add-ticket-cat-btn')?.addEventListener('click', () => {
    document.getElementById('ticket-cat-count').textContent = `Current ticket category number: ${ceTicketCategories.length}`;
    ticketCatModal?.classList.add('active');
  });
  document.getElementById('ticket-cat-modal-close')?.addEventListener('click', () => ticketCatModal?.classList.remove('active'));
  ticketCatModal?.addEventListener('click', (e) => { if (e.target === ticketCatModal) ticketCatModal.classList.remove('active'); });

  document.getElementById('ticket-cat-save')?.addEventListener('click', () => {
    const name = document.getElementById('ticket-cat-name')?.value.trim();
    if (!name) { showToast('Category name is required', 'error'); return; }
    ceTicketCategories.push({ name, desc: document.getElementById('ticket-cat-desc')?.value.trim() || '' });
    // Update select
    const select = document.getElementById('ce-ticket-category-select');
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
    document.getElementById('ticket-cat-name').value = '';
    document.getElementById('ticket-cat-desc').value = '';
    ticketCatModal?.classList.remove('active');
    showToast(`Category "${name}" added!`, 'success');
  });

  // ── Add Ticket ──
  document.getElementById('ce-add-ticket-btn')?.addEventListener('click', () => {
    const name = document.getElementById('ce-ticket-name')?.value.trim();
    const qty = parseInt(document.getElementById('ce-ticket-qty')?.value) || 1;
    const price = parseFloat(document.getElementById('ce-ticket-price')?.value) || 0;
    const category = document.getElementById('ce-ticket-category-select')?.value;
    const earlyPrice = document.getElementById('ce-early-price')?.value || '';
    const earlyEnd = document.getElementById('ce-early-end')?.value || '';
    if (!name) { showToast('Ticket name is required', 'error'); return; }
    if (!price && price !== 0) { showToast('Ticket price is required', 'error'); return; }
    const currency = document.getElementById('ce-currency')?.value || 'USD';
    ceTicketsList.push({ name, qty, price, category, earlyPrice, earlyEnd, currency });
    renderCeTicketsTable();
    // Reset
    document.getElementById('ce-ticket-name').value = '';
    document.getElementById('ce-ticket-qty').value = '1';
    document.getElementById('ce-ticket-price').value = '';
    showToast('Ticket added!', 'success');
  });

  // ── Services Modal ──
  const svcModal = document.getElementById('services-modal');
  document.getElementById('services-modal-close')?.addEventListener('click', () => svcModal?.classList.remove('active'));
  svcModal?.addEventListener('click', (e) => { if (e.target === svcModal) svcModal.classList.remove('active'); });
  document.getElementById('svc-submit')?.addEventListener('click', () => {
    showToast('Service request submitted!', 'success');
    svcModal?.classList.remove('active');
  });

  // ── Publish Event ──
  document.getElementById('ce-publish-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('ce-publish-btn');

    // ── VALIDATION ──
    // Clear previous errors
    document.querySelectorAll('.ce-field-error').forEach(el => el.remove());
    document.querySelectorAll('.ce-error-border').forEach(el => el.classList.remove('ce-error-border'));

    const errors = [];
    const markError = (fieldId, message) => {
      const field = document.getElementById(fieldId);
      if (!field) return;
      field.classList.add('ce-error-border');
      const errEl = document.createElement('div');
      errEl.className = 'ce-field-error';
      errEl.textContent = message;
      field.parentElement.appendChild(errEl);
      // Auto-clear error when user interacts
      const clearFn = () => {
        field.classList.remove('ce-error-border');
        errEl.remove();
        field.removeEventListener('input', clearFn);
        field.removeEventListener('change', clearFn);
      };
      field.addEventListener('input', clearFn);
      field.addEventListener('change', clearFn);
      errors.push({ fieldId, message });
    };

    // Tab 1: Basic Information
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) markError('ce-name', 'Event name is required (min 3 characters)');

    const place = document.getElementById('ce-place')?.value.trim();
    if (!place) markError('ce-place', 'Venue / Place name is required');

    const city = document.getElementById('ce-city')?.value.trim();
    if (!city) markError('ce-city', 'City is required');

    const country = document.getElementById('ce-country')?.value;
    if (!country) markError('ce-country', 'Country is required');

    const category = document.getElementById('ce-category')?.value;
    if (!category) markError('ce-category', 'Category is required');

    const currency = document.getElementById('ce-currency')?.value;
    if (!currency) markError('ce-currency', 'Currency is required');

    const timezone = document.getElementById('ce-timezone')?.value;
    if (!timezone) markError('ce-timezone', 'Time zone is required');

    const startDate = document.getElementById('ce-start-date')?.value;
    if (!startDate) markError('ce-start-date', 'Start date is required');

    const endDate = document.getElementById('ce-end-date')?.value;
    if (!endDate) markError('ce-end-date', 'End date is required');

    // Tab 2: Tickets (skip validation for display_only)
    const listingType = typeof window.__ceListingType === 'function' ? window.__ceListingType() : 'display_and_sell';
    if (listingType !== 'display_only' && ceTicketsList.length === 0) {
      errors.push({ fieldId: 'ce-ticket-name', message: 'At least one ticket is required', tab: 'tickets' });
      showToast('⚠️ You must add at least one ticket before publishing', 'error');
    }

    // If there are errors, show them and stop
    if (errors.length > 0) {
      // Build error summary
      const errorNames = errors.map(e => e.message).join('\n• ');
      showToast(`⚠️ Please fix ${errors.length} error(s):\n• ${errorNames}`, 'error');

      // Switch to the tab that has the first error
      const firstError = errors[0];
      if (firstError.tab === 'tickets') {
        // Switch to tickets tab
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="tickets"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-tickets')?.classList.add('active');
      } else {
        // Switch to basic tab
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-basic')?.classList.add('active');
      }

      // Scroll to first error field
      const firstField = document.getElementById(firstError.fieldId);
      if (firstField) firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });

      return; // STOP — don't create/update event
    }

    btn.disabled = true;
    btn.textContent = ceEditingEventId ? 'Updating…' : 'Publishing…';
    try {
      const user = await getCurrentUser();
      if (!user) return;

      // Collect social links
      const socialLinks = [];
      document.querySelectorAll('#ce-social-links .ce-social-row').forEach(row => {
        const platform = row.querySelector('select')?.value;
        const url = row.querySelector('input[type="url"]')?.value?.trim();
        if (platform && url) socialLinks.push({ platform, url });
      });

      // Collect show_end_time radio
      const showEndTime = document.querySelector('input[name="ce-show-end"]:checked')?.value !== 'no';

      // Get listing type
      const listingType = typeof window.__ceListingType === 'function' ? window.__ceListingType() : 'display_and_sell';

      // Core event data (columns that always exist)
      const coreData = {
        organizer_id: user.id,
        title: name,
        description: document.getElementById('ce-overview')?.innerHTML || '',
        venue: place,
        city: city,
        date: new Date(startDate).toISOString(),
        category: category || 'general',
        status: 'published',
      };

      // Extra event data (new columns — may not exist yet)
      const extraData = {
        listing_type: listingType,
        longitude: parseFloat(document.getElementById('ce-longitude')?.value) || null,
        latitude: parseFloat(document.getElementById('ce-latitude')?.value) || null,
        country: country || null,
        keywords: ceKeywords.length ? ceKeywords : null,
        pixel_code: document.getElementById('ce-pixel')?.value.trim() || null,
        currency: currency || 'USD',
        timezone: timezone || null,
        doors_open: document.getElementById('ce-doors')?.value ? new Date(document.getElementById('ce-doors').value).toISOString() : null,
        end_date: endDate ? new Date(endDate).toISOString() : null,
        show_end_time: showEndTime,
        website: document.getElementById('ce-website')?.value.trim() || null,
        social_links: socialLinks.length ? socialLinks : null,
      };

      let event;
      if (ceEditingEventId) {
        // ── UPDATE existing event ──
        const allUpdates = { ...coreData, ...extraData };
        delete allUpdates.organizer_id;
        event = await updateEvent(ceEditingEventId, allUpdates);
      } else {
        // ── CREATE new event (core first, then extras) ──
        event = await createEvent(coreData);
        // Try adding extra fields
        try {
          await supabase.from('events').update(extraData).eq('id', event.id);
        } catch (extraErr) {
          console.warn('Extra event fields skipped:', extraErr.message);
        }
      }

      // Upload cover image
      if (pendingCoverFile) {
        const coverUrl = await uploadCoverImage(event.id);
        if (coverUrl) await supabase.from('events').update({ cover_url: coverUrl }).eq('id', event.id);
      }

      // Upload logo image
      const logoArea = document.getElementById('ce-logo-area');
      const logoInput = document.getElementById('ce-logo');
      if (logoInput?.files?.[0]) {
        const logoUrl = await uploadEventFile(event.id, logoInput.files[0], 'logo');
        if (logoUrl) await supabase.from('events').update({ logo_url: logoUrl }).eq('id', event.id);
      }

      // Upload gallery images
      const galleryInputs = document.querySelectorAll('#ce-gallery-grid input[type="file"]');
      const galleryUrls = [];
      for (let i = 0; i < galleryInputs.length; i++) {
        if (galleryInputs[i].files?.[0]) {
          const url = await uploadEventFile(event.id, galleryInputs[i].files[0], `gallery_${i}`);
          if (url) galleryUrls.push(url);
        }
      }
      if (galleryUrls.length) await supabase.from('events').update({ gallery_urls: galleryUrls }).eq('id', event.id);

      // Upload sponsor logos
      const sponsorInputs = document.querySelectorAll('#ce-sponsors-grid input[type="file"]');
      const sponsorUrls = [];
      for (let i = 0; i < sponsorInputs.length; i++) {
        if (sponsorInputs[i].files?.[0]) {
          const url = await uploadEventFile(event.id, sponsorInputs[i].files[0], `sponsor_${i}`);
          if (url) sponsorUrls.push(url);
        }
      }
      if (sponsorUrls.length) await supabase.from('events').update({ sponsor_urls: sponsorUrls }).eq('id', event.id);

      // Get selected ticket type
      const ticketType = document.querySelector('.ce-ticket-card.selected input')?.value || 'normal';

      // Only insert tickets if listing type is display_and_sell
      if (listingType !== 'display_only' && ceTicketsList.length > 0) {
        if (ceEditingEventId) {
          // ── UPDATE MODE: delete old tiers (with 0 sales) and re-insert ──
          const { data: existingTiers } = await supabase.from('ticket_tiers').select('id, sold_count').eq('event_id', event.id);
          for (const tier of (existingTiers || [])) {
            if ((tier.sold_count || 0) === 0) {
              await supabase.from('ticket_tiers').delete().eq('id', tier.id);
            }
          }
          // Insert updated tiers (skip ones that still exist with sales)
          const remainingIds = (existingTiers || []).filter(t => (t.sold_count || 0) > 0).map(t => t.id);
          for (const t of ceTicketsList) {
            if (t.id && remainingIds.includes(t.id)) {
              await supabase.from('ticket_tiers').update({
                name: t.name, price: t.price, capacity: t.qty,
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              }).eq('id', t.id);
            } else {
              await supabase.from('ticket_tiers').insert({
                event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              });
            }
          }
        } else {
          // ── CREATE MODE: insert all tiers ──
          for (const t of ceTicketsList) {
            const { data: newTier, error: tierErr } = await supabase.from('ticket_tiers').insert({
              event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
            }).select('id').single();

            if (tierErr) {
              console.warn('Tier insert failed:', tierErr.message);
              continue;
            }

            try {
              await supabase.from('ticket_tiers').update({
                ticket_type: ticketType, category: t.category || null,
                early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
                early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
                max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
                currency: t.currency || 'USD',
              }).eq('id', newTier.id);
            } catch (extraErr) {
              console.warn('Extra tier fields skipped:', extraErr.message);
            }
          }
        }
      }

      showToast(ceEditingEventId ? 'Event updated successfully!' : 'Event published successfully!', 'success');
      ceEditingEventId = null;
      switchToPanel('events');
      await loadDashboard();

      // Show services modal only on new events
      if (!ceEditingEventId) {
        setTimeout(() => { document.getElementById('services-modal')?.classList.add('active'); }, 600);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      setSafeHTML(btn, ceEditingEventId ? 'Update Event' : 'Publish Event');
    }
  });

  // Stripe verification button
  document.getElementById('ce-complete-verify')?.addEventListener('click', () => {
    showToast('Stripe verification flow will be integrated', 'info');
  });
}

export async function loadEventForEditing(eventId) {
  try {
    const { data: ev, error } = await supabase
      .from('events')
      .select(`*, ticket_tiers(id, name, price, capacity, ticket_type, category, early_bird_price, early_bird_end, max_scans, currency)`)
      .eq('id', eventId)
      .single();
    if (error || !ev) { showToast('Failed to load event', 'error'); return; }

    // Reset form first
    resetCreateEventForm();
    ceEditingEventId = eventId;

    // Update UI to "Edit" mode
    const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = 'Edit Event';
    const publishBtn = document.getElementById('ce-publish-btn');
    if (publishBtn) setSafeHTML(publishBtn, 'Update Event');

    // ── Fill basic fields ──
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    const setSelect = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) {
        const opt = Array.from(el.options).find(o => o.value === val);
        if (opt) el.value = val;
      }
    };

    setVal('ce-name', ev.title);
    setVal('ce-place', ev.venue);
    setVal('ce-address', ev.city); // legacy: city was used as address
    setVal('ce-city', ev.city);
    setSelect('ce-country', ev.country);
    setVal('ce-longitude', ev.longitude);
    setVal('ce-latitude', ev.latitude);
    setSelect('ce-category', ev.category);
    setVal('ce-pixel', ev.pixel_code);
    setSelect('ce-currency', ev.currency);
    setSelect('ce-timezone', ev.timezone);
    setVal('ce-website', ev.website);

    // Rich text editor
    const editor = document.getElementById('ce-overview');
    if (editor && ev.description) setSafeHTML(editor, ev.description);

    // Dates — convert ISO to datetime-local format
    const toLocalDatetime = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setVal('ce-start-date', toLocalDatetime(ev.date));
    setVal('ce-end-date', toLocalDatetime(ev.end_date));
    setVal('ce-doors', toLocalDatetime(ev.doors_open));

    // Show End Time radio
    if (ev.show_end_time === false) {
      const noRadio = document.querySelector('input[name="ce-show-end"][value="no"]');
      if (noRadio) noRadio.checked = true;
    }

    // Keywords
    if (ev.keywords && Array.isArray(ev.keywords)) {
      ceKeywords = [...ev.keywords];
      const tagsWrap = document.getElementById('ce-keywords-tags');
      if (tagsWrap) {
        setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>
          `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">x</button></span>`
        ).join(''));
      }
    }

    // Social links
    if (ev.social_links && Array.isArray(ev.social_links) && ev.social_links.length) {
      const container = document.getElementById('ce-social-links');
      if (container) {
        setSafeHTML(container, ev.social_links.map(link => `
          <div class="ce-social-row">
            <select class="ev-form-input ce-social-select">
              <option value="">Select Platform</option>
              <option value="facebook" ${link.platform==='facebook'?'selected':''}>Facebook</option>
              <option value="instagram" ${link.platform==='instagram'?'selected':''}>Instagram</option>
              <option value="twitter" ${link.platform==='twitter'?'selected':''}>X (Twitter)</option>
              <option value="tiktok" ${link.platform==='tiktok'?'selected':''}>TikTok</option>
              <option value="linkedin" ${link.platform==='linkedin'?'selected':''}>LinkedIn</option>
              <option value="youtube" ${link.platform==='youtube'?'selected':''}>YouTube</option>
            </select>
            <input class="ev-form-input" type="url" placeholder="https://..." value="${escapeHTML(link.url || '')}" />
            <button type="button" class="ce-social-del" title="Remove">x</button>
          </div>
        `).join(''));
      }
    }

    // Load existing ticket tiers
    if (ev.ticket_tiers && ev.ticket_tiers.length) {
      ceTicketsList = ev.ticket_tiers.map(t => ({
        id: t.id,
        name: t.name,
        qty: t.capacity,
        price: t.price,
        category: t.category || '',
        earlyPrice: t.early_bird_price || '',
        earlyEnd: t.early_bird_end || '',
        currency: t.currency || 'USD',
      }));
      renderCeTicketsTable();
    }

    // Skip chooser — go directly to form for editing
    const listingChooser = document.getElementById('ce-listing-chooser');
    const wizardContent = document.getElementById('ce-wizard-content');
    if (listingChooser) listingChooser.style.display = 'none';
    if (wizardContent) wizardContent.style.display = 'block';

    // Determine listing type from DB data
    const editListingType = ev.listing_type || (ev.ticket_tiers?.length ? 'display_and_sell' : 'display_only');
    window.__ceListingType = () => editListingType;

    // Configure form based on listing type
    const bannerIcon = document.getElementById('ce-banner-icon');
    const bannerLabel = document.getElementById('ce-banner-label');
    const bannerDesc = document.getElementById('ce-banner-desc');
    const ticketsTab = document.getElementById('ce-tab-tickets');
    const ticketsStep = document.getElementById('ce-step-tickets');
    const currencyGroup = document.getElementById('ce-currency-group');

    if (editListingType === 'display_only') {
      if (bannerIcon) bannerIcon.textContent = '📢';
      if (bannerLabel) bannerLabel.textContent = 'Display Only';
      if (bannerDesc) bannerDesc.textContent = 'Event showcase — no ticket sales';
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
    }

    // Switch to the panel
    switchToPanel('create-event');

    // Initialize Google Places for editing & show map if coordinates exist
    setTimeout(() => initGooglePlacesAutocomplete(), 300);
    if (ev.latitude && ev.longitude) {
      showGoogleMapPreview(ev.latitude, ev.longitude, ev.venue, ev.city);
    }

    showToast('Event loaded for editing', 'info');
  } catch (err) {
    showToast('Error loading event: ' + err.message, 'error');
  }
}

export function resetCreateEventForm() {
  // Reset listing type chooser — show chooser, hide wizard
  const listingChooser = document.getElementById('ce-listing-chooser');
  const wizardContent = document.getElementById('ce-wizard-content');
  if (listingChooser) listingChooser.style.display = '';
  if (wizardContent) wizardContent.style.display = 'none';
  document.querySelectorAll('input[name="ce-listing-type"]').forEach(r => r.checked = false);
  const continueBtn = document.getElementById('ce-listing-continue');
  if (continueBtn) continueBtn.disabled = true;
  // Reset tickets tab visibility
  const ticketsTab = document.getElementById('ce-tab-tickets');
  const ticketsStep = document.getElementById('ce-step-tickets');
  if (ticketsTab) ticketsTab.style.display = '';
  if (ticketsStep) ticketsStep.style.display = '';
  // Reset currency group visibility
  const currencyGroup = document.getElementById('ce-currency-group');
  if (currencyGroup) currencyGroup.style.display = '';

  // Reset text/select inputs
  ['ce-name','ce-place','ce-address','ce-city','ce-longitude','ce-latitude','ce-keywords','ce-pixel','ce-website','ce-doors','ce-start-date','ce-end-date','ce-ticket-name','ce-ticket-price','ce-early-price','ce-early-end','ce-max-scans-day','ce-google-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ce-category','ce-currency','ce-timezone','ce-country'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  document.getElementById('ce-ticket-qty') && (document.getElementById('ce-ticket-qty').value = '1');
  document.getElementById('ce-max-scans') && (document.getElementById('ce-max-scans').value = '1');
  // Reset rich text editor
  const editor = document.getElementById('ce-overview');
  if (editor) editor.textContent = '';
  // Reset image uploads
  ['ce-main-photo-area','ce-logo-area'].forEach(id => {
    const area = document.getElementById(id);
    if (area) { area.classList.remove('has-image'); area.querySelector('img')?.remove(); }
  });
  // Reset gallery & sponsors
  const galleryGrid = document.getElementById('ce-gallery-grid');
  if (galleryGrid) setSafeHTML(galleryGrid, `<div class="ce-gallery-item"><label>Photo 1</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div></div>`);
  const sponsorsGrid = document.getElementById('ce-sponsors-grid');
  if (sponsorsGrid) sponsorsGrid.textContent = '';
  // Reset social links to 1 empty row
  const socialLinks = document.getElementById('ce-social-links');
  if (socialLinks) setSafeHTML(socialLinks, `<div class="ce-social-row"><select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">x</button></div>`);
  // Reset keywords tags
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (tagsWrap) tagsWrap.textContent = '';
  // Reset ticket categories & ticket list
  ceTicketCategories = [];
  ceTicketsList = [];
  ceGalleryCount = 1;
  ceKeywords = [];
  ceTicketTableListenerAttached = false;
  ceEditingEventId = null;
  // Reset UI to "Create" mode
  const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
  if (breadcrumb) breadcrumb.textContent = 'Create Event';
  const publishBtn = document.getElementById('ce-publish-btn');
  if (publishBtn) setSafeHTML(publishBtn, 'Publish Event');
  const catSelect = document.getElementById('ce-ticket-category-select');
  if (catSelect) setSafeHTML(catSelect, '<option value="">Select Category</option>');
  const ticketTbody = document.getElementById('ce-tickets-tbody');
  if (ticketTbody) setSafeHTML(ticketTbody, '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>');
  // Reset ticket type to Normal
  document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
  const normalCard = document.querySelector('.ce-ticket-card:first-child');
  if (normalCard) { normalCard.classList.add('selected'); normalCard.querySelector('input').checked = true; }
  // Reset tabs to Basic
  document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
  document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
  document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
  document.getElementById('ce-step-basic')?.classList.add('active');
  const progressBar = document.getElementById('ce-progress-bar');
  if (progressBar) progressBar.style.width = '33%';
  // Reset cover file
  pendingCoverFile = null;
  // Reset Google Map preview
  const mapWrap = document.getElementById('ce-map-preview-wrap');
  if (mapWrap) mapWrap.style.display = 'none';
  googleMapInstance = null;
  googleMapMarker = null;
}

export async function initGooglePlacesAutocomplete() {
  if (googleAutocompleteInitialized) return;
  
  try {
    const { Autocomplete } = await google.maps.importLibrary('places');
    const { Map } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
    
    const searchInput = document.getElementById('ce-google-search');
    if (!searchInput) return;

    const autocomplete = new Autocomplete(searchInput, {
      types: ['establishment', 'geocode'],
      fields: ['name', 'formatted_address', 'geometry', 'address_components', 'place_id', 'website', 'utc_offset_minutes', 'types'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry) {
        showToast('No details available for this place', 'error');
        return;
      }

      // ── Fill fields ──
      const setField = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
      const setSelect = (id, val) => {
        const el = document.getElementById(id);
        if (!el || !val) return;
        const opt = Array.from(el.options).find(o => o.value === val);
        if (opt) { el.value = val; el.dispatchEvent(new Event('change')); }
      };

      // Venue name
      if (place.name) setField('ce-place', place.name);

      // Full address
      if (place.formatted_address) setField('ce-address', place.formatted_address);

      // Parse address components
      let city = '', countryCode = '', countryName = '';
      if (place.address_components) {
        for (const comp of place.address_components) {
          if (comp.types.includes('locality')) city = comp.long_name;
          if (comp.types.includes('administrative_area_level_1') && !city) city = comp.long_name;
          if (comp.types.includes('country')) {
            countryCode = comp.short_name;
            countryName = comp.long_name;
          }
        }
      }

      // City
      if (city) setField('ce-city', city);

      // Country
      const selectCode = ISO_TO_SELECT[countryCode] || 'OTHER';
      setSelect('ce-country', selectCode);

      // Latitude & Longitude
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      setField('ce-latitude', lat.toFixed(6));
      setField('ce-longitude', lng.toFixed(6));

      // Timezone (auto-detect from country)
      const tz = COUNTRY_TIMEZONE_MAP[countryCode];
      if (tz) setSelect('ce-timezone', tz);

      // Currency (auto-detect from country)
      const currency = COUNTRY_CURRENCY_MAP[countryCode];
      if (currency) setSelect('ce-currency', currency);

      // Website (if available from Google)
      if (place.website) {
        const websiteField = document.getElementById('ce-website');
        if (websiteField && !websiteField.value) setField('ce-website', place.website);
      }

      // Add venue type as keyword
      if (place.types && place.types.length > 0) {
        const venueTypeKeywords = place.types
          .filter(t => !['point_of_interest', 'establishment', 'geocode', 'political'].includes(t))
          .map(t => t.replace(/_/g, ' '))
          .slice(0, 2);
        venueTypeKeywords.forEach(kw => {
          if (!ceKeywords.includes(kw)) {
            ceKeywords.push(kw);
          }
        });
        // Re-render keywords
        const tagsWrap = document.getElementById('ce-keywords-tags');
        if (tagsWrap) {
          setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>
            `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">x</button></span>`
          ).join(''));
          tagsWrap.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => { ceKeywords.splice(Number(btn.dataset.idx), 1); renderGoogleKeywords(); });
          });
        }
      }

      // ── Show Map Preview ──
      showGoogleMapPreview(lat, lng, place.name, place.formatted_address);

      // Highlight filled fields with a brief green flash
      ['ce-place', 'ce-address', 'ce-city', 'ce-country', 'ce-latitude', 'ce-longitude', 'ce-timezone', 'ce-currency'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value) {
          el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
          el.style.boxShadow = '0 0 0 3px rgba(66, 133, 244, 0.25)';
          el.style.borderColor = '#4285F4';
          setTimeout(() => { el.style.boxShadow = ''; el.style.borderColor = ''; }, 2000);
        }
      });

      showToast(`📍 Location filled: ${place.name || place.formatted_address}`, 'success');
    });

    googleAutocompleteInitialized = true;
    console.log('✅ Google Places Autocomplete initialized');
  } catch (err) {
    console.warn('Google Places init failed:', err);
  }
}

export function renderGoogleKeywords() {
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (!tagsWrap) return;
  setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>
    `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">✕</button></span>`
  ).join(''));
  tagsWrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { ceKeywords.splice(Number(btn.dataset.idx), 1); renderGoogleKeywords(); });
  });
}

export async function showGoogleMapPreview(lat, lng, name, address) {
  const wrap = document.getElementById('ce-map-preview-wrap');
  const mapDiv = document.getElementById('ce-map-preview');
  const addressBar = document.getElementById('ce-map-address-bar');
  if (!wrap || !mapDiv) return;

  wrap.style.display = '';

  // Update address bar
  if (addressBar) {
    setSafeHTML(addressBar, `
      <div class="ce-map-address-info">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#4285F4" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div>
          <strong>${escapeHTML(name || 'Selected Location')}</strong>
          <span>${escapeHTML(address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`)}</span>
        </div>
      </div>
      <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="ce-map-open-btn" title="Open in Google Maps">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Open in Maps
      </a>`);
  }

  const location = { lat, lng };

  try {
    const { Map } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

    if (!googleMapInstance) {
      googleMapInstance = new Map(mapDiv, {
        zoom: 16,
        center: location,
        mapId: 'event_waw_map',
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'cooperative',
      });
    } else {
      googleMapInstance.setCenter(location);
      googleMapInstance.setZoom(16);
    }

    // Custom marker
    if (googleMapMarker) googleMapMarker.map = null;
    
    const markerContent = document.createElement('div');
    setSafeHTML(markerContent, `
      <div style="
        display: flex; align-items: center; gap: 6px;
        background: #1a1a2e; color: #fff; padding: 8px 14px;
        border-radius: 20px; font-size: 13px; font-weight: 600;
        box-shadow: 0 4px 20px rgba(0,0,0,.3);
        border: 2px solid #4285F4;
        white-space: nowrap;
      ">
        <span style="font-size:16px">📍</span>
        <span>${escapeHTML((name || 'Location').substring(0, 30))}</span>
      </div>
      <div style="
        width: 12px; height: 12px;
        background: #4285F4; border-radius: 50%;
        margin: -2px auto 0; position: relative;
        box-shadow: 0 0 0 4px rgba(66,133,244,.3);
      "></div>`);

    googleMapMarker = new AdvancedMarkerElement({
      map: googleMapInstance,
      position: location,
      content: markerContent,
      title: name || 'Event Location',
    });
  } catch (err) {
    // Fallback: use static map image
    console.warn('Interactive map failed, using static fallback:', err);
    setSafeHTML(mapDiv, `<iframe 
      width="100%" height="100%" frameborder="0" style="border:0;border-radius:12px" 
      src="https://www.google.com/maps/embed/v1/place?key=AIzaSyCqKRXXkjYNaGYjjPSm0OUxPAPxbfJnqEY&q=${lat},${lng}&zoom=16" 
      allowfullscreen loading="lazy"></iframe>`);
  }
}

export function setupCeUpload(inputId, areaId) {
  const input = document.getElementById(inputId);
  const area = document.getElementById(areaId);
  if (!input || !area) return;
  input.addEventListener('change', (e) => handleCeFileUpload(e, area));
}

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

export function renderCeTicketsTable() {
  const tbody = document.getElementById('ce-tickets-tbody');
  if (!ceTicketsList.length) {
    setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>');
    return;
  }
  setSafeHTML(tbody, ceTicketsList.map((t, i) => {
    const sym = t.currency === 'CAD' ? 'CA$' : t.currency === 'EUR' ? '€' : t.currency === 'GBP' ? '£' : '$';
    return `<tr>
      <td style="font-weight:600">${escapeHTML(t.name)}</td>
      <td>${sym}${Number(t.price).toFixed(2)}</td>
      <td style="color:var(--ev-yellow);font-weight:600">${t.qty}</td>
      <td>${t.earlyEnd ? new Date(t.earlyEnd).toLocaleDateString() : 'Not Set'}</td>
      <td>${t.earlyPrice ? sym + Number(t.earlyPrice).toFixed(2) : '—'}</td>
      <td><button class="ev-btn-icon" title="Remove" data-del-ticket="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
    </tr>`;
  }).join(''));
  if (!ceTicketTableListenerAttached) {
    ceTicketTableListenerAttached = true;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del-ticket]');
      if (btn) { ceTicketsList.splice(Number(btn.dataset.delTicket), 1); renderCeTicketsTable(); }
    });
  }
}

export function updateCePreview() {
  const title = document.getElementById('ce-name')?.value.trim() || 'Event Name';
  document.getElementById('ce-preview-title').textContent = title;
  const venue = document.getElementById('ce-place')?.value.trim() || 'Venue';
  const addr = document.getElementById('ce-address')?.value.trim() || '';
  document.getElementById('ce-preview-venue').textContent = venue;
  document.getElementById('ce-preview-addr').textContent = addr;
  const startDate = document.getElementById('ce-start-date')?.value;
  const endDate = document.getElementById('ce-end-date')?.value;
  if (startDate) {
    const d = new Date(startDate);
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    document.getElementById('ce-preview-month').textContent = months[d.getMonth()];
    document.getElementById('ce-preview-day').textContent = String(d.getDate()).padStart(2, '0');
    document.getElementById('ce-preview-datestr').textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    let timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (endDate) {
      const ed = new Date(endDate);
      timeStr += ` - ${ed.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}, ${ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
    document.getElementById('ce-preview-timestr').textContent = timeStr;
  }
  // Preview image
  const mainImg = document.getElementById('ce-main-photo-area')?.querySelector('img');
  const previewImgDiv = document.getElementById('ce-preview-img');
  if (mainImg) {
    let pImg = previewImgDiv.querySelector('img');
    if (!pImg) { pImg = document.createElement('img'); previewImgDiv.textContent = ''; previewImgDiv.appendChild(pImg); }
    pImg.src = mainImg.src;
  }
}

export async function showEditModal(eventId) {
  document.querySelectorAll('.ev-modal-overlay.ev-edit-modal').forEach(m => m.remove());

  const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
  if (error || !ev) { showToast('Failed to load event', 'error'); return; }

  const evDate = ev.date ? new Date(ev.date) : new Date();
  const dateStr = evDate.toISOString().slice(0, 10);
  const timeStr = evDate.toTimeString().slice(0, 5);
  const isDraft = ev.status === 'draft';

  const modal = document.createElement('div');
  modal.className = 'ev-modal-overlay active ev-edit-modal';
  setSafeHTML(modal, `<div class="ev-modal" style="max-width:520px">
    <div class="ev-modal-header"><h2>Edit Event</h2><button class="ev-modal-close" id="edit-close">x</button></div>
    <div class="ev-form-group">
      <label>Event Title</label>
      <input class="ev-form-input" type="text" id="edit-title" value="${escapeHTML(ev.title)}" />
    </div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Date</label><input class="ev-form-input" type="date" id="edit-date" value="${dateStr}" /></div>
      <div class="ev-form-group"><label>Time</label><input class="ev-form-input" type="time" id="edit-time" value="${timeStr}" /></div>
    </div>
    <div class="ev-form-group"><label>Description</label><textarea class="ev-form-input" id="edit-desc" rows="3">${escapeHTML(ev.description || '')}</textarea></div>
    <div class="ev-form-row">
      <div class="ev-form-group"><label>Venue</label><input class="ev-form-input" type="text" id="edit-venue" value="${escapeHTML(ev.venue || ev.location || '')}" /></div>
      <div class="ev-form-group"><label>City</label><input class="ev-form-input" type="text" id="edit-city" value="${escapeHTML(ev.city || '')}" /></div>
    </div>
    <div class="ev-form-group">
      <label>Status</label>
      <div style="display:flex;gap:10px">
        <button class="ev-btn ${isDraft ? 'ev-btn-outline' : 'ev-btn-pink'}" id="edit-status-pub" type="button" style="flex:1">Published</button>
        <button class="ev-btn ${isDraft ? 'ev-btn-pink' : 'ev-btn-outline'}" id="edit-status-draft" type="button" style="flex:1">Draft</button>
      </div>
      <input type="hidden" id="edit-status" value="${ev.status}" />
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="ev-btn ev-btn-outline" id="edit-cancel" style="flex:1">Cancel</button>
      <button class="ev-btn ev-btn-pink" id="edit-save" style="width:100%;margin-top:10px">Save Changes</button>
    </div>
  </div>`);
  document.body.appendChild(modal);

  // Status toggle
  document.getElementById('edit-status-pub').addEventListener('click', () => {
    document.getElementById('edit-status').value = 'published';
    document.getElementById('edit-status-pub').className = 'ev-btn ev-btn-pink';
    document.getElementById('edit-status-draft').className = 'ev-btn ev-btn-outline';
  });
  document.getElementById('edit-status-draft').addEventListener('click', () => {
    document.getElementById('edit-status').value = 'draft';
    document.getElementById('edit-status-draft').className = 'ev-btn ev-btn-pink';
    document.getElementById('edit-status-pub').className = 'ev-btn ev-btn-outline';
  });

  const closeModal = () => modal.remove();
  document.getElementById('edit-close').addEventListener('click', closeModal);
  document.getElementById('edit-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('edit-save').addEventListener('click', async () => {
    const btn = document.getElementById('edit-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    const d = document.getElementById('edit-date').value;
    const t = document.getElementById('edit-time').value;
    if (!d) { showToast('Please select a date', 'error'); btn.disabled = false; btn.textContent = 'Save Changes'; return; }
    try {
      const updates = {
        title: document.getElementById('edit-title').value.trim().slice(0, 200),
        date: new Date(`${d}T${t || '00:00'}:00`).toISOString(),
        description: document.getElementById('edit-desc').value.trim(),
        status: document.getElementById('edit-status').value,
      };
      if (!updates.title || updates.title.length < 3) {
        showToast('Title must be at least 3 characters', 'error');
        btn.disabled = false; btn.textContent = 'Save Changes'; return;
      }
      const venue = document.getElementById('edit-venue').value.trim();
      const city = document.getElementById('edit-city').value.trim();
      if (venue) updates.venue = venue;
      if (city) updates.city = city;
      await updateEvent(eventId, updates);
      showToast('Event updated!', 'success');
      closeModal();
      await loadDashboard();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });
}

export async function uploadCoverImage(eventId) {
  if (!pendingCoverFile) return null;
  try {
    const ext = pendingCoverFile.name.split('.').pop();
    const path = `events/${eventId}/cover.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, pendingCoverFile, { upsert: true });
    if (error) { console.warn('Cover upload failed:', error.message); return null; }
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    pendingCoverFile = null;
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('Cover upload error:', err);
    return null;
  }
}

export async function uploadEventFile(eventId, file, label) {
  if (!file) return null;
  try {
    const ext = file.name.split('.').pop();
    const path = `events/${eventId}/${label}.${ext}`;
    const { error } = await supabase.storage.from('event-covers').upload(path, file, { upsert: true });
    if (error) { console.warn(`Upload ${label} failed:`, error.message); return null; }
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn(`Upload ${label} error:`, err);
    return null;
  }
}

