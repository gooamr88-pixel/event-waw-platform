/* ===================================
   EVENTSLI — Wizard Publishing & Validation
   =================================== */

import { supabase, getCurrentUser } from './supabase.js';
import { createEvent, updateEvent } from './events.js';
import { showToast } from './dashboard-ui.js';
import { emitDashboardAction } from './dashboard-bus.js';
import { getTicketsList, getPromoCodesList } from './wizard-tickets.js';
import { uploadCoverImage, uploadEventFile, getPendingCoverFile } from './wizard-uploads.js';
import DOMPurify from 'https://esm.sh/dompurify@3.2.4';

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

export function setupPublishing(getOrchestratorState, switchToPanel) {
  document.getElementById('ce-publish-btn')?.addEventListener('click', async (e) => {
    if (isPublishing) return;
    isPublishing = true;
    const btn = document.getElementById('ce-publish-btn');
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
    if (!place) markError('ce-place', 'Venue is required');
    const city = document.getElementById('ce-city')?.value.trim();
    if (!city) markError('ce-city', 'City is required');
    const country = document.getElementById('ce-country')?.value;
    if (!country) markError('ce-country', 'Country is required');
    const category = document.getElementById('ce-category')?.value;
    if (!category) markError('ce-category', 'Category is required');
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

    const listingType = getListingType() || 'display_and_sell';
    const currency = document.getElementById('ce-currency')?.value;
    if (listingType !== 'display_only' && !currency) markError('ce-currency', 'Currency is required');

    if (listingType !== 'display_only' && getTicketsList().length === 0) {
      errors.push({ fieldId: 'ce-ticket-name', message: 'At least one ticket is required', tab: 'tickets' });
      showToast('⚠️ You must add at least one ticket before publishing', 'error');
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
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = ceEditingEventId ? 'Updating…' : 'Publishing…'; }
    const wasEditingForReset = !!ceEditingEventId;

    try {
      const user = await getCurrentUser();
      if (!user) return;

      // ════════════════════════════════════════════════
      // BRD RULE 4: STRIPE CONNECT PUBLISHING GATE
      // Block publishing ticketed events if organizer hasn't
      // completed Stripe Connect onboarding. Without this,
      // payments go to the platform instead of the organizer.
      // ════════════════════════════════════════════════
      if (listingType !== 'display_only') {
        try {
          const { data: orgProfile } = await supabase
            .from('organizers')
            .select('stripe_account_id, stripe_onboarding_complete')
            .eq('user_id', user.id)
            .maybeSingle();

          if (!orgProfile?.stripe_account_id || !orgProfile?.stripe_onboarding_complete) {
            // Check if any ticket has price > 0 (free events don't need Stripe)
            const hasPaidTickets = getTicketsList().some(t => parseFloat(t.price) > 0);
            if (hasPaidTickets) {
              showToast('⚠️ You must complete Stripe Connect setup before publishing paid events. Go to Settings → Payment Setup.', 'error');
              if (btn) { btn.disabled = false; btn.textContent = ceEditingEventId ? 'Update Event' : 'Publish Event'; }
              isPublishing = false;
              return;
            }
          }
        } catch (stripeCheckErr) {
          console.warn('Stripe onboarding check failed (non-blocking):', stripeCheckErr);
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
        venue: place,
        venue_address: document.getElementById('ce-address')?.value.trim() || null,
        city: city,
        date: new Date(startDate).toISOString(),
        category: category || 'general',
        age_policy: document.getElementById('ce-age-policy')?.value || null,
        language: document.getElementById('ce-language')?.value || null,
        status: 'published',
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
        }
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

      showToast(wasEditingForReset ? 'Event updated successfully!' : '🎉 Event submitted! It will appear publicly once approved by admin.', 'success');
      
      // Clear edit state in orchestrator (requires callback)
      getOrchestratorState().clearEditState();
      switchToPanel('events');
      await emitDashboardAction('refreshDashboard');

      if (!wasEditingForReset) {
        setTimeout(() => { document.getElementById('services-modal')?.classList.add('active'); }, 600);
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = wasEditingForReset ? 'Update Event' : 'Publish Event'; }
      isPublishing = false;
    }
  });

  // ════════════════════════════════════════════════
  // STRIPE CONNECT ONBOARDING — Full Integration
  // Replaces placeholder. Calls stripe-onboarding Edge Function,
  // redirects organizer to Stripe, and handles return.
  // ════════════════════════════════════════════════

  const SUPABASE_FUNCTIONS_URL = 'https://bmtwdwoibvoewbesohpu.supabase.co/functions/v1';
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

  // ── Auto-check status on Publishing tab load ──
  checkStripeStatus();
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
