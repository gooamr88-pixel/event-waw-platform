/* ===================================
   EVENTSLI — Admin Commission Debt Panel
   =================================== */

import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';

const esc = (s) => { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; };

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .acd-stats { display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px; }
    .acd-stat { padding:18px;border-radius:14px;border:1px solid var(--ev-border,rgba(255,255,255,.08)); background:var(--ev-card,#1a1a2e); }
    .acd-stat-val { font-size:1.4rem;font-weight:800;font-family:var(--ev-font-serif,'Georgia',serif); }
    .acd-stat-label { font-size:.72rem;color:var(--ev-text-muted,#888);text-transform:uppercase;letter-spacing:.06em;margin-top:4px; }
    .acd-badge { padding:3px 10px;border-radius:50px;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em; }
    .acd-badge.accruing { background:rgba(59,130,246,.15);color:#60a5fa; }
    .acd-badge.due { background:rgba(234,179,8,.15);color:#eab308; }
    .acd-badge.overdue { background:rgba(239,68,68,.15);color:#ef4444; }
    .acd-badge.settled { background:rgba(34,197,94,.15);color:#22c55e; }
    .acd-badge.waived { background:rgba(120,120,120,.15);color:#888; }
    .acd-settle-modal { position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .3s ease; }
    .acd-settle-box { max-width:420px;width:100%;background:var(--ev-card,#1a1a2e);border:1px solid var(--ev-border,rgba(255,255,255,.1));border-radius:18px;padding:28px 24px; }
    .acd-settle-box h3 { font-family:var(--ev-font-serif,'Georgia',serif);font-size:1.1rem;font-weight:700;margin-bottom:16px; }
    .acd-settle-box .ev-form-group { margin-bottom:14px; }
    @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  `;
  document.head.appendChild(style);
}

export async function renderAdminCommissionPanel(container) {
  injectStyles();

  try {
    const { data, error } = await supabase
      .from('commission_debt')
      .select('*, events(title, date)')
      .order('commission_balance', { ascending: false });

    if (error) throw error;

    // Also fetch organizer profiles separately (FK name might vary)
    const orgIds = [...new Set((data || []).map(d => d.organizer_id).filter(Boolean))];
    let profileMap = {};
    if (orgIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', orgIds);
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
    }

    const rows = data || [];
    const outstanding = rows.filter(r => r.commission_balance > 0);
    const totalOutstanding = outstanding.reduce((s, r) => s + Number(r.commission_balance), 0);
    const lockedCount = rows.filter(r => r.scanner_locked).length;
    const settledCount = rows.filter(r => r.status === 'settled').length;

    // Update badge
    const badge = document.getElementById('commission-debt-count');
    if (badge) {
      if (outstanding.length > 0) { badge.textContent = outstanding.length; badge.style.display = ''; }
      else { badge.style.display = 'none'; }
    }

    let html = `
      <div class="acd-stats">
        <div class="acd-stat"><div class="acd-stat-val" style="color:#ef4444">${totalOutstanding.toLocaleString()} EGP</div><div class="acd-stat-label">Total Outstanding</div></div>
        <div class="acd-stat"><div class="acd-stat-val" style="color:#eab308">${lockedCount}</div><div class="acd-stat-label">Locked Events</div></div>
        <div class="acd-stat"><div class="acd-stat-val" style="color:#22c55e">${settledCount}</div><div class="acd-stat-label">Settled</div></div>
        <div class="acd-stat"><div class="acd-stat-val">${rows.length}</div><div class="acd-stat-label">Total Records</div></div>
      </div>
    `;

    if (rows.length === 0) {
      html += '<div class="ev-card" style="padding:40px;text-align:center"><p style="color:var(--ev-text-muted)">No commission debt records yet.</p></div>';
    } else {
      html += `<div class="ev-card"><div class="ev-table-wrap"><table class="ev-table">
        <thead><tr><th>#</th><th>Organizer</th><th>Event</th><th>Owed</th><th>Paid</th><th>Balance</th><th>Status</th><th>Lock</th><th>Actions</th></tr></thead>
        <tbody>`;

      rows.forEach((r, i) => {
        const p = profileMap[r.organizer_id];
        const orgName = p ? esc(p.full_name || p.email) : esc(r.organizer_id?.substring(0, 8));
        const orgEmail = p?.email ? `<div style="font-size:.7rem;color:var(--ev-text-muted)">${esc(p.email)}</div>` : '';
        const evTitle = r.events?.title ? esc(r.events.title) : '—';
        const status = r.status || 'accruing';
        const lock = r.scanner_locked ? '🔒' : '🔓';
        const settleBtn = r.commission_balance > 0
          ? `<button class="ev-btn ev-btn-outline" style="font-size:.75rem;padding:5px 12px" data-settle="${r.event_id}" data-balance="${r.commission_balance}">💰 Settle</button>`
          : '<span style="font-size:.75rem;color:#22c55e">✓ Clear</span>';

        html += `<tr>
          <td>${i + 1}</td>
          <td>${orgName}${orgEmail}</td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${evTitle}</td>
          <td style="font-weight:600">${Number(r.commission_owed).toLocaleString()}</td>
          <td style="color:#22c55e">${Number(r.commission_paid).toLocaleString()}</td>
          <td style="font-weight:700;color:${r.commission_balance > 0 ? '#ef4444' : '#22c55e'}">${Number(r.commission_balance).toLocaleString()}</td>
          <td><span class="acd-badge ${status}">${status}</span></td>
          <td style="font-size:1.1rem;text-align:center">${lock}</td>
          <td>${settleBtn}</td>
        </tr>`;
      });

      html += '</tbody></table></div></div>';
    }

    setSafeHTML(container, html);

    // Settle button handlers
    container.querySelectorAll('[data-settle]').forEach(btn => {
      btn.addEventListener('click', () => showSettleModal(btn.dataset.settle, btn.dataset.balance, container));
    });
  } catch (err) {
    setSafeHTML(container, `<div class="ev-card" style="padding:20px;color:#ef4444">Error: ${esc(err.message)}</div>`);
  }
}

function showSettleModal(eventId, balance, panelContainer) {
  document.getElementById('acd-settle-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'acd-settle-modal';
  modal.className = 'acd-settle-modal';
  setSafeHTML(modal, `
    <div class="acd-settle-box">
      <h3>💰 Record <span style="color:var(--ev-accent,#d4af37)">Settlement</span></h3>
      <div class="ev-form-group">
        <label style="font-size:.82rem;font-weight:600">Amount (EGP)</label>
        <input class="ev-form-input" type="number" id="settle-amount" value="${esc(balance)}" min="0.01" step="0.01" />
      </div>
      <div class="ev-form-group">
        <label style="font-size:.82rem;font-weight:600">Settlement Method</label>
        <select class="ev-form-input" id="settle-method">
          <option value="bank_transfer">🏦 Bank Transfer</option>
          <option value="stripe_deduction">💳 Stripe Deduction</option>
          <option value="cash">💵 Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="ev-form-group">
        <label style="font-size:.82rem;font-weight:600">Reference / Note</label>
        <input class="ev-form-input" type="text" id="settle-reference" placeholder="Bank ref, receipt #, etc." />
      </div>
      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="ev-btn ev-btn-outline" id="settle-cancel" style="flex:1">Cancel</button>
        <button class="ev-btn" id="settle-confirm" style="flex:1;background:#059669;color:#fff;border:none;font-weight:600">Confirm Settlement</button>
      </div>
    </div>
  `);

  document.body.appendChild(modal);

  modal.querySelector('#settle-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  modal.querySelector('#settle-confirm').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('settle-amount').value);
    const method = document.getElementById('settle-method').value;
    const reference = document.getElementById('settle-reference').value.trim();

    if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }

    const confirmBtn = modal.querySelector('#settle-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Processing…';

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.rpc('settle_commission', {
        p_event_id: eventId,
        p_amount: amount,
        p_method: method,
        p_reference: reference || `Admin settlement - ${new Date().toISOString().split('T')[0]}`,
        p_admin_id: user.id,
      });

      if (error) throw error;

      modal.remove();
      showToast('Settlement recorded successfully!', 'success');
      await renderAdminCommissionPanel(panelContainer);
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Settlement';
      showToast('Error: ' + err.message, 'error');
    }
  });
}
