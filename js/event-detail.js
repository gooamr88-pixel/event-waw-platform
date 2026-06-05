import { supabase, resolveImageUrl } from '../src/lib/supabase.js';
import { getEvent, createCheckout, createGuestCheckout, createSeatedCheckout, createGuestSeatedCheckout } from '../src/lib/events.js';
import { getOrderBreakdown, renderPriceBreakdown, injectBreakdownStyles } from '../src/lib/price-breakdown.js';
import { initSeatingUI, getCachedSeatBreakdown } from '../src/lib/seating-ui.js?v=7';
import { semiProtectPage, updateNavForAuth } from '../src/lib/guard.js';
import { initUI } from '../src/lib/ui.js';
import { escapeHTML, formatCurrency } from '../src/lib/utils.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { showManualCheckoutModal } from '../src/lib/manual-checkout.js?v=2';
import { showAlertModal } from '../src/lib/ui-modals.js';

let eventData = null;
let quantities = {};
let authState = null;

window.openLightbox = function(src) {
  if(!src) return;
  // D-2 FIX: Block javascript: and data: schemes
  try {
    const url = new URL(src, window.location.origin);
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) return;
  } catch { return; }
  document.getElementById('lightbox-img').src = src;
  const modal = document.getElementById('lightbox-modal');
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));
};

document.getElementById('lightbox-close').addEventListener('click', () => {
  const modal = document.getElementById('lightbox-modal');
  modal.classList.remove('show');
  setTimeout(() => modal.style.display = 'none', 300);
});

document.getElementById('lightbox-modal').addEventListener('click', (e) => {
  if(e.target === document.getElementById('lightbox-modal')) {
    const modal = document.getElementById('lightbox-modal');
    modal.classList.remove('show');
    setTimeout(() => modal.style.display = 'none', 300);
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  initUI();

  authState = await semiProtectPage();
  updateNavForAuth(authState);
  
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('id');
  
  if (!eventId) {
    window.location.href = 'dashboard.html';
    return;
  }

  await loadEvent(eventId);
});

async function loadEvent(eventId) {
  try {
    eventData = await getEvent(eventId);
    await renderEvent(eventData);
  } catch (err) {
    console.error('Error loading event:', err);
    renderDemoEvent(eventId);
  }
}

async function renderEvent(event) {
  document.title = `${event.title} — Eventsli`;
  document.getElementById('event-cover').src = event.cover_image || event.cover_url || 'images/event-concert.png';
  document.getElementById('event-cover-blur').src = document.getElementById('event-cover').src;
  
  // Make hero cover clickable for lightbox
  document.getElementById('event-cover').addEventListener('click', () => {
    window.openLightbox(document.getElementById('event-cover').src);
  });

  // Resolve Supabase storage URLs (handles private buckets)
  const rawCover = event.cover_image || event.cover_url || null;
  if (rawCover) {
    resolveImageUrl(rawCover).then(resolved => {
      if (resolved) {
        document.getElementById('event-cover').src = resolved;
        document.getElementById('event-cover-blur').src = resolved;
      }
    }).catch(() => {});
  }
  // Fallback for broken images
  document.getElementById('event-cover').onerror = function() { 
    this.onerror = null; 
    this.src = 'images/event-concert.png'; 
    document.getElementById('event-cover-blur').src = 'images/event-concert.png';
  };
  document.getElementById('event-title').textContent = event.title;
  document.getElementById('event-category').textContent = event.category || 'Event';
  // Render short description blurb

  if (event.short_description) {

    const shortDescSection = document.getElementById('ed-short-desc-section');

    const shortDescEl = document.getElementById('event-short-description');

    if (shortDescSection && shortDescEl) {

      shortDescEl.textContent = event.short_description;

      shortDescSection.style.display = 'block';

    }

  }



  // Render rich HTML description securely (supports bold, italic, links from editor)
  const descEl = document.getElementById('event-description');
  if (event.description && /<[a-z][\s\S]*>/i.test(event.description)) {
    setSafeHTML(descEl, event.description);
    // Make description images clickable
    descEl.querySelectorAll('img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => window.openLightbox(img.src));
    });
  } else {
    descEl.textContent = event.description || 'No description available.';
  }

  // Dynamic SEO: update page title + OG meta tags for social sharing
  document.title = `${event.title} — Eventsli`;
  const ogTitle = document.getElementById('og-title');
  const ogDesc = document.getElementById('og-desc');
  const ogImage = document.getElementById('og-image');
  if (ogTitle) ogTitle.setAttribute('content', `${event.title} — Eventsli`);
  if (ogDesc) ogDesc.setAttribute('content', event.short_description || event.description || `Book tickets for ${event.title} on Eventsli.`);
  if (ogImage && event.cover_image) ogImage.setAttribute('content', event.cover_image);

  // Check if description needs "See more"
  requestAnimationFrame(() => {
    const descWrap = document.getElementById('event-description-wrap');
    const descToggle = document.getElementById('desc-toggle');
    if (descWrap.scrollHeight > 130) {
      descToggle.style.display = 'block';
      descToggle.addEventListener('click', () => {
        const expanded = descWrap.classList.toggle('expanded');
        descToggle.textContent = expanded ? 'See less' : 'See more';
      });
    } else {
      descWrap.classList.add('expanded');
    }
  });

  // Date & Time info cards
  const date = new Date(event.date);
  document.getElementById('ed-date').textContent = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('ed-time').textContent = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // Doors open
  if (event.doors_open) {
    document.getElementById('ed-doors-card').style.display = 'flex';
    const doorsDate = new Date(event.doors_open);
    // If it's a valid date, format it. Otherwise, show it as is.
    if (!isNaN(doorsDate.getTime())) {
      document.getElementById('ed-doors').textContent = doorsDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else {
      document.getElementById('ed-doors').textContent = event.doors_open;
    }
  }

  // Venue & location
  document.getElementById('ed-venue-name').textContent = event.venue;
  const address = event.venue_address ? `${event.venue_address}${event.city ? ', ' + event.city : ''}` : (event.city || '');
  document.getElementById('ed-location').textContent = address || event.venue;

  // Organizer
  const orgName = event.organizer_name || event.profiles?.full_name || 'Eventsli';
  document.getElementById('ed-organizer').textContent = `By: ${orgName}`;

  // Age Policy
  if (event.age_policy) {
    document.getElementById('ed-age-policy-card').style.display = 'flex';
    let ageText = event.age_policy;
    if (ageText === 'family') ageText = 'Family Friendly';
    else if (ageText === 'adults_only') ageText = 'Adults Only';
    else if (ageText.endsWith('+')) ageText = `${ageText} Years`;
    document.getElementById('ed-age-policy').textContent = ageText;
  }

  // Language
  if (event.language) {
    document.getElementById('ed-language-card').style.display = 'flex';
    let langText = event.language;
    if (langText === 'Bilingual') langText = 'Bilingual (Ar/En)';
    document.getElementById('ed-language').textContent = langText;
  }

  // Hero bar
  const dateText = `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const dateEl = document.getElementById('event-date');
  dateEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> `;
  dateEl.appendChild(document.createTextNode(dateText));
  const venueEl = document.getElementById('event-venue');
  venueEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg> `;
  venueEl.appendChild(document.createTextNode(event.venue));

  // Policies & Rules
  let policiesObj = event.policies;
  if (typeof policiesObj === 'string') {
    try { policiesObj = JSON.parse(policiesObj); } catch { policiesObj = null; }
  }
  if (policiesObj && typeof policiesObj === 'object' && Object.values(policiesObj).some(val => val && val.trim() !== '')) {
    const policiesSection = document.getElementById('ed-policies-section');
    const policiesContainer = document.getElementById('ed-policies-container');
    policiesContainer.textContent = '';
    policiesSection.style.display = 'block';

    const addPolicy = (title, text, icon) => {
      if (!text || text.trim() === '') return;
      const div = document.createElement('div');
      div.className = 'ed-policy-card';
      div.innerHTML = `
        <div class="ed-policy-header">
          <span class="ed-policy-icon">${icon}</span>
          <span class="ed-policy-title">${title}</span>
        </div>
        <div class="ed-policy-body">${escapeHTML(text)}</div>
      `;
      policiesContainer.appendChild(div);
    };

    let refundText = policiesObj.refund_policy;
    if (policiesObj.refund_deadline) {
      const deadline = new Date(policiesObj.refund_deadline).toLocaleString();
      refundText = refundText ? `${refundText}\nDeadline: ${deadline}` : `Deadline: ${deadline}`;
    }
    
    addPolicy('Guests & VIPs', policiesObj.guests_vips, '✨');
    addPolicy('Refund Policy', refundText, '💸');
    addPolicy('Cancellation Policy', policiesObj.cancellation_policy, '❌');
    addPolicy('Re-entry Policy', policiesObj.reentry_policy, '🚪');
    addPolicy('Seating Type', policiesObj.seating_type, '🪑');
    addPolicy('Children Policy', policiesObj.children_policy, '👶');
    addPolicy('Security Notes', policiesObj.security_notes, '🛡️');
    addPolicy('Entry Requirements', policiesObj.entry_requirements, '🎟️');
    addPolicy('Parking Information', policiesObj.parking_info, '🅿️');
    addPolicy('Important Instructions', policiesObj.important_instructions, 'ℹ️');
  }

  // ── Event Logo ──
  if (event.logo_url) {
    const logoSection = document.getElementById('ed-logo-section');
    const logoImg = document.getElementById('ed-event-logo');
    const logoTitle = document.getElementById('ed-logo-title');
    logoTitle.textContent = event.title;
    resolveImageUrl(event.logo_url).then(resolved => {
      logoImg.src = resolved || event.logo_url;
      logoImg.onerror = () => { logoSection.style.display = 'none'; };
      logoSection.style.display = 'block';
      logoImg.style.cursor = 'zoom-in';
      logoImg.addEventListener('click', () => window.openLightbox(logoImg.src));
    }).catch(() => {});
  }

  // ── Gallery Images ──
  let galleryArr = event.gallery_urls;
  if (typeof galleryArr === 'string') {
    try { galleryArr = JSON.parse(galleryArr); } catch { galleryArr = null; }
  }
  if (Array.isArray(galleryArr) && galleryArr.length) {
    // Deduplicate URLs
    const uniqueGallery = [...new Set(galleryArr)];
    const gallerySection = document.getElementById('ed-gallery-section');
    const galleryGrid = document.getElementById('ed-gallery-grid');
    galleryGrid.textContent = '';
    gallerySection.style.display = 'block';
    // C-07 FIX: Batch resolve all gallery images in parallel
    const resolvedGallery = await Promise.all(uniqueGallery.map(url => resolveImageUrl(url)));
    resolvedGallery.forEach(resolved => {
      if (resolved) {
        const img = document.createElement('img');
        img.src = resolved;
        img.alt = 'Gallery image';
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        img.addEventListener('click', () => window.openLightbox(img.src));
        galleryGrid.appendChild(img);
      }
    });
  }

  // ── Performers ──
  let performersArr = event.performers;
  if (typeof performersArr === 'string') {
    try { performersArr = JSON.parse(performersArr); } catch { performersArr = null; }
  }
  if (Array.isArray(performersArr) && performersArr.length) {
    const perfSection = document.getElementById('ed-performers-section');
    const perfGrid = document.getElementById('ed-performers-grid');
    perfGrid.textContent = '';
    perfSection.style.display = 'block';
    // C-07 FIX: Batch resolve all performer images in parallel
    const perfImageUrls = performersArr.map(p => p.image_url ? resolveImageUrl(p.image_url) : Promise.resolve(null));
    const resolvedPerfImages = await Promise.all(perfImageUrls);
    performersArr.forEach((p, idx) => {
      const card = document.createElement('div');
      card.style.textAlign = 'center';
      
      const imgWrap = document.createElement('div');
      imgWrap.style.width = '80px';
      imgWrap.style.height = '80px';
      imgWrap.style.margin = '0 auto 8px';
      imgWrap.style.borderRadius = '50%';
      imgWrap.style.overflow = 'hidden';
      imgWrap.style.background = 'var(--bg-card, rgba(255,255,255,.05))';
      imgWrap.style.border = '1px solid var(--border-color, rgba(255,255,255,.1))';
      imgWrap.style.display = 'flex';
      imgWrap.style.alignItems = 'center';
      imgWrap.style.justifyContent = 'center';

      const resolved = resolvedPerfImages[idx];
      if (p.image_url && resolved) {
        const img = document.createElement('img');
        img.src = resolved;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        imgWrap.appendChild(img);
      } else {
        imgWrap.innerHTML = '<span style="font-size: 2rem;">👤</span>';
      }

      const name = document.createElement('div');
      name.style.fontWeight = '700';
      name.style.fontSize = '0.95rem';
      name.textContent = p.name;

      const role = document.createElement('div');
      role.style.fontSize = '0.8rem';
      role.style.color = 'var(--text-muted)';
      role.textContent = p.role;

      card.appendChild(imgWrap);
      card.appendChild(name);
      card.appendChild(role);
      perfGrid.appendChild(card);
    });
  }

  // ── Sponsor Logos ──
  let sponsorArr = event.sponsor_urls;
  if (typeof sponsorArr === 'string') {
    try { sponsorArr = JSON.parse(sponsorArr); } catch { sponsorArr = null; }
  }
  if (Array.isArray(sponsorArr) && sponsorArr.length) {
    // Deduplicate URLs
    const uniqueSponsors = [...new Set(sponsorArr)];
    const sponsorsSection = document.getElementById('ed-sponsors-section');
    const sponsorsGrid = document.getElementById('ed-sponsors-grid');
    sponsorsGrid.textContent = '';
    sponsorsSection.style.display = 'block';
    // C-07 FIX: Batch resolve all sponsor images in parallel
    const resolvedSponsors = await Promise.all(uniqueSponsors.map(url => resolveImageUrl(url)));
    resolvedSponsors.forEach(resolved => {
      if (resolved) {
        const img = document.createElement('img');
        img.src = resolved;
        img.alt = 'Sponsor';
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        sponsorsGrid.appendChild(img);
      }
    });
  }

  // ── Map Location ──
  if (event.latitude && event.longitude) {
    const mapSection = document.getElementById('ed-map-section');
    const mapRender = document.getElementById('ed-map-render');
    const mapBar = document.getElementById('ed-map-bar');
    if (mapSection && mapRender) {
      mapSection.style.display = 'block';

      const lat = parseFloat(event.latitude);
      const lng = parseFloat(event.longitude);
      const venueName = event.venue || 'Event Location';
      const venueAddr = event.venue_address
        ? `${event.venue_address}${event.city ? ', ' + event.city : ''}`
        : (event.city || `${lat.toFixed(4)}, ${lng.toFixed(4)}`);

      // Render embedded Google Map
      const iframe = document.createElement('iframe');
      iframe.width = '100%';
      iframe.height = '100%';
      iframe.style.cssText = 'border:0;display:block;min-height:280px';
      iframe.src = `https://www.google.com/maps/embed/v1/place?key=AIzaSyDDM_2NLmIH3acVqZgKX6lD21YNh01a4K4&q=${lat},${lng}&zoom=16`;
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('loading', 'lazy');
      iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      mapRender.textContent = '';
      mapRender.appendChild(iframe);

      // Render address bar
      if (mapBar) {
        setSafeHTML(mapBar, `
          <div class="ed-map-bar-info">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#4285F4" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            <div>
              <strong>${escapeHTML(venueName)}</strong>
              <span>${escapeHTML(venueAddr)}</span>
            </div>
          </div>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="ed-map-directions-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Get Directions
          </a>
        `);
      }
    }
  }

  // ── Ticket Tiers or Display-Only Notice ──
  let finalAccepted = [];
  if (event.listing_type === 'display_only') {
    // Hide ticket selector entirely for display-only events
    const ticketSelector = document.getElementById('ticket-selector');
    if (ticketSelector) {
      setSafeHTML(ticketSelector, `
        <div style="text-align:center;padding:32px 20px;">
          <div style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:rgba(5, 150, 105,.08);border:1px solid rgba(5, 150, 105,.15);display:flex;align-items:center;justify-content:center;font-size:1.8rem;">🎪</div>
          <h3 style="font-family:var(--font-serif);font-size:1.15rem;font-weight:700;margin-bottom:8px;">Display Only Event</h3>
          <p style="color:var(--text-muted);font-size:0.88rem;line-height:1.6;max-width:320px;margin:0 auto;">This event is for display purposes only. No tickets are available for purchase.</p>
        </div>
      `);
    }
  } else {
    renderTiers(event.ticket_tiers || []);

    // ── HYBRID PAYMENT: Show payment method selector if manual methods available ──
    // V52 FIX: Use RPC instead of direct organizers table query.
    // The old query was blocked by RLS — buyers couldn't read organizer's payment config
    // because the organizers table policy only allows `user_id = auth.uid()`.
    let configuredManualMethods = [];
    let hasStripe = false;
    let rpcSucceeded = false;
    try {
      const { data: paymentConfig, error: pcErr } = await supabase
        .rpc('get_event_payment_config', { p_event_id: event.id });

      if (!pcErr && paymentConfig && !paymentConfig.error) {
        rpcSucceeded = true;
        hasStripe = !!(paymentConfig.has_stripe && paymentConfig.stripe_onboarding_complete);
        if (paymentConfig.manual_payment_methods && Array.isArray(paymentConfig.manual_payment_methods)) {
          configuredManualMethods = paymentConfig.manual_payment_methods
            .filter(pm => pm.method && pm.destination)
            .map(pm => pm.method);
        }
      } else if (pcErr) {
        // RPC doesn't exist yet (migration not deployed) — fall back to direct query.
        // This only works when the viewer IS the organizer (RLS: user_id = auth.uid()).
        // For buyers, this will return null and they need the V52 migration.
        console.warn('RPC get_event_payment_config failed, trying direct organizer query fallback:', pcErr.message);
        try {
          const { data: orgRow } = await supabase
            .from('organizers')
            .select('stripe_account_id, stripe_onboarding_complete, manual_payment_methods')
            .eq('user_id', event.organizer_id)
            .maybeSingle();

          if (orgRow) {
            rpcSucceeded = true;
            hasStripe = !!(orgRow.stripe_account_id && orgRow.stripe_onboarding_complete);
            if (orgRow.manual_payment_methods && Array.isArray(orgRow.manual_payment_methods)) {
              configuredManualMethods = orgRow.manual_payment_methods
                .filter(pm => pm.method && pm.destination)
                .map(pm => pm.method);
            }
          }
        } catch (fallbackErr) {
          console.warn('Direct organizer query also failed:', fallbackErr);
        }
      }
    } catch (orgErr) {
      console.warn('Failed to load organizer payment methods:', orgErr);
    }

    // If the event was published with NO payment methods configured (empty or null),
    // dynamically default to all currently available payment methods for this organizer.
    // V52 FIX: Also merge in any manual methods configured AFTER publishing.
    // Without this, adding Vodafone Cash in profile settings after publishing
    // would never show up because accepted_payment_methods was already set to ['stripe'].
    let acceptedMethods = event.accepted_payment_methods;
    if (!acceptedMethods || acceptedMethods.length === 0) {
      // No methods set at all — use everything available
      acceptedMethods = [];
      if (hasStripe) acceptedMethods.push('stripe');
      acceptedMethods = [...acceptedMethods, ...configuredManualMethods];
    } else {
      // Methods were set at publish time — merge in any NEW manual methods
      // that the organizer configured after publishing
      configuredManualMethods.forEach(m => {
        if (!acceptedMethods.includes(m)) acceptedMethods.push(m);
      });
    }

    // V52 FIX: Build final methods list.
    // If we successfully loaded configuredManualMethods from the RPC, use it to verify.
    // If the RPC failed (not deployed, error), trust event.accepted_payment_methods directly.
    const rpcLoaded = rpcSucceeded;
    const finalMethods = [];
    if (acceptedMethods.includes('stripe') && hasStripe) {
      finalMethods.push('stripe');
    }
    acceptedMethods.filter(m => m !== 'stripe').forEach(m => {
      // If RPC loaded: only include methods the organizer still has configured
      // If RPC failed: trust the event's accepted_payment_methods (set at publish time)
      if (!rpcLoaded || configuredManualMethods.includes(m)) {
        finalMethods.push(m);
      }
    });

    // Check if organizer has any active payment methods configured
    // No fallback: if finalMethods is empty, it means no payment methods are properly set up
    finalAccepted = finalMethods;
    const hasActivePayments = finalAccepted.length > 0;
    const hasManual = finalAccepted.some(m => m !== 'stripe');
    const hasPaidTickets = (event.ticket_tiers || []).some(t => parseFloat(t.price) > 0);

    if (!hasActivePayments && hasPaidTickets) {
      // Organizer has not set up active payment methods yet
      const selector = document.getElementById('payment-method-selector');
      const select = document.getElementById('payment-method-select');
      const secNote = document.getElementById('payment-security-note');
      if (selector && select) {
        selector.style.display = 'block';
        select.innerHTML = '<option value="">⚠️ Payments Unconfigured</option>';
        select.disabled = true;
      }
      const checkoutBtn = document.getElementById('checkout-btn');
      if (checkoutBtn) {
        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = '⚠️ Payments Unconfigured';
        checkoutBtn.style.opacity = '0.5';
        checkoutBtn.style.cursor = 'not-allowed';
      }
      const guestBtn = document.getElementById('guest-checkout-btn');
      if (guestBtn) {
        guestBtn.disabled = true;
        guestBtn.style.opacity = '0.5';
        guestBtn.style.cursor = 'not-allowed';
      }
      if (secNote) {
        secNote.textContent = '⚠️ The organizer has not set up active payment methods (Stripe or Manual Transfer wallets) yet.';
        secNote.style.color = 'var(--text-danger)';
      }
    } else if (hasManual) {
      const selector = document.getElementById('payment-method-selector');
      const select = document.getElementById('payment-method-select');
      const secNote = document.getElementById('payment-security-note');
      if (selector && select) {
        selector.style.display = 'block';
        select.disabled = false;
        // Add manual payment options
        const methodLabels = {
          vodafone_cash: '📱 Vodafone Cash',
          instapay: '🏦 InstaPay',
          bank_transfer: '🏧 Bank Transfer',
          fawry: '💳 Fawry'
        };
        select.innerHTML = '';
        if (finalAccepted.includes('stripe')) {
          const opt = document.createElement('option');
          opt.value = 'stripe';
          opt.textContent = '💳 Credit/Debit Card (Stripe)';
          select.appendChild(opt);
        }
        finalAccepted.filter(m => m !== 'stripe').forEach(method => {
          const opt = document.createElement('option');
          opt.value = method;
          opt.textContent = methodLabels[method] || method;
          select.appendChild(opt);
        });
        // Update checkout button label + security note on method change
        select.addEventListener('change', () => {
          const checkoutBtn = document.getElementById('checkout-btn');
          const guestBtn = document.getElementById('guest-checkout-btn');
          if (select.value === 'stripe') {
            checkoutBtn.innerHTML = 'Reserve & Pay <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
            if (guestBtn) guestBtn.style.display = '';
            if (secNote) secNote.textContent = '🔒 Secure checkout powered by Stripe';
          } else {
            checkoutBtn.innerHTML = '📱 Pay via ' + (methodLabels[select.value] || select.value).replace(/^.+\s/, '') + ' <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
            if (guestBtn) guestBtn.style.display = 'none';
            if (secNote) secNote.textContent = '📱 Manual transfer — pay directly to the organizer';
          }
        });
        // Force state synchronization on page load
        select.dispatchEvent(new Event('change'));
      }
    }

    // ── Seating Chart: init if venue map exists ──
    const params2 = new URLSearchParams(window.location.search);
    const currentEventId = params2.get('id');
    if (currentEventId) {
      try {
        const hasSeating = await initSeatingUI(currentEventId, document.getElementById('seating-chart-panel'), {
          onCheckout: async ({ tierId, seatIds, seats, selectedMethod }) => {
            // V52 FIX: selectedMethod comes from seating-ui.js's own payment selector
            const method = selectedMethod || 'stripe';

            if (method !== 'stripe') {
              // Manual transfer for seated checkout
              showManualCheckoutModal({
                eventId: eventData.id,
                tierId: tierId,
                quantity: seatIds.length,
                seatIds: seatIds,
                paymentMethod: method,
                promoCode: typeof appliedPromo !== 'undefined' && appliedPromo?.code || null,
                eventTitle: eventData.title,
              });
              return;
            }

            // Stripe path — check if user is logged in
            if (authState?.user) {
              // Authenticated seated checkout - show confirm modal first
              const tierInfo = eventData?.ticket_tiers?.find(t => t.id === tierId);
              const totalPrice = Math.round(seats.reduce((s, seat) => s + Number(seat.tier_price), 0) * 100) / 100;
              showConfirmSeatedModal({ tierId, seatIds, seats, tierInfo, totalPrice, profile: authState.profile || {}, user: authState.user });
            } else {
              // Guest seated checkout — show guest modal with seat context
              const tierInfo = eventData?.ticket_tiers?.find(t => t.id === tierId);
              const totalPrice = Math.round(seats.reduce((s, seat) => s + Number(seat.tier_price), 0) * 100) / 100;
              showGuestSeatedModal({ tierId, seatIds, seats, tierInfo, totalPrice });
            }
          },
        });
        if (hasSeating) {
          // Switch to single-column centered layout for seated events
          document.querySelector('.event-detail-grid')?.classList.add('seated-mode');
          
          // Hide the GA ticket selector (it has its own payment selector now)
          document.getElementById('ticket-selector').style.display = 'none';

          // V52 FIX: Populate the seating chart's own payment method selector
          // with the same methods we computed for the GA selector (finalAccepted)
          const seatPaySelector = document.getElementById('seat-payment-method-selector');
          const seatPaySelect = document.getElementById('seat-payment-method-select');
          const seatHasManual = finalAccepted.some(m => m !== 'stripe');
          if (seatPaySelector && seatPaySelect && seatHasManual) {
            seatPaySelector.style.display = 'block';
            seatPaySelect.innerHTML = '';

            const seatMethodLabels = {
              vodafone_cash: '📱 Vodafone Cash',
              instapay: '🏦 InstaPay',
              bank_transfer: '🏧 Bank Transfer',
              fawry: '💳 Fawry'
            };

            if (finalAccepted.includes('stripe')) {
              const opt = document.createElement('option');
              opt.value = 'stripe';
              opt.textContent = '💳 Credit/Debit Card (Stripe)';
              seatPaySelect.appendChild(opt);
            }
            finalAccepted.filter(m => m !== 'stripe').forEach(method => {
              const opt = document.createElement('option');
              opt.value = method;
              opt.textContent = seatMethodLabels[method] || method;
              seatPaySelect.appendChild(opt);
            });

            // Update seated checkout button label on method change
            seatPaySelect.addEventListener('change', () => {
              const btn = document.getElementById('checkout-seats-btn');
              if (!btn) return;
              if (seatPaySelect.value === 'stripe') {
                btn.innerHTML = 'احجز الآن / Checkout <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
              } else {
                const label = (seatMethodLabels[seatPaySelect.value] || seatPaySelect.value).replace(/^.+\s/, '');
                btn.innerHTML = '📱 Pay via ' + label + ' <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
              }
            });
            // Force sync on load
            seatPaySelect.dispatchEvent(new Event('change'));
          }
        }
      } catch (seatingErr) {
        console.warn('Seating chart init failed, using GA fallback:', seatingErr);
      }
    }

    // Tier search filter
    const tierSearch = document.getElementById('tier-search');
    if (tierSearch) {
      tierSearch.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.tier-card').forEach(card => {
          card.style.display = card.dataset.name.toLowerCase().includes(q) ? 'block' : 'none';
        });
      });
    }
  }
}

function renderTiers(tiers) {
  const sorted = [...tiers].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const list = document.getElementById('tiers-list');
  
  // Check if ALL tiers are sold out
  const allSoldOut = sorted.every(tier => {
    const avail = (tier.capacity || 0) - (tier.sold_count || 0);
    return avail <= 0;
  });
  
  setSafeHTML(list, sorted.map(tier => {
    const avail = (tier.capacity || 0) - (tier.sold_count || 0);
    const soldOut = avail <= 0;
    quantities[tier.id] = 0;
    const desc = tier.description || '';
    const descLines = desc.split('\n').filter(l => l.trim());
    const shortDesc = descLines.slice(0, 3).join('\n');
    const hasMore = descLines.length > 3;
    
    return `
      <div class="tier-card ${soldOut ? 'tier-sold-out' : ''}" id="tier-${tier.id}" data-tier-id="${tier.id}" data-name="${escapeHTML(tier.name)}">
        <div class="tier-card-header">
          <h3 class="tier-card-name">${escapeHTML(tier.name)}</h3>
          ${soldOut ? '<span class="tier-sold-badge">Sold</span>' : ''}
        </div>
        <div class="tier-card-price">${formatCurrency(tier.price, tier.currency || eventData?.currency || 'USD')}</div>
        ${desc ? `
          <div class="tier-card-desc" id="desc-${tier.id}">
            <div class="tier-card-desc-text">${escapeHTML(shortDesc).replace(/\n/g, '<br>')}</div>
            ${hasMore ? `<button class="ed-see-more" data-action="toggle-desc" data-tier-id="${tier.id}" data-full="${escapeHTML(desc).replace(/"/g, '&quot;')}">See More</button>` : ''}
          </div>
        ` : ''}
        ${!soldOut ? `
          <div class="tier-card-controls">
            <div class="tier-card-qty-wrap">
              <span style="font-size:0.82rem;color:var(--text-muted);font-weight:500;">Quantity:</span>
              <div class="tier-qty">
                <button data-action="decrease-qty" data-tier-id="${tier.id}">−</button>
                <span id="qty-${tier.id}">0</span>
                <button data-action="increase-qty" data-tier-id="${tier.id}">+</button>
              </div>
            </div>
            <div class="tier-card-actions">
              <button class="btn btn-primary btn-sm btn-full" data-action="buy-now" data-tier-id="${tier.id}">Buy now</button>
            </div>
          </div>
          <div class="tier-avail-text">${avail} remaining</div>
        ` : '<div class="tier-avail-text" style="color:#ef4444;">This tier is sold out</div>'}
      </div>
    `;
  }).join(''));

  // Event delegation for tier card actions (since safeHTML strips inline onclick)
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    
    const action = btn.dataset.action;
    const tierId = btn.dataset.tierId;
    
    if (action === 'decrease-qty') {
      window.changeQty(tierId, -1);
    } else if (action === 'increase-qty') {
      window.changeQty(tierId, 1);
    } else if (action === 'buy-now') {
      window.buyNow(tierId);
    } else if (action === 'toggle-desc') {
      window.toggleTierDesc(tierId, btn);
    }
  });

  // ── WAITLIST FORM: Show when ALL tiers are sold out ──
  if (allSoldOut && eventData) {
    const waitlistHtml = `
      <div id="waitlist-section" style="margin-top:24px;padding:28px;background:linear-gradient(135deg,rgba(245,158,11,.04),rgba(239,68,68,.03));border:1px solid rgba(245,158,11,.15);border-radius:var(--card-radius);">
        <div style="text-align:center;margin-bottom:20px">
          <div style="width:56px;height:56px;margin:0 auto 14px;border-radius:50%;background:rgba(245,158,11,.1);display:flex;align-items:center;justify-content:center;font-size:1.5rem">🔔</div>
          <h3 style="font-family:var(--font-serif);font-size:1.1rem;font-weight:700;margin-bottom:6px">All Tickets Sold Out!</h3>
          <p style="font-size:.82rem;color:var(--text-muted);line-height:1.5;max-width:300px;margin:0 auto">Join the waitlist and we'll notify you if spots open up.</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <input type="text" class="fi" id="waitlist-name" placeholder="Your Full Name" style="font-size:.88rem" />
          <input type="email" class="fi" id="waitlist-email" placeholder="Your Email Address *" required style="font-size:.88rem" />
          <button class="btn btn-primary btn-full" id="waitlist-submit" style="padding:13px;font-weight:600">
            🔔 Join Waitlist
          </button>
        </div>
        <div id="waitlist-status" style="display:none;margin-top:14px;text-align:center"></div>
      </div>
    `;
    list.insertAdjacentHTML('afterend', waitlistHtml);

    // Auto-fill if user is logged in
    if (authState?.user) {
      const emailInput = document.getElementById('waitlist-email');
      const nameInput = document.getElementById('waitlist-name');
      if (emailInput && authState.user.email) emailInput.value = authState.user.email;
      if (nameInput && authState.user.user_metadata?.full_name) nameInput.value = authState.user.user_metadata.full_name;
    }

    // Submit handler
    document.getElementById('waitlist-submit').addEventListener('click', async () => {
      const email = document.getElementById('waitlist-email').value.trim();
      const name = document.getElementById('waitlist-name').value.trim();
      const btn = document.getElementById('waitlist-submit');
      const statusDiv = document.getElementById('waitlist-status');

      if (!email || !email.includes('@')) {
        document.getElementById('waitlist-email').style.borderColor = '#ef4444';
        document.getElementById('waitlist-email').focus();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Joining...';

      try {
        const { data, error } = await supabase.rpc('join_waitlist', {
          p_event_id: eventData.id,
          p_email: email,
          p_name: name || null
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        // Success
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `
          <div style="padding:16px;background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.15);border-radius:12px">
            <div style="font-size:1.3rem;margin-bottom:6px">✅</div>
            <div style="font-weight:700;font-size:.92rem;margin-bottom:4px">${data.already_registered ? 'Already Registered!' : 'You\'re on the List!'}</div>
            <div style="font-size:.82rem;color:var(--text-muted)">Your position: <strong>#${data.position || '—'}</strong></div>
            <div style="font-size:.78rem;color:var(--text-muted);margin-top:4px">We'll email you at <strong>${escapeHTML(email)}</strong> when tickets become available.</div>
          </div>
        `;
        btn.textContent = '✓ Joined';
        btn.style.background = '#22c55e';
      } catch (err) {
        statusDiv.style.display = 'block';
        statusDiv.innerHTML = `<div style="color:#ef4444;font-size:.82rem;padding:10px">❌ ${escapeHTML(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = '🔔 Join Waitlist';
      }
    });

    // Hide checkout buttons when sold out
    const checkoutBtn = document.getElementById('checkout-btn');
    const guestBtn = document.getElementById('guest-checkout-btn');
    if (checkoutBtn) checkoutBtn.style.display = 'none';
    if (guestBtn) guestBtn.style.display = 'none';
  }
}

// Expose to window for onclick handlers
window.changeQty = function(tierId, delta) {
  const tier = eventData?.ticket_tiers?.find(t => t.id === tierId);
  if (!tier) return;
  
  const avail = (tier.capacity || 0) - (tier.sold_count || 0);
  const newQty = Math.max(0, Math.min(10, Math.min(avail, (quantities[tierId] || 0) + delta)));
  quantities[tierId] = newQty;
  
  document.getElementById(`qty-${tierId}`).textContent = newQty;
  
  updateTotal();
};

// Buy Now — sets qty to 1 (if 0) and triggers checkout
window.buyNow = function(tierId) {
  if ((quantities[tierId] || 0) < 1) {
    // Reset all other tiers
    for (const k of Object.keys(quantities)) quantities[k] = 0;
    quantities[tierId] = 1;
    document.querySelectorAll('[id^="qty-"]').forEach(el => el.textContent = '0');
    document.getElementById(`qty-${tierId}`).textContent = '1';
    updateTotal();
  }
  // Trigger the main checkout button
  document.getElementById('checkout-btn').click();
};

// Toggle tier description expand/collapse
window.toggleTierDesc = function(tierId, btn) {
  const descText = btn.closest('.tier-card-desc').querySelector('.tier-card-desc-text');
  if (btn.textContent === 'See More') {
    descText.innerHTML = escapeHTML(btn.dataset.full).replace(/\n/g, '<br>');
    btn.textContent = 'See Less';
  } else {
    const lines = btn.dataset.full.split('\n').filter(l => l.trim());
    descText.innerHTML = escapeHTML(lines.slice(0, 3).join('\n')).replace(/\n/g, '<br>');
    btn.textContent = 'See More';
  }
};

// ── Promo Code State ──
let appliedPromo = null; // { id, code, discount_type, discount_value }

document.getElementById('apply-promo-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('promo-input');
  const status = document.getElementById('promo-status');
  const code = input.value.trim().toUpperCase();
  const btn = document.getElementById('apply-promo-btn');

  if (!code) { status.style.display = 'block'; status.style.color = '#ef4444'; status.textContent = '⚠ Enter a promo code'; return; }
  if (!eventData?.id) return;

  btn.disabled = true; btn.textContent = 'Checking…';

  try {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code)
      .eq('event_id', eventData.id)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      status.style.display = 'block'; status.style.color = '#ef4444';
      status.textContent = '❌ Invalid promo code';
      appliedPromo = null;
      updateTotal();
      return;
    }

    // Check expiry
    if (data.valid_until && new Date(data.valid_until) < new Date()) {
      status.style.display = 'block'; status.style.color = '#ef4444';
      status.textContent = '❌ This promo code has expired';
      appliedPromo = null; updateTotal(); return;
    }

    // Check max uses
    if (data.max_uses && data.used_count >= data.max_uses) {
      status.style.display = 'block'; status.style.color = '#ef4444';
      status.textContent = '❌ This promo code has reached its usage limit';
      appliedPromo = null; updateTotal(); return;
    }

    // Valid!
    appliedPromo = {
      id: data.id,
      code: data.code,
      discount_type: data.discount_type || 'percentage',
      discount_value: data.discount_value || data.discount_percent || 0,
      discount_currency: data.discount_currency || eventData?.currency || 'USD',
    };

    const discLabel = appliedPromo.discount_type === 'fixed'
      ? `${appliedPromo.discount_value} ${appliedPromo.discount_currency} off`
      : `${appliedPromo.discount_value}% off`;

    status.style.display = 'block';
    status.style.color = '#22c55e';
    status.textContent = `✅ ${data.code} applied — ${discLabel}`;
    input.disabled = true;
    btn.textContent = '✓ Applied';
    btn.style.borderColor = '#22c55e';
    btn.style.color = '#22c55e';

    updateTotal();

    const chart = document.getElementById('seating-chart-panel')?._seatingChart;
    if (chart) {
      chart.setPromoCode(appliedPromo?.code || null);
    }
  } catch {
    status.style.display = 'block'; status.style.color = '#ef4444';
    status.textContent = '❌ Error validating code';
    appliedPromo = null; updateTotal();
  } finally {
    btn.disabled = false;
  }
});

// Allow removing promo
document.getElementById('promo-input')?.addEventListener('input', () => {
  if (appliedPromo) {
    appliedPromo = null;
    const btn = document.getElementById('apply-promo-btn');
    const input = document.getElementById('promo-input');
    input.disabled = false;
    btn.textContent = 'Apply';
    btn.style.borderColor = '';
    btn.style.color = '';
    document.getElementById('promo-status').style.display = 'none';
    document.getElementById('discount-row').style.display = 'none';
    document.getElementById('subtotal-row').style.display = 'none';
    updateTotal();

    const chart = document.getElementById('seating-chart-panel')?._seatingChart;
    if (chart) {
      chart.setPromoCode(null);
    }
  }
});

// ── Cached server breakdown for use in confirm modals ──
let cachedBreakdown = null;
let breakdownDebounce = null;

function updateTotal() {
  let subtotal = 0;
  let hasSelection = false;
  let activeTierId = null;
  let activeQty = 0;
  
  for (const [tierId, qty] of Object.entries(quantities)) {
    if (qty > 0) {
      hasSelection = true;
      const tier = eventData?.ticket_tiers?.find(t => t.id === tierId);
      if (tier) {
        subtotal += Math.round(tier.price * qty * 100) / 100;
        activeTierId = tierId;
        activeQty = qty;
      }
    }
  }

  const cur = eventData?.currency || 'USD';
  let discount = 0;
  if (appliedPromo && subtotal > 0) {
    if (appliedPromo.discount_type === 'fixed') {
      discount = Math.min(appliedPromo.discount_value, subtotal);
    } else {
      discount = Math.round(subtotal * (appliedPromo.discount_value / 100) * 100) / 100;
    }

    // Show discount breakdown
    document.getElementById('subtotal-row').style.display = 'flex';
    document.getElementById('subtotal-price').textContent = `${subtotal.toLocaleString()} ${cur}`;
    document.getElementById('discount-row').style.display = 'block';
    document.getElementById('discount-label').textContent = appliedPromo.discount_type === 'fixed'
      ? `${appliedPromo.discount_value} ${appliedPromo.discount_currency || cur}` : `${appliedPromo.discount_value}%`;
    document.getElementById('discount-amount').textContent = `-${discount.toLocaleString()} ${cur}`;
  } else {
    document.getElementById('subtotal-row').style.display = 'none';
    document.getElementById('discount-row').style.display = 'none';
  }

  // Instant local total (shown immediately)
  const localTotal = Math.round(Math.max(0, subtotal - discount) * 100) / 100;
  document.getElementById('total-price').textContent = `${localTotal.toLocaleString()} ${cur}`;

  // ── BRD Fix: Fetch server-side breakdown (debounced) ──
  const breakdownContainer = document.getElementById('server-breakdown');
  if (hasSelection && activeTierId && activeQty > 0) {
    document.getElementById('checkout-btn').disabled = true;
    document.getElementById('guest-checkout-btn').disabled = true;

    clearTimeout(breakdownDebounce);
    breakdownDebounce = setTimeout(async () => {
      try {
        injectBreakdownStyles();
        if (breakdownContainer) breakdownContainer.innerHTML = '<div class="ev-breakdown ev-breakdown--loading">Calculating final price…</div>';
        const breakdown = await getOrderBreakdown(activeTierId, activeQty, appliedPromo?.code || null);
        cachedBreakdown = breakdown;
        if (breakdownContainer) renderPriceBreakdown(breakdownContainer, breakdown, { compact: true });
        // Update total to match server
        if (breakdown?.total != null) {
          document.getElementById('total-price').textContent = `${Number(breakdown.total).toLocaleString()} ${cur}`;
        }
      } catch (err) {
        console.warn('Server breakdown fetch failed, using local total:', err);
        cachedBreakdown = null;
        if (breakdownContainer) breakdownContainer.innerHTML = '';
      } finally {
        document.getElementById('checkout-btn').disabled = !hasSelection;
        document.getElementById('guest-checkout-btn').disabled = !hasSelection;
      }
    }, 400);
  } else {
    cachedBreakdown = null;
    if (breakdownContainer) breakdownContainer.innerHTML = '';
    document.getElementById('checkout-btn').disabled = !hasSelection;
    document.getElementById('guest-checkout-btn').disabled = !hasSelection;
  }
}

// ── Helper: gather selected items ──
function getSelectedItems() {
  const items = [];
  for (const [tierId, qty] of Object.entries(quantities)) {
    if (qty > 0) {
      const tier = eventData.ticket_tiers.find(t => t.id === tierId);
      if (tier) items.push({ tierId, qty, tier });
    }
  }
  return items;
}

// ── Authenticated Checkout ──
document.getElementById('checkout-btn').addEventListener('click', async () => {
  // ── HYBRID PAYMENT: Route based on selected payment method ──
  const payMethodSelect = document.getElementById('payment-method-select');
  const selectedMethod = payMethodSelect?.value || 'stripe';

  if (selectedMethod !== 'stripe') {
    // Manual transfer checkout
    const selectedItems = getSelectedItems();
    if (selectedItems.length === 0) return;
    if (selectedItems.length > 1) {
      showAlertModal({ title: 'Single Tier Only', message: 'Please select tickets from one tier at a time for manual transfer.' });
      return;
    }
    const firstItem = selectedItems[0];
    showManualCheckoutModal({
      eventId: eventData.id,
      tierId: firstItem.tierId,
      quantity: firstItem.qty,
      paymentMethod: selectedMethod,
      promoCode: typeof appliedPromo !== 'undefined' && appliedPromo?.code || null,
      eventTitle: eventData.title,
    });
    return;
  }

  // Check auth + OTP before allowing Stripe checkout
  if (!authState?.user) {
    window.location.href = `login.html?redirect=${encodeURIComponent(window.location.href)}`;
    return;
  }
  if (!authState?.isFullyAuth) {
    window.location.href = `login.html?otp_required=true&redirect=${encodeURIComponent(window.location.href)}`;
    return;
  }

  const selectedItems = getSelectedItems();
  if (selectedItems.length === 0) return;

  const subtotal = Math.round(selectedItems.reduce((sum, item) => sum + (item.tier.price * item.qty), 0) * 100) / 100;
  let discount = 0;
  if (appliedPromo && subtotal > 0) {
    if (appliedPromo.discount_type === 'fixed') {
      discount = Math.min(appliedPromo.discount_value, subtotal);
    } else {
      discount = Math.round(subtotal * (appliedPromo.discount_value / 100) * 100) / 100;
    }
  }
  const totalPrice = Math.round(Math.max(0, subtotal - discount) * 100) / 100;
  const totalQty = selectedItems.reduce((sum, item) => sum + item.qty, 0);
  const profile = authState.profile || {};

  showConfirmModal({
    event: eventData,
    items: selectedItems,
    totalPrice,
    totalQty,
    profile,
    user: authState.user,
  });
});

// ── Guest Checkout ──
document.getElementById('guest-checkout-btn').addEventListener('click', () => {
  const selectedItems = getSelectedItems();
  if (selectedItems.length === 0) return;

  const subtotal = Math.round(selectedItems.reduce((sum, item) => sum + (item.tier.price * item.qty), 0) * 100) / 100;
  let discount = 0;
  if (appliedPromo && subtotal > 0) {
    if (appliedPromo.discount_type === 'fixed') {
      discount = Math.min(appliedPromo.discount_value, subtotal);
    } else {
      discount = Math.round(subtotal * (appliedPromo.discount_value / 100) * 100) / 100;
    }
  }
  const totalPrice = Math.round(Math.max(0, subtotal - discount) * 100) / 100;
  const totalQty = selectedItems.reduce((sum, item) => sum + item.qty, 0);

  showGuestModal({
    event: eventData,
    items: selectedItems,
    totalPrice,
    totalQty,
  });
});

// ══════════════════════════════════════════
// PER-TICKET ATTENDEE FORM BUILDER (v60)
// ══════════════════════════════════════════
function buildAttendeeFormHTML(qty, buyerInfo, prefix, seatLabels) {
  if (qty <= 0) return '';
  buyerInfo = buyerInfo || {}; seatLabels = seatLabels || [];
  let html = '<div class="confirm-section" id="' + prefix + '-attendee-section" style="margin-top:16px;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">';
  html += '<div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;"><span>🎟️ Ticket Holders</span>';
  if (qty > 1) html += '<button type="button" id="' + prefix + '-copy-all" style="font-size:0.7rem;padding:4px 12px;border-radius:8px;font-weight:600;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.2);color:var(--accent-primary);cursor:pointer;">📋 Copy to all</button>';
  html += '</div>';
  for (var i = 0; i < qty; i++) {
    var isFirst = i === 0;
    var seatLabel = seatLabels[i] || '';
    var ticketLabel = seatLabel ? 'Ticket ' + (i+1) + ' — ' + seatLabel : 'Ticket ' + (i+1);
    var nameVal = isFirst ? (buyerInfo.name || '').replace(/"/g, '&quot;') : '';
    var emailVal = isFirst ? (buyerInfo.email || '').replace(/"/g, '&quot;') : '';
    var phoneVal = isFirst ? (buyerInfo.phone || '').replace(/"/g, '&quot;') : '';
    var emailRO = isFirst && buyerInfo.emailReadonly;
    var reqStar = '<span style="color:#ef4444;">*</span>';
    var optLabel = '<span style="color:var(--text-muted);font-size:0.7rem;">(optional)</span>';
    html += '<div style="margin-top:' + (i > 0 ? '14' : '6') + 'px;padding:14px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:12px;">';
    html += '<div style="font-size:0.78rem;font-weight:700;color:var(--text-primary);margin-bottom:10px;display:flex;align-items:center;gap:6px;"><span style="width:22px;height:22px;border-radius:50%;background:var(--accent-gradient);display:inline-flex;align-items:center;justify-content:center;font-size:0.65rem;color:#000;font-weight:800;">' + (i+1) + '</span>' + ticketLabel + '</div>';
    var inputStyle = 'width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);';
    html += '<div style="margin-bottom:10px;"><label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Name ' + reqStar + '</label><input type="text" id="' + prefix + '-name-' + i + '" value="' + nameVal + '" placeholder="Full name" style="' + inputStyle + '" /></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
    html += '<div><label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Email ' + (isFirst ? reqStar : optLabel) + '</label><input type="email" id="' + prefix + '-email-' + i + '" value="' + emailVal + '" placeholder="email@example.com" ' + (emailRO ? 'readonly style="' + inputStyle + 'opacity:0.6;cursor:not-allowed;"' : 'style="' + inputStyle + '"') + ' /></div>';
    html += '<div><label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Phone ' + (isFirst ? reqStar : optLabel) + '</label><input type="tel" id="' + prefix + '-phone-' + i + '" value="' + phoneVal + '" placeholder="+XX XXX XXX" style="' + inputStyle + '" /></div>';
    html += '</div></div>';
  }
  html += '</div>';
  return html;
}

function injectAttendeeForm(targetEl, qty, buyerInfo, prefix, seatLabels) {
  if (!targetEl) return;
  var wrapper = document.createElement('div');
  wrapper.innerHTML = buildAttendeeFormHTML(qty, buyerInfo, prefix, seatLabels);
  targetEl.replaceWith(wrapper.firstElementChild);
  var copyBtn = document.getElementById(prefix + '-copy-all');
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var src = { name: document.getElementById(prefix + '-name-0')?.value || '', email: document.getElementById(prefix + '-email-0')?.value || '', phone: document.getElementById(prefix + '-phone-0')?.value || '' };
      for (var j = 1; j < qty; j++) {
        var n = document.getElementById(prefix + '-name-' + j); if (n && !n.value) n.value = src.name;
        var e = document.getElementById(prefix + '-email-' + j); if (e && !e.value) e.value = src.email;
        var p = document.getElementById(prefix + '-phone-' + j); if (p && !p.value) p.value = src.phone;
      }
      copyBtn.textContent = '✓ Copied';
      copyBtn.style.borderColor = 'var(--accent-primary)';
      setTimeout(function() { copyBtn.textContent = '📋 Copy to all'; copyBtn.style.borderColor = ''; }, 1500);
    });
  }
}

function collectAttendees(qty, prefix) {
  var attendees = [];
  for (var i = 0; i < qty; i++) {
    attendees.push({
      name: (document.getElementById(prefix + '-name-' + i)?.value || '').trim(),
      email: (document.getElementById(prefix + '-email-' + i)?.value || '').trim(),
      phone: (document.getElementById(prefix + '-phone-' + i)?.value || '').trim(),
    });
  }
  return attendees;
}

function validateAttendees(attendees) {
  for (var i = 0; i < attendees.length; i++) {
    if (!attendees[i].name) return { valid: false, message: 'Please enter a name for Ticket ' + (i + 1) + '.' };
  }
  if (attendees.length > 0) {
    if (!attendees[0].email) return { valid: false, message: 'Please enter an email for Ticket 1.' };
    if (!attendees[0].phone) return { valid: false, message: 'Please enter a phone number for Ticket 1.' };
  }
  return { valid: true };
}

function showConfirmModal({ event, items, totalPrice, totalQty, profile, user }) {
  // Remove existing modal
  document.getElementById('confirm-modal')?.remove();

  const tiersSummary = items.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light);">
      <div>
        <div style="font-weight:600;font-size:0.9rem;">${escapeHTML(i.tier.name)} × ${i.qty}</div>
      </div>
      <div style="font-weight:700;color:var(--accent-primary);">${formatCurrency(i.tier.price * i.qty, i.tier.currency || eventData?.currency || 'USD')}</div>
    </div>
  `).join('');

  const modal = document.createElement('div');
  modal.id = 'confirm-modal';
  modal.innerHTML = `
    <style>
      #confirm-modal {
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,.7);
        backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
        animation:fadeIn .3s ease;
      }
      .confirm-box {
        max-width:480px;width:100%;
        background:var(--bg-card);
        border:1px solid rgba(212,175,55,.12);
        border-radius:20px;padding:28px 24px;
        box-shadow:0 30px 80px rgba(0,0,0,.4);
        max-height:90vh;overflow-y:auto;
        animation:scaleIn .4s cubic-bezier(.16,1,.3,1) forwards;
      }
      .confirm-box h3 {
        font-family:var(--font-serif);font-size:1.2rem;
        font-weight:700;margin-bottom:4px;
      }
      .confirm-section {
        margin-top:20px;padding:16px;
        background:rgba(255,255,255,.02);
        border:1px solid var(--border-color);
        border-radius:14px;
      }
      .confirm-section-title {
        font-size:0.75rem;text-transform:uppercase;
        letter-spacing:0.06em;color:var(--accent-primary);
        font-weight:700;margin-bottom:12px;
      }
      .confirm-field {
        margin-bottom:12px;
      }
      .confirm-field label {
        display:block;font-size:0.78rem;
        color:var(--text-muted);margin-bottom:4px;font-weight:500;
      }
      .confirm-field input {
        width:100%;padding:10px 14px;
        background:rgba(255,255,255,.04);
        border:1px solid var(--border-color);
        border-radius:10px;color:var(--text-primary);
        font-size:0.88rem;font-family:var(--font-sans);
        transition:border-color .2s;
      }
      .confirm-field input:focus {
        outline:none;border-color:var(--accent-primary);
        box-shadow:0 0 0 3px rgba(212,175,55,.08);
      }
      .confirm-total {
        display:flex;justify-content:space-between;
        align-items:center;margin-top:16px;
        padding-top:12px;border-top:1.5px solid var(--border-color);
      }
      .confirm-total-label { font-size:0.9rem;color:var(--text-secondary); }
      .confirm-total-price {
        font-size:1.3rem;font-weight:800;
        background:var(--accent-gradient);
        -webkit-background-clip:text;-webkit-text-fill-color:transparent;
        background-clip:text;
      }
      .confirm-btns { display:flex;gap:10px;margin-top:20px; }
      .confirm-btns .btn { flex:1; }
      .confirm-note {
        margin-top:14px;padding:10px 14px;
        background:rgba(212,175,55,.04);
        border:1px solid rgba(212,175,55,.1);
        border-radius:10px;font-size:0.78rem;
        color:var(--text-muted);line-height:1.6;
        display:flex;align-items:flex-start;gap:8px;
      }
      @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
      @media (max-width: 480px) {
        .confirm-box { padding: 20px 16px; border-radius: 16px; }
        .confirm-box h3 { font-size: 1.1rem; }
        .confirm-section { padding: 12px; margin-top: 14px; }
        .confirm-btns { flex-direction: column-reverse; gap: 8px; }
        .confirm-btns .btn { width: 100%; }
      }
    </style>
    <div class="confirm-box">
      <h3>Confirm Your <span style="color:var(--accent-primary);">Booking</span></h3>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:0;">${escapeHTML(event.title)}</p>

      <div class="confirm-section">
        <div class="confirm-section-title">🎫 Tickets</div>
        ${tiersSummary}
        <div class="confirm-total">
          <span class="confirm-total-label">${totalQty} ticket${totalQty > 1 ? 's' : ''} · Total</span>
          <span class="confirm-total-price">${cachedBreakdown ? Number(cachedBreakdown.total).toLocaleString() : totalPrice.toLocaleString()} ${event.currency || 'USD'}</span>
        </div>
        ${cachedBreakdown && (cachedBreakdown.tax_amount > 0 || cachedBreakdown.platform_fee_total > 0) ? `
          <div style="margin-top:8px;font-size:0.78rem;color:var(--text-muted);line-height:1.6;">
            ${cachedBreakdown.tax_amount > 0 ? `<div style="display:flex;justify-content:space-between;"><span>${cachedBreakdown.tax_label || 'VAT'} (${cachedBreakdown.tax_rate}%)</span><span>${Number(cachedBreakdown.tax_amount).toLocaleString()} ${event.currency || 'USD'}</span></div>` : ''}
            ${cachedBreakdown.platform_fee_total > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Service Fee</span><span>${Number(cachedBreakdown.platform_fee_total).toLocaleString()} ${event.currency || 'USD'}</span></div>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="confirm-section">
        <div class="confirm-section-title">👤 Attendee Information</div>
        <div class="confirm-field">
          <label>Full Name</label>
          <input type="text" id="confirm-name" value="${escapeHTML(profile.full_name || user.user_metadata?.full_name || '')}" required />
        </div>
        <div class="confirm-field">
          <label>Email</label>
          <input type="email" id="confirm-email" value="${escapeHTML(user.email || '')}" readonly style="opacity:0.6;cursor:not-allowed;" />
        </div>
        <div class="confirm-field">
          <label>Phone</label>
          <input type="tel" id="confirm-phone" value="${escapeHTML(profile.phone || user.user_metadata?.phone || '')}" placeholder="+1 XXX XXX XXXX" />
        </div>
      </div>

      <div class="confirm-note">
        <span style="flex-shrink:0;">🔒</span>
        <span>Your data is encrypted and linked to your QR code. The ticket cannot be transferred or forged. You must present a valid ID matching this information at the venue.</span>
      </div>

      <div class="confirm-btns">
        <button class="btn btn-outline btn-lg" id="confirm-cancel">Cancel</button>
        <button class="btn btn-primary btn-lg" id="confirm-pay">
          Confirm & Pay
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // v60: Inject per-ticket attendee form (replaces the old single-attendee section)
  (function() {
    var sections = modal.querySelectorAll('.confirm-section');
    var attendeeSection = sections.length >= 2 ? sections[1] : null;
    if (attendeeSection) {
      injectAttendeeForm(attendeeSection, totalQty, {
        name: profile.full_name || user.user_metadata?.full_name || '',
        email: user.email || '',
        phone: profile.phone || user.user_metadata?.phone || '',
        emailReadonly: true,
      }, 'ca', null);
    }
  })();

  // Close
  document.getElementById('confirm-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Confirm & Pay
  document.getElementById('confirm-pay').addEventListener('click', async () => {
    // v60: Collect per-ticket attendee data
    const attendees = collectAttendees(totalQty, 'ca');
    const validation = validateAttendees(attendees);
    if (!validation.valid) { showAlertModal({ title: 'Required Field', message: validation.message }); return; }
    const name = attendees[0].name;
    const phone = attendees[0].phone;

    const payBtn = document.getElementById('confirm-pay');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Processing…';

    try {
      // Update profile with latest info
      await supabase.from('profiles').update({
        full_name: name,
        phone: phone || null,
      }).eq('id', authState.user.id);

      // Process checkout — one tier per Stripe session.
      // If multiple tiers selected, warn the user.
      if (items.length > 1) {
        showAlertModal({ title: 'Single Tier Only', message: 'Please select tickets from one tier at a time. Multiple tiers require separate purchases.' });
        payBtn.disabled = false;
        payBtn.innerHTML = 'Confirm & Pay <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
        return;
      }

      const firstItem = items[0];
      const result = await createCheckout({ tierId: firstItem.tierId, quantity: firstItem.qty, promoCode: appliedPromo?.code || null, attendees });

      if (result.checkout_url) {
        // Show reservation timer before redirect
        modal.remove();
        startReservationTimer();
        // Redirect to Stripe
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      showAlertModal({ title: 'Checkout Failed', message: err.message || 'Failed to process. Please try again.', buttonColor: '#dc2626' });
      payBtn.disabled = false;
      payBtn.innerHTML = 'Confirm & Pay <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
    }
  });
}

// ── Guest Checkout ──
function showGuestModal({ event, items, totalPrice, totalQty }) {
  document.getElementById('guest-modal')?.remove();

  const tiersSummary = items.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light);">
      <div style="font-weight:600;font-size:0.9rem;">${escapeHTML(i.tier.name)} × ${i.qty}</div>
      <div style="font-weight:700;color:var(--accent-primary);">${formatCurrency(Math.round(i.tier.price * i.qty * 100) / 100, eventData?.currency || 'USD')}</div>
    </div>
  `).join('');

  const modal = document.createElement('div');
  modal.id = 'guest-modal';
  modal.innerHTML = `
    <style>
      #guest-modal {
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,.7);
        backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
        animation:fadeIn .3s ease;
      }
      .guest-box {
        max-width:480px;width:100%;
        background:var(--bg-card);
        border:1px solid rgba(212,175,55,.12);
        border-radius:20px;padding:28px 24px;
        box-shadow:0 30px 80px rgba(0,0,0,.4);
        max-height:90vh;overflow-y:auto;
        animation:scaleIn .4s cubic-bezier(.16,1,.3,1) forwards;
      }
      @media (max-width: 480px) {
        .guest-box { padding: 20px 16px; border-radius: 16px; }
        .guest-box h3 { font-size: 1.1rem; }
        .confirm-section { padding: 12px; margin-top: 14px; }
        .guest-btns { flex-direction: column-reverse; gap: 8px; }
        .guest-btns .btn { width: 100%; }
      }
    </style>
    <div class="guest-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(34,197,94,.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🎫</div>
        <h3 style="font-family:var(--font-serif);font-size:1.2rem;font-weight:700;margin:0;">Guest <span style="color:var(--accent-primary);">Checkout</span></h3>
      </div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin:4px 0 16px;">No account needed — just fill in your details below.</p>

      <div class="confirm-section" style="margin-top:0;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">🎫 Tickets</div>
        ${tiersSummary}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1.5px solid var(--border-color);">
          <span style="font-size:0.9rem;color:var(--text-secondary);">${totalQty} ticket${totalQty > 1 ? 's' : ''} · Total</span>
          <span style="font-size:1.3rem;font-weight:800;background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${cachedBreakdown ? Number(cachedBreakdown.total).toLocaleString() : totalPrice.toLocaleString()} ${event.currency || 'USD'}</span>
        </div>
        ${cachedBreakdown && (cachedBreakdown.tax_amount > 0 || cachedBreakdown.platform_fee_total > 0) ? `
          <div style="margin-top:8px;font-size:0.78rem;color:var(--text-muted);line-height:1.6;">
            ${cachedBreakdown.tax_amount > 0 ? `<div style="display:flex;justify-content:space-between;"><span>${cachedBreakdown.tax_label || 'VAT'} (${cachedBreakdown.tax_rate}%)</span><span>${Number(cachedBreakdown.tax_amount).toLocaleString()} ${event.currency || 'USD'}</span></div>` : ''}
            ${cachedBreakdown.platform_fee_total > 0 ? `<div style="display:flex;justify-content:space-between;"><span>Service Fee</span><span>${Number(cachedBreakdown.platform_fee_total).toLocaleString()} ${event.currency || 'USD'}</span></div>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="confirm-section" style="margin-top:16px;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">👤 Your Information</div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Full Name <span style="color:var(--accent-primary);">*</span></label>
          <input type="text" id="guest-name" placeholder="John Doe" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
        </div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Email <span style="color:var(--accent-primary);">*</span></label>
          <input type="email" id="guest-email" placeholder="you@example.com" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
          <p style="margin:4px 0 0;font-size:0.7rem;color:var(--text-muted);">Your tickets will be sent to this email</p>
        </div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Phone <span style="color:var(--accent-primary);">*</span></label>
          <input type="tel" id="guest-phone" placeholder="+1 XXX XXX XXXX" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
        </div>
      </div>

      <div style="margin-top:14px;padding:10px 14px;background:rgba(212,175,55,.04);border:1px solid rgba(212,175,55,.1);border-radius:10px;font-size:0.78rem;color:var(--text-muted);line-height:1.6;display:flex;align-items:flex-start;gap:8px;">
        <span style="flex-shrink:0;">🔒</span>
        <span>Your data is encrypted and linked to your QR code. After purchase, you'll receive an email with a secure link to view your tickets. No account creation needed.</span>
      </div>

      <div class="guest-btns" style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-outline btn-lg" id="guest-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary btn-lg" id="guest-pay" style="flex:1;">
          Pay as Guest
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // v60: Inject per-ticket attendee form (replaces the old single-attendee section)
  (function() {
    var sections = modal.querySelectorAll('.confirm-section');
    var attendeeSection = sections.length >= 2 ? sections[1] : null;
    if (attendeeSection) {
      injectAttendeeForm(attendeeSection, totalQty, {}, 'ga', null);
    }
  })();

  // Close
  document.getElementById('guest-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Pay
  document.getElementById('guest-pay').addEventListener('click', async () => {
    // v60: Collect per-ticket attendee data
    const attendees = collectAttendees(totalQty, 'ga');
    const validation = validateAttendees(attendees);
    if (!validation.valid) { showAlertModal({ title: 'Required Field', message: validation.message }); return; }
    const name = attendees[0].name;
    const email = attendees[0].email;
    const phone = attendees[0].phone;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAlertModal({ title: 'Invalid Email', message: 'Please enter a valid email for Ticket 1.' }); return; }
    if (!phone || phone.length < 7) { showAlertModal({ title: 'Invalid Phone', message: 'Please enter a valid phone for Ticket 1.' }); return; }

    if (items.length > 1) {
      showAlertModal({ title: 'Single Tier Only', message: 'Please select tickets from one tier at a time for guest checkout.' });
      return;
    }

    const payBtn = document.getElementById('guest-pay');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Processing…';

    try {
      const firstItem = items[0];
      const result = await createGuestCheckout({
        tierId: firstItem.tierId,
        quantity: firstItem.qty,
        guestName: name,
        guestEmail: email,
        guestPhone: phone,
        promoCode: appliedPromo?.code || null,
        attendees,
      });

      if (result.checkout_url) {
        modal.remove();
        startReservationTimer();
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      showAlertModal({ title: 'Checkout Failed', message: err.message || 'Failed to process. Please try again.', buttonColor: '#dc2626' });
      payBtn.disabled = false;
      payBtn.innerHTML = 'Pay as Guest <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
    }
  });
}

// ══════════════════════════════════════════
// AUTHENTICATED SEATED CHECKOUT MODAL
// ══════════════════════════════════════════
function showConfirmSeatedModal({ tierId, seatIds, seats, tierInfo, totalPrice, profile, user }) {
  document.getElementById('confirm-seated-modal')?.remove();

  const seatsSummary = seats.length <= 6
    ? seats.map(s => `Row ${escapeHTML(s.row_label)} Seat ${escapeHTML(s.seat_number)}`).join(', ')
    : `${seats.length} seats selected`;

  const modal = document.createElement('div');
  modal.id = 'confirm-seated-modal';
  modal.innerHTML = `
    <style>
      #confirm-seated-modal {
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,.7);
        backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
        animation:fadeIn .3s ease;
      }
      .confirm-seated-box {
        max-width:480px;width:100%;
        background:var(--bg-card);
        border:1px solid rgba(212,175,55,.12);
        border-radius:20px;padding:28px 24px;
        box-shadow:0 30px 80px rgba(0,0,0,.4);
        max-height:90vh;overflow-y:auto;
        animation:scaleIn .4s cubic-bezier(.16,1,.3,1) forwards;
      }
      @media (max-width: 480px) {
        .confirm-seated-box { padding: 20px 16px; border-radius: 16px; }
        .confirm-seated-box h3 { font-size: 1.1rem; }
        .confirm-section { padding: 12px; margin-top: 14px; }
        .cs-btns { flex-direction: column-reverse; gap: 8px; }
        .cs-btns .btn { width: 100%; }
      }
    </style>
    <div class="confirm-seated-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(34,197,94,.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">💺</div>
        <h3 style="font-family:var(--font-serif);font-size:1.2rem;font-weight:700;margin:0;">Confirm Your <span style="color:var(--accent-primary);">Seats</span></h3>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:4px 0 16px;">${escapeHTML(eventData.title)}</p>

      <div class="confirm-section" style="margin-top:0;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">💺 Selected Seats</div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light);">
          <div style="font-weight:600;font-size:0.9rem;">${escapeHTML(tierInfo?.name || 'Ticket')} × ${seats.length}</div>
          <div style="font-weight:700;color:var(--accent-primary);">${formatCurrency(totalPrice, eventData?.currency || 'USD')}</div>
        </div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:8px;">${seatsSummary}</div>
        <div id="cs-breakdown-container" style="margin-top:12px;"></div>
        <div id="cs-total-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1.5px solid var(--border-color);">
          <span style="font-size:0.9rem;color:var(--text-secondary);">${seats.length} seat${seats.length > 1 ? 's' : ''} · Total</span>
          <span id="cs-final-total" style="font-size:1.3rem;font-weight:800;background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${formatCurrency(totalPrice, eventData?.currency || 'USD')}</span>
        </div>
      </div>

      <div class="confirm-section" style="margin-top:16px;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">👤 Attendee Information</div>
        <div class="confirm-field">
          <label>Full Name</label>
          <input type="text" id="cs-name" value="${escapeHTML(profile.full_name || user.user_metadata?.full_name || '')}" required />
        </div>
        <div class="confirm-field">
          <label>Email</label>
          <input type="email" id="cs-email" value="${escapeHTML(user.email || '')}" readonly style="opacity:0.6;cursor:not-allowed;" />
        </div>
        <div class="confirm-field">
          <label>Phone</label>
          <input type="tel" id="cs-phone" value="${escapeHTML(profile.phone || user.user_metadata?.phone || '')}" placeholder="+1 XXX XXX XXXX" />
        </div>
      </div>

      <div class="confirm-note" style="margin-top:14px;padding:10px 14px;background:rgba(212,175,55,.04);border:1px solid rgba(212,175,55,.1);border-radius:10px;font-size:0.78rem;color:var(--text-muted);line-height:1.6;display:flex;align-items:flex-start;gap:8px;">
        <span style="flex-shrink:0;">🔒</span>
        <span>Your data is encrypted and linked to your QR code. The ticket cannot be transferred or forged. You must present a valid ID matching this information at the venue.</span>
      </div>

      <div class="cs-btns" style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-outline btn-lg" id="cs-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary btn-lg" id="cs-pay" style="flex:1;">
          Confirm & Pay
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // v60: Inject per-ticket attendee form (replaces the old single-attendee section)
  (function() {
    var sections = modal.querySelectorAll('.confirm-section');
    var attendeeSection = sections.length >= 2 ? sections[1] : null;
    if (attendeeSection) {
      injectAttendeeForm(attendeeSection, seats.length, {
        name: profile.full_name || user.user_metadata?.full_name || '',
        email: user.email || '',
        phone: profile.phone || user.user_metadata?.phone || '',
        emailReadonly: true,
      }, 'cs', seats.map(function(s) { return 'Row ' + s.row_label + ' Seat ' + s.seat_number; }));
    }
  })();

  // Populate pricing
  const csBreakdownEl = document.getElementById('cs-breakdown-container');
  const csFinalTotal = document.getElementById('cs-final-total');
  if (csBreakdownEl) {
    const cached = getCachedSeatBreakdown();
    if (cached) {
      injectBreakdownStyles();
      renderPriceBreakdown(csBreakdownEl, cached, { compact: true });
      if (cached.total != null && csFinalTotal) {
        csFinalTotal.textContent = formatCurrency(Number(cached.total), eventData?.currency || 'USD');
      }
    } else {
      (async () => {
        try {
          injectBreakdownStyles();
          csBreakdownEl.innerHTML = '<div class="ev-breakdown ev-breakdown--loading">Calculating fees…</div>';
          const bd = await getOrderBreakdown(tierId, seats.length, appliedPromo?.code || null);
          renderPriceBreakdown(csBreakdownEl, bd, { compact: true });
          if (bd.total != null && csFinalTotal) {
            csFinalTotal.textContent = formatCurrency(Number(bd.total), eventData?.currency || 'USD');
          }
        } catch {
          csBreakdownEl.innerHTML = '';
        }
      })();
    }
  }

  document.getElementById('cs-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById('cs-pay').addEventListener('click', async () => {
    // v60: Collect per-ticket attendee data
    const attendees = collectAttendees(seats.length, 'cs');
    const validation = validateAttendees(attendees);
    if (!validation.valid) { showAlertModal({ title: 'Required Field', message: validation.message }); return; }
    const name = attendees[0].name;
    const phone = attendees[0].phone;

    const payBtn = document.getElementById('cs-pay');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Reserving…';

    try {
      await supabase.from('profiles').update({
        full_name: name,
        phone: phone || null,
      }).eq('id', user.id);

      const result = await createSeatedCheckout({ 
        tierId, 
        seatIds, 
        attendees, 
        promoCode: appliedPromo?.code || null 
      });
      if (result.checkout_url) {
        modal.remove();
        startReservationTimer();
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      showAlertModal({ title: 'Reservation Failed', message: err.message || 'Failed to reserve seats. Please try again.', buttonColor: '#dc2626' });
      payBtn.disabled = false;
      payBtn.innerHTML = 'Confirm & Pay <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
    }
  });
}

// ══════════════════════════════════════════
// GUEST SEATED CHECKOUT MODAL
// ══════════════════════════════════════════
function showGuestSeatedModal({ tierId, seatIds, seats, tierInfo, totalPrice }) {
  document.getElementById('guest-seated-modal')?.remove();

  const seatsSummary = seats.length <= 6
    ? seats.map(s => `Row ${escapeHTML(s.row_label)} Seat ${escapeHTML(s.seat_number)}`).join(', ')
    : `${seats.length} seats selected`;

  const modal = document.createElement('div');
  modal.id = 'guest-seated-modal';
  modal.innerHTML = `
    <style>
      #guest-seated-modal {
        position:fixed;inset:0;z-index:99999;
        background:rgba(0,0,0,.7);
        backdrop-filter:blur(8px);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
        animation:fadeIn .3s ease;
      }
      .guest-seated-box {
        max-width:480px;width:100%;
        background:var(--bg-card);
        border:1px solid rgba(212,175,55,.12);
        border-radius:20px;padding:28px 24px;
        box-shadow:0 30px 80px rgba(0,0,0,.4);
        max-height:90vh;overflow-y:auto;
        animation:scaleIn .4s cubic-bezier(.16,1,.3,1) forwards;
      }
      @media (max-width: 480px) {
        .guest-seated-box { padding: 20px 16px; border-radius: 16px; }
        .guest-seated-box h3 { font-size: 1.1rem; }
        .confirm-section { padding: 12px; margin-top: 14px; }
        .gs-btns { flex-direction: column-reverse; gap: 8px; }
        .gs-btns .btn { width: 100%; }
      }
    </style>
    <div class="guest-seated-box">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <div style="width:40px;height:40px;border-radius:12px;background:rgba(34,197,94,.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;">💺</div>
        <h3 style="font-family:var(--font-serif);font-size:1.2rem;font-weight:700;margin:0;">Guest <span style="color:var(--accent-primary);">Seated Checkout</span></h3>
      </div>
      <p style="color:var(--text-muted);font-size:0.82rem;margin:4px 0 16px;">Complete your details to reserve your selected seats.</p>

      <div class="confirm-section" style="margin-top:0;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">💺 Your Seats</div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light);">
          <div style="font-weight:600;font-size:0.9rem;">${escapeHTML(tierInfo?.name || 'Ticket')} × ${seats.length}</div>
          <div style="font-weight:700;color:var(--accent-primary);">${formatCurrency(totalPrice, eventData?.currency || 'USD')}</div>
        </div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:8px;">${seatsSummary}</div>
        <!-- BRD: Server-side price breakdown (tax + service fee + total) -->
        <div id="gs-breakdown-container" style="margin-top:12px;"></div>
        <div id="gs-total-row" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1.5px solid var(--border-color);">
          <span style="font-size:0.9rem;color:var(--text-secondary);">${seats.length} seat${seats.length > 1 ? 's' : ''} · Total</span>
          <span id="gs-final-total" style="font-size:1.3rem;font-weight:800;background:var(--accent-gradient);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">${formatCurrency(totalPrice, eventData?.currency || 'USD')}</span>
        </div>
      </div>

      <div class="confirm-section" style="margin-top:16px;padding:16px;background:rgba(255,255,255,.02);border:1px solid var(--border-color);border-radius:14px;">
        <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--accent-primary);font-weight:700;margin-bottom:12px;">👤 Your Information</div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Full Name <span style="color:var(--accent-primary);">*</span></label>
          <input type="text" id="gs-name" placeholder="John Doe" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
        </div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Email <span style="color:var(--accent-primary);">*</span></label>
          <input type="email" id="gs-email" placeholder="you@example.com" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
        </div>
        <div class="confirm-field" style="margin-bottom:12px;">
          <label style="display:block;font-size:0.78rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">Phone <span style="color:var(--accent-primary);">*</span></label>
          <input type="tel" id="gs-phone" placeholder="+1 XXX XXX XXXX" required
            style="width:100%;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border-color);border-radius:10px;color:var(--text-primary);font-size:0.88rem;font-family:var(--font-sans);" />
        </div>
      </div>

      <div class="gs-btns" style="display:flex;gap:10px;margin-top:20px;">
        <button class="btn btn-outline btn-lg" id="gs-cancel" style="flex:1;">Cancel</button>
        <button class="btn btn-primary btn-lg" id="gs-pay" style="flex:1;">
          Pay as Guest
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // v60: Inject per-ticket attendee form (replaces the old single-attendee section)
  (function() {
    var sections = modal.querySelectorAll('.confirm-section');
    var attendeeSection = sections.length >= 2 ? sections[1] : null;
    if (attendeeSection) {
      injectAttendeeForm(attendeeSection, seats.length, {}, 'gs', seats.map(function(s) { return 'Row ' + s.row_label + ' Seat ' + s.seat_number; }));
    }
  })();

  // BRD: Populate price breakdown with tax + fees
  const gsBreakdownEl = document.getElementById('gs-breakdown-container');
  const gsFinalTotal = document.getElementById('gs-final-total');
  if (gsBreakdownEl) {
    const cached = getCachedSeatBreakdown();
    if (cached) {
      injectBreakdownStyles();
      renderPriceBreakdown(gsBreakdownEl, cached, { compact: true });
      if (cached.total != null && gsFinalTotal) {
        gsFinalTotal.textContent = formatCurrency(Number(cached.total), eventData?.currency || 'USD');
      }
    } else {
      // Fetch fresh if no cache
      (async () => {
        try {
          injectBreakdownStyles();
          gsBreakdownEl.innerHTML = '<div class="ev-breakdown ev-breakdown--loading">Calculating fees…</div>';
          const bd = await getOrderBreakdown(tierId, seats.length, appliedPromo?.code || null);
          renderPriceBreakdown(gsBreakdownEl, bd, { compact: true });
          if (bd.total != null && gsFinalTotal) {
            gsFinalTotal.textContent = formatCurrency(Number(bd.total), eventData?.currency || 'USD');
          }
        } catch {
          gsBreakdownEl.innerHTML = '';
        }
      })();
    }
  }

  document.getElementById('gs-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById('gs-pay').addEventListener('click', async () => {
    // v60: Collect per-ticket attendee data
    const attendees = collectAttendees(seats.length, 'gs');
    const validation = validateAttendees(attendees);
    if (!validation.valid) { showAlertModal({ title: 'Required Field', message: validation.message }); return; }
    const name = attendees[0].name;
    const email = attendees[0].email;
    const phone = attendees[0].phone;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAlertModal({ title: 'Invalid Email', message: 'Please enter a valid email for Ticket 1.' }); return; }
    if (!phone || phone.length < 7) { showAlertModal({ title: 'Invalid Phone', message: 'Please enter a valid phone for Ticket 1.' }); return; }

    const payBtn = document.getElementById('gs-pay');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span style="display:inline-block;width:18px;height:18px;border:2px solid rgba(0,0,0,.3);border-top-color:var(--bg-primary);border-radius:50%;animation:spin 0.6s linear infinite;"></span> Reserving…';

    try {
      const result = await createGuestSeatedCheckout({
        tierId,
        seatIds,
        guestName: name,
        guestEmail: email,
        guestPhone: phone,
        attendees,
        promoCode: appliedPromo?.code || null,
      });

      if (result.checkout_url) {
        modal.remove();
        startReservationTimer();
        window.location.href = result.checkout_url;
      }
    } catch (err) {
      showAlertModal({ title: 'Reservation Failed', message: err.message || 'Failed to reserve seats. Please try again.', buttonColor: '#dc2626' });
      payBtn.disabled = false;
      payBtn.innerHTML = 'Pay as Guest <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg>';
    }
  });
}

// ── Demo fallback ──
function renderDemoEvent(id) {
  const demos = {
    'demo-1': { title: 'Neon Pulse Music Festival', description: 'Experience the ultimate music festival featuring top international and local artists. Three stages, immersive light shows, and unforgettable performances under the Cairo sky.', cover_image: 'images/event-concert.png', category: 'music', venue: 'Cairo International Stadium', venue_address: 'Nasr City, Cairo, Egypt', date: '2026-05-17T20:00:00+02:00', ticket_tiers: [{ id:'t1', name:'General Admission', description:'Access to all main areas', price:850, capacity:500, sold_count:477, sort_order:1 }, { id:'t2', name:'VIP', description:'Premium viewing area, complimentary drinks', price:2500, capacity:100, sold_count:72, sort_order:2 }, { id:'t3', name:'VVIP', description:'Front row, private area, full service', price:5000, capacity:30, sold_count:28, sort_order:3 }] },
    'demo-2': { title: 'The Golden Gala 2026', description: 'An evening of elegance and sophistication. Black-tie charity gala featuring live jazz, gourmet dining, and exclusive art exhibitions.', cover_image: 'images/event-gala.png', category: 'gala', venue: 'Royal Maxim Palace', venue_address: 'First Settlement, New Cairo, Egypt', date: '2026-06-06T19:30:00+02:00', ticket_tiers: [{ id:'t4', name:'Standard', description:'Dinner, drinks, and entertainment', price:2500, capacity:200, sold_count:192, sort_order:1 }, { id:'t5', name:'Premium Table', description:'Reserved table for 8, premium wine selection', price:15000, capacity:25, sold_count:17, sort_order:2 }] },
    'demo-3': { title: 'Future Tech Summit 2026', description: 'Two days of cutting-edge technology talks, workshops, and networking. Featuring speakers from Google, Meta, and leading Egyptian tech startups.', cover_image: 'images/event-conference.png', category: 'conference', venue: 'GrEEK Campus', venue_address: 'Downtown Cairo, Egypt', date: '2026-06-15T09:00:00+02:00', ticket_tiers: [{ id:'t6', name:'Day Pass', description:'Single day access', price:450, capacity:300, sold_count:158, sort_order:1 }, { id:'t7', name:'Full Pass', description:'Both days + networking dinner', price:750, capacity:200, sold_count:89, sort_order:2 }, { id:'t8', name:'Speaker Access', description:'Full pass + speaker lounge', price:1500, capacity:50, sold_count:31, sort_order:3 }] },
  };
  const demo = demos[id];
  if (demo) {
    eventData = demo;
    renderEvent(demo);
  } else {
    document.getElementById('event-title').textContent = 'Event Not Found';
  }
}

// ── Reservation Timer (10 minutes) ──
let _reservationInterval = null;
function startReservationTimer() {
  const timerWrap = document.getElementById('reservation-timer');
  const timerDisplay = document.getElementById('timer-display');
  if (!timerWrap || !timerDisplay) return;

  // M-fe-4 FIX: Clear any previously running timer
  if (_reservationInterval) clearInterval(_reservationInterval);

  timerWrap.style.display = 'block';
  let seconds = 2100; // 35 minutes (matches DB reservation TTL)

  _reservationInterval = setInterval(() => {
    seconds--;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    if (seconds <= 60) {
      timerDisplay.style.color = '#ef4444';
    }
    if (seconds <= 0) {
      clearInterval(_reservationInterval);
      _reservationInterval = null;
      timerDisplay.textContent = 'Expired';
    }
  }, 1000);
}

// M-fe-4 FIX: Clean up reservation timer on page unload
window.addEventListener('beforeunload', () => {
  if (_reservationInterval) {
    clearInterval(_reservationInterval);
    _reservationInterval = null;
  }
});
