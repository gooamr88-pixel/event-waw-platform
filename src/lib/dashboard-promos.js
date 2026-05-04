import { supabase, getCurrentUser } from './supabase.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML, generateSkeletonRows } from './dom.js';
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
  setSafeHTML(tbody, generateSkeletonRows(['20px', '180px', '100px', '120px', '100px', '120px', '80px'], 5));

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

let promoDeleteListenerAttached = false;

export async function loadPromoCodes() {
  const tbody = document.getElementById('promo-tbody');
  if (!tbody) return;
  setSafeHTML(tbody, generateSkeletonRows(['20px', '140px', '100px', '80px', '100px', '80px', '60px'], 5));

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
      const discountDisplay = p.discount_type === 'fixed'
        ? `${Number(p.discount_value).toLocaleString()} ${p.discount_currency || 'USD'}`
        : (p.discount_value || p.discount_percent || 0) + '%';
      const typeBadge = p.discount_type === 'fixed'
        ? '<span style="display:inline-block;font-size:.6rem;padding:1px 5px;border-radius:4px;background:rgba(34,197,94,.1);color:#22c55e;font-weight:600;margin-left:4px">FIXED</span>'
        : '<span style="display:inline-block;font-size:.6rem;padding:1px 5px;border-radius:4px;background:rgba(139,92,246,.1);color:#8b5cf6;font-weight:600;margin-left:4px">%</span>';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:700;font-family:monospace;letter-spacing:1px">${escapeHTML(p.code)}</td>
        <td style="font-weight:600;color:var(--ev-pink)">${discountDisplay}${typeBadge}</td>
        <td>${p.used_count || 0}${p.max_uses ? '/' + p.max_uses : ''}</td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${p.valid_until ? new Date(p.valid_until).toLocaleDateString() : '-'}</td>
        <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
        <td><button class="ev-btn-icon" title="Delete" data-promo-delete="${p.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button></td>
      </tr>`;
    }).join(''));

    // Delete handler (delegated, attached once)
    if (!promoDeleteListenerAttached) {
      promoDeleteListenerAttached = true;
      tbody.addEventListener('click', async (e) => {
        const delBtn = e.target.closest('[data-promo-delete]');
        if (!delBtn || delBtn.dataset.confirming) return;
        const promoId = delBtn.dataset.promoDelete;

        // Show inline confirm
        delBtn.dataset.confirming = 'true';
        const origHTML = delBtn.innerHTML;
        delBtn.innerHTML = '<span style="font-size:.65rem;font-weight:700;color:#ef4444">Sure?</span>';

        const resetTimer = setTimeout(() => {
          delBtn.innerHTML = origHTML;
          delete delBtn.dataset.confirming;
        }, 3000);

        delBtn.addEventListener('click', async function confirmHandler(ev) {
          ev.stopPropagation();
          clearTimeout(resetTimer);
          delBtn.removeEventListener('click', confirmHandler);
          delBtn.innerHTML = '<span style="font-size:.65rem">...</span>';
          const { error } = await supabase.from('promo_codes').delete().eq('id', promoId);
          if (error) showToast('Delete failed: ' + error.message, 'error');
          else { showToast('Promo deleted', 'success'); loadPromoCodes(); }
        }, { once: true });
      });
    }
  } catch (err) {
    setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty">
      <p style="font-weight:600;margin-bottom:4px">No promo codes yet</p>
      <p style="font-size:.84rem">Create your first promo code to offer discounts.</p>
    </td></tr>`);
  }
}

/* ==================================
   PROMO FORM SUBMIT (was missing)
   ================================== */
export function setupPromoForm() {
  const form = document.getElementById('promo-form');
  if (!form) return;

  // ── Discount Type Toggle (Card-based) ──
  const typeWrap = document.getElementById('promo-type-wrap');
  const typeInput = document.getElementById('promo-discount-type');
  const discountInput = document.getElementById('promo-discount');
  const discountLabel = document.getElementById('promo-discount-label');
  const currencyGroup = document.getElementById('promo-currency-group');
  const inputSuffix = document.getElementById('promo-input-suffix');
  const previewText = document.getElementById('promo-preview-text');
  const previewWrap = document.getElementById('promo-live-preview');

  function updatePreview() {
    const type = typeInput?.value || 'percentage';
    const val = discountInput?.value || '';
    const cur = document.getElementById('promo-currency')?.value || 'USD';
    if (!val) {
      previewText.textContent = type === 'percentage' ? '—% OFF' : `— ${cur} OFF`;
    } else if (type === 'percentage') {
      previewText.textContent = `${val}% OFF`;
    } else {
      previewText.textContent = `${val} ${cur} OFF`;
    }
  }

  function setActiveType(type) {
    typeInput.value = type;
    const cards = typeWrap.querySelectorAll('.promo-type-card');
    cards.forEach(card => {
      const isActive = card.dataset.type === type;
      const check = card.querySelector('.promo-type-check');
      if (type === 'percentage') {
        card.style.border = isActive ? '2px solid rgba(139,92,246,.4)' : '2px solid rgba(255,255,255,.08)';
        card.style.background = isActive ? 'rgba(139,92,246,.06)' : 'rgba(255,255,255,.02)';
      } else {
        card.style.border = isActive ? '2px solid rgba(34,197,94,.4)' : '2px solid rgba(255,255,255,.08)';
        card.style.background = isActive ? 'rgba(34,197,94,.06)' : 'rgba(255,255,255,.02)';
      }
      if (check) check.style.display = isActive ? 'flex' : 'none';
    });

    if (type === 'percentage') {
      discountLabel.textContent = 'Discount Percentage *';
      discountInput.placeholder = '20';
      discountInput.min = '1';
      discountInput.max = '100';
      if (inputSuffix) inputSuffix.textContent = '%';
      currencyGroup.style.display = 'none';
      if (previewWrap) {
        previewWrap.style.background = 'linear-gradient(135deg,rgba(139,92,246,.06),rgba(139,92,246,.02))';
        previewWrap.style.borderColor = 'rgba(139,92,246,.15)';
      }
    } else {
      discountLabel.textContent = 'Discount Amount *';
      discountInput.placeholder = '50';
      discountInput.min = '0.01';
      discountInput.removeAttribute('max');
      const cur = document.getElementById('promo-currency')?.value || 'USD';
      if (inputSuffix) inputSuffix.textContent = cur;
      currencyGroup.style.display = '';
      if (previewWrap) {
        previewWrap.style.background = 'linear-gradient(135deg,rgba(34,197,94,.06),rgba(34,197,94,.02))';
        previewWrap.style.borderColor = 'rgba(34,197,94,.15)';
      }
    }
    updatePreview();
  }

  if (typeWrap) {
    typeWrap.addEventListener('click', (e) => {
      const card = e.target.closest('.promo-type-card');
      if (!card) return;
      setActiveType(card.dataset.type);
    });
  }

  // Live preview updates
  discountInput?.addEventListener('input', updatePreview);
  document.getElementById('promo-currency')?.addEventListener('change', () => {
    const cur = document.getElementById('promo-currency')?.value || 'USD';
    if (inputSuffix && typeInput?.value === 'fixed') inputSuffix.textContent = cur;
    updatePreview();
  });

  // ── Form Submit ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      const user = await getCurrentUser();
      const code = document.getElementById('promo-code')?.value.trim().toUpperCase();
      const discountType = typeInput?.value || 'percentage';
      const discountVal = parseFloat(discountInput?.value);
      const currency = document.getElementById('promo-currency')?.value || 'USD';
      const maxUses = parseInt(document.getElementById('promo-max-uses')?.value) || null;
      const eventId = document.getElementById('promo-event')?.value || null;
      const expires = document.getElementById('promo-expires')?.value || null;

      if (!code || code.length < 2) { showToast('Code must be at least 2 characters', 'error'); return; }

      if (discountType === 'percentage') {
        if (!discountVal || discountVal < 1 || discountVal > 100) {
          showToast('Percentage discount must be 1-100%', 'error'); return;
        }
      } else {
        if (!discountVal || discountVal <= 0) {
          showToast('Fixed discount must be greater than 0', 'error'); return;
        }
      }

      const insertData = {
        organizer_id: user.id,
        code,
        discount_type: discountType,
        discount_value: discountVal,
        max_uses: maxUses,
        event_id: eventId,
        valid_until: expires ? new Date(expires).toISOString() : null,
        is_active: true,
        used_count: 0,
      };

      // Also set discount_percent for backward compat if percentage
      if (discountType === 'percentage') {
        insertData.discount_percent = discountVal;
      }

      // Store currency in discount_currency if the column exists
      if (discountType === 'fixed') {
        insertData.discount_currency = currency;
      }

      const { error } = await supabase.from('promo_codes').insert(insertData);

      if (error) throw error;
      const displayDiscount = discountType === 'percentage' ? `${discountVal}%` : `${discountVal} ${currency}`;
      showToast(`Promo code "${code}" created! (${displayDiscount} off)`, 'success');
      form.reset();

      // Reset toggle to percentage
      setActiveType('percentage');

      document.getElementById('promo-modal')?.classList.remove('active');
      loadPromoCodes();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Promo Code';
    }
  });
}
