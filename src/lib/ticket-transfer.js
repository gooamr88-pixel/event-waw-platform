/* ===================================
   EVENTSLI — Ticket Transfer Module
   Phase 8 Task 3: BRD Section 20
   ===================================
   Provides the transfer modal/dialog
   that can be launched from any page
   showing a user's ticket.
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';

/**
 * Shows a ticket transfer modal.
 * @param {string} ticketId - The ticket UUID to transfer
 * @param {object} ticketInfo - Optional display info { eventTitle, tierName, attendeeName }
 * @param {function} onSuccess - Callback after successful transfer
 */
export function showTransferModal(ticketId, ticketInfo = {}, onSuccess) {
  // Remove any existing modal
  document.getElementById('ticket-transfer-modal')?.remove();

  injectTransferStyles();

  const modal = document.createElement('div');
  modal.id = 'ticket-transfer-modal';
  modal.className = 'ttf-modal-overlay';
  modal.innerHTML = `
    <div class="ttf-modal-dialog">
      <div class="ttf-modal-header">
        <h3>🔄 Transfer Ticket</h3>
        <button class="ttf-modal-close" id="ttf-close">&times;</button>
      </div>
      <div class="ttf-modal-body">
        <div class="ttf-ticket-info">
          <div class="ttf-ticket-label">${esc(ticketInfo.eventTitle || 'Event Ticket')}</div>
          <div class="ttf-ticket-sub">${esc(ticketInfo.tierName || 'General Admission')}${ticketInfo.attendeeName ? ` • ${esc(ticketInfo.attendeeName)}` : ''}</div>
        </div>

        <div class="ttf-warning">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <div>
            <strong>Important:</strong> Transferring this ticket will invalidate your current QR code and generate a new one for the recipient. This action cannot be undone.
          </div>
        </div>

        <div class="ev-form-group" style="margin-bottom:14px">
          <label style="font-size:.85rem;font-weight:600">Recipient's Full Name *</label>
          <input type="text" class="ev-form-input" id="ttf-name" placeholder="e.g. Ahmed Hassan" required />
        </div>
        <div class="ev-form-group" style="margin-bottom:20px">
          <label style="font-size:.85rem;font-weight:600">Recipient's Email *</label>
          <input type="email" class="ev-form-input" id="ttf-email" placeholder="e.g. friend@email.com" required />
        </div>

        <button class="ev-btn ev-btn-primary ttf-submit-btn" id="ttf-submit" style="width:100%;padding:13px;justify-content:center">
          Transfer Ticket
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close handlers
  document.getElementById('ttf-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Submit
  document.getElementById('ttf-submit').addEventListener('click', async () => {
    const nameInput = document.getElementById('ttf-name');
    const emailInput = document.getElementById('ttf-email');
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!name) { nameInput.focus(); nameInput.style.borderColor = '#ef4444'; return; }
    if (!email || !email.includes('@')) { emailInput.focus(); emailInput.style.borderColor = '#ef4444'; return; }

    const btn = document.getElementById('ttf-submit');
    btn.disabled = true;
    btn.textContent = 'Transferring...';

    try {
      const { data, error } = await supabase.rpc('transfer_ticket', {
        p_ticket_id: ticketId,
        p_new_email: email,
        p_new_name: name
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Success state
      setSafeHTML(modal.querySelector('.ttf-modal-body'), `
        <div style="text-align:center;padding:30px 0">
          <div style="width:64px;height:64px;border-radius:50%;background:rgba(34,197,94,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:1.8rem">✓</div>
          <h3 style="font-size:1.05rem;font-weight:700;margin-bottom:8px">Ticket Transferred!</h3>
          <p style="color:var(--ev-text-muted);font-size:.85rem;margin-bottom:4px">
            <strong>${esc(data.tier_name || 'Ticket')}</strong> for <strong>${esc(data.event_title || 'Event')}</strong>
          </p>
          <p style="color:var(--ev-text-muted);font-size:.85rem;margin-bottom:16px">
            has been transferred to <strong>${esc(data.new_attendee)}</strong> (${esc(data.new_email)}).
          </p>
          <p style="color:#f59e0b;font-size:.78rem;margin-bottom:20px">
            ⚠ Your old QR code is now invalid.
          </p>
          <button class="ev-btn ev-btn-outline" onclick="this.closest('.ttf-modal-overlay').remove()" style="padding:10px 24px">Close</button>
        </div>
      `);

      if (typeof onSuccess === 'function') onSuccess(data);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Transfer Ticket';

      // Show error below button
      let errDiv = modal.querySelector('.ttf-error');
      if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.className = 'ttf-error';
        btn.after(errDiv);
      }
      errDiv.textContent = '❌ ' + err.message;
    }
  });
}

/* ── Utilities ── */

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function injectTransferStyles() {
  if (document.getElementById('ttf-styles')) return;
  const style = document.createElement('style');
  style.id = 'ttf-styles';
  style.textContent = `
    .ttf-modal-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: ttfFade .2s ease;
    }
    @keyframes ttfFade { from { opacity: 0; } to { opacity: 1; } }
    .ttf-modal-dialog {
      width: 460px; max-width: 95vw;
      background: var(--ev-bg-card, var(--bg-card, #fff)); border-radius: 16px;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .ttf-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 24px; border-bottom: 1px solid var(--ev-border, var(--border-color, #eee));
    }
    .ttf-modal-header h3 { margin: 0; font-size: 1.05rem; font-weight: 700; }
    .ttf-modal-close {
      background: none; border: none; font-size: 1.5rem;
      color: var(--ev-text-muted, var(--text-muted)); cursor: pointer;
    }
    .ttf-modal-body { padding: 24px; }
    .ttf-ticket-info {
      padding: 14px 16px; border-radius: 10px;
      background: rgba(5,150,105,.06); border: 1px solid rgba(5,150,105,.15);
      margin-bottom: 16px;
    }
    .ttf-ticket-label { font-weight: 700; font-size: .95rem; margin-bottom: 2px; }
    .ttf-ticket-sub { font-size: .78rem; color: var(--ev-text-muted, var(--text-muted)); }
    .ttf-warning {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 12px 14px; border-radius: 10px;
      background: rgba(245,158,11,.06); border: 1px solid rgba(245,158,11,.2);
      margin-bottom: 20px; font-size: .8rem; line-height: 1.5;
      color: var(--ev-text-sec, var(--text-secondary));
    }
    .ttf-warning svg { flex-shrink: 0; color: #f59e0b; margin-top: 2px; }
    .ttf-submit-btn { font-size: .9rem; font-weight: 600; }
    .ttf-error {
      margin-top: 10px; padding: 10px 14px; border-radius: 8px;
      background: rgba(239,68,68,.08); color: #ef4444; font-size: .82rem;
    }
  `;
  document.head.appendChild(style);
}
