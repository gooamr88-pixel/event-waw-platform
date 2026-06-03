/**
 * src/lib/wizard-tickets.js
 * Domain: Ticket tier arrays, category modals, rendering the tickets table
 * Extracted from dashboard-modals.js (Operation Defuse)
 */
import { escapeHTML, formatCurrency } from './utils.js';
import { showToast } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';

/* ── Shared state ── */
let ceTicketsList = [];
let ceTicketCategories = [];
let ceTicketTableListenerAttached = false;

/* ── State accessors ── */
export function getTicketsList() { return ceTicketsList; }
export function setTicketsList(list) { ceTicketsList = list; }
export function getTicketCategories() { return ceTicketCategories; }

export function resetTicketState() {
  ceTicketsList = [];
  ceTicketCategories = [];
  cePromoCodesList = [];
  ceTicketTableListenerAttached = false;
  cePromoTableListenerAttached = false;
}

let cePromoCodesList = [];
let cePromoTableListenerAttached = false;

export function getPromoCodesList() { return cePromoCodesList; }
export function setPromoCodesList(list) { cePromoCodesList = list; }

export function renderCePromoTable() {
  const tbody = document.getElementById('ce-promo-tbody');
  if (!tbody) return;
  if (!cePromoCodesList.length) {
    setSafeHTML(tbody, '<tr><td colspan="4" class="ev-table-empty">No promo codes added yet</td></tr>');
    return;
  }
  setSafeHTML(tbody, cePromoCodesList.map((p, i) => {
    const discountText = p.type === 'percentage' ? `${p.value}%` : `${p.value} fixed`;
    const maxUsesText = p.maxUses ? p.maxUses : 'Unlimited';
    return `<tr>
      <td style="font-weight:600; color:var(--ev-pink);">${escapeHTML(p.code)}</td>
      <td>${escapeHTML(discountText)}</td>
      <td>${escapeHTML(maxUsesText.toString())}</td>
      <td><button class="ev-btn-icon" title="Remove" data-del-promo="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
    </tr>`;
  }).join(''));
  if (!cePromoTableListenerAttached) {
    cePromoTableListenerAttached = true;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del-promo]');
      if (btn) { cePromoCodesList.splice(Number(btn.dataset.delPromo), 1); renderCePromoTable(); }
    });
  }
}

/**
 * Render the tickets table in the wizard.
 */
export function renderCeTicketsTable() {
  const tbody = document.getElementById('ce-tickets-tbody');
  if (!tbody) return;
  if (!ceTicketsList.length) {
    setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No tickets added yet</td></tr>');
    return;
  }
  setSafeHTML(tbody, ceTicketsList.map((t, i) => {
    return `<tr>
      <td style="font-weight:600">${escapeHTML(t.name)}</td>
      <td><span style="font-size:0.8rem;color:var(--ev-text-muted);display:block;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(t.desc)}">${escapeHTML(t.desc) || '—'}</span></td>
      <td>${formatCurrency(t.price, t.currency || 'USD')}</td>
      <td style="color:var(--ev-yellow);font-weight:600">${t.qty}</td>
      <td>${t.earlyEnd ? new Date(t.earlyEnd).toLocaleDateString() : 'Not Set'}</td>
      <td>${t.earlyPrice ? formatCurrency(t.earlyPrice, t.currency || 'USD') : '—'}</td>
      <td><button class="ev-btn-icon" title="Remove" data-del-ticket="${i}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button></td>
    </tr>`;
  }).join(''));
  if (!ceTicketTableListenerAttached) {
    ceTicketTableListenerAttached = true;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del-ticket]');
      if (btn) { ceTicketsList.splice(Number(btn.dataset.delTicket), 1); renderCeTicketsTable(); }
    });
  }
}

/**
 * Wire up all ticket-related DOM event listeners inside the wizard.
 * Called once from the orchestrator's setupCreateModal.
 */
export function setupTicketListeners() {
  // ── Sync ticket currencies on event currency change ──
  document.getElementById('ce-currency')?.addEventListener('change', (e) => {
    const newCurrency = e.target.value;
    if (newCurrency) {
      ceTicketsList.forEach(t => t.currency = newCurrency);
      renderCeTicketsTable();
    }
  });

  // ── Ticket Type Cards ──
  document.querySelectorAll('.ce-ticket-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.ce-ticket-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      card.querySelector('input').checked = true;
    });
  });

  // ── Ticket Category Modal ──
  const ticketCatModal = document.getElementById('ticket-cat-modal');
  document.getElementById('ce-add-ticket-cat-btn')?.addEventListener('click', () => {
    document.getElementById('ticket-cat-count').textContent = `Current ticket category number: ${ceTicketCategories.length}`;
    ticketCatModal?.classList.add('active');
  });
  document.getElementById('ticket-cat-modal-close')?.addEventListener('click', () => ticketCatModal?.classList.remove('active'));
  ticketCatModal?.addEventListener('click', (e) => { if (e.target === ticketCatModal) ticketCatModal.classList.remove('active'); });

  document.getElementById('ticket-cat-save')?.addEventListener('click', () => {
    const name = document.getElementById('ticket-cat-name')?.value.trim();
    if (!name) { showToast('Category name is required', 'error'); return; }
    ceTicketCategories.push({ name, desc: document.getElementById('ticket-cat-desc')?.value.trim() || '' });
    // Update select
    const select = document.getElementById('ce-ticket-category-select');
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
    document.getElementById('ticket-cat-name').value = '';
    document.getElementById('ticket-cat-desc').value = '';
    ticketCatModal?.classList.remove('active');
    showToast(`Category "${name}" added!`, 'success');
  });

  // ── Add Ticket ──
  document.getElementById('ce-add-ticket-btn')?.addEventListener('click', () => {
    const name = document.getElementById('ce-ticket-name')?.value.trim();
    const qty = parseInt(document.getElementById('ce-ticket-qty')?.value) || 1;
    const price = parseFloat(document.getElementById('ce-ticket-price')?.value) || 0;
    const category = document.getElementById('ce-ticket-category-select')?.value;
    const earlyPrice = document.getElementById('ce-early-price')?.value || '';
    const earlyEnd = document.getElementById('ce-early-end')?.value || '';
    
    // New Advanced Ticket Fields
    const desc = document.getElementById('ce-ticket-desc')?.value.trim() || '';
    const minPurchase = parseInt(document.getElementById('ce-ticket-min')?.value) || 1;
    const maxPurchase = parseInt(document.getElementById('ce-ticket-max')?.value) || 10;
    const salesStart = document.getElementById('ce-ticket-sales-start')?.value || null;
    const salesEnd = document.getElementById('ce-ticket-sales-end')?.value || null;
    const seatingType = document.getElementById('ce-ticket-seating-type')?.value || 'general';
    const isHidden = document.getElementById('ce-ticket-hidden')?.checked || false;

    if (!name) { showToast('Ticket name is required', 'error'); return; }
    // M-fe-2 FIX: Validate min purchase ≤ max purchase
    if (minPurchase > maxPurchase) { showToast('Min purchase cannot exceed max purchase', 'error'); return; }

    // H-10: Early Bird Price Validation
    if (earlyPrice !== '') {
      const parsedEarly = parseFloat(earlyPrice);
      if (isNaN(parsedEarly) || parsedEarly < 0) {
        showToast('Early bird price must be a valid positive number', 'error');
        return;
      }
      // M-4 FIX: Validate early bird price is lower than regular price
      if (parsedEarly >= price && price > 0) {
        showToast('Early bird price must be lower than the regular price', 'error');
        return;
      }
    }
    const currency = document.getElementById('ce-currency')?.value || 'USD';
    
    ceTicketsList.push({ 
      name, qty, price, category, earlyPrice, earlyEnd, currency,
      desc, minPurchase, maxPurchase, salesStart, salesEnd, seatingType, isHidden 
    });
    renderCeTicketsTable();
    
    // Reset basic fields
    document.getElementById('ce-ticket-name').value = '';
    document.getElementById('ce-ticket-qty').value = '1';
    document.getElementById('ce-ticket-price').value = '';
    // Reset advanced fields
    if (document.getElementById('ce-ticket-desc')) document.getElementById('ce-ticket-desc').value = '';
    if (document.getElementById('ce-ticket-min')) document.getElementById('ce-ticket-min').value = '1';
    if (document.getElementById('ce-ticket-max')) document.getElementById('ce-ticket-max').value = '10';
    if (document.getElementById('ce-ticket-sales-start')) document.getElementById('ce-ticket-sales-start').value = '';
    if (document.getElementById('ce-ticket-sales-end')) document.getElementById('ce-ticket-sales-end').value = '';
    if (document.getElementById('ce-ticket-seating-type')) document.getElementById('ce-ticket-seating-type').value = 'general';
    if (document.getElementById('ce-ticket-hidden')) document.getElementById('ce-ticket-hidden').checked = false;

    showToast('Ticket added!', 'success');
  });

  // ── Add Promo Code ──
  document.getElementById('ce-add-promo-btn')?.addEventListener('click', () => {
    const code = document.getElementById('ce-promo-code')?.value.trim();
    const type = document.getElementById('ce-promo-type')?.value;
    const value = parseFloat(document.getElementById('ce-promo-value')?.value) || 0;
    const maxUses = parseInt(document.getElementById('ce-promo-max-uses')?.value) || null;

    if (!code) { showToast('Promo code is required', 'error'); return; }
    if (value <= 0) { showToast('Discount value must be greater than 0', 'error'); return; }
    // C-2 FIX: Cap percentage promo codes at 100%
    if (type === 'percentage' && value > 100) { showToast('Percentage discount cannot exceed 100%', 'error'); return; }
    
    // Check for duplicates
    if (cePromoCodesList.some(p => p.code.toUpperCase() === code.toUpperCase())) {
      showToast('Promo code already exists', 'error');
      return;
    }

    cePromoCodesList.push({
      code: code.toUpperCase(),
      type,
      value,
      maxUses
    });
    renderCePromoTable();

    // Reset fields
    document.getElementById('ce-promo-code').value = '';
    document.getElementById('ce-promo-value').value = '';
    document.getElementById('ce-promo-max-uses').value = '';
    
    showToast('Promo code added!', 'success');
  });
}
