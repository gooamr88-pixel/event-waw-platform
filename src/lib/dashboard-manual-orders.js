/* ===================================
   EVENTSLI — Manual Orders Dashboard Panel
   Renders "Pending Transfers" panel for organizers
   to review and approve/reject manual payment orders.
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';

let currentFilter = 'all';

/**
 * Renders the Pending Transfers panel in the organizer dashboard.
 */
export async function renderManualOrdersPanel(container) {
  if (!container) return;
  injectStyles();

  try {
    let query = supabase
      .from('manual_transfer_orders')
      .select('*, events(title), ticket_tiers(name)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (currentFilter !== 'all') {
      query = query.eq('status', currentFilter);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    const pendingCount = (orders || []).filter(o => o.status === 'pending_approval').length;

    let html = `
      <div class="mto-header">
        <h2 class="mto-title">📱 Pending Transfers ${pendingCount > 0 ? `<span class="mto-badge-count">${pendingCount}</span>` : ''}</h2>
        <select class="mto-filter" id="mto-filter-select">
          <option value="all" ${currentFilter === 'all' ? 'selected' : ''}>All Orders</option>
          <option value="pending_payment" ${currentFilter === 'pending_payment' ? 'selected' : ''}>⏳ Awaiting Payment</option>
          <option value="pending_approval" ${currentFilter === 'pending_approval' ? 'selected' : ''}>🟡 Pending Approval</option>
          <option value="approved" ${currentFilter === 'approved' ? 'selected' : ''}>✅ Approved</option>
          <option value="rejected" ${currentFilter === 'rejected' ? 'selected' : ''}>❌ Rejected</option>
          <option value="expired" ${currentFilter === 'expired' ? 'selected' : ''}>⏰ Expired</option>
        </select>
      </div>
    `;

    if (!orders || orders.length === 0) {
      html += `<div class="mto-empty">
        <div style="font-size:2.5rem;margin-bottom:12px">📭</div>
        <p>No manual transfer orders${currentFilter !== 'all' ? ` with status "${currentFilter.replace('_', ' ')}"` : ''}</p>
      </div>`;
    } else {
      html += '<div class="mto-grid">';
      orders.forEach(order => {
        html += renderOrderCard(order);
      });
      html += '</div>';
    }

    setSafeHTML(container, html);

    // Filter handler
    document.getElementById('mto-filter-select')?.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      renderManualOrdersPanel(container);
    });

    // Action button handlers
    container.querySelectorAll('.mto-approve-btn').forEach(btn => {
      btn.addEventListener('click', () => handleApprove(btn.dataset.orderId, container));
    });
    container.querySelectorAll('.mto-reject-btn').forEach(btn => {
      btn.addEventListener('click', () => handleReject(btn.dataset.orderId, container));
    });
    container.querySelectorAll('.mto-proof-btn').forEach(btn => {
      btn.addEventListener('click', () => window.open(btn.dataset.url, '_blank'));
    });
  } catch (err) {
    setSafeHTML(container, `<div class="mto-error">Failed to load orders: ${esc(err.message)}</div>`);
  }
}

function renderOrderCard(order) {
  const statusConfig = {
    pending_payment: { icon: '⏳', label: 'Awaiting Payment', cls: 'mto-status-orange' },
    pending_approval: { icon: '🟡', label: 'Pending Approval', cls: 'mto-status-yellow' },
    approved: { icon: '✅', label: 'Approved', cls: 'mto-status-green' },
    rejected: { icon: '❌', label: 'Rejected', cls: 'mto-status-red' },
    expired: { icon: '⏰', label: 'Expired', cls: 'mto-status-gray' },
    cancelled: { icon: '🚫', label: 'Cancelled', cls: 'mto-status-gray' },
  };
  const s = statusConfig[order.status] || statusConfig.cancelled;
  const methodLabels = {
    vodafone_cash: '📱 Vodafone Cash', instapay: '🏦 InstaPay',
    bank_transfer: '🏧 Bank Transfer', fawry: '💳 Fawry', other: '💰 Other'
  };
  const fmt = (v) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: order.currency || 'EGP', minimumFractionDigits: 2
  }).format(v || 0);
  const timeAgo = getTimeAgo(order.created_at);
  const expiresIn = order.expires_at && ['pending_payment', 'pending_approval'].includes(order.status)
    ? getTimeUntil(order.expires_at) : null;

  let actions = '';
  if (order.status === 'pending_approval') {
    actions = `
      ${order.proof_image_url ? `<button class="mto-btn mto-proof-btn" data-url="${escAttr(order.proof_image_url)}">📷 View Proof</button>` : ''}
      <button class="mto-btn mto-btn-approve mto-approve-btn" data-order-id="${order.id}">✅ Approve</button>
      <button class="mto-btn mto-btn-reject mto-reject-btn" data-order-id="${order.id}">❌ Reject</button>`;
  } else if (order.status === 'pending_payment') {
    actions = `<button class="mto-btn mto-btn-reject mto-reject-btn" data-order-id="${order.id}">❌ Reject</button>`;
  }

  return `
    <div class="mto-card">
      <div class="mto-card-top">
        <span class="mto-status ${s.cls}">${s.icon} ${s.label}</span>
        <span class="mto-ref">${esc(order.transfer_reference || '—')}</span>
      </div>
      <div class="mto-card-body">
        <div class="mto-buyer"><strong>${esc(order.buyer_name)}</strong> · ${esc(order.buyer_phone)}</div>
        <div class="mto-detail">${esc(order.events?.title || 'Unknown Event')} · ${order.quantity}x ${esc(order.ticket_tiers?.name || 'Ticket')}</div>
        <div class="mto-amount">${fmt(order.total_amount)} via ${methodLabels[order.payment_method] || order.payment_method}</div>
        <div class="mto-meta">
          <span>Created ${timeAgo}</span>
          ${expiresIn ? `<span class="mto-expires">Expires ${expiresIn}</span>` : ''}
          ${order.rejection_reason ? `<span class="mto-reason">Reason: ${esc(order.rejection_reason)}</span>` : ''}
        </div>
      </div>
      ${actions ? `<div class="mto-card-actions">${actions}</div>` : ''}
    </div>`;
}

async function handleApprove(orderId, container) {
  if (!confirm('Confirm you received the full payment amount for this order?')) return;
  try {
    const { data, error } = await supabase.rpc('approve_manual_order', { p_manual_order_id: orderId });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    showToast(`✅ Order approved! ${data.ticket_count} ticket(s) issued to ${data.buyer_name}`, 'success');
    renderManualOrdersPanel(container);
  } catch (err) {
    showToast('❌ Approval failed: ' + err.message, 'error');
  }
}

async function handleReject(orderId, container) {
  const reason = prompt('Rejection reason (shown to buyer):');
  if (reason === null) return;
  try {
    const { data, error } = await supabase.rpc('reject_manual_order', {
      p_manual_order_id: orderId, p_reason: reason || 'Payment not received'
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    showToast('Order rejected. Reservation released.', 'info');
    renderManualOrdersPanel(container);
  } catch (err) {
    showToast('❌ Rejection failed: ' + err.message, 'error');
  }
}

function esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = String(str); return d.innerHTML; }
function escAttr(str) { return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getTimeUntil(dateStr) {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `in ${hrs}h`;
  return `in ${Math.floor(diff / 60000)}m`;
}

function injectStyles() {
  if (document.getElementById('mto-panel-styles')) return;
  const style = document.createElement('style');
  style.id = 'mto-panel-styles';
  style.textContent = `
    .mto-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; flex-wrap:wrap; gap:10px; }
    .mto-title { font-size:1.15rem; font-weight:700; margin:0; display:flex; align-items:center; gap:8px; }
    .mto-badge-count { background:linear-gradient(135deg,#f59e0b,#f97316); color:#fff; font-size:.75rem; font-weight:700; padding:2px 8px; border-radius:20px; }
    .mto-filter { padding:8px 14px; border-radius:10px; border:1px solid var(--ev-border); background:var(--ev-bg-card,#fff); font-size:.85rem; cursor:pointer; }
    .mto-empty { text-align:center; padding:60px 20px; color:var(--ev-text-muted); }
    .mto-error { text-align:center; padding:40px; color:var(--ev-danger); }
    .mto-grid { display:flex; flex-direction:column; gap:12px; }
    .mto-card { border:1px solid var(--ev-border); border-radius:14px; background:var(--ev-bg-card,#fff); overflow:hidden; transition:box-shadow .2s; }
    .mto-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.08); }
    .mto-card-top { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--ev-border); }
    .mto-status { font-size:.78rem; font-weight:600; padding:4px 10px; border-radius:8px; }
    .mto-status-yellow { background:rgba(245,158,11,.1); color:#f59e0b; }
    .mto-status-orange { background:rgba(249,115,22,.1); color:#f97316; }
    .mto-status-green { background:rgba(34,197,94,.1); color:#22c55e; }
    .mto-status-red { background:rgba(239,68,68,.1); color:#ef4444; }
    .mto-status-gray { background:rgba(107,114,128,.1); color:#6b7280; }
    .mto-ref { font-size:.8rem; font-weight:600; color:var(--ev-text-muted); font-family:monospace; }
    .mto-card-body { padding:14px 18px; }
    .mto-buyer { font-size:.9rem; font-weight:600; margin-bottom:4px; }
    .mto-detail { font-size:.82rem; color:var(--ev-text-muted); margin-bottom:6px; }
    .mto-amount { font-size:1rem; font-weight:700; margin-bottom:8px; }
    .mto-meta { display:flex; flex-wrap:wrap; gap:12px; font-size:.75rem; color:var(--ev-text-muted); }
    .mto-expires { color:#f59e0b; font-weight:600; }
    .mto-reason { color:#ef4444; font-style:italic; }
    .mto-card-actions { display:flex; gap:8px; padding:12px 18px; border-top:1px solid var(--ev-border); }
    .mto-btn { padding:8px 14px; border-radius:10px; border:1px solid var(--ev-border); background:var(--ev-bg-card); cursor:pointer; font-size:.82rem; font-weight:600; transition:all .2s; }
    .mto-btn:hover { opacity:.85; }
    .mto-btn-approve { background:rgba(34,197,94,.1); color:#22c55e; border-color:rgba(34,197,94,.3); }
    .mto-btn-reject { background:rgba(239,68,68,.1); color:#ef4444; border-color:rgba(239,68,68,.3); }
    @media(max-width:640px) { .mto-card-actions { flex-wrap:wrap; } .mto-btn { flex:1; text-align:center; } }
  `;
  document.head.appendChild(style);
}
