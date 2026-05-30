/* ===================================
   EVENTSLI — Wizard Publishing & Validation
   =================================== */

import { supabase, getCurrentUser, SUPABASE_FUNCTIONS_URL } from './supabase.js';
import { createEvent, updateEvent } from './events.js';
import { showToast } from './dashboard-ui.js';
import { emitDashboardAction } from './dashboard-bus.js';
import { getTicketsList, getPromoCodesList } from './wizard-tickets.js';
import { uploadCoverImage, uploadEventFile, getPendingCoverFile } from './wizard-uploads.js';
import DOMPurify from 'https://esm.sh/dompurify@3.2.4';
import { setSafeHTML } from './dom.js';

const escapeHTML = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };

let isPublishing = false;

/**
 * Sanitize rich-text HTML from the event description editor.
 * Uses DOMPurify to strip ALL XSS vectors: script tags, event handlers,
 * javascript: URIs, data: URIs in dangerous contexts, and CSS expressions.
 */
function sanitizeDescriptionHTML(html) {
  if (!html || !html.trim()) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'i', 'u', 'strong', 'em', 'a', 'ul', 'ol', 'li',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code',
      'span', 'div', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    ],
    ALLOWED_ATTR: [
      'href', 'target', 'rel', 'src', 'alt', 'title', 'class', 'style',
      'width', 'height', 'colspan', 'rowspan',
    ],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
}

/**
 * Show an inline terms acceptance modal in the dashboard.
 * Returns a Promise that resolves to true if the user accepts, false if they cancel.
 * On accept, calls the accept_platform_terms RPC to record consent.
 */
function showTermsAcceptanceModal(requiredVersion) {
  return new Promise((resolve) => {
    // Remove any existing terms modal
    document.getElementById('ev-terms-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ev-terms-modal';
    overlay.className = 'ev-modal-overlay active';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Platform Terms Acceptance');

    setSafeHTML(overlay, `
      <div class="ev-modal" style="max-width:600px; max-height:85vh; display:flex; flex-direction:column;">
        <div class="ev-modal-header" style="flex-shrink:0;">
          <div style="display:flex; align-items:center; gap:12px;">
            <div style="width:44px; height:44px; border-radius:12px; background:linear-gradient(135deg, #ec4899, #8b5cf6); display:flex; align-items:center; justify-content:center; font-size:1.3rem;">📋</div>
            <div>
              <h2 style="margin:0; font-size:1.15rem;">Platform Terms & Conditions</h2>
              <p style="margin:4px 0 0; font-size:0.8rem; color:var(--ev-text-sec);">Version ${escapeHTML(requiredVersion)} — Review required before publishing</p>
            </div>
          </div>
          <button class="ev-modal-close" id="ev-terms-close">✕</button>
        </div>

        <div style="flex:1; overflow-y:auto; padding:20px; border-top:1px solid var(--ev-border); border-bottom:1px solid var(--ev-border);">
          <div style="background:rgba(236,72,153,0.06); border:1px solid rgba(236,72,153,0.15); border-radius:12px; padding:16px; margin-bottom:16px;">
            <p style="font-size:0.85rem; color:var(--ev-text-primary); margin:0 0 8px; font-weight:600;">⚠️ Action Required</p>
            <p style="font-size:0.82rem; color:var(--ev-text-sec); margin:0; line-height:1.6;">
              You must review and accept the current platform terms before publishing events. Your acceptance will be recorded for compliance purposes.
            </p>
          </div>

          <div style="font-size:0.84rem; color:var(--ev-text-sec); line-height:1.8;">
            <p style="font-weight:600; color:var(--ev-text-primary); margin-bottom:12px;">By accepting these terms, you agree to:</p>
            <ul style="padding-left:20px; margin:0;">
              <li>Provide accurate and complete event information</li>
              <li>Honor all tickets, reservations, and commitments made through the platform</li>
              <li>Respond to attendee inquiries within 48 hours</li>
              <li>Comply with all applicable laws and regulations</li>
              <li>Accept the platform service fee structure</li>
              <li>Process refunds for cancelled events within 14 days</li>
              <li>Not engage in misleading advertising or deceptive practices</li>
              <li>Use the platform's QR code system for event check-in</li>
              <li>Comply with data protection laws (GDPR, CCPA, etc.)</li>
            </ul>
            <p style="margin-top:16px;">
              <a href="/merchant-agreement.html" target="_blank" rel="noopener" style="color:var(--ev-pink); text-decoration:underline; font-weight:500;">
                Read the full Merchant Agreement →
              </a>
            </p>
          </div>
        </div>

        <div style="flex-shrink:0; padding:16px 20px;">
          <label id="ev-terms-checkbox-label" style="display:flex; align-items:flex-start; gap:12px; cursor:pointer; padding:12px 16px; border-radius:10px; border:1px solid var(--ev-border); background:rgba(0,0,0,0.15); margin-bottom:16px; transition:all 0.2s;">
            <input type="checkbox" id="ev-terms-agree" style="width:20px; height:20px; margin-top:2px; accent-color:var(--ev-pink); flex-shrink:0;" />
            <span style="font-size:0.84rem; color:var(--ev-text-primary); line-height:1.5;">
              I have read and agree to the <strong>Eventsli Merchant Agreement</strong> (Version ${escapeHTML(requiredVersion)}). I understand that my acceptance is legally binding.
            </span>
          </label>

          <div style="display:flex; gap:10px;">
            <button class="ev-btn ev-btn-outline" id="ev-terms-cancel" style="flex:1; padding:12px; justify-content:center; border-color:var(--ev-gray); color:var(--ev-text);">Cancel</button>
            <button class="ev-btn ev-btn-pink" id="ev-terms-accept" disabled style="flex:1; padding:12px; justify-content:center; opacity:0.5; cursor:not-allowed;">Accept & Continue Publishing</button>
          </div>
        </div>
      </div>
    `);

    document.body.appendChild(overlay);

    const checkbox = document.getElementById('ev-terms-agree');
    const acceptBtn = document.getElementById('ev-terms-accept');
    const cancelBtn = document.getElementById('ev-terms-cancel');
    const closeBtn = document.getElementById('ev-terms-close');
    const checkboxLabel = document.getElementById('ev-terms-checkbox-label');

    // Toggle accept button based on checkbox
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        acceptBtn.disabled = false;
        acceptBtn.style.opacity = '1';
        acceptBtn.style.cursor = 'pointer';
        checkboxLabel.style.borderColor = 'var(--ev-pink)';
        checkboxLabel.style.background = 'rgba(236,72,153,0.06)';
      } else {
        acceptBtn.disabled = true;
        acceptBtn.style.opacity = '0.5';
        acceptBtn.style.cursor = 'not-allowed';
        checkboxLabel.style.borderColor = 'var(--ev-border)';
        checkboxLabel.style.background = 'rgba(0,0,0,0.15)';
      }
    });

    const cleanup = () => { overlay.remove(); };

    // Cancel / Close
    cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
    closeBtn.addEventListener('click', () => { cleanup(); resolve(false); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); resolve(false); } });

    // Accept
    acceptBtn.addEventListener('click', async () => {
      if (!checkbox.checked) return;
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Accepting…';

      try {
        const { data, error } = await supabase.rpc('accept_platform_terms', {
          p_version: requiredVersion,
          p_ip_address: null,
          p_user_agent: navigator.userAgent || null
        });

        if (error) {
          showToast(`❌ Failed to accept terms: ${error.message}`, 'error');
          acceptBtn.disabled = false;
          acceptBtn.textContent = 'Accept & Continue Publishing';
          return;
        }

        if (data?.error) {
          showToast(`❌ ${data.error}`, 'error');
          acceptBtn.disabled = false;
          acceptBtn.textContent = 'Accept & Continue Publishing';
          return;
        }

        cleanup();
        resolve(true);
      } catch (err) {
        showToast(`❌ Failed to accept terms: ${err.message}`, 'error');
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'Accept & Continue Publishing';
      }
    });
  });
}

export function setupPublishing(getOrchestratorState, switchToPanel) {
  const submitHandler = async (e) => {
    if (isPublishing) return;
    isPublishing = true;
    const isDraft = e.currentTarget.id === 'ce-draft-btn';
    const btn = e.currentTarget;
    if (btn) btn.disabled = true; // Q-1 FIX: Disable immediately to prevent double-click race
    const { ceEditingEventId, ceKeywords, getListingType } = getOrchestratorState();

    // ── VALIDATION ──
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

    const name = document.getElementById('ce-name')?.value.trim();
    if (!name || name.length < 3) markError('ce-name', 'Event name is required (min 3 characters)');
    
    const place = document.getElementById('ce-place')?.value.trim();
    const city = document.getElementById('ce-city')?.value.trim();
    const country = document.getElementById('ce-country')?.value;
    const category = document.getElementById('ce-category')?.value;
    const timezone = document.getElementById('ce-timezone')?.value;
    const organizerName = document.getElementById('ce-organizer-name')?.value.trim();
    const organizerEmail = document.getElementById('ce-organizer-email')?.value.trim();
    const startDate = document.getElementById('ce-start-date')?.value;
    const endDate = document.getElementById('ce-end-date')?.value;
    const showEndTimeVal = document.querySelector('input[name="ce-show-end"]:checked')?.value;
    const listingType = getListingType() || 'display_and_sell';
    const currency = document.getElementById('ce-currency')?.value;

    if (!isDraft) {
      if (!place) markError('ce-place', 'Venue is required');
      if (!city) markError('ce-city', 'City is required');
      if (!country) markError('ce-country', 'Country is required');
      if (!category) markError('ce-category', 'Category is required');
      if (!timezone) markError('ce-timezone', 'Time zone is required');
      if (!organizerName) markError('ce-organizer-name', 'Organizer name is required');
      if (!organizerEmail) markError('ce-organizer-email', 'Organizer email is required');
      if (!startDate) markError('ce-start-date', 'Start date is required');
      if (showEndTimeVal !== 'no' && !endDate) markError('ce-end-date', 'End date is required');
      
      if (listingType !== 'display_only' && !currency) markError('ce-currency', 'Currency is required');

      if (listingType !== 'display_only' && getTicketsList().length === 0) {
        errors.push({ fieldId: 'ce-ticket-name', message: 'At least one ticket is required', tab: 'tickets' });
        showToast('⚠️ You must add at least one ticket before publishing', 'error');
      }
    }

    if (errors.length > 0) {
      const errorNames = errors.map(e => e.message).join('\n• ');
      showToast(`⚠️ Please fix ${errors.length} error(s):\n• ${errorNames}`, 'error');
      
      const firstError = errors[0];
      if (firstError.tab === 'tickets') {
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="tickets"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-tickets')?.classList.add('active');
      } else {
        document.querySelectorAll('[data-ce-tab]').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-ce-tab="basic"]')?.classList.add('active');
        document.querySelectorAll('.ce-step').forEach(s => s.classList.remove('active'));
        document.getElementById('ce-step-basic')?.classList.add('active');
      }
      
      const firstField = document.getElementById(firstError.fieldId);
      if (firstField) firstField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      isPublishing = false;
      // Q-1 FIX: Re-enable button on validation failure
      // (was left disabled, forcing page reload)
      if (btn) { btn.disabled = false; btn.textContent = ceEditingEventId ? 'Update Event' : 'Publish Event'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = ceEditingEventId ? 'Updating…' : 'Publishing…'; }
    const wasEditingForReset = !!ceEditingEventId;

    try {
      const user = await getCurrentUser();
      if (!user) return;

      // ════════════════════════════════════════════════
      // HYBRID PAYMENT: DYNAMIC PAYMENT METHOD SELECTION
      // 1. Checks organizer's Stripe + Manual configuration
      // 2. If BOTH are available → shows preference selector UI
      // 3. If only ONE type → auto-selects it (no UI needed)
      // 4. If NONE → shows warning
      // ════════════════════════════════════════════════
      let acceptedPaymentMethods = [];
      if (!isDraft && listingType !== 'display_only') {
        try {
          const { data: orgProfile } = await supabase
            .from('organizers')
            .select('stripe_account_id, stripe_onboarding_complete, manual_payment_methods')
            .eq('user_id', user.id)
            .maybeSingle();

          // Only include manual methods that have both a method type AND a destination configured
          const configuredManualMethods = (orgProfile?.manual_payment_methods || [])
            .filter(pm => pm.method && pm.destination)
            .map(pm => pm.method);

          const hasStripe = !!(orgProfile?.stripe_account_id && orgProfile?.stripe_onboarding_complete);
          const hasManual = configuredManualMethods.length > 0;

          // Read the organizer's per-event payment preference from the UI
          const prefSection = document.getElementById('ce-payment-pref-section');
          const selectedPref = document.querySelector('input[name="ce-payment-pref"]:checked')?.value;

          if (hasStripe && hasManual) {
            // Both available — use the preference selector
            if (selectedPref === 'stripe_only') {
              acceptedPaymentMethods = ['stripe'];
            } else if (selectedPref === 'manual_only') {
              acceptedPaymentMethods = [...configuredManualMethods];
            } else {
              // 'both' or no selection (default to both)
              acceptedPaymentMethods = ['stripe', ...configuredManualMethods];
            }
          } else if (hasStripe) {
            acceptedPaymentMethods = ['stripe'];
          } else if (hasManual) {
            acceptedPaymentMethods = [...configuredManualMethods];
            const hasPaidTickets = getTicketsList().some(t => parseFloat(t.price) > 0);
            if (hasPaidTickets) {
              showToast('ℹ️ Stripe is not set up — buyers will only see your configured Manual Transfer options. You can connect Stripe later in Settings.', 'info');
            }
          } else {
            // No payment methods configured at all
            const hasPaidTickets = getTicketsList().some(t => parseFloat(t.price) > 0);
            if (hasPaidTickets) {
              showToast('⚠️ No payment methods configured! Buyers won\'t be able to pay. Go to Profile → Payment Methods to set up Stripe or Manual Transfer wallets.', 'error');
            }
          }
        } catch (stripeCheckErr) {
          console.warn('Stripe/payment method check failed (non-blocking):', stripeCheckErr);
        }
      }

      // ════════════════════════════════════════════════
      // BRD RULE: TERMS COMPLIANCE PUBLISHING GATE
      // Block publishing if organizer hasn't accepted current platform terms.
      // BRD Rule 3: Only blocks NEW event publishing, not drafts or running events.
      // ════════════════════════════════════════════════
      if (!isDraft) {
        try {
          const { data: compliance, error: compErr } = await supabase
            .rpc('check_terms_compliance', { p_user_id: user.id });

          if (!compErr && compliance && compliance.compliant === false) {
            const requiredVersion = compliance.required_version || 'latest';
            // Show inline terms acceptance modal instead of navigating away
            const accepted = await showTermsAcceptanceModal(requiredVersion);
            if (!accepted) {
              // User cancelled — stop publishing
              if (btn) { btn.disabled = false; btn.textContent = ceEditingEventId ? 'Update Event' : '🚀 Publish Event'; }
              isPublishing = false;
              return;
            }
            // User accepted — continue with publishing (no return needed)
            showToast('✅ Terms accepted! Continuing to publish…', 'success');
          }
        } catch (termsCheckErr) {
          console.warn('Terms compliance check failed (non-blocking):', termsCheckErr);
          // Don't block for query errors — the Edge Function has a server-side gate too
        }
      }

      const socialLinks = [];
      document.querySelectorAll('#ce-social-links .ce-social-row').forEach(row => {
        const platform = row.querySelector('select')?.value;
        const url = row.querySelector('input[type="url"]')?.value?.trim();
        if (platform && url) socialLinks.push({ platform, url });
      });

      const performersData = [];
      document.querySelectorAll('#ce-performers-container .ce-performer-row').forEach(row => {
        const name = row.querySelector('.perf-name')?.value?.trim();
        if (!name) return;
        const role = row.querySelector('.perf-role')?.value?.trim() || '';
        const fileInput = row.querySelector('.perf-upload');
        const existingUrl = row.dataset.existingUrl || null;
        performersData.push({ name, role, existingUrl, _fileInput: fileInput });
      });

      const showEndTime = document.querySelector('input[name="ce-show-end"]:checked')?.value !== 'no';

      const eventData = {
        organizer_id: user.id,
        title: name,
        short_description: document.getElementById('ce-short-desc')?.value.trim() || null,
        description: sanitizeDescriptionHTML(document.getElementById('ce-overview')?.innerHTML || ''),
        venue: place || null,
        venue_address: document.getElementById('ce-address')?.value.trim() || null,
        city: city || null,
        date: startDate ? new Date(startDate).toISOString() : null,
        category: category || 'general',
        age_policy: document.getElementById('ce-age-policy')?.value || null,
        language: document.getElementById('ce-language')?.value || null,
        status: isDraft ? 'draft' : 'published',
        is_private: document.getElementById('ce-is-private')?.value === 'true',
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
        organizer_name: organizerName || null,
        organizer_email: document.getElementById('ce-organizer-email')?.value.trim() || null,
        organizer_phone: document.getElementById('ce-organizer-phone')?.value.trim() || null,
        organizer_website: document.getElementById('ce-organizer-website')?.value.trim() || null,
        organizer_bio: document.getElementById('ce-organizer-bio')?.value.trim() || null,
        performers: performersData.map(p => ({ name: p.name, role: p.role, image_url: p.existingUrl })),
        policies: {
          guests_vips: document.getElementById('ce-policy-guests')?.value.trim() || null,
          refund_policy: document.getElementById('ce-policy-refund')?.value.trim() || null,
          refund_deadline: document.getElementById('ce-policy-refund-deadline')?.value || null,
          cancellation_policy: document.getElementById('ce-policy-cancellation')?.value.trim() || null,
          reentry_policy: document.getElementById('ce-policy-reentry')?.value || null,
          seating_type: document.getElementById('ce-policy-seating')?.value || null,
          children_policy: document.getElementById('ce-policy-children')?.value.trim() || null,
          security_notes: document.getElementById('ce-policy-security')?.value.trim() || null,
          entry_requirements: document.getElementById('ce-policy-entry')?.value.trim() || null,
          parking_info: document.getElementById('ce-policy-parking')?.value.trim() || null,
          important_instructions: document.getElementById('ce-policy-instructions')?.value.trim() || null
        },
        // HYBRID PAYMENT: Set accepted payment methods based on organizer's Stripe status
        accepted_payment_methods: (listingType !== 'display_only') ? acceptedPaymentMethods : null
      };

      let event;
      if (ceEditingEventId) {
        const allUpdates = { ...eventData };
        delete allUpdates.organizer_id;
        allUpdates.admin_approved = false; // Send back to approval queue
        event = await updateEvent(ceEditingEventId, allUpdates);
      } else {
        event = await createEvent(eventData);
      }

      // ── Image Uploads ──
      const imageUpdates = {};
      if (getPendingCoverFile()) {
        const coverUrl = await uploadCoverImage(event.id);
        if (coverUrl) imageUpdates.cover_image = coverUrl;
      }
      const logoInput = document.getElementById('ce-logo');
      if (logoInput?.files?.[0]) {
        const logoUrl = await uploadEventFile(event.id, logoInput.files[0], 'logo');
        if (logoUrl) imageUpdates.logo_url = logoUrl;
      }
      
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

      const orgLogoInput = document.getElementById('ce-organizer-logo');
      if (orgLogoInput?.files?.[0]) {
        const orgLogoUrl = await uploadEventFile(event.id, orgLogoInput.files[0], 'organizer_logo');
        if (orgLogoUrl) imageUpdates.organizer_logo_url = orgLogoUrl;
      }

      // Upload performers images
      let performersUpdated = false;
      for (let i = 0; i < performersData.length; i++) {
        const p = performersData[i];
        if (p._fileInput && p._fileInput.files?.[0]) {
          const url = await uploadEventFile(event.id, p._fileInput.files[0], `performer_${i}_${Date.now()}`);
          if (url) {
            p.image_url = url;
            performersUpdated = true;
          }
        } else {
          p.image_url = p.existingUrl; // keep existing if no new file
        }
      }
      if (performersUpdated) {
        imageUpdates.performers = performersData.map(p => ({ name: p.name, role: p.role, image_url: p.image_url }));
      }

      if (Object.keys(imageUpdates).length > 0) {
        try {
          await supabase.from('events').update(imageUpdates).eq('id', event.id);
        } catch (imgCatchErr) {
          console.warn('Image fields update skipped:', imgCatchErr.message);
        }
      }

      // ── Tickets ──
      const ticketType = document.querySelector('.ce-ticket-card.selected input')?.value || 'normal';
      if (listingType !== 'display_only' && getTicketsList().length > 0) {
        if (ceEditingEventId) {
          const { data: existingTiers } = await supabase.from('ticket_tiers').select('id, sold_count').eq('event_id', event.id);
          const tiersToDelete = (existingTiers || []).filter(tier => (tier.sold_count || 0) === 0).map(t => t.id);
          if (tiersToDelete.length > 0) {
            await supabase.from('ticket_tiers').delete().in('id', tiersToDelete);
          }
          const remainingIds = (existingTiers || []).filter(t => (t.sold_count || 0) > 0).map(t => t.id);
          const tierPayloads = getTicketsList().map(t => ({
            ...(t.id && remainingIds.includes(t.id) ? { id: t.id } : {}),
            event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
            ticket_type: ticketType, category: t.category || null,
            early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
            early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
            max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
            currency: t.currency || 'USD',
            description: t.desc || null,
            min_purchase: t.minPurchase || 1,
            max_purchase: t.maxPurchase || 10,
            sales_start: t.salesStart ? new Date(t.salesStart).toISOString() : null,
            sales_end: t.salesEnd ? new Date(t.salesEnd).toISOString() : null,
            is_hidden: t.isHidden || false,
            seating_type: t.seatingType || 'general'
          }));
          await supabase.from('ticket_tiers').upsert(tierPayloads);
        } else {
          const tierPayloads = getTicketsList().map(t => ({
            event_id: event.id, name: t.name, price: t.price, capacity: t.qty,
            ticket_type: ticketType, category: t.category || null,
            early_bird_price: t.earlyPrice ? parseFloat(t.earlyPrice) : null,
            early_bird_end: t.earlyEnd ? new Date(t.earlyEnd).toISOString() : null,
            max_scans: parseInt(document.getElementById('ce-max-scans')?.value) || 1,
            currency: t.currency || 'USD',
            description: t.desc || null,
            min_purchase: t.minPurchase || 1,
            max_purchase: t.maxPurchase || 10,
            sales_start: t.salesStart ? new Date(t.salesStart).toISOString() : null,
            sales_end: t.salesEnd ? new Date(t.salesEnd).toISOString() : null,
            is_hidden: t.isHidden || false,
            seating_type: t.seatingType || 'general'
          }));
          await supabase.from('ticket_tiers').insert(tierPayloads);
        }
      }

      // ── Promo Codes ──
      const promoCodes = getPromoCodesList();
      if (promoCodes.length > 0) {
        if (ceEditingEventId) {
          // Delete existing promo codes and recreate
          await supabase.from('promo_codes').delete().eq('event_id', event.id);
        }
        const promoPayloads = promoCodes.map(p => ({
          event_id: event.id,
          code: p.code,
          discount_type: p.type,
          discount_value: p.value,
          max_uses: p.maxUses || null
        }));
        await supabase.from('promo_codes').insert(promoPayloads);
      }

      if (!isDraft) {
        // If they published a paid event with NO configured payment methods, trigger the unconfigured payments email
        const hasPaidTickets = getTicketsList().some(t => parseFloat(t.price) > 0);
        if (acceptedPaymentMethods.length === 0 && hasPaidTickets) {
          try {
            const { data: rpcRes, error: rpcErr } = await supabase.rpc('send_unconfigured_payments_email', { p_event_id: event.id });
            if (rpcErr) {
              console.warn('Failed to trigger unconfigured payments email:', rpcErr.message);
            } else {
              console.debug('Unconfigured payments email triggered successfully');
            }
          } catch (rpcCatch) {
            console.warn('Failed to call send_unconfigured_payments_email RPC:', rpcCatch);
          }
        }
      }

      if (isDraft) {
        showToast('📝 Draft saved successfully!', 'success');
      } else {
        showToast(wasEditingForReset ? 'Event updated successfully!' : '🎉 Event submitted! It will appear publicly once approved by admin.', 'success');
      }
      
      // Clear edit state in orchestrator (requires callback)
      getOrchestratorState().clearEditState();
      
      // Reset form so the wizard is clean next time
      if (getOrchestratorState().resetForm) {
        getOrchestratorState().resetForm();
      }

      switchToPanel(isDraft ? 'drafts' : 'events');
      await emitDashboardAction('refreshDashboard');

      if (!wasEditingForReset && !isDraft) {
        setTimeout(() => { document.getElementById('services-modal')?.classList.add('active'); }, 600);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = isDraft ? '📝 Save as Draft' : (wasEditingForReset ? 'Update Event' : '🚀 Publish Event'); }
      isPublishing = false;
    }
  };

  document.getElementById('ce-publish-btn')?.addEventListener('click', submitHandler);
  document.getElementById('ce-draft-btn')?.addEventListener('click', submitHandler);

  // ════════════════════════════════════════════════
  // STRIPE CONNECT ONBOARDING — Full Integration
  // Replaces placeholder. Calls stripe-onboarding Edge Function,
  // redirects organizer to Stripe, and handles return.
  // ════════════════════════════════════════════════

  const stripeBtn = document.getElementById('ce-complete-verify');
  const stripeSection = document.getElementById('ce-stripe-section');
  const stripeBadge = stripeSection?.querySelector('.ev-badge');
  const stripeReqs = stripeSection?.querySelector('.ce-stripe-reqs');
  const stripeDesc = stripeSection?.querySelector('.ce-stripe-header p');

  /**
   * Check Stripe onboarding status and update UI accordingly.
   */
  async function checkStripeStatus() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/stripe-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'check-status' }),
      });

      if (!res.ok) return;
      const data = await res.json();

      if (data.onboarding_complete) {
        // ── Stripe fully connected ──
        if (stripeBadge) {
          stripeBadge.textContent = 'Connected';
          stripeBadge.className = 'ev-badge success';
        }
        if (stripeDesc) stripeDesc.textContent = 'Your Stripe account is verified and ready to accept payments.';
        if (stripeReqs) stripeReqs.style.display = 'none';
        if (stripeBtn) {
          stripeBtn.textContent = '✅ Stripe Connected';
          stripeBtn.disabled = true;
          stripeBtn.style.opacity = '0.7';
        }
        // Hide the "missing requirements" text
        const missingText = stripeSection?.querySelector('p[style*="missing"]');
        if (missingText) missingText.style.display = 'none';
        // Hide the "use different account" text
        const diffText = stripeSection?.querySelectorAll('p');
        diffText?.forEach(p => {
          if (p.textContent.includes('different account')) p.style.display = 'none';
        });
      } else if (data.status === 'pending') {
        // ── Stripe account created but onboarding incomplete ──
        if (stripeBadge) {
          stripeBadge.textContent = 'Pending';
          stripeBadge.className = 'ev-badge pending';
        }
        if (stripeDesc) stripeDesc.textContent = 'Your Stripe account was created but onboarding is not complete. Click below to finish.';
        if (stripeBtn) stripeBtn.textContent = 'Continue Verification';
      }
      // status === 'not_started' → leave defaults
    } catch (err) {
      console.warn('Stripe status check failed (non-blocking):', err);
    }
  }

  /**
   * Initiate Stripe onboarding — creates account if needed, redirects to Stripe.
   */
  if (stripeBtn) {
    stripeBtn.addEventListener('click', async () => {
      const originalText = stripeBtn.textContent;
      stripeBtn.disabled = true;
      stripeBtn.textContent = 'Connecting to Stripe…';

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          showToast('⚠️ Please sign in again to connect Stripe.', 'error');
          return;
        }

        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/stripe-onboarding`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: 'onboard' }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error: ${res.status}`);
        }

        const data = await res.json();

        if (data.url) {
          showToast('🔗 Redirecting to Stripe…', 'info');
          // Short delay so user sees the toast
          setTimeout(() => { window.location.href = data.url; }, 400);
        } else {
          throw new Error('No onboarding URL returned from Stripe');
        }
      } catch (err) {
        console.error('Stripe onboarding error:', err);
        showToast(`❌ Stripe connection failed: ${err.message}`, 'error');
        stripeBtn.disabled = false;
        stripeBtn.textContent = originalText;
      }
    });
  }

  // ── Handle return from Stripe onboarding ──
  const urlParams = new URLSearchParams(window.location.search);
  const stripeReturn = urlParams.get('stripe');

  if (stripeReturn === 'complete') {
    // User returned from Stripe — check status
    showToast('🔄 Checking your Stripe verification status…', 'info');
    checkStripeStatus().then(() => {
      showToast('✅ Stripe status updated!', 'success');
    });
    // Clean up the URL
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  } else if (stripeReturn === 'refresh') {
    // User clicked "refresh" link on Stripe
    showToast('⚠️ Stripe onboarding was interrupted. Click "Complete Verification" to continue.', 'error');
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);
  }

  /**
   * Populate the Payment Preference selector card on the Publishing tab.
   * Only shows when the organizer has BOTH Stripe and Manual methods configured.
   * When only one type is available, auto-selects it (no UI needed).
   */
  async function populatePaymentPreference() {
    const section = document.getElementById('ce-payment-pref-section');
    const container = document.getElementById('ce-payment-pref-options');
    const note = document.getElementById('ce-payment-pref-note');
    if (!section || !container) return;

    try {
      const user = await getCurrentUser();
      if (!user) return;

      const { data: orgProfile } = await supabase
        .from('organizers')
        .select('stripe_account_id, stripe_onboarding_complete, manual_payment_methods')
        .eq('user_id', user.id)
        .maybeSingle();

      const hasStripe = !!(orgProfile?.stripe_account_id && orgProfile?.stripe_onboarding_complete);
      const configuredManual = (orgProfile?.manual_payment_methods || [])
        .filter(pm => pm.method && pm.destination);
      const hasManual = configuredManual.length > 0;

      // Only show selector when BOTH types are available
      if (!hasStripe || !hasManual) {
        section.style.display = 'none';
        return;
      }

      // Build manual methods summary
      const methodLabels = {
        vodafone_cash: 'Vodafone Cash', instapay: 'InstaPay',
        bank_transfer: 'Bank Transfer', fawry: 'Fawry', other: 'Other'
      };
      // M11 FIX: Escape method names to prevent stored XSS via JSONB
      const manualSummary = escapeHTML(configuredManual.map(pm => methodLabels[pm.method] || pm.method).join(', '));

      section.style.display = '';
      container.innerHTML = `
        <label class="ce-pref-card ce-pref-selected" style="display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-radius:14px;border:2px solid var(--ev-pink,#ec4899);background:rgba(236,72,153,0.04);cursor:pointer;transition:all .2s">
          <input type="radio" name="ce-payment-pref" value="both" checked style="margin-top:3px;accent-color:var(--ev-pink,#ec4899);width:18px;height:18px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:1rem">💳📱</span>
              <strong style="font-size:.9rem">All Payment Methods</strong>
              <span style="font-size:.65rem;padding:2px 8px;border-radius:6px;background:linear-gradient(135deg,#ec4899,#8b5cf6);color:#fff;font-weight:600">Recommended</span>
            </div>
            <p style="margin:0;font-size:.8rem;color:var(--ev-text-sec);line-height:1.5">Buyers can pay with Stripe (Credit/Debit Card) or Manual Transfer (${manualSummary})</p>
          </div>
        </label>
        <label class="ce-pref-card" style="display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-radius:14px;border:2px solid var(--ev-border);background:transparent;cursor:pointer;transition:all .2s">
          <input type="radio" name="ce-payment-pref" value="stripe_only" style="margin-top:3px;accent-color:var(--ev-pink,#ec4899);width:18px;height:18px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:1rem">💳</span>
              <strong style="font-size:.9rem">Stripe Only</strong>
            </div>
            <p style="margin:0;font-size:.8rem;color:var(--ev-text-sec);line-height:1.5">Buyers can only pay with Credit/Debit Card via Stripe. Instant confirmation.</p>
          </div>
        </label>
        <label class="ce-pref-card" style="display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-radius:14px;border:2px solid var(--ev-border);background:transparent;cursor:pointer;transition:all .2s">
          <input type="radio" name="ce-payment-pref" value="manual_only" style="margin-top:3px;accent-color:var(--ev-pink,#ec4899);width:18px;height:18px;flex-shrink:0">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <span style="font-size:1rem">📱</span>
              <strong style="font-size:.9rem">Manual Transfer Only</strong>
            </div>
            <p style="margin:0;font-size:.8rem;color:var(--ev-text-sec);line-height:1.5">Buyers pay via ${manualSummary}. Requires your manual approval.</p>
          </div>
        </label>
      `;

      if (note) note.textContent = 'You can change this for each event. Your configured methods are managed in Profile → Payment Methods.';

      // Handle card selection styling
      const cards = container.querySelectorAll('.ce-pref-card');
      const radios = container.querySelectorAll('input[name="ce-payment-pref"]');
      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          cards.forEach(card => {
            card.style.borderColor = 'var(--ev-border)';
            card.style.background = 'transparent';
            card.classList.remove('ce-pref-selected');
          });
          const selectedCard = radio.closest('.ce-pref-card');
          if (selectedCard) {
            selectedCard.style.borderColor = 'var(--ev-pink, #ec4899)';
            selectedCard.style.background = 'rgba(236,72,153,0.04)';
            selectedCard.classList.add('ce-pref-selected');
          }
        });
      });
    } catch (err) {
      console.warn('Payment preference check failed (non-blocking):', err);
      section.style.display = 'none';
    }
  }

  // ── Auto-check status on Publishing tab load ──
  checkStripeStatus();
  populatePaymentPreference();
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
  
  const mainImg = document.getElementById('ce-main-photo-area')?.querySelector('img');
  const previewImgDiv = document.getElementById('ce-preview-img');
  if (mainImg && previewImgDiv) {
    let pImg = previewImgDiv.querySelector('img');
    if (!pImg) { pImg = document.createElement('img'); previewImgDiv.textContent = ''; previewImgDiv.appendChild(pImg); }
    pImg.src = mainImg.src;
  }
}
