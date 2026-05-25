/* ===================================
   EVENTSLI — Commission Debt Dashboard Card
   Shows organizer's commission debt summary
   and per-event breakdown in the financial panel.
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';

/**
 * Renders the commission debt card within the financial dashboard.
 * If no debt exists, renders nothing.
 */
export async function renderCommissionDebtCard(container) {
  if (!container) return;

  try {
    const { data, error } = await supabase.rpc('get_organizer_commission_status');
    if (error) throw error;
    if (!data || !data.has_debt) return; // No debt — render nothing

    injectStyles();
    const events = data.events || [];
    const activeCurrency = events[0]?.event_currency || 'EGP';

    const fmt = (v) => new Intl.NumberFormat('en-US', {
      style: 'currency', currency: activeCurrency, minimumFractionDigits: 2
    }).format(v || 0);

    const statusConfig = {
      accruing: { label: 'Accruing', cls: 'cd-badge-blue' },
      due: { label: 'Due', cls: 'cd-badge-yellow' },
      overdue: { label: 'Overdue', cls: 'cd-badge-red' },
      settled: { label: 'Settled', cls: 'cd-badge-green' },
      waived: { label: 'Waived', cls: 'cd-badge-gray' },
    };

    // Warning banner if any scanners are locked
    let alert = '';
    if (data.locked_events > 0) {
      alert = `
        <div class="cd-alert-locked">
          <div class="cd-alert-icon">⛔</div>
          <div>
            <strong>Scanner Locked for ${data.locked_events} Event${data.locked_events > 1 ? 's' : ''}</strong>
            <p>Ticket scanning is disabled due to unpaid commission. Settle your balance to unlock.</p>
          </div>
        </div>`;
    } else if (data.due_count > 0) {
      alert = `
        <div class="cd-alert-due">
          <div class="cd-alert-icon">⚠️</div>
          <div>
            <strong>Commission Due for ${data.due_count} Event${data.due_count > 1 ? 's' : ''}</strong>
            <p>Please settle before the event to avoid scanner lockout.</p>
          </div>
        </div>`;
    }

    let html = `
      ${alert}
      <div class="cd-summary">
        <div class="cd-stat"><span class="cd-stat-label">Total Owed</span><span class="cd-stat-value">${fmt(data.total_owed)}</span></div>
        <div class="cd-stat"><span class="cd-stat-label">Total Paid</span><span class="cd-stat-value cd-green">${fmt(data.total_paid)}</span></div>
        <div class="cd-stat cd-stat-balance"><span class="cd-stat-label">Outstanding</span><span class="cd-stat-value ${data.total_balance > 0 ? 'cd-red' : 'cd-green'}">${fmt(data.total_balance)}</span></div>
      </div>
    `;

    // Per-event breakdown
    if (events.length > 0) {
      html += `<div class="ev-table-wrap"><table class="ev-table"><thead><tr>
        <th>Event</th><th>Manual Sales</th><th>Commission</th><th>Paid</th><th>Balance</th><th>Status</th><th></th>
      </tr></thead><tbody>`;
      events.forEach(ev => {
        const sc = statusConfig[ev.status] || statusConfig.accruing;
        const fmtRow = (v) => new Intl.NumberFormat('en-US', {
          style: 'currency', currency: ev.event_currency || 'EGP', minimumFractionDigits: 2
        }).format(v || 0);

        html += `<tr>
          <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ev.event_title)}</td>
          <td>${fmtRow(ev.total_manual_sales)}</td>
          <td>${fmtRow(ev.commission_owed)}</td>
          <td>${fmtRow(ev.commission_paid)}</td>
          <td style="font-weight:700">${fmtRow(ev.commission_balance)}</td>
          <td><span class="cd-badge ${sc.cls}">${sc.label}</span></td>
          <td>${ev.scanner_locked ? '🔒' : ev.commission_balance > 0 ? '🔓' : '✅'}</td>
        </tr>`;
      });
      html += '</tbody></table></div>';
    }

    // Settlement instructions
    if (data.total_balance > 0) {
      html += `
        <div class="cd-settle-info">
          <strong>💳 How to Settle Your Commission</strong>
          <p>Transfer <strong>${fmt(data.total_balance)}</strong> to the Eventsli platform account:</p>
          <ul>
            <li><strong>Bank Transfer</strong> — Contact support@eventsli.com for bank details</li>
            <li><strong>Vodafone Cash / InstaPay</strong> — Contact support for wallet details</li>
          </ul>
          <p style="font-size:.78rem;color:var(--ev-text-muted)">Once settled, our team will verify and unlock your scanner within 24 hours.</p>
        </div>`;
    }

    setSafeHTML(container, html);
  } catch (err) {
    console.warn('Commission debt card error:', err);
    // Silently fail — this is a supplementary card
  }
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }

function injectStyles() {
  if (document.getElementById('cd-card-styles')) return;
  const style = document.createElement('style');
  style.id = 'cd-card-styles';
  style.textContent = `
    .cd-alert-locked { display:flex; gap:14px; align-items:flex-start; padding:16px; border-radius:12px; background:rgba(239,68,68,.08); border:1px solid rgba(239,68,68,.2); margin-bottom:16px; }
    .cd-alert-due { display:flex; gap:14px; align-items:flex-start; padding:16px; border-radius:12px; background:rgba(245,158,11,.08); border:1px solid rgba(245,158,11,.2); margin-bottom:16px; }
    .cd-alert-icon { font-size:1.5rem; flex-shrink:0; }
    .cd-alert-locked strong, .cd-alert-due strong { font-size:.9rem; }
    .cd-alert-locked p, .cd-alert-due p { font-size:.82rem; margin:4px 0 0; color:var(--ev-text-muted); }
    .cd-summary { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px; }
    @media(max-width:640px) { .cd-summary { grid-template-columns:1fr; } }
    .cd-stat { padding:16px; border-radius:12px; border:1px solid var(--ev-border); text-align:center; }
    .cd-stat-balance { border-color:rgba(239,68,68,.2); background:rgba(239,68,68,.03); }
    .cd-stat-label { display:block; font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:var(--ev-text-muted); margin-bottom:6px; }
    .cd-stat-value { font-size:1.4rem; font-weight:800; }
    .cd-green { color:#22c55e; } .cd-red { color:#ef4444; }
    .cd-badge { font-size:.72rem; font-weight:600; padding:3px 8px; border-radius:6px; }
    .cd-badge-blue { background:rgba(59,130,246,.1); color:#3b82f6; }
    .cd-badge-yellow { background:rgba(245,158,11,.1); color:#f59e0b; }
    .cd-badge-red { background:rgba(239,68,68,.1); color:#ef4444; }
    .cd-badge-green { background:rgba(34,197,94,.1); color:#22c55e; }
    .cd-badge-gray { background:rgba(107,114,128,.1); color:#6b7280; }
    .cd-settle-info { margin-top:16px; padding:18px; border-radius:12px; background:rgba(59,130,246,.05); border:1px solid rgba(59,130,246,.15); font-size:.85rem; }
    .cd-settle-info strong { display:block; margin-bottom:8px; }
    .cd-settle-info ul { padding-left:20px; margin:8px 0; }
    .cd-settle-info li { margin-bottom:6px; }
  `;
  document.head.appendChild(style);
}
