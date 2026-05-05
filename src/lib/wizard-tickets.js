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
  ceTicketTableListenerAttached = false;
}

/**
 * Render the tickets table in the wizard.
 */
export function renderCeTicketsTable() {
  const tbody = document.getElementById('ce-tickets-tbody');
  if (!ceTicketsList.length) {
    setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No tickets added yet</td></tr>');
    return;
  }
  setSafeHTML(tbody, ceTicketsList.map((t, i) => {
    return `<tr>
      <td style="font-weight:600">${escapeHTML(t.name)}</td>
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
    if (!name) { showToast('Ticket name is required', 'error'); return; }
    if (!price && price !== 0) { showToast('Ticket price is required', 'error'); return; }
    const currency = document.getElementById('ce-currency')?.value || 'USD';
    ceTicketsList.push({ name, qty, price, category, earlyPrice, earlyEnd, currency });
    renderCeTicketsTable();
    // Reset
    document.getElementById('ce-ticket-name').value = '';
    document.getElementById('ce-ticket-qty').value = '1';
    document.getElementById('ce-ticket-price').value = '';
    showToast('Ticket added!', 'success');
  });
}
