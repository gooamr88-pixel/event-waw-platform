/* ===================================
   EVENTSLI — Modal Orchestrator
   =================================== */

import { supabase, resolveImageUrl } from './supabase.js';
import { updateEvent } from './events.js';
import { escapeHTML } from './utils.js';
import { showToast, switchToPanel } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';
import { emitDashboardAction } from './dashboard-bus.js';
import { initGooglePlacesAutocomplete as _initMaps, showGoogleMapPreview, isAutocompleteInitialized, resetMapState } from './wizard-maps.js';
import { clearPendingCoverFile, handleCeFileUpload } from './wizard-uploads.js';
import { setupTicketListeners, setTicketsList, resetTicketState, renderCeTicketsTable, setPromoCodesList, renderCePromoTable } from './wizard-tickets.js';
import { setupBasicTab, renderGoogleKeywords } from './wizard-basic.js';
import { setupSponsorsTab, setCeGalleryCount } from './wizard-sponsors.js';
import { setupPublishing, updateCePreview, sanitizeDescriptionHTML } from './wizard-publishing.js';

let ceKeywords = [];
let ceEditingEventId = null;
let ceListingTypeGetter = null;
let ceListingType = null;

export function toTZLocalString(dateInput, timeZone) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const getPart = type => parts.find(p => p.type === type)?.value;
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}`;
  } catch (e) {
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
}

export function parseTZLocalToISO(localStr, timeZone) {
  if (!localStr) return null;
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const [dateStr, timeStr] = localStr.split('T');
    const [year, month, day] = dateStr.split('-');
    const [hour, min] = timeStr.split(':');
    
    const date = new Date(Date.UTC(year, month - 1, day, hour, min));
    const localTime = date.getTime();
    
    const tzFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' });
    const parts = tzFormatter.formatToParts(date);
    const offsetStr = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    
    const match = offsetStr.match(/GMT([+-])(\d+):?(\d+)?/);
    let offsetMinutes = 0;
    if (match) {
      const sign = match[1] === '+' ? 1 : -1;
      const hours = parseInt(match[2], 10);
      const mins = match[3] ? parseInt(match[3], 10) : 0;
      offsetMinutes = sign * (hours * 60 + mins);
    }
    
    return new Date(localTime - (offsetMinutes * 60 * 1000)).toISOString();
  } catch (e) {
    return new Date(localStr).toISOString();
  }
}

function getOrchestratorState() {
  return {
    ceKeywords,
    ceEditingEventId,
    getEditingEventId: () => ceEditingEventId,
    setEditingEventId: (id) => { ceEditingEventId = id; },
    getListingType: () => (ceListingTypeGetter ? ceListingTypeGetter() : ceListingType),
    clearEditState: () => { ceEditingEventId = null; },
    resetForm: resetCreateEventForm,
    toTZLocalString,
    parseTZLocalToISO
  };
}

function _mapsDeps() {
  return { getKeywords: () => ceKeywords, setKeywords: kw => { ceKeywords = kw; }, renderKeywords: () => renderGoogleKeywords(ceKeywords) };
}

export function initGooglePlacesAutocomplete() { return _initMaps(_mapsDeps()); }

export function setupCreateModal() {
  const openPanel = () => { switchToPanel('create-event'); };

  setupBasicTab(getOrchestratorState);

  document.getElementById('header-create-event')?.addEventListener('click', (e) => { e.preventDefault(); openPanel(); });
  document.getElementById('welcome-create-btn')?.addEventListener('click', openPanel);
  document.getElementById('ce-back-home')?.addEventListener('click', (e) => { e.preventDefault(); switchToPanel('events'); });

  const initGoogleOnShow = () => {
    if (!isAutocompleteInitialized()) setTimeout(() => initGooglePlacesAutocomplete(), 300);
  };
  document.getElementById('header-create-event')?.addEventListener('click', initGoogleOnShow);
  document.getElementById('welcome-create-btn')?.addEventListener('click', initGoogleOnShow);

  // ── Listing Type Chooser ──
  const listingRadios = document.querySelectorAll('input[name="ce-listing-type"]');
  const listingContinueBtn = document.getElementById('ce-listing-continue');
  const listingChooser = document.getElementById('ce-listing-chooser');
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
    if (listingChooser) listingChooser.style.display = 'none';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'block';

    const bannerIcon = document.getElementById('ce-banner-icon');
    const bannerLabel = document.getElementById('ce-banner-label');
    const bannerDesc = document.getElementById('ce-banner-desc');
    const currencyGroup = document.getElementById('ce-currency-group');
    const stripeSection = document.getElementById('ce-stripe-section');

    if (ceListingType === 'display_only') {
      if (bannerIcon) bannerIcon.textContent = '📢';
      if (bannerLabel) bannerLabel.textContent = 'Display Only';
      if (bannerDesc) bannerDesc.textContent = 'Event showcase — no ticket sales';
      if (ticketsTab) ticketsTab.style.display = 'none';
      if (ticketsStep) ticketsStep.style.display = 'none';
      if (currencyGroup) currencyGroup.style.display = 'none';
      if (stripeSection) stripeSection.style.display = 'none';
    } else {
      if (bannerIcon) bannerIcon.textContent = '🎫';
      if (bannerLabel) bannerLabel.textContent = 'Display & Sell Tickets';
      if (bannerDesc) bannerDesc.textContent = 'Full ticketing with Stripe payments & QR entry';
      if (ticketsTab) ticketsTab.style.display = '';
      if (ticketsStep) ticketsStep.style.display = '';
      if (currencyGroup) currencyGroup.style.display = '';
      if (stripeSection) stripeSection.style.display = '';
    }

    document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.getElementById('ce-step-basic')?.classList.add('active');

    const progress = document.getElementById('ce-progress-bar');
    const totalSteps = ceListingType === 'display_only' ? 2 : 3;
    if (progress) progress.style.width = `${(1 / totalSteps) * 100}%`;
  });

  document.getElementById('ce-listing-change')?.addEventListener('click', () => {
    if (listingChooser) listingChooser.style.display = '';
    const wizardContent = document.getElementById('ce-wizard-content');
    if (wizardContent) wizardContent.style.display = 'none';
  });

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
    if (getListingType() === 'display_only' && tabName === 'tickets') return;

    tabs.forEach(t => t.classList.remove('active'));
    Object.values(steps).forEach(id => document.getElementById(id)?.classList.remove('active'));
    const tab = document.querySelector(`[data-ce-tab="${tabName}"]`);
    if (tab) tab.classList.add('active');
    document.getElementById(steps[tabName])?.classList.add('active');
    
    const idx = tabOrder.indexOf(tabName);
    tabOrder.forEach((t, i) => {
      const el = document.querySelector(`[data-ce-tab="${t}"]`);
      if (i < idx) el?.classList.add('completed');
      else el?.classList.remove('completed');
    });
    
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = `${((idx + 1) / tabOrder.length) * 100}%`;
    if (tabName === 'publishing') updateCePreview();
  }

  tabs.forEach(tab => tab.addEventListener('click', () => switchCeTab(tab.dataset.ceTab)));

  // Save & Continue
  document.getElementById('ce-save-basic')?.addEventListener('click', () => {
    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) { showToast('Event name must be at least 3 characters', 'error'); return; }

    const listingType = getListingType();
    const targetTab = listingType === 'display_only' ? 'publishing' : 'tickets';

    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('[data-ce-tab]').forEach(t => { t.classList.remove('active'); t.classList.remove('completed'); });

    document.getElementById(steps[targetTab])?.classList.add('active');
    document.querySelector(`[data-ce-tab="${targetTab}"]`)?.classList.add('active');
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('completed');

    const tabOrder = getTabOrder();
    const idx = tabOrder.indexOf(targetTab);
    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = `${((idx + 1) / tabOrder.length) * 100}%`;

    if (targetTab === 'publishing') {
      try { updateCePreview(); } catch (e) { console.warn('Preview update failed:', e); }
    }
  });

  document.getElementById('ce-save-tickets')?.addEventListener('click', () => {
    document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('[data-ce-tab]').forEach(t => { t.classList.remove('active'); t.classList.remove('completed'); });

    document.getElementById('ce-step-publishing')?.classList.add('active');
    document.querySelector('[data-ce-tab="publishing"]')?.classList.add('active');
    document.querySelector('[data-ce-tab="basic"]')?.classList.add('completed');
    document.querySelector('[data-ce-tab="tickets"]')?.classList.add('completed');

    const progress = document.getElementById('ce-progress-bar');
    if (progress) progress.style.width = '100%';

    try { updateCePreview(); } catch (e) { console.warn('Preview update failed:', e); }
  });

  setupSponsorsTab();
  setupTicketListeners();
  setupPublishing(getOrchestratorState, switchToPanel);

  const svcModal = document.getElementById('services-modal');
  document.getElementById('services-modal-close')?.addEventListener('click', () => svcModal?.classList.remove('active'));
  svcModal?.addEventListener('click', (e) => { if (e.target === svcModal) svcModal.classList.remove('active'); });
  document.getElementById('svc-submit')?.addEventListener('click', () => {
    showToast('Service request submitted!', 'success');
    svcModal?.classList.remove('active');
  });
}

export async function loadEventForEditing(eventId) {
  try {
    const { data: ev, error } = await supabase.from('events').select(`*, ticket_tiers(id, name, price, capacity, ticket_type, category, early_bird_price, early_bird_end, max_scans, currency, description, min_purchase, max_purchase, sales_start, sales_end, seating_type, is_hidden), promo_codes(id, code, discount_type, discount_value, max_uses)`).eq('id', eventId).single();
    if (error || !ev) { showToast('Failed to load event', 'error'); return; }

    resetCreateEventForm();
    ceEditingEventId = eventId;

    const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
    if (breadcrumb) breadcrumb.textContent = 'Edit Event';
    const publishBtn = document.getElementById('ce-publish-btn');
    if (publishBtn) setSafeHTML(publishBtn, 'Update Event');

    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val != null && val !== '') el.value = val; };
    const setSelect = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null && val !== '') {
        const strVal = String(val);
        if (el.tomselect) {
          el.tomselect.setValue(strVal);
        } else {
          const opt = Array.from(el.options).find(o => o.value === strVal);
          if (opt) el.value = strVal;
        }
      }
    };

    setVal('ce-name', ev.title);
    setVal('ce-place', ev.venue);
    setVal('ce-address', ev.venue_address || ev.city);
    setVal('ce-city', ev.city);
    setSelect('ce-country', ev.country);
    setVal('ce-longitude', ev.longitude);
    setVal('ce-latitude', ev.latitude);
    setSelect('ce-category', ev.category);
    setSelect('ce-age-policy', ev.age_policy);
    setSelect('ce-language', ev.language);
    setSelect('ce-currency', ev.currency);
    setSelect('ce-timezone', ev.timezone);
    setVal('ce-website', ev.website);
    setVal('ce-organizer-name', ev.organizer_name);
    setVal('ce-organizer-email', ev.organizer_email);
    setVal('ce-organizer-phone', ev.organizer_phone);
    setVal('ce-organizer-website', ev.organizer_website);
    setVal('ce-organizer-bio', ev.organizer_bio);
    setVal('ce-short-desc', ev.short_description);

    setSelect('ce-is-private', ev.is_private ? 'true' : 'false');

    if (ev.policies && typeof ev.policies === 'object') {
      setVal('ce-policy-guests', ev.policies.guests_vips);
      setVal('ce-policy-refund', ev.policies.refund_policy);
      setVal('ce-policy-refund-deadline', ev.policies.refund_deadline);
      setVal('ce-policy-cancellation', ev.policies.cancellation_policy);
      setSelect('ce-policy-reentry', ev.policies.reentry_policy);
      setSelect('ce-policy-seating', ev.policies.seating_type);
      setVal('ce-policy-children', ev.policies.children_policy);
      setVal('ce-policy-security', ev.policies.security_notes);
      setVal('ce-policy-entry', ev.policies.entry_requirements);
      setVal('ce-policy-parking', ev.policies.parking_info);
      setVal('ce-policy-instructions', ev.policies.important_instructions);
    }

    // Update short desc counter
    const shortDescEl = document.getElementById('ce-short-desc');
    const shortDescCounter = document.getElementById('ce-short-desc-count');
    if (shortDescEl && shortDescCounter) shortDescCounter.textContent = `${(shortDescEl.value || '').length}/200`;

    const editor = document.getElementById('ce-overview');
    if (editor && ev.description) setSafeHTML(editor, ev.description);

    const toLocalDatetime = (iso) => {
      return toTZLocalString(iso, ev.timezone);
    };
    setVal('ce-start-date', toLocalDatetime(ev.date));
    setVal('ce-end-date', toLocalDatetime(ev.end_date));
    setVal('ce-doors', toLocalDatetime(ev.doors_open));

    if (ev.show_end_time === false) {
      const noRadio = document.querySelector('input[name="ce-show-end"][value="no"]');
      if (noRadio) noRadio.checked = true;
    }

    if (ev.keywords && Array.isArray(ev.keywords)) {
      ceKeywords = [...ev.keywords];
      renderGoogleKeywords(ceKeywords);
    }

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

    if (ev.performers && Array.isArray(ev.performers) && ev.performers.length) {
      const container = document.getElementById('ce-performers-container');
      if (container) {
        setSafeHTML(container, ev.performers.map((p, i) => {
          const id = `perf-edit-${i}-${Date.now()}`;
          return `
            <div class="ce-performer-row" data-existing-url="${escapeHTML(p.image_url || '')}">
              <div class="ce-performer-photo-area ${p.image_url ? 'has-image' : ''}" id="perf-area-${id}">
                ${p.image_url ? `<img src="${escapeHTML(p.image_url)}" />` : '<span style="font-size: 1.5rem; color: #9ca3af;">👤</span>'}
                <input type="file" accept="image/jpeg,image/png" class="perf-upload" id="perf-input-${id}" />
              </div>
              <div class="ce-performer-inputs">
                <input type="text" class="ev-form-input perf-name" placeholder="Name (e.g. DJ Snake)" value="${escapeHTML(p.name || '')}" required />
                <input type="text" class="ev-form-input perf-role" placeholder="Role (e.g. DJ, Singer, Speaker)" value="${escapeHTML(p.role || '')}" />
              </div>
              <button type="button" class="ce-performer-del" title="Remove">✕</button>
            </div>
          `;
        }).join(''));

        // Wire up image previews for loaded rows
        container.querySelectorAll('.ce-performer-row').forEach(row => {
          const input = row.querySelector('.perf-upload');
          const area = row.querySelector('.ce-performer-photo-area');
          if (input && area) {
            input.addEventListener('change', (e) => {
              const file = e.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                area.innerHTML = '';
                const img = document.createElement('img');
                img.src = ev.target.result;
                area.appendChild(img);
                area.appendChild(input);
                area.classList.add('has-image');
              };
              reader.readAsDataURL(file);
            });
          }
        });
      }
    }

    if (ev.ticket_tiers && ev.ticket_tiers.length) {
      setTicketsList(ev.ticket_tiers.map(t => ({
        id: t.id, name: t.name, qty: t.capacity, price: t.price,
        category: t.category || '', earlyPrice: t.early_bird_price || '',
        earlyEnd: t.early_bird_end || '', currency: t.currency || 'USD',
        desc: t.description || '', minPurchase: t.min_purchase || 1,
        maxPurchase: t.max_purchase || 10, salesStart: t.sales_start || '',
        salesEnd: t.sales_end || '', seatingType: t.seating_type || 'general',
        isHidden: t.is_hidden || false
      })));
      renderCeTicketsTable();
    }

    if (ev.promo_codes && ev.promo_codes.length) {
      setPromoCodesList(ev.promo_codes.map(p => ({
        id: p.id, code: p.code, type: p.discount_type, 
        value: p.discount_value, maxUses: p.max_uses || null
      })));
      renderCePromoTable();
    }

    const coverSrc = ev.cover_image || ev.cover_url;
    if (coverSrc) {
      const mainArea = document.getElementById('ce-main-photo-area');
      if (mainArea) {
        const resolvedCoverUrl = await resolveImageUrl(coverSrc);
        let img = mainArea.querySelector('img');
        if (!img) { img = document.createElement('img'); mainArea.appendChild(img); }
        img.onerror = () => { img.remove(); mainArea.classList.remove('has-image'); };
        img.src = resolvedCoverUrl;
        mainArea.classList.add('has-image');
      }
    }

    if (ev.logo_url) {
      const logoArea = document.getElementById('ce-logo-area');
      if (logoArea) {
        const resolvedLogoUrl = await resolveImageUrl(ev.logo_url);
        let img = logoArea.querySelector('img');
        if (!img) { img = document.createElement('img'); logoArea.appendChild(img); }
        img.onerror = () => { img.remove(); logoArea.classList.remove('has-image'); };
        img.src = resolvedLogoUrl;
        logoArea.classList.add('has-image');
      }
    }

    let galleryArr = ev.gallery_urls;
    if (typeof galleryArr === 'string') { try { galleryArr = JSON.parse(galleryArr); } catch (_) { galleryArr = null; } }
    if (Array.isArray(galleryArr) && galleryArr.length) {
      const galleryGrid = document.getElementById('ce-gallery-grid');
      if (galleryGrid) {
        galleryGrid.textContent = '';
        for (let i = 0; i < galleryArr.length; i++) {
          const originalUrl = galleryArr[i];
          const resolvedGalleryUrl = await resolveImageUrl(originalUrl);
          const item = document.createElement('div');
          item.className = 'ce-gallery-item';
          item.dataset.existingUrl = originalUrl;
          setSafeHTML(item, `<label>Photo ${i + 1}</label><div class="ce-upload-area ce-gallery-upload has-image"><img src="${escapeHTML(resolvedGalleryUrl)}" /><input type="file" accept="image/jpeg,image/png" /></div>`);
          galleryGrid.appendChild(item);
          const fileInput = item.querySelector('input[type="file"]');
          const area = item.querySelector('.ce-upload-area');
          fileInput.addEventListener('change', (e) => { handleCeFileUpload(e, area); delete item.dataset.existingUrl; });
        }
        setCeGalleryCount(galleryArr.length);
      }
    }

    let sponsorArr = ev.sponsor_urls;
    if (typeof sponsorArr === 'string') { try { sponsorArr = JSON.parse(sponsorArr); } catch (_) { sponsorArr = null; } }
    if (Array.isArray(sponsorArr) && sponsorArr.length) {
      const sponsorsGrid = document.getElementById('ce-sponsors-grid');
      if (sponsorsGrid) {
        sponsorsGrid.textContent = '';
        for (let i = 0; i < sponsorArr.length; i++) {
          const originalUrl = sponsorArr[i];
          const resolvedSponsorUrl = await resolveImageUrl(originalUrl);
          const item = document.createElement('div');
          item.className = 'ce-gallery-item';
          item.dataset.existingUrl = originalUrl;
          setSafeHTML(item, `<label>Sponsor ${i + 1}</label><div class="ce-upload-area ce-gallery-upload has-image"><img src="${escapeHTML(resolvedSponsorUrl)}" /><input type="file" accept="image/jpeg,image/png" /></div>`);
          sponsorsGrid.appendChild(item);
          const fileInput = item.querySelector('input[type="file"]');
          const area = item.querySelector('.ce-upload-area');
          fileInput.addEventListener('change', (e) => { handleCeFileUpload(e, area); delete item.dataset.existingUrl; });
        }
      }
    }

    if (ev.organizer_logo_url) {
      const orgLogoArea = document.getElementById('ce-organizer-logo-area');
      if (orgLogoArea) {
        const resolvedOrgLogoUrl = await resolveImageUrl(ev.organizer_logo_url);
        let img = orgLogoArea.querySelector('img');
        if (!img) { img = document.createElement('img'); orgLogoArea.appendChild(img); }
        img.onerror = () => { img.remove(); orgLogoArea.classList.remove('has-image'); };
        img.src = resolvedOrgLogoUrl;
        orgLogoArea.classList.add('has-image');
      }
    }

    const listingChooser = document.getElementById('ce-listing-chooser');
    const wizardContent = document.getElementById('ce-wizard-content');
    if (listingChooser) listingChooser.style.display = 'none';
    if (wizardContent) wizardContent.style.display = 'block';

    const editListingType = ev.listing_type || (ev.ticket_tiers?.length ? 'display_and_sell' : 'display_only');
    ceListingTypeGetter = () => editListingType;

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

    switchToPanel('create-event');
    setTimeout(() => initGooglePlacesAutocomplete(), 300);
    if (ev.latitude && ev.longitude) showGoogleMapPreview(ev.latitude, ev.longitude, ev.venue, ev.city);
    showToast('Event loaded for editing', 'info');
  } catch (err) {
    showToast('Error loading event: ' + err.message, 'error');
  }
}

export function resetCreateEventForm() {
  const listingChooser = document.getElementById('ce-listing-chooser');
  const wizardContent = document.getElementById('ce-wizard-content');
  if (listingChooser) listingChooser.style.display = '';
  if (wizardContent) wizardContent.style.display = 'none';
  document.querySelectorAll('input[name="ce-listing-type"]').forEach(r => r.checked = false);
  const continueBtn = document.getElementById('ce-listing-continue');
  if (continueBtn) continueBtn.disabled = true;
  const ticketsTab = document.getElementById('ce-tab-tickets');
  const ticketsStep = document.getElementById('ce-step-tickets');
  if (ticketsTab) ticketsTab.style.display = '';
  if (ticketsStep) ticketsStep.style.display = '';
  const currencyGroup = document.getElementById('ce-currency-group');
  if (currencyGroup) currencyGroup.style.display = '';

  ['ce-name','ce-place','ce-address','ce-city','ce-longitude','ce-latitude','ce-keywords','ce-website','ce-doors','ce-start-date','ce-end-date','ce-ticket-name','ce-ticket-price','ce-early-price','ce-early-end','ce-max-scans-day','ce-google-search','ce-organizer-name','ce-organizer-email','ce-organizer-phone','ce-organizer-website','ce-organizer-bio','ce-short-desc','ce-policy-guests','ce-policy-refund','ce-policy-refund-deadline','ce-policy-cancellation','ce-policy-children','ce-policy-security','ce-policy-entry','ce-policy-parking','ce-policy-instructions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['ce-is-private','ce-category','ce-currency','ce-timezone','ce-country','ce-age-policy','ce-language','ce-policy-reentry','ce-policy-seating'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.selectedIndex = 0;
  });
  document.getElementById('ce-ticket-qty') && (document.getElementById('ce-ticket-qty').value = '1');
  document.getElementById('ce-max-scans') && (document.getElementById('ce-max-scans').value = '1');
  const editor = document.getElementById('ce-overview');
  if (editor) editor.textContent = '';
  ['ce-main-photo-area','ce-logo-area','ce-organizer-logo-area'].forEach(id => {
    const area = document.getElementById(id);
    if (area) { area.classList.remove('has-image'); area.querySelector('img')?.remove(); }
  });
  const galleryGrid = document.getElementById('ce-gallery-grid');
  if (galleryGrid) {
    setSafeHTML(galleryGrid, `<div class="ce-gallery-item"><label>Photo 1</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div></div>`);
    const newGalleryInput = galleryGrid.querySelector('input[type="file"]');
    const newGalleryArea = galleryGrid.querySelector('.ce-upload-area');
    if (newGalleryInput && newGalleryArea) newGalleryInput.addEventListener('change', (e) => handleCeFileUpload(e, newGalleryArea));
  }
  const sponsorsGrid = document.getElementById('ce-sponsors-grid');
  if (sponsorsGrid) sponsorsGrid.textContent = '';
  const socialLinks = document.getElementById('ce-social-links');
  if (socialLinks) setSafeHTML(socialLinks, `<div class="ce-social-row"><select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">x</button></div>`);
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (tagsWrap) tagsWrap.textContent = '';
  const performersContainer = document.getElementById('ce-performers-container');
  if (performersContainer) performersContainer.textContent = '';
  resetTicketState();
  setCeGalleryCount(1);
  ceKeywords = [];
  ceEditingEventId = null;
  const breadcrumb = document.querySelector('#panel-create-event .ev-breadcrumb strong');
  if (breadcrumb) breadcrumb.textContent = 'Create Event';
  const publishBtn = document.getElementById('ce-publish-btn');
  if (publishBtn) setSafeHTML(publishBtn, 'Publish Event');
  const catSelect = document.getElementById('ce-ticket-category-select');
  if (catSelect) setSafeHTML(catSelect, '<option value="">Select Category</option>');
  const ticketTbody = document.getElementById('ce-tickets-tbody');
  if (ticketTbody) setSafeHTML(ticketTbody, '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>');
  const promoTbody = document.getElementById('ce-promo-tbody');
  if (promoTbody) setSafeHTML(promoTbody, '<tr><td colspan="4" class="ev-table-empty">No promo codes added yet</td></tr>');
  document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
  const normalCard = document.querySelector('.ce-ticket-card:first-child');
  if (normalCard) { normalCard.classList.add('selected'); normalCard.querySelector('input').checked = true; }
  document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active','completed'));
  document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
  document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
  document.getElementById('ce-step-basic')?.classList.add('active');
  const progressBar = document.getElementById('ce-progress-bar');
  if (progressBar) progressBar.style.width = '33%';
  clearPendingCoverFile();
  const mapWrap = document.getElementById('ce-map-preview-wrap');
  if (mapWrap) mapWrap.style.display = 'none';
  resetMapState();
}

export async function showEditModal(eventId) {
  document.querySelectorAll('.ev-modal-overlay.ev-edit-modal').forEach(m => m.remove());

  const { data: ev, error } = await supabase.from('events').select('id, title, description, venue, city, date, category, status, cover_image, tags, age_restriction, dress_code, max_capacity, refund_policy, contact_email, contact_phone, lat, lng').eq('id', eventId).single();
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
        description: typeof sanitizeDescriptionHTML === 'function' ? sanitizeDescriptionHTML(document.getElementById('edit-desc').value.trim()) : document.getElementById('edit-desc').value.trim(), // P1-10 FIX
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
