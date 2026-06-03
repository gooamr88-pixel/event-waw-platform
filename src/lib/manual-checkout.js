/* ===================================
   EVENTSLI — Manual Checkout Flow (Buyer Side)
   Shows the manual transfer checkout modal when a buyer
   selects a non-Stripe payment method (Vodafone Cash, etc.)
   =================================== */
import { supabase, SUPABASE_FUNCTIONS_URL, supabaseAnonKey } from './supabase.js';
import { showAlertModal } from './ui-modals.js';
import { setSafeHTML } from './dom.js';

/**
 * Shows the manual transfer checkout modal.
 * @param {object} opts - { eventId, tierId, quantity, paymentMethod, promoCode, eventTitle }
 */
export async function showManualCheckoutModal(opts) {
  const { eventId, tierId, quantity, paymentMethod, promoCode, eventTitle, seatIds } = opts;
  injectStyles();

  // Remove any existing modal
  document.getElementById('mc-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'mc-modal';
  modal.className = 'mc-overlay';
  modal.innerHTML = `
    <div class="mc-dialog">
      <div class="mc-header">
        <h3>📱 Manual Transfer Checkout</h3>
        <button class="mc-close" id="mc-close">&times;</button>
      </div>
      <div class="mc-body" id="mc-body">
        <div class="mc-step" id="mc-step-form">
          <p class="mc-subtitle">Complete your details to receive transfer instructions</p>
          <div class="mc-field">
            <label>Full Name *</label>
            <input type="text" id="mc-name" class="mc-input" placeholder="Your full name" required />
          </div>
          <div class="mc-field">
            <label>Email *</label>
            <input type="email" id="mc-email" class="mc-input" placeholder="you@example.com" required />
          </div>
          <div class="mc-field">
            <label>Phone Number *</label>
            <input type="tel" id="mc-phone" class="mc-input" placeholder="01XXXXXXXXX" required />
          </div>
          <div class="mc-field">
            <label>Notes (optional)</label>
            <input type="text" id="mc-notes" class="mc-input" placeholder="Any notes about your transfer" />
          </div>
          <button class="mc-btn mc-btn-primary" id="mc-submit">Continue →</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Pre-fill from auth if available
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle();
      if (profile?.full_name) document.getElementById('mc-name').value = profile.full_name;
      if (user.email) document.getElementById('mc-email').value = user.email;
      if (profile?.phone) document.getElementById('mc-phone').value = profile.phone;
    }
  } catch { /* non-critical */ }

  // Close handlers
  document.getElementById('mc-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Submit handler
  document.getElementById('mc-submit').addEventListener('click', async () => {
    const name = document.getElementById('mc-name').value.trim();
    const email = document.getElementById('mc-email').value.trim();
    const phone = document.getElementById('mc-phone').value.trim();
    const notes = document.getElementById('mc-notes').value.trim();

    if (!name || !email || !phone) {
      showToast('Please fill in all required fields (*).', 'warning');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Please enter a valid email address.', 'error');
      return;
    }

    // H23 FIX: Validate tier/event IDs exist before sending to server
    if (!tierId || !eventId) {
      showToast('Invalid ticket selection. Please try again.', 'error');
      return;
    }
    // Strict phone validation supporting Egyptian (01XXXXXXXXX) or generic international numbers
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (!/^(\+?)[0-9]{8,15}$/.test(cleanPhone)) {
      showToast('Please enter a valid phone number (e.g., 01XXXXXXXXX).', 'error');
      return;
    }

    const btn = document.getElementById('mc-submit');
    btn.disabled = true;
    btn.textContent = 'Creating order…';

    try {
      // Get session for auth header (if logged in)
      const { data: { session } } = await supabase.auth.getSession();

      const headers = { 'Content-Type': 'application/json' };
      // Send authenticated session token or fallback to the public anon key for guests.
      // This satisfies the API Gateway's JWT verification (if enabled) while allowing the
      // Edge Function to distinguish guest orders by parsing the JWT role or key value.
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      } else {
        headers['Authorization'] = `Bearer ${supabaseAnonKey}`;
      }

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-manual-order`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event_id: eventId,
          tier_id: tierId,
          quantity: quantity || 1,
          payment_method: paymentMethod,
          buyer_name: name,
          buyer_email: email,
          buyer_phone: phone,
          buyer_notes: notes || undefined,
          promo_code: promoCode || undefined,
          seat_ids: seatIds || undefined,
        }),
      });

      // Safe JSON and text parsing to handle edge HTML error pages gracefully
      const resText = await res.text();
      let data = {};
      try {
        data = JSON.parse(resText);
      } catch (jsonErr) {
        throw new Error(`The server returned an invalid response (Status ${res.status}). Please try again later.`);
      }

      if (!res.ok || data.error) throw new Error(data.error || `Server error: ${res.status}`);

      // Success — show transfer instructions
      showTransferInstructions(modal, data);
    } catch (err) {
      showToast('Checkout Failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Continue →';
    }
  });
}

function showTransferInstructions(modal, data) {
  const methodLabels = {
    vodafone_cash: '📱 Vodafone Cash', instapay: '🏦 InstaPay',
    bank_transfer: '🏧 Bank Transfer', fawry: '💳 Fawry'
  };
  const fmt = (v) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: data.currency || 'EGP', minimumFractionDigits: 2
  }).format(v || 0);

  const body = modal.querySelector('#mc-body');
  setSafeHTML(body, `
    <div class="mc-step">
      <div class="mc-success-icon">✅</div>
      <h3 class="mc-success-title">Order Created!</h3>
      <p class="mc-subtitle">Send the payment using the details below, then confirm.</p>

      <div class="mc-info-card">
        <div class="mc-info-row">
          <span>Method</span>
          <strong>${methodLabels[data.payment_method] || data.payment_method}</strong>
        </div>
        <div class="mc-info-row">
          <span>Send To</span>
          <strong class="mc-dest">${esc(data.transfer_destination || 'See organizer instructions')}</strong>
        </div>
        <div class="mc-info-row mc-ref-row">
          <span>Reference Code</span>
          <strong class="mc-ref-code" id="mc-ref">${esc(data.transfer_reference)}</strong>
          <button class="mc-copy-btn" id="mc-copy" title="Copy reference">📋</button>
        </div>
        <div class="mc-info-row mc-amount-row">
          <span>Amount</span>
          <strong class="mc-amount">${fmt(data.total_amount)}</strong>
        </div>
      </div>

      ${data.transfer_instructions ? `
        <div class="mc-instructions">
          <strong>📝 Organizer Instructions:</strong>
          <p>${esc(data.transfer_instructions)}</p>
        </div>
      ` : ''}

      <p class="mc-expires-note">⏳ This order expires in 24 hours. Please send payment and confirm below.</p>

      <button class="mc-btn mc-btn-primary" id="mc-confirm-paid">I've Sent the Payment ✓</button>
    </div>
  `);

  // Copy button
  document.getElementById('mc-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(data.transfer_reference).then(() => showToast('Reference copied!', 'success'));
  });

  // Confirm payment button
  document.getElementById('mc-confirm-paid')?.addEventListener('click', async () => {
    const btn = document.getElementById('mc-confirm-paid');
    btn.disabled = true;
    btn.textContent = 'Confirming…';

    try {
      const { data: result, error } = await supabase.rpc('mark_manual_order_paid', {
        p_order_id: data.order_id,
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);

      // Show final confirmation
      body.innerHTML = `
        <div class="mc-step mc-final">
          <div class="mc-success-icon">🎉</div>
          <h3 class="mc-success-title">Payment Confirmed!</h3>
          <p class="mc-subtitle">Your order is now pending organizer approval. You'll receive your tickets via email once the organizer confirms your payment.</p>
          <div class="mc-ref-display">Reference: <strong>${esc(data.transfer_reference)}</strong></div>
          <button class="mc-btn mc-btn-outline" id="mc-done">Close</button>
        </div>
      `;
      document.getElementById('mc-done')?.addEventListener('click', () => modal.remove());
    } catch (err) {
      showToast('Confirmation Failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'I\'ve Sent the Payment ✓';
    }
  });
}

function showToast(message, type = 'success') {
  let container = document.getElementById('mc-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'mc-toast-container';
    Object.assign(container.style, {
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '9999999', display: 'flex', flexDirection: 'column', gap: '10px',
      pointerEvents: 'none', width: '90%', maxWidth: '400px'
    });
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `mc-toast ${type}`;
  
  let bgColor, borderColor, icon, textColor;
  if (type === 'error') {
    bgColor = 'rgba(239, 68, 68, 0.98)';
    borderColor = 'rgba(239, 68, 68, 0.2)';
    textColor = '#ffffff';
    icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
  } else if (type === 'warning') {
    bgColor = 'rgba(245, 158, 11, 0.98)';
    borderColor = 'rgba(245, 158, 11, 0.2)';
    textColor = '#ffffff';
    icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    bgColor = 'rgba(16, 185, 129, 0.98)';
    borderColor = 'rgba(16, 185, 129, 0.2)';
    textColor = '#ffffff';
    icon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }

  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px; pointer-events: auto; cursor: pointer; background: ${bgColor}; border: 1px solid ${borderColor}; color: ${textColor}; padding: 12px 18px; border-radius: 12px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); font-size: 0.88rem; font-weight: 600; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1); transform: translateY(-20px); opacity: 0;">
      <span style="display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: rgba(255, 255, 255, 0.15); padding: 5px; border-radius: 8px;">${icon}</span>
      <div style="flex: 1; line-height: 1.4; letter-spacing: -0.01em;" class="mc-toast-msg"></div>
    </div>
  `;
  // FIX: Use textContent to prevent XSS from server error messages
  toast.querySelector('.mc-toast-msg').textContent = message;

  const toastCard = toast.firstElementChild;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toastCard.style.transform = 'translateY(0)';
    toastCard.style.opacity = '1';
  });

  toastCard.addEventListener('click', () => {
    dismissToast(toast, toastCard);
  });

  const timeoutId = setTimeout(() => {
    dismissToast(toast, toastCard);
  }, 4000);

  function dismissToast(el, card) {
    clearTimeout(timeoutId);
    card.style.transform = 'translateY(-20px) scale(0.95)';
    card.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      if (container.children.length === 0) {
        container.remove();
      }
    }, 350);
  }
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

function injectStyles() {
  if (document.getElementById('mc-modal-styles')) return;
  const style = document.createElement('style');
  style.id = 'mc-modal-styles';
  style.textContent = `
    .mc-overlay { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.55); backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; animation:mcFadeIn .25s ease; }
    @keyframes mcFadeIn { from{opacity:0} to{opacity:1} }
    .mc-dialog { width:460px; max-width:95vw; max-height:90vh; overflow-y:auto; background:var(--ev-bg-card,#fff); border-radius:18px; box-shadow:0 24px 60px rgba(0,0,0,.35); }
    .mc-header { display:flex; justify-content:space-between; align-items:center; padding:18px 24px; border-bottom:1px solid var(--ev-border); }
    .mc-header h3 { margin:0; font-size:1.1rem; font-weight:700; }
    .mc-close { background:none; border:none; font-size:1.5rem; color:var(--ev-text-muted); cursor:pointer; padding:4px; }
    .mc-body { padding:24px; }
    .mc-subtitle { font-size:.85rem; color:var(--ev-text-muted); margin:0 0 18px; }
    .mc-field { margin-bottom:14px; }
    .mc-field label { display:block; font-size:.82rem; font-weight:600; margin-bottom:6px; }
    .mc-input { width:100%; padding:11px 14px; border-radius:10px; border:1px solid var(--ev-border); background:var(--ev-bg,#fff); font-size:.9rem; box-sizing:border-box; transition:border-color .2s; }
    .mc-input:focus { border-color:var(--ev-pink,#ec4899); outline:none; }
    .mc-btn { padding:13px 20px; border-radius:12px; border:none; font-size:.9rem; font-weight:700; cursor:pointer; width:100%; transition:all .2s; }
    .mc-btn-primary { background:linear-gradient(135deg,#ec4899,#8b5cf6); color:#fff; }
    .mc-btn-primary:hover { opacity:.9; transform:translateY(-1px); }
    .mc-btn-primary:disabled { opacity:.5; cursor:not-allowed; transform:none; }
    .mc-btn-outline { background:none; border:1px solid var(--ev-border); color:var(--ev-text-primary); }
    .mc-success-icon { font-size:3rem; text-align:center; margin-bottom:12px; }
    .mc-success-title { text-align:center; font-size:1.2rem; font-weight:700; margin:0 0 8px; }
    .mc-info-card { background:rgba(99,102,241,.05); border:1px solid rgba(99,102,241,.15); border-radius:14px; padding:16px; margin:16px 0; }
    .mc-info-row { display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(99,102,241,.08); }
    .mc-info-row:last-child { border-bottom:none; }
    .mc-info-row span { font-size:.82rem; color:var(--ev-text-muted); }
    .mc-info-row strong { font-size:.9rem; }
    .mc-ref-row { gap:8px; }
    .mc-ref-code { font-family:monospace; font-size:1.1rem; color:var(--ev-pink,#ec4899); letter-spacing:.05em; }
    .mc-copy-btn { background:none; border:none; cursor:pointer; font-size:1rem; padding:4px; }
    .mc-amount-row strong { font-size:1.3rem; font-weight:800; color:var(--ev-pink,#ec4899); }
    .mc-dest { word-break:break-all; }
    .mc-instructions { padding:14px; border-radius:10px; background:rgba(245,158,11,.06); border:1px solid rgba(245,158,11,.15); margin:14px 0; font-size:.85rem; }
    .mc-instructions strong { display:block; margin-bottom:6px; }
    .mc-instructions p { margin:0; color:var(--ev-text-muted); }
    .mc-expires-note { font-size:.8rem; color:var(--ev-text-muted); text-align:center; margin:14px 0; }
    .mc-final { text-align:center; }
    .mc-ref-display { font-size:.9rem; margin:16px 0; padding:12px; background:rgba(99,102,241,.05); border-radius:10px; }
  `;
  document.head.appendChild(style);
}
