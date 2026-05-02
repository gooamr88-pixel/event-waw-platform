import { supabase } from './supabase.js';
import { safeQuery } from './api.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

let vendorTableExists = null;
let approvalTabFilter = 'pending';
  document.querySelectorAll('[data-approval-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-approval-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      approvalTabFilter = tab.dataset.approvalTab;
      loadApprovalData();
    });
  });

  // Event filter
  document.getElementById('approval-event-select')?.addEventListener('change', () => loadApprovalData());
}

let vendorTableExists = null; // null = unknown, true/false after first check

  if (!tbody) return;
  const eventId = document.getElementById('approval-event-select')?.value;

  // If we already know the table doesn't exist, show empty immediately
  if (vendorTableExists === false) {
    tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
    return;
  }

  tbody.innerHTML = '<tr><td colspan="9" class="ev-table-empty"><div class="ev-loading"><div class="ev-spinner"></div></div></td></tr>';

  try {
    let query = supabase.from('vendor_requests').select('*').eq('status', approvalTabFilter).order('created_at', { ascending: false }).limit(20);
    if (eventId) query = query.eq('event_id', eventId);
    const { data, error } = await query;

    if (error) {
      vendorTableExists = false;
      tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
      return;
    }

    vendorTableExists = true;
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.vendor_name || r.business_name || '—')}</td>
      <td>${escapeHTML(r.vendor_email || r.contact_email || '—')}</td>
      <td>${escapeHTML(r.type || r.category || '—')}</td>
      <td>${escapeHTML(r.name || r.business_name || '—')}</td>
      <td>${escapeHTML(r.category || '—')}</td>
      <td>${r.price ? '$' + Number(r.price).toLocaleString() : '—'}</td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(r.created_at).toLocaleDateString()}</td>
      <td><span class="ev-badge ${r.status || approvalTabFilter}">${r.status || approvalTabFilter}</span></td>
    </tr>`).join('');
  } catch (err) {
    vendorTableExists = false;
    tbody.innerHTML = `<tr><td colspan="9" class="ev-table-empty">No ${approvalTabFilter} requests</td></tr>`;
  }
}

/* ══════════════════════════════════
   PROMO CODE PANEL
   ══════════════════════════════════ */
export function setupPromoPanel() {
  const modal = document.getElementById('promo-modal');

