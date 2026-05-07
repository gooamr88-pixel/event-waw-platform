import { supabase, getCurrentUser, resolveImageUrl } from './supabase.js';
import { createEvent, updateEvent } from './events.js';
import { escapeHTML, formatCurrency } from './utils.js';
import { showToast, switchToPanel } from './dashboard-ui.js';
import { safeQuery } from './api.js';
import { setSafeHTML, safeHTML } from './dom.js';
import { emitDashboardAction } from './dashboard-bus.js';
import { showPromptModal, showConfirmModal } from './ui-modals.js';

// ── Extracted domain modules (Operation Defuse) ──
import { initGooglePlacesAutocomplete as _initMaps, showGoogleMapPreview, isAutocompleteInitialized, resetMapState } from './wizard-maps.js';
import { setupCeUpload, handleCeFileUpload, uploadCoverImage, uploadEventFile, getPendingCoverFile, clearPendingCoverFile } from './wizard-uploads.js';
import { setupTicketListeners, renderCeTicketsTable, getTicketsList, setTicketsList, resetTicketState } from './wizard-tickets.js';

// Re-export for backward compatibility (consumed by eveenty-dashboard.js)
export { showGoogleMapPreview, setupCeUpload, handleCeFileUpload, renderCeTicketsTable, uploadCoverImage, uploadEventFile };

/**
 * Sanitize rich text editor HTML before storing in DB.
 * Strips scripts, event handlers, and javascript: URIs
 * while preserving formatting tags (b, i, a, br, p, etc.).
 */
function sanitizeDescriptionHTML(html) {
  if (!html || !html.trim()) return '';
  const fragment = safeHTML(html);
  const temp = document.createElement('div');
  temp.appendChild(fragment);
  return temp.innerHTML;
}

/* ── Module-level state (orchestrator-owned) ── */
let ceKeywords = [];
let ceEditingEventId = null;
let currentEventStatus = 'draft'; // track original status when editing
let isPublishing = false; // H-1: Double-Submit protection semaphore
let ceGalleryCount = 1;
let ceListingTypeGetter = null;

/** Bind orchestrator state into the maps module */
function _mapsDeps() {
  return { getKeywords: () => ceKeywords, setKeywords: kw => { ceKeywords = kw; }, renderKeywords: renderGoogleKeywords };
}
export function initGooglePlacesAutocomplete() { return _initMaps(_mapsDeps()); }
export function setupCreateModal() {
  // Open create event panel instead of modal
  const openPanel = () => { resetCreateEventForm(); switchToPanel('create-event'); };

  // ── Dynamically Populate Categories ──
  const EVENT_CATEGORIES = [
    'Music & Concerts', 'Technology & Innovation', 'Business & Professional',
    'Sports & Fitness', 'Education & Learning', 'Arts & Culture',
    'Food & Drink', 'Health & Wellness', 'Community & Culture',
    'Family & Kids', 'Fashion & Beauty', 'Film & Media',
    'Hobbies & Special Interest', 'Travel & Outdoor', 'Charity & Causes',
    'Spirituality & Religion', 'Science & Tech', 'Auto, Boat & Air',
    'Government & Politics', 'Festival', 'Other'
  ];
  const categorySelect = document.getElementById('ce-category');
  if (categorySelect) {
    setSafeHTML(categorySelect, '<option value="">Select Category</option>' +
      EVENT_CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join(''));
  }

  // ── Dynamically Populate Time Zones ──
  const timezoneSelect = document.getElementById('ce-timezone');
  if (timezoneSelect) {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      const optionsHTML = '<option value="">Select Time Zone</option>' +
        timezones.map(tz => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`).join('');
      setSafeHTML(timezoneSelect, optionsHTML);
    } catch (e) {
      console.warn('Intl.supportedValuesOf not supported, timezone select fallback to default.');
    }
  }

  document.getElementById('header-create-event')?.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
  document.getElementById('welcome-create-btn')?.addEventListener('click', openPanel);

  // Back to home
  document.getElementById('ce-back-home')?.addEventListener('click', (e) => { e.preventDefault(); switchToPanel('events'); });

  // Initialize Google Places when create-event panel is opened
  const initGoogleOnShow = () => {
    if (!isAutocompleteInitialized()) {
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
      // Hide tickets tab, step, currency, and Stripe verification
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
      const stripeSection = document.getElementById('ce-stripe-section');
      if (stripeSection) stripeSection.style.display = 'none';
    } else {
      // Show tickets tab, step, currency, and Stripe verification
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
      const stripeSection = document.getElementById('ce-stripe-section');
      if (stripeSection) stripeSection.style.display = '';
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

  // Make listing type accessible across the module
  ceListingTypeGetter = () => ceListingType;

  // ── Tab switching ──
  const tabs = document.querySelectorAll('[data-ce-tab]');
  const steps = { basic: 'ce-step-basic', tickets: 'ce-step-tickets', publishing: 'ce-step-publishing' };

  function getListingType() {
    return ceListingTypeGetter ? ceListingTypeGetter() : ceListingType;
  }

  function getTabOrder() {
    return getListingType() === 'display_only' ? ['basic', 'publishing'] : ['basic', 'tickets', 'publishing'];
  }

  function switchCeTab(tabName) {
    const tabOrder = getTabOrder();
    // Skip tickets tab if display_only
    if (getListingType() === 'display_only' && tabName === 'tickets') return;

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

  // Save & Continue buttons — resolves listing type from both create and edit flows
  document.getElementById('ce-save-basic')?.addEventListener('click', () => {
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) { showToast('Event name must be at least 3 characters', 'error'); return; }

    // Resolve listing type: ceListingTypeGetter works in EDIT mode,
    // ceListingType closure var works in CREATE mode
    const listingType = ceListingTypeGetter ? ceListingTypeGetter() : ceListingType;
    const targetTab = listingType === 'display_only' ? 'publishing' : 'tickets';

    // 1. Deactivate all steps and tabs
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('[data-ce-tab]').forEach(t => { t.classList.remove('active'); t.classList.remove('completed'); });

    // 2. Activate target step
    const stepEl = document.getElementById(steps[targetTab]);
    if (stepEl) stepEl.classList.add('active');

    // 3. Activate target tab + mark previous tabs completed
    const tabEl = document.querySelector(`[data-ce-tab="${targetTab}"]`);
    if (tabEl) tabEl.classList.add('active');
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('completed');

    // 4. Update progress bar
    const tabOrder = listingType === 'display_only' ? ['basic', 'publishing'] : ['basic', 'tickets', 'publishing'];
    const idx = tabOrder.indexOf(targetTab);
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = `${((idx + 1) / tabOrder.length) * 100}%`;

    // 5. Update preview if going to publishing
    if (targetTab === 'publishing') {
      try { updateCePreview(); } catch (e) { console.warn('Preview update failed:', e); }
    }
  });

  document.getElementById('ce-save-tickets')?.addEventListener('click', () => {
    // 1. Deactivate all steps and tabs
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('[data-ce-tab]').forEach(t => { t.classList.remove('active'); t.classList.remove('completed'); });

    // 2. Activate publishing step
    const pubStep = document.getElementById('ce-step-publishing');
    if (pubStep) pubStep.classList.add('active');

    // 3. Activate publishing tab + mark previous tabs completed
    document.querySelector('[data-ce-tab="publishing"]')?.classList.add('active');
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('completed');
    document.querySelector('[data-ce-tab="tickets"]')?.classList.add('completed');

    // 4. Update progress bar to 100%
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = '100%';

    // 5. Update preview
    try { updateCePreview(); } catch (e) { console.warn('Preview update failed:', e); }
  });

  // ── Rich Text Editor ──
  document.querySelectorAll('.ce-editor-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = await showPromptModal({
          title: 'Insert Link',
          message: 'Enter URL:',
          placeholder: 'https://...',
          confirmText: 'Insert Link'
        });
        if (url) {
          const trimmed = url.trim();
          // Block all dangerous URI schemes
          if (/^\s*(javascript|data|vbscript|blob):/i.test(trimmed)) {
            showToast('Blocked: unsafe URL protocol.', 'error');
            return;
          }
          // Only allow http(s), mailto, tel, or relative paths
          if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed) || !/^[a-z]+:/i.test(trimmed)) {
            document.execCommand(cmd, false, trimmed);
          } else {
            showToast('Only http/https URLs are allowed.', 'error');
          }
        }
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
  setupCeUpload('ce-organizer-logo', 'ce-organizer-logo-area');

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

  // ── Ticket Listeners (delegated to wizard-tickets.js) ──
  setupTicketListeners();

  // ── Services Modal ──
  const svcModal = document.getElementById('services-modal');
  document.getElementById('services-modal-close')?.addEventListener('click', () => svcModal?.classList.remove('active'));
  svcModal?.addEventListener('click', (e) => { if (e.target === svcModal) svcModal.classList.remove('active'); });
  document.getElementById('svc-submit')?.addEventListener('click', () => {
    showToast('Service request submitted!', 'success');
    svcModal?.classList.remove('active');
  });

  // ── Publish Event ──
  document.getElementById('ce-publish-btn')?.addEventListener('click', async (e) => {
    if (isPublishing) return; // H-1: Prevent double-submit
    isPublishing = true;
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
    const resolvedListingType = ceListingTypeGetter ? ceListingTypeGetter() : ceListingType;
    if (resolvedListingType !== 'display_only' && !currency) markError('ce-currency', 'Currency is required');

    const timezone = document.getElementById('ce-timezone')?.value;
    if (!timezone) markError('ce-timezone', 'Time zone is required');

    const organizerName = document.getElementById('ce-organizer-name')?.value.trim();
    if (!organizerName) markError('ce-organizer-name', 'Organizer name is required');

    const organizerEmail = document.getElementById('ce-organizer-email')?.value.trim();
    if (!organizerEmail) markError('ce-organizer-email', 'Organizer email is required');

    const startDate = document.getElementById('ce-start-date')?.value;
    if (!startDate) markError('ce-start-date', 'Start date is required');

    const endDate = document.getElementById('ce-end-date')?.value;
    if (!endDate) markError('ce-end-date', 'End date is required');

    // Tab 2: Tickets (skip validation for display_only)
    const listingType = resolvedListingType || 'display_and_sell';
    if (listingType !== 'display_only' && getTicketsList().length === 0) {
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

    if (btn) { btn.disabled = true; btn.textContent = ceEditingEventId ? 'Updating…' : 'Publishing…'; }
    // M-9: Capture editing state BEFORE the try block so finally can use it
    //       even after ceEditingEventId is nulled on success.
    const wasEditingForReset = !!ceEditingEventId;
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
      const listingType = ceListingTypeGetter ? ceListingTypeGetter() : 'display_and_sell';

      // All event data — columns are guaranteed to exist after migration-v11/v12
      const eventData = {
        organizer_id: user.id,
        title: name,
        description: sanitizeDescriptionHTML(document.getElementById('ce-overview')?.innerHTML || ''),
        venue: place,
        venue_address: document.getElementById('ce-address')?.value.trim() || null,
        city: city,
        date: new Date(startDate).toISOString(),
        category: category || 'general',
        status: 'published',
        listing_type: listingType,
        longitude: parseFloat(document.getElementById('ce-longitude')?.value) || null,
        latitude: parseFloat(document.getElementById('ce-latitude')?.value) || null,
        country: country || null,
        keywords: ceKeywords.length ? ceKeywords : null,
        pixel_code: document.getElementById('ce-pixel')?.value.trim() || null,
        currency: currency || 'EGP',
        timezone: timezone || null,
        doors_open: document.getElementById('ce-doors')?.value ? new Date(document.getElementById('ce-doors').value).toISOString() : null,
        end_date: endDate ? new Date(endDate).toISOString() : null,
        show_end_time: showEndTime,
        website: document.getElementById('ce-website')?.value.trim() || null,
        social_links: socialLinks.length ? socialLinks : null,
        // Organizer information
        organizer_name: organizerName || null,
        organizer_email: document.getElementById('ce-organizer-email')?.value.trim() || null,
        organizer_phone: document.getElementById('ce-organizer-phone')?.value.trim() || null,
        organizer_website: document.getElementById('ce-organizer-website')?.value.trim() || null,
        organizer_bio: document.getElementById('ce-organizer-bio')?.value.trim() || null,
      };

      let event;
      if (ceEditingEventId) {
        // ── UPDATE existing event ──
        const allUpdates = { ...eventData };
        delete allUpdates.organizer_id;
        event = await updateEvent(ceEditingEventId, allUpdates);
      } else {
        // ── CREATE new event (single insert with all fields) ──
        event = await createEvent(eventData);
      }

      // ── Collect all image URLs, then update in ONE call ──
      const imageUpdates = {};

      // Upload cover image
      if (getPendingCoverFile()) {
        const coverUrl = await uploadCoverImage(event.id);
        if (coverUrl) imageUpdates.cover_image = coverUrl;
      }

      // Upload logo image
      const logoInput = document.getElementById('ce-logo');
      if (logoInput?.files?.[0]) {
        const logoUrl = await uploadEventFile(event.id, logoInput.files[0], 'logo');
        if (logoUrl) imageUpdates.logo_url = logoUrl;
      }

      // Upload gallery images (merge with existing URLs)
      const galleryItems = document.querySelectorAll('#ce-gallery-grid .ce-gallery-item');
      const galleryUrls = [];
      for (let i = 0; i < galleryItems.length; i++) {
        const item = galleryItems[i];
        const fileInput = item.querySelector('input[type="file"]');
        if (fileInput?.files?.[0]) {
          const url = await uploadEventFile(event.id, fileInput.files[0], `gallery_${i}`);
          if (url) galleryUrls.push(url);
        } else if (item.dataset.existingUrl) {
          galleryUrls.push(item.dataset.existingUrl);
        }
      }
      if (galleryUrls.length) imageUpdates.gallery_urls = galleryUrls;

      // Upload sponsor logos
      const sponsorItems = document.querySelectorAll('#ce-sponsors-grid .ce-gallery-item');
      const sponsorUrls = [];
      for (let i = 0; i < sponsorItems.length; i++) {
        const fileInput = sponsorItems[i].querySelector('input[type="file"]');
        if (fileInput?.files?.[0]) {
          const url = await uploadEventFile(event.id, fileInput.files[0], `sponsor_${i}`);
          if (url) sponsorUrls.push(url);
        } else if (sponsorItems[i].dataset.existingUrl) {
          sponsorUrls.push(sponsorItems[i].dataset.existingUrl);
        }
      }
      if (sponsorUrls.length) imageUpdates.sponsor_urls = sponsorUrls;

      // Upload organizer logo
      const orgLogoInput = document.getElementById('ce-organizer-logo');
      if (orgLogoInput?.files?.[0]) {
        const orgLogoUrl = await uploadEventFile(event.id, orgLogoInput.files[0], 'organizer_logo');
        if (orgLogoUrl) imageUpdates.organizer_logo_url = orgLogoUrl;
      }

      // Apply all image updates in a single call (resilient)
      if (Object.keys(imageUpdates).length > 0) {
        try {
          const { error: imgErr } = await supabase.from('events').update(imageUpdates).eq('id', event.id);
          if (imgErr) console.warn('Image fields update failed:', imgErr.message);
        } catch (imgCatchErr) {
          console.warn('Image fields update skipped:', imgCatchErr.message);
        }
      }

      // Get selected ticket type
      const ticketType = document.querySelector('.ce-ticket-card.selected input')?.value || 'normal';

      // Only insert tickets if listing type is display_and_sell
      if (listingType !== 'display_only' && getTicketsList().length > 0) {
        if (ceEditingEventId) {
          // ── UPDATE MODE: delete old tiers (with 0 sales) and re-insert ──
          const { data: existingTiers } = await supabase.from('ticket_tiers').select('id, sold_count').eq('event_id', event.id);
          
          const tiersToDelete = (existingTiers || []).filter(tier => (tier.sold_count || 0) === 0).map(t => t.id);
          if (tiersToDelete.length > 0) {
            await supabase.from('ticket_tiers').delete().in('id', tiersToDelete);
          }

          // Insert/Update updated tiers
          const remainingIds = (existingTiers || []).filter(t => (t.sold_count || 0) > 0).map(t => t.id);
          if (getTicketsList().length > 0) {
            const tierPayloads = getTicketsList().map(t => ({
              ...(t.id && remainingIds.includes(t.id) ? { id: t.id } : {}),
              event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
              ticket_type: ticketType, category: t.category || null,
              early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
              early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
              max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
              currency: t.currency || 'USD',
            }));
            const { error: tierErr } = await supabase.from('ticket_tiers').upsert(tierPayloads);
            if (tierErr) console.warn('Tier upsert failed:', tierErr.message);
          }
        } else {
          // ── CREATE MODE: insert all tiers with full payload (M-11: single round-trip) ──
          // ── CREATE MODE: insert all tiers with full payload (H-3: single round-trip) ──
          if (getTicketsList().length > 0) {
            const tierPayloads = getTicketsList().map(t => ({
              event_id: event.id,
              name: t.name,
              price: t.price,
              capacity: t.qty,
              ticket_type: ticketType,
              category: t.category || null,
              early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
              early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
              max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
              currency: t.currency || 'USD',
            }));
            const { error: tierErr } = await supabase.from('ticket_tiers').insert(tierPayloads);
            if (tierErr) console.warn('Tier insert failed:', tierErr.message);
          }
        }
      }

      const wasEditing = wasEditingForReset;
      showToast(wasEditing ? 'Event updated successfully!' : '🎉 Event submitted! It will appear publicly once approved by admin.', 'success');
      ceEditingEventId = null;
      switchToPanel('events');
      await emitDashboardAction('refreshDashboard');

      // Show services modal only on new events
      if (!wasEditing) {
        setTimeout(() => { document.getElementById('services-modal')?.classList.add('active'); }, 600);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; setSafeHTML(btn, wasEditingForReset ? 'Update Event' : 'Publish Event'); }
      isPublishing = false; // H-1: Release semaphore
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
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
    const setSelect = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null && val !== '') {
        const strVal = String(val);
        const opt = Array.from(el.options).find(o => o.value === strVal);
        if (opt) el.value = strVal;
      }
    };

    setVal('ce-name', ev.title);
    setVal('ce-place', ev.venue);
    setVal('ce-address', ev.venue_address || ev.city); // prefer full address, fallback to city
    setVal('ce-city', ev.city);
    setSelect('ce-country', ev.country);
    setVal('ce-longitude', ev.longitude);
    setVal('ce-latitude', ev.latitude);
    setSelect('ce-category', ev.category);
    setVal('ce-pixel', ev.pixel_code);
    setSelect('ce-currency', ev.currency);
    setSelect('ce-timezone', ev.timezone);
    setVal('ce-website', ev.website);

    // Organizer information
    setVal('ce-organizer-name', ev.organizer_name);
    setVal('ce-organizer-email', ev.organizer_email);
    setVal('ce-organizer-phone', ev.organizer_phone);
    setVal('ce-organizer-website', ev.organizer_website);
    setVal('ce-organizer-bio', ev.organizer_bio);

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
        tagsWrap.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', () => { ceKeywords.splice(Number(btn.dataset.idx), 1); renderGoogleKeywords(); });
        });
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
      setTicketsList(ev.ticket_tiers.map(t => ({
        id: t.id,
        name: t.name,
        qty: t.capacity,
        price: t.price,
        category: t.category || '',
        earlyPrice: t.early_bird_price || '',
        earlyEnd: t.early_bird_end || '',
        currency: t.currency || 'USD',
      })));
      renderCeTicketsTable();
    }

    // ── Populate cover image preview ──
    const coverSrc = ev.cover_image || ev.cover_url;
    if (coverSrc) {
      const mainArea = document.getElementById('ce-main-photo-area');
      if (mainArea) {
        const resolvedCoverUrl = await resolveImageUrl(coverSrc);
        let img = mainArea.querySelector('img');
        if (!img) { img = document.createElement('img'); mainArea.appendChild(img); }
        img.onerror = () => { console.warn('Cover preview failed to load:', resolvedCoverUrl); img.remove(); mainArea.classList.remove('has-image'); };
        img.src = resolvedCoverUrl;
        mainArea.classList.add('has-image');
      }
    }

    // ── Populate logo image preview ──
    if (ev.logo_url) {
      const logoArea = document.getElementById('ce-logo-area');
      if (logoArea) {
        const resolvedLogoUrl = await resolveImageUrl(ev.logo_url);
        let img = logoArea.querySelector('img');
        if (!img) { img = document.createElement('img'); logoArea.appendChild(img); }
        img.onerror = () => { console.warn('Logo preview failed to load:', resolvedLogoUrl); img.remove(); logoArea.classList.remove('has-image'); };
        img.src = resolvedLogoUrl;
        logoArea.classList.add('has-image');
      }
    }

    // ── Populate gallery images (Issue #5) ──
    // Safely parse gallery_urls — may arrive as JSON string or native array
    let galleryArr = ev.gallery_urls;
    if (typeof galleryArr === 'string') {
      try { galleryArr = JSON.parse(galleryArr); } catch (_) { galleryArr = null; }
    }
    if (Array.isArray(galleryArr) && galleryArr.length) {
      const galleryGrid = document.getElementById('ce-gallery-grid');
      if (galleryGrid) {
        galleryGrid.textContent = '';
        for (let i = 0; i < galleryArr.length; i++) {
          const originalUrl = galleryArr[i];
          const resolvedGalleryUrl = await resolveImageUrl(originalUrl);
          const item = document.createElement('div');
          item.className = 'ce-gallery-item';
          item.dataset.existingUrl = originalUrl; // Store original URL for DB
          setSafeHTML(item, `<label>Photo ${i + 1}</label><div class="ce-upload-area ce-gallery-upload has-image"><img src="${escapeHTML(resolvedGalleryUrl)}" /><input type="file" accept="image/jpeg,image/png" /></div>`);
          galleryGrid.appendChild(item);
          const fileInput = item.querySelector('input[type="file"]');
          const area = item.querySelector('.ce-upload-area');
          fileInput.addEventListener('change', (e) => {
            handleCeFileUpload(e, area);
            // Clear existing URL since user chose new file
            delete item.dataset.existingUrl;
          });
        }
        ceGalleryCount = galleryArr.length;
      }
    }

    // ── Populate sponsor logos ──
    let sponsorArr = ev.sponsor_urls;
    if (typeof sponsorArr === 'string') {
      try { sponsorArr = JSON.parse(sponsorArr); } catch (_) { sponsorArr = null; }
    }
    if (Array.isArray(sponsorArr) && sponsorArr.length) {
      const sponsorsGrid = document.getElementById('ce-sponsors-grid');
      if (sponsorsGrid) {
        sponsorsGrid.textContent = '';
        for (let i = 0; i < sponsorArr.length; i++) {
          const originalUrl = sponsorArr[i];
          const resolvedSponsorUrl = await resolveImageUrl(originalUrl);
          const item = document.createElement('div');
          item.className = 'ce-gallery-item';
          item.dataset.existingUrl = originalUrl; // Store original URL for DB
          setSafeHTML(item, `<label>Sponsor ${i + 1}</label><div class="ce-upload-area ce-gallery-upload has-image"><img src="${escapeHTML(resolvedSponsorUrl)}" /><input type="file" accept="image/jpeg,image/png" /></div>`);
          sponsorsGrid.appendChild(item);
          const fileInput = item.querySelector('input[type="file"]');
          const area = item.querySelector('.ce-upload-area');
          fileInput.addEventListener('change', (e) => {
            handleCeFileUpload(e, area);
            delete item.dataset.existingUrl;
          });
        }
      }
    }

    // ── Populate organizer logo image preview ──
    if (ev.organizer_logo_url) {
      const orgLogoArea = document.getElementById('ce-organizer-logo-area');
      if (orgLogoArea) {
        const resolvedOrgLogoUrl = await resolveImageUrl(ev.organizer_logo_url);
        let img = orgLogoArea.querySelector('img');
        if (!img) { img = document.createElement('img'); orgLogoArea.appendChild(img); }
        img.onerror = () => { console.warn('Organizer logo preview failed to load:', resolvedOrgLogoUrl); img.remove(); orgLogoArea.classList.remove('has-image'); };
        img.src = resolvedOrgLogoUrl;
        orgLogoArea.classList.add('has-image');
      }
    }

    // Skip chooser — go directly to form for editing
    const listingChooser = document.getElementById('ce-listing-chooser');
    const wizardContent = document.getElementById('ce-wizard-content');
    if (listingChooser) listingChooser.style.display = 'none';
    if (wizardContent) wizardContent.style.display = 'block';

    // Determine listing type from DB data
    const editListingType = ev.listing_type || (ev.ticket_tiers?.length ? 'display_and_sell' : 'display_only');
    ceListingTypeGetter = () => editListingType;

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
      const stripeSection = document.getElementById('ce-stripe-section');
      if (stripeSection) stripeSection.style.display = 'none';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
      const stripeSection = document.getElementById('ce-stripe-section');
      if (stripeSection) stripeSection.style.display = '';
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
  ['ce-name','ce-place','ce-address','ce-city','ce-longitude','ce-latitude','ce-keywords','ce-pixel','ce-website','ce-doors','ce-start-date','ce-end-date','ce-ticket-name','ce-ticket-price','ce-early-price','ce-early-end','ce-max-scans-day','ce-google-search','ce-organizer-name','ce-organizer-email','ce-organizer-phone','ce-organizer-website','ce-organizer-bio'].forEach(id => {
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
  ['ce-main-photo-area','ce-logo-area','ce-organizer-logo-area'].forEach(id => {
    const area = document.getElementById(id);
    if (area) { area.classList.remove('has-image'); area.querySelector('img')?.remove(); }
  });
  // Reset gallery & sponsors
  const galleryGrid = document.getElementById('ce-gallery-grid');
  if (galleryGrid) {
    setSafeHTML(galleryGrid, `<div class="ce-gallery-item"><label>Photo 1</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div></div>`);
    const newGalleryInput = galleryGrid.querySelector('input[type="file"]');
    const newGalleryArea = galleryGrid.querySelector('.ce-upload-area');
    if (newGalleryInput && newGalleryArea) {
      newGalleryInput.addEventListener('change', (e) => handleCeFileUpload(e, newGalleryArea));
    }
  }
  const sponsorsGrid = document.getElementById('ce-sponsors-grid');
  if (sponsorsGrid) sponsorsGrid.textContent = '';
  // Reset social links to 1 empty row
  const socialLinks = document.getElementById('ce-social-links');
  if (socialLinks) setSafeHTML(socialLinks, `<div class="ce-social-row"><select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">x</button></div>`);
  // Reset keywords tags
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (tagsWrap) tagsWrap.textContent = '';
  // Reset ticket categories & ticket list
  resetTicketState();
  ceGalleryCount = 1;
  ceKeywords = [];
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
  clearPendingCoverFile();
  // Reset Google Map preview
  const mapWrap = document.getElementById('ce-map-preview-wrap');
  if (mapWrap) mapWrap.style.display = 'none';
  resetMapState();
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

export function updateCePreview() {
  const title = document.getElementById('ce-name')?.value.trim() || 'Event Name';
  const previewTitle = document.getElementById('ce-preview-title');
  if (previewTitle) previewTitle.textContent = title;

  const venue = document.getElementById('ce-place')?.value.trim() || 'Venue';
  const addr = document.getElementById('ce-address')?.value.trim() || '';
  const previewVenue = document.getElementById('ce-preview-venue');
  if (previewVenue) previewVenue.textContent = venue;
  const previewAddr = document.getElementById('ce-preview-addr');
  if (previewAddr) previewAddr.textContent = addr;

  const startDate = document.getElementById('ce-start-date')?.value;
  const endDate = document.getElementById('ce-end-date')?.value;
  if (startDate) {
    const d = new Date(startDate);
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const previewMonth = document.getElementById('ce-preview-month');
    if (previewMonth) previewMonth.textContent = months[d.getMonth()];
    const previewDay = document.getElementById('ce-preview-day');
    if (previewDay) previewDay.textContent = String(d.getDate()).padStart(2, '0');
    const previewDateStr = document.getElementById('ce-preview-datestr');
    if (previewDateStr) previewDateStr.textContent = d.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    let timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (endDate) {
      const ed = new Date(endDate);
      timeStr += ` - ${ed.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })}, ${ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
    }
    const previewTimeStr = document.getElementById('ce-preview-timestr');
    if (previewTimeStr) previewTimeStr.textContent = timeStr;
  }
  // Preview image
  const mainImg = document.getElementById('ce-main-photo-area')?.querySelector('img');
  const previewImgDiv = document.getElementById('ce-preview-img');
  if (mainImg && previewImgDiv) {
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
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
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
      <button class="ev-btn ev-btn-outline" id="edit-cancel" style="flex:1;padding:11px">Cancel</button>
      <button class="ev-btn ev-btn-pink" id="edit-save" style="flex:1;padding:11px">Save Changes</button>
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
      await emitDashboardAction('refreshDashboard');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
      btn.disabled = false; btn.textContent = 'Save Changes';
    }
  });
}

