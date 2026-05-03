import { supabase, getCurrentUser } from './supabase.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';

/* ==================================
   PROMO CODES PANEL
   ================================== */

export function setupFinancialPanel() {
  document.getElementById('fin-event-select')?.addEventListener('change', () => loadFinancialData());
  loadFinancialData();
}

async function loadFinancialData() {
  const tbody = document.getElementById('financial-tbody');
  if (!tbody) return;
  const eventId = document.getElementById('fin-event-select')?.value;

  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });

    if (error) throw error;
    if (!data?.length) {
      setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>');
      return;
    }

    let filtered = data;
    if (eventId) filtered = data.filter(r => r.event_id === eventId);
    if (!filtered.length) {
      setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No data for selected event</td></tr>');
      return;
    }

    setSafeHTML(tbody, filtered.map((r, i) => {
      const gross = Number(r.gross_revenue || 0);
      const fee = Math.round(gross * 0.05 * 100) / 100;
      const net = gross - fee;
      return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.event_title || '-')}</td>
      <td>${r.total_tickets_sold || 0} tickets</td>
      <td style="font-weight:600">$${gross.toLocaleString()}</td>
      <td style="color:var(--ev-danger);font-size:.8rem">-$${fee.toLocaleString()}</td>
      <td style="color:var(--ev-success);font-weight:700">$${net.toLocaleString()}</td>
      <td><span class="ev-badge ${net > 0 ? 'published' : 'pending'}">${net > 0 ? 'Earned' : 'Pending'}</span></td>
    </tr>`;
    }).join(''));
  } catch (err) {
    setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>');
  }
}

/* ==================================
   PROMO CODES CRUD
   ================================== */

export async function loadPromoCodes() {
  const tbody = document.getElementById('promo-tbody');
  if (!tbody) return;

  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data?.length) {
      setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty">
        <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
        <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
      </td></tr>`);
      return;
    }

    setSafeHTML(tbody, data.map((p, i) => {
      const expired = p.valid_until && new Date(p.valid_until) < new Date();
      const maxedOut = p.max_uses && p.used_count >= p.max_uses;
      const statusClass = !p.is_active ? 'rejected' : expired ? 'past' : maxedOut ? 'past' : 'published';
      const statusLabel = !p.is_active ? 'Inactive' : expired ? 'Expired' : maxedOut ? 'Maxed Out' : 'Active';
      const discountDisplay = p.discount_type === 'fixed' ? '$' + p.discount_value : (p.discount_value || p.discount_percent || 0) + '%';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:700;font-family:monospace;letter-spacing:1px">${escapeHTML(p.code)}</td>
        <td style="font-weight:600;color:var(--ev-pink)">${discountDisplay}</td>
        <td>${p.used_count || 0}${p.max_uses ? '/' + p.max_uses : ''}</td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${p.valid_until ? new Date(p.valid_until).toLocaleDateString() : '-'}</td>
        <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
        <td><button class="ev-btn-icon" title="Delete" data-promo-delete="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button></td>
      </tr>`;
    }).join(''));

    // Delete handler (delegated)
    tbody.onclick = async (e) => {
      const delBtn = e.target.closest('[data-promo-delete]');
      if (!delBtn) return;
      if (!confirm('Delete this promo code?')) return;
      const { error } = await supabase.from('promo_codes').delete().eq('id', delBtn.dataset.promoDelete);
      if (error) showToast('Delete failed: ' + error.message, 'error');
      else { showToast('Promo deleted', 'success'); loadPromoCodes(); }
    };
  } catch (err) {
    setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty">
      <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
      <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
    </td></tr>`);
  }
}
