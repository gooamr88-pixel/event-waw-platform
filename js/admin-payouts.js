/* ===================================
   EVENTSLI — Admin Payouts Manager
   Phase 7 Task 4: BRD Section 8
   ===================================
   Renders payout management table for admins:
   view all payout requests, approve, reject,
   add transaction references.
   =================================== */
import { supabase, SUPABASE_FUNCTIONS_URL } from '../src/lib/supabase.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { showConfirmModal } from '../src/lib/ui-modals.js';

/**
 * Renders the admin payouts panel.
 */
export async function renderAdminPayouts(container) {
  if (!container) return;

  try {
    const { data, error } = await supabase.rpc('admin_get_all_payouts');
    if (error) throw error;

    const payouts = data || [];
    injectStyles();

    // Stats
    const pending = payouts.filter(p => p.status === 'pending');
    const completed = payouts.filter(p => p.status === 'completed');
    // M-3 FIX: Group totals by currency to avoid mixing currencies
    const groupByCurrency = (items) => {
      const groups = {};
      items.forEach(p => {
        const c = p.currency || 'USD';
        groups[c] = (groups[c] || 0) + Number(p.net_amount || 0);
      });
      return Object.entries(groups).map(([c, v]) => fmtCurrency(v, c)).join(' + ') || fmtCurrency(0);
    };
    const totalPendingDisplay = groupByCurrency(pending);
    const totalPaidDisplay = groupByCurrency(completed);

    let html = `
      <div class="ev-stat-grid" style="margin-bottom:20px">
        <div class="ev-stat-card"><div class="ev-stat-icon orange">⏳</div><div><div class="ev-stat-value">${pending.length}</div><div class="ev-stat-label">Pending Requests</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon gold">💰</div><div><div class="ev-stat-value">${totalPendingDisplay}</div><div class="ev-stat-label">Pending Amount</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon green">✅</div><div><div class="ev-stat-value">${completed.length}</div><div class="ev-stat-label">Completed Payouts</div></div></div>
        <div class="ev-stat-card"><div class="ev-stat-icon blue">💸</div><div><div class="ev-stat-value">${totalPaidDisplay}</div><div class="ev-stat-label">Total Paid</div></div></div>
      </div>

      <div class="ev-card">
        <div class="ev-card-header">
          <span class="ev-card-title">💳 Payout Requests</span>
          <div style="display:flex;gap:8px">
            <select class="ev-filter-select" id="admin-payout-filter" style="font-size:.82rem;padding:6px 10px">
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button class="ev-btn ev-btn-outline ev-btn-sm" id="admin-payout-refresh">Refresh</button>
          </div>
        </div>
        <div class="ev-table-wrap">
          <table class="ev-table" id="admin-payouts-table">
            <thead>
              <tr>
                <th>#</th><th>Organizer</th><th>Amount</th><th>Method</th>
                <th>Event</th><th>Status</th><th>Requested</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="admin-payouts-tbody">
    `;

    if (payouts.length === 0) {
      html += `<tr><td colspan="8" class="ev-table-empty">No payout requests yet</td></tr>`;
    } else {
      const statusBadges = {
        pending: 'apo-badge-yellow',
        processing: 'apo-badge-blue',
        completed: 'apo-badge-green',
        failed: 'apo-badge-red',
        cancelled: 'apo-badge-gray',
      };

      payouts.forEach((po, i) => {
        const badge = statusBadges[po.status] || '';
        const canProcess = po.status === 'pending' || po.status === 'processing';

        html += `
          <tr data-payout-id="${esc(po.id)}" class="${canProcess ? 'apo-actionable' : ''}">
            <td>${i + 1}</td>
            <td>
              <div style="font-weight:600;font-size:.85rem">${esc(po.organizer_name)}</div>
              <div style="font-size:.75rem;color:var(--ev-text-muted)">${esc(po.organizer_email)}</div>
            </td>
            <td style="font-weight:700;font-size:.95rem">${fmtCurrency(po.net_amount, po.currency)}</td>
            <td>
              <div style="font-size:.82rem">${esc(po.payout_method)}</div>
              <div style="font-size:.72rem;color:var(--ev-text-muted)">${esc(po.payout_destination || '')}</div>
            </td>
            <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(po.event_title || 'Multi-event')}</td>
            <td>
              <span class="apo-badge ${badge}">${esc(po.status)}</span>
              ${po.failure_reason ? `<div style="font-size:.7rem;color:var(--ev-danger);margin-top:2px">${esc(po.failure_reason)}</div>` : ''}
              ${po.external_ref ? `<div style="font-size:.7rem;color:var(--ev-text-muted);margin-top:2px">Ref: ${esc(po.external_ref)}</div>` : ''}
              ${po.processed_by_name ? `<div style="font-size:.7rem;color:var(--ev-text-muted)">by ${esc(po.processed_by_name)}</div>` : ''}
            </td>
            <td style="font-size:.8rem;color:var(--ev-text-muted)">
              ${po.requested_at ? new Date(po.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              ${po.processed_at ? `<br><span style="font-size:.72rem">Processed: ${new Date(po.processed_at).toLocaleDateString()}</span>` : ''}
            </td>
            <td>
              ${canProcess ? `
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <button class="ev-btn ev-btn-sm apo-approve-btn" data-id="${esc(po.id)}" style="background:#22c55e;color:#fff;border:none;font-size:.75rem;padding:5px 10px;border-radius:6px;cursor:pointer">✓ Approve</button>
                  <button class="ev-btn ev-btn-sm apo-reject-btn" data-id="${esc(po.id)}" style="background:#ef4444;color:#fff;border:none;font-size:.75rem;padding:5px 10px;border-radius:6px;cursor:pointer">✗ Reject</button>
                </div>
              ` : `<span style="font-size:.75rem;color:var(--ev-text-muted)">—</span>`}
            </td>
          </tr>
        `;
      });
    }

    html += `</tbody></table></div></div>`;

    setSafeHTML(container, html);

    // ── Event Handlers ──

    // Approve buttons
    container.querySelectorAll('.apo-approve-btn').forEach(btn => {
      btn.addEventListener('click', () => showProcessModal(btn.dataset.id, 'completed', container));
    });

    // Reject buttons
    container.querySelectorAll('.apo-reject-btn').forEach(btn => {
      btn.addEventListener('click', () => showProcessModal(btn.dataset.id, 'failed', container));
    });

    // Filter
    document.getElementById('admin-payout-filter')?.addEventListener('change', async (e) => {
      const status = e.target.value || null;
      const { data: filtered } = await supabase.rpc('admin_get_all_payouts', { p_status: status });
      if (filtered) renderPayoutRows(container.querySelector('#admin-payouts-tbody'), filtered, container);
    });

    // Refresh
    document.getElementById('admin-payout-refresh')?.addEventListener('click', () => {
      renderAdminPayouts(container);
    });

  } catch (err) {
    setSafeHTML(container, `<div style="text-align:center;padding:40px;color:var(--ev-danger)">Failed to load payouts: ${esc(err.message)}</div>`);
  }
}

/* ── Process Modal ── */

function showProcessModal(payoutId, action, parentContainer) {
  document.getElementById('apo-process-modal')?.remove();

  const isApprove = action === 'completed';
  const title = isApprove ? '✓ Approve & Execute Payout' : '✗ Reject Payout';
  const btnColor = isApprove ? '#22c55e' : '#ef4444';
  const btnLabel = isApprove ? 'Execute Stripe Payout' : 'Confirm Rejection';

  const modal = document.createElement('div');
  modal.id = 'apo-process-modal';
  modal.className = 'apo-modal-overlay';
  modal.innerHTML = `
    <div class="apo-modal-dialog">
      <div class="apo-modal-header">
        <h3>${title}</h3>
        <button class="apo-modal-close" id="apo-close">&times;</button>
      </div>
      <div class="apo-modal-body">
        ${isApprove ? `
          <div style="background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:14px;margin-bottom:16px;font-size:.85rem;color:var(--ev-text-sec)">
            ⚠️ This will <strong>immediately transfer funds</strong> from the organizer's Stripe account to their bank. This action cannot be undone.
          </div>
        ` : `
          <div class="ev-form-group" style="margin-bottom:14px">
            <label style="font-size:.85rem;font-weight:600">Rejection Reason</label>
            <textarea class="ev-form-input" id="apo-reason" rows="3" placeholder="Why is this payout being rejected?" style="resize:vertical"></textarea>
          </div>
        `}
        <div class="ev-form-group" style="margin-bottom:16px">
          <label style="font-size:.85rem;font-weight:600">Notes (optional)</label>
          <input type="text" class="ev-form-input" id="apo-notes" placeholder="Internal admin notes..." />
        </div>
        <button class="ev-btn" id="apo-submit" style="width:100%;padding:12px;justify-content:center;background:${btnColor};color:#fff;border:none;font-weight:600;border-radius:10px;cursor:pointer;font-size:.9rem">
          ${btnLabel}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  document.getElementById('apo-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  document.getElementById('apo-submit').addEventListener('click', async () => {
    const btn = document.getElementById('apo-submit');

    if (isApprove) {
      // ═══════════════════════════════════════════════════
      // APPROVE PATH: Call execute-payout Edge Function
      // This triggers the actual Stripe payout to the
      // organizer's bank account.
      // ═══════════════════════════════════════════════════

      // P2-9 FIX: Use custom modal instead of native confirm()
      const confirmed = await showConfirmModal({
        title: 'Execute Stripe Payout',
        message: 'This will immediately transfer funds to the organizer\'s bank account. This action cannot be undone.',
        confirmText: 'Execute Payout',
        confirmColor: '#22c55e'
      });
      if (!confirmed) return;

      btn.disabled = true;
      btn.textContent = 'Executing Stripe Payout...';

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('Session expired. Please sign in again.');
        }

        const response = await fetch(
          `${SUPABASE_FUNCTIONS_URL}/execute-payout`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ payout_id: payoutId }),
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || `HTTP ${response.status}`);
        }

        if (result.duplicate) {
          // Idempotent — already processed
          window.dispatchEvent(new CustomEvent('cms-saved', {
            detail: { label: `Payout was already completed (${result.external_ref})` }
          }));
        } else if (result.success) {
          window.dispatchEvent(new CustomEvent('cms-saved', {
            detail: { label: `Payout executed! Stripe ID: ${result.stripe_payout_id}` }
          }));
          if (result.warning) {
            alert('⚠️ ' + result.warning);
          }
        } else {
          throw new Error(result.error || 'Unknown error');
        }

        // Save optional admin notes via the existing RPC
        const notes = document.getElementById('apo-notes')?.value;
        if (notes) {
          await supabase.rpc('admin_process_payout', {
            p_payout_id: payoutId,
            p_action: 'completed',
            p_external_ref: result.stripe_payout_id || null,
            p_notes: notes,
            p_failure_reason: null,
          }).catch(() => {}); // Best-effort — payout already executed
        }

        modal.remove();
        renderAdminPayouts(parentContainer);

      } catch (err) {
        window.dispatchEvent(new CustomEvent('cms-error', {
          detail: { message: 'Payout failed: ' + err.message }
        }));
        btn.disabled = false;
        btn.textContent = btnLabel;
      }

    } else {
      // ═══════════════════════════════════════════════════
      // REJECT PATH: DB-only via admin_process_payout RPC
      // No Stripe action needed for rejections.
      // ═══════════════════════════════════════════════════

      btn.disabled = true;
      btn.textContent = 'Processing...';

      const params = {
        p_payout_id: payoutId,
        p_action: action,
        p_external_ref: null,
        p_notes: document.getElementById('apo-notes')?.value || null,
        p_failure_reason: document.getElementById('apo-reason')?.value || null,
      };

      try {
        const { data, error } = await supabase.rpc('admin_process_payout', params);
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        modal.remove();

        window.dispatchEvent(new CustomEvent('cms-saved', {
          detail: { label: `Payout rejected` }
        }));

        renderAdminPayouts(parentContainer);
      } catch (err) {
        window.dispatchEvent(new CustomEvent('cms-error', {
          detail: { message: 'Failed: ' + err.message }
        }));
        btn.disabled = false;
        btn.textContent = btnLabel;
      }
    }
  });
}

/* ── Re-render tbody only (for filter) ── */

function renderPayoutRows(tbody, payouts, parentContainer) {
  if (!tbody) return;
  if (!payouts || payouts.length === 0) {
    setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No payouts match filter</td></tr>');
    return;
  }

  const statusBadges = {
    pending: 'apo-badge-yellow', processing: 'apo-badge-blue',
    completed: 'apo-badge-green', failed: 'apo-badge-red', cancelled: 'apo-badge-gray',
  };

  setSafeHTML(tbody, payouts.map((po, i) => {
    const badge = statusBadges[po.status] || '';
    const canProcess = po.status === 'pending' || po.status === 'processing';
    return `
      <tr data-payout-id="${esc(po.id)}">
        <td>${i + 1}</td>
        <td><div style="font-weight:600;font-size:.85rem">${esc(po.organizer_name)}</div><div style="font-size:.75rem;color:var(--ev-text-muted)">${esc(po.organizer_email)}</div></td>
        <td style="font-weight:700">${fmtCurrency(po.net_amount, po.currency)}</td>
        <td>${esc(po.payout_method)}</td>
        <td>${esc(po.event_title || 'Multi-event')}</td>
        <td><span class="apo-badge ${badge}">${esc(po.status)}</span></td>
        <td style="font-size:.8rem;color:var(--ev-text-muted)">${po.requested_at ? new Date(po.requested_at).toLocaleDateString() : '—'}</td>
        <td>${canProcess ? `<button class="apo-approve-btn ev-btn ev-btn-sm" data-id="${esc(po.id)}" style="background:#22c55e;color:#fff;border:none;font-size:.75rem;padding:5px 8px;border-radius:6px;cursor:pointer;margin-right:4px">✓</button><button class="apo-reject-btn ev-btn ev-btn-sm" data-id="${esc(po.id)}" style="background:#ef4444;color:#fff;border:none;font-size:.75rem;padding:5px 8px;border-radius:6px;cursor:pointer">✗</button>` : '—'}</td>
      </tr>
    `;
  }).join(''));

  // P1-2 FIX: Re-attach button handlers after filter re-render
  tbody.querySelectorAll('.apo-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => showProcessModal(btn.dataset.id, 'completed', parentContainer));
  });
  tbody.querySelectorAll('.apo-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => showProcessModal(btn.dataset.id, 'failed', parentContainer));
  });
}

/* ── Utilities ── */

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function fmtCurrency(amount, currency) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2
  }).format(amount || 0);
}

function injectStyles() {
  if (document.getElementById('apo-styles')) return;
  const style = document.createElement('style');
  style.id = 'apo-styles';
  style.textContent = `
    .apo-badge {
      display: inline-block; padding: 3px 10px; border-radius: 20px;
      font-size: .72rem; font-weight: 600; text-transform: capitalize;
    }
    .apo-badge-yellow { background: rgba(245,158,11,.1); color: #f59e0b; }
    .apo-badge-blue { background: rgba(59,130,246,.1); color: #3b82f6; }
    .apo-badge-green { background: rgba(34,197,94,.1); color: #22c55e; }
    .apo-badge-red { background: rgba(239,68,68,.1); color: #ef4444; }
    .apo-badge-gray { background: rgba(107,114,128,.1); color: #6b7280; }
    .apo-actionable { background: rgba(245,158,11,.03); }
    .apo-modal-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.5); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: apoFade .2s ease;
    }
    @keyframes apoFade { from { opacity: 0; } to { opacity: 1; } }
    .apo-modal-dialog {
      width: 460px; max-width: 95vw;
      background: var(--ev-bg-card, #fff); border-radius: 16px;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3);
    }
    .apo-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 24px; border-bottom: 1px solid var(--ev-border);
    }
    .apo-modal-header h3 { margin: 0; font-size: 1.05rem; font-weight: 700; }
    .apo-modal-close {
      background: none; border: none; font-size: 1.5rem;
      color: var(--ev-text-muted); cursor: pointer;
    }
    .apo-modal-body { padding: 24px; }
  `;
  document.head.appendChild(style);
}
