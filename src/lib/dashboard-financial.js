/* ===================================
   EVENTSLI — Organizer Financial Dashboard
   Phase 7 Task 2: BRD Section 8
   ===================================
   Renders financial metrics, balance cards,
   event breakdown, payout history, and
   Request Payout modal.
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';

/**
 * Renders the complete financial dashboard.
 */
export async function renderFinancialDashboard(container) {
  if (!container) return;

  try {
    const { data, error } = await supabase.rpc('get_organizer_financials');
    if (error) throw error;

    const fin = data;

    if (!fin || !fin.has_organizer) {
      setSafeHTML(container, `
        <div style="text-align:center;padding:60px 20px">
          <div style="font-size:3rem;margin-bottom:16px">💳</div>
          <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px">No Organizer Profile</h3>
          <p style="color:var(--ev-text-muted);font-size:.9rem">Set up your organizer profile and complete an event with ticket sales to see financial data.</p>
        </div>
      `);
      return;
    }

    injectStyles();

    const c = fin.currency || 'USD';
    const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, minimumFractionDigits: 2 }).format(v || 0);

    // ── Build UI ──
    let html = `
      <h2 style="font-size:1.15rem;font-weight:700;margin-bottom:18px">💳 Financial Overview</h2>

      <!-- Balance Cards -->
      <div class="fin-balance-grid">
        <div class="fin-balance-card fin-available">
          <div class="fin-balance-label">Available Balance</div>
          <div class="fin-balance-value">${fmt(fin.available_balance)}</div>
          <div class="fin-balance-sub">Ready for payout</div>
          ${fin.available_balance > 0 ? `<button class="ev-btn ev-btn-primary fin-payout-btn" id="fin-request-payout">💰 Request Payout</button>` : ''}
        </div>
        <div class="fin-balance-card fin-pending">
          <div class="fin-balance-label">Pending Balance</div>
          <div class="fin-balance-value">${fmt(fin.pending_balance)}</div>
          <div class="fin-balance-sub">Released ${fin.escrow_days} days after event ends</div>
        </div>
        <div class="fin-balance-card fin-paid">
          <div class="fin-balance-label">Total Paid Out</div>
          <div class="fin-balance-value">${fmt(fin.total_paid)}</div>
          <div class="fin-balance-sub">${fin.total_requested > 0 ? `${fmt(fin.total_requested)} pending payout` : 'All payouts completed'}</div>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="ev-stat-grid" style="margin-bottom:20px">
        <div class="ev-stat-card"><div class="ev-stat-icon green">💰</div><div><div class="ev-stat-value">${fmt(fin.gross_sales)}</div><div class="ev-stat-label">Gross Sales</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon orange">🏛️</div><div><div class="ev-stat-value">${fmt(fin.tax_collected)}</div><div class="ev-stat-label">Tax Collected</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon pink">📊</div><div><div class="ev-stat-value">${fmt(fin.platform_fees)}</div><div class="ev-stat-label">Platform Fees</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon blue">💵</div><div><div class="ev-stat-value">${fmt(fin.net_revenue)}</div><div class="ev-stat-label">Net Revenue</div></div></div>
      </div>
    `;

    // ── Event Breakdown Table ──
    const events = fin.events || [];
    html += `
      <div class="ev-card" style="margin-bottom:20px">
        <div class="ev-card-header"><span class="ev-card-title">📋 Per-Event Breakdown</span></div>
        <div class="ev-table-wrap">
          <table class="ev-table">
            <thead><tr><th>#</th><th>Event</th><th>Orders</th><th>Gross</th><th>Tax</th><th>Fees</th><th>Net</th><th>Status</th></tr></thead>
            <tbody>
    `;

    if (events.length === 0) {
      html += `<tr><td colspan="8" class="ev-table-empty">No revenue events yet</td></tr>`;
    } else {
      events.forEach((ev, i) => {
        const statusClass = ev.balance_status === 'available' ? 'ev-badge-green' : 'ev-badge-yellow';
        const statusLabel = ev.balance_status === 'available' ? 'Released' : `Escrow until ${ev.release_date}`;
        html += `
          <tr>
            <td>${i + 1}</td>
            <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.event_title)}</td>
            <td>${ev.order_count}</td>
            <td>${fmt(ev.gross_sales)}</td>
            <td>${fmt(ev.tax)}</td>
            <td>${fmt(ev.fees)}</td>
            <td style="font-weight:700">${fmt(ev.net)}</td>
            <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;

    // ── Payout History ──
    const payouts = fin.recent_payouts || [];
    html += `
      <div class="ev-card">
        <div class="ev-card-header"><span class="ev-card-title">💸 Payout History</span></div>
        <div class="ev-table-wrap">
          <table class="ev-table">
            <thead><tr><th>#</th><th>Amount</th><th>Method</th><th>Event</th><th>Status</th><th>Requested</th><th>Processed</th></tr></thead>
            <tbody>
    `;

    if (payouts.length === 0) {
      html += `<tr><td colspan="7" class="ev-table-empty">No payouts yet</td></tr>`;
    } else {
      const statusColors = { pending: 'ev-badge-yellow', processing: 'ev-badge-blue', completed: 'ev-badge-green', failed: 'ev-badge-red', cancelled: 'ev-badge-red' };
      payouts.forEach((po, i) => {
        const fees = Number(po.platform_fees || 0);
        const hasFees = fees > 0;
        html += `
          <tr>
            <td>${i + 1}</td>
            <td style="font-weight:700;vertical-align:top">
              ${fmt(po.net_amount)}
              ${hasFees ? `
                <div style="font-size:.7rem;font-weight:400;color:var(--ev-text-muted);margin-top:4px;line-height:1.3">
                  Gross: ${fmt(po.gross_amount)}<br/>
                  <span style="color:#ef4444">Deducted: ${fmt(po.platform_fees)}</span>
                </div>
              ` : ''}
            </td>
            <td>${esc(po.payout_method)}</td>
            <td>${esc(po.event_title || 'Multi-event')}</td>
            <td><span class="ev-badge ${statusColors[po.status] || ''}">${esc(po.status)}</span>${po.failure_reason ? ` <span title="${escAttr(po.failure_reason)}" style="cursor:help">⚠</span>` : ''}</td>
            <td>${po.requested_at ? new Date(po.requested_at).toLocaleDateString() : '—'}</td>
            <td>${po.processed_at ? new Date(po.processed_at).toLocaleDateString() : '—'}</td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;

    setSafeHTML(container, html);

    // ── Request Payout Button Handler ──
    document.getElementById('fin-request-payout')?.addEventListener('click', () => {
      showPayoutModal(fin);
    });

  } catch (err) {
    setSafeHTML(container, `<div style="text-align:center;padding:40px;color:var(--ev-danger)">Failed to load financial data: ${esc(err.message)}</div>`);
  }
}

/* ── Payout Request Modal ── */

function showPayoutModal(fin) {
  document.getElementById('fin-payout-modal')?.remove();

  const c = fin.currency || 'USD';
  const fmt = (v) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(v || 0);
  const maxAmount = fin.available_balance || 0;

  const modal = document.createElement('div');
  modal.id = 'fin-payout-modal';
  modal.className = 'fin-modal-overlay';
  modal.innerHTML = `
    <div class="fin-modal-dialog">
      <div class="fin-modal-header">
        <h3>💰 Request Payout</h3>
        <button class="fin-modal-close" id="fin-modal-close">&times;</button>
      </div>
      <div class="fin-modal-body">
        <div class="fin-modal-balance">
          <span>Available Balance</span>
          <strong>${fmt(maxAmount)}</strong>
        </div>
        <div class="ev-form-group" style="margin-bottom:16px">
          <label style="font-size:.85rem;font-weight:600">Payout Amount</label>
          <input type="number" class="ev-form-input" id="fin-payout-amount" value="${maxAmount}" min="1" max="${maxAmount}" step="0.01" />
        </div>
        <p style="font-size:.8rem;color:var(--ev-text-muted);margin-bottom:16px">
          The payout will be processed by our team within 3-5 business days to your registered payment method.
        </p>
        <button class="ev-btn ev-btn-primary" id="fin-payout-submit" style="width:100%;padding:13px;justify-content:center">
          Submit Payout Request
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close
  document.getElementById('fin-modal-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Submit
  document.getElementById('fin-payout-submit').addEventListener('click', async () => {
    const amount = parseFloat(document.getElementById('fin-payout-amount').value);
    if (!amount || amount <= 0 || amount > maxAmount) {
      showToast(`Amount must be between 1 and ${fmt(maxAmount)}`, 'error');
      return;
    }

    const btn = document.getElementById('fin-payout-submit');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
      const { data, error } = await supabase.rpc('request_payout', { p_amount: amount });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      showToast(`Payout of ${fmt(amount)} requested successfully!`, 'success');
      modal.remove();

      // Refresh financial dashboard
      renderFinancialDashboard(document.getElementById('financial-dashboard-body'));
    } catch (err) {
      showToast('Payout request failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Submit Payout Request';
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

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function injectStyles() {
  if (document.getElementById('fin-dash-styles')) return;
  const style = document.createElement('style');
  style.id = 'fin-dash-styles';
  style.textContent = `
    .fin-balance-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;
    }
    @media (max-width: 768px) { .fin-balance-grid { grid-template-columns: 1fr; } }
    .fin-balance-card {
      padding: 24px; border-radius: 14px; border: 1px solid var(--ev-border);
      background: var(--ev-bg-card, var(--bg-card)); position: relative; overflow: hidden;
    }
    .fin-balance-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
    }
    .fin-available::before { background: linear-gradient(90deg, #22c55e, #10b981); }
    .fin-pending::before { background: linear-gradient(90deg, #f59e0b, #eab308); }
    .fin-paid::before { background: linear-gradient(90deg, #3b82f6, #6366f1); }
    .fin-balance-label {
      font-size: .75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: .06em; color: var(--ev-text-muted); margin-bottom: 8px;
    }
    .fin-balance-value {
      font-size: 1.8rem; font-weight: 800; margin-bottom: 4px;
      font-family: var(--ev-font-serif, var(--font-serif));
    }
    .fin-available .fin-balance-value { color: #22c55e; }
    .fin-pending .fin-balance-value { color: #f59e0b; }
    .fin-paid .fin-balance-value { color: #3b82f6; }
    .fin-balance-sub {
      font-size: .78rem; color: var(--ev-text-muted);
    }
    .fin-payout-btn {
      margin-top: 14px; font-size: .85rem; padding: 10px 20px;
    }
    .ev-badge-green { background: rgba(34,197,94,.1); color: #22c55e; }
    .ev-badge-yellow { background: rgba(245,158,11,.1); color: #f59e0b; }
    .ev-badge-blue { background: rgba(59,130,246,.1); color: #3b82f6; }
    .ev-badge-red { background: rgba(239,68,68,.1); color: #ef4444; }

    /* Payout Modal */
    .fin-modal-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: finFadeIn .2s ease;
    }
    @keyframes finFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .fin-modal-dialog {
      width: 440px; max-width: 95vw;
      background: var(--ev-bg-card, #fff); border-radius: 16px;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .fin-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 24px; border-bottom: 1px solid var(--ev-border);
    }
    .fin-modal-header h3 { margin: 0; font-size: 1.05rem; font-weight: 700; }
    .fin-modal-close {
      background: none; border: none; font-size: 1.5rem;
      color: var(--ev-text-muted); cursor: pointer;
    }
    .fin-modal-body { padding: 24px; }
    .fin-modal-balance {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px; background: rgba(34,197,94,.08); border-radius: 10px;
      margin-bottom: 20px; border: 1px solid rgba(34,197,94,.2);
    }
    .fin-modal-balance span { color: var(--ev-text-muted); font-size: .85rem; }
    .fin-modal-balance strong { color: #22c55e; font-size: 1.2rem; }
  `;
  document.head.appendChild(style);
}
