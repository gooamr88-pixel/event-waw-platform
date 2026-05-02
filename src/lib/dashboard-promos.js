import { supabase, getCurrentUser } from './supabase.js';
import { safeQuery } from './api.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';
import { dashboardState } from './state.js';

  document.getElementById('promo-modal-close')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  // Search
  document.getElementById('promo-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#promo-tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // Create promo
  document.getElementById('promo-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'Creating…';

    try {
      const user = await getCurrentUser();
      const discountVal = parseInt(document.getElementById('promo-discount').value) || 0;
      const promoData = {
        organizer_id: user.id,
        code: document.getElementById('promo-code').value.trim().toUpperCase(),
        discount_type: 'percentage',
        discount_value: discountVal,
        max_uses: parseInt(document.getElementById('promo-max-uses').value) || 100,
        event_id: document.getElementById('promo-event').value || null,
        valid_until: document.getElementById('promo-expires').value ? new Date(document.getElementById('promo-expires').value).toISOString() : null,
        used_count: 0,
        is_active: true,
      };

      const { error } = await supabase.from('promo_codes').insert(promoData);
      if (error) throw error;

      closeModal();
      e.target.reset();
      showToast('Promo code created!', 'success');
      loadPromoCodes();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Create Promo Code';
    }
  });

  // Load on init
  loadPromoCodes();
}

export async function loadPromoCodes() {
  const tbody = document.getElementById('promo-tbody');
  if (!tbody) return;

  try {

    const { data, error } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="ev-table-empty">
        <div style="font-size:2.5rem;margin-bottom:12px">🏷️</div>
        <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
        <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((p, i) => {
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
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${p.valid_until ? new Date(p.valid_until).toLocaleDateString() : '—'}</td>
        <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
        <td><button class="ev-btn-icon" title="Delete" data-promo-delete="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button></td>
      </tr>`;
    }).join('');

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
    // Table may not exist yet
    tbody.innerHTML = `<tr><td colspan="7" class="ev-table-empty">
      <div style="font-size:2.5rem;margin-bottom:12px">🏷️</div>
      <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
      <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
    </td></tr>`;
  }
}

/* ══════════════════════════════════
   FINANCIAL PANEL
   ══════════════════════════════════ */
export function setupFinancialPanel() {
  document.getElementById('fin-event-select')?.addEventListener('change', () => loadFinancialData());

