import { supabase, getCurrentUser } from './supabase.js';
import { createEvent, deleteEvent } from './events.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML, safeHTML } from './dom.js';
import { showToast } from './dashboard-ui.js';

let tableListenerAttached = false;

export function renderEventsTable(events) {
  const tbody = document.getElementById('events-tbody');
  if (!tbody) return;
  
  if (!events.length) {
    setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events yet - create your first one!</td></tr>');
    return;
  }

  const htmlString = events.map((ev, i) => {
    const date = new Date(ev.date);
    const created = new Date(ev.created_at);
    const isPast = date < new Date();
    const sold = ev.ticket_tiers?.reduce((s, t) => s + (t.sold_count || 0), 0) || 0;
    const cap = ev.ticket_tiers?.reduce((s, t) => s + t.capacity, 0) || 0;
    let statusClass = isPast ? 'past' : ev.status;
    let statusLabel = isPast ? 'Past' : (ev.status ? ev.status.charAt(0).toUpperCase() + ev.status.slice(1) : 'Draft');

    return `<tr>
      <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
      <td><a href="event-detail.html?id=${ev.id}" class="ev-link" style="font-weight:600;font-size:.88rem">${escapeHTML(ev.title)}</a></td>
      <td><span style="font-weight:500">${sold}/${cap}</span> <span style="font-size:.75rem;color:var(--ev-text-muted)">sold</span></td>
      <td style="font-size:.8rem;color:var(--ev-text-sec)">${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
      <td style="font-size:.8rem">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
      <td style="font-weight:600">${calcRevenue(ev)}</td>
      <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="ev-btn-icon" title="Edit" data-action="edit" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="ev-btn-icon" title="Venue Map" data-action="map" data-id="${ev.id}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          </button>
          <button class="ev-btn-icon" title="Delete" data-action="delete" data-id="${ev.id}" data-title="${escapeHTML(ev.title)}" data-sold="${sold}" data-status="${ev.status}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  setSafeHTML(tbody, htmlString);

  if (!tableListenerAttached) {
    tableListenerAttached = true;
    tbody.addEventListener('click', handleTableAction);
  }
}

export function calcRevenue(ev) {
  const r = ev.ticket_tiers?.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0) || 0;
  return r > 0 ? '$' + r.toLocaleString() : '-';
}

export async function handleTableAction(e) {
  const editBtn = e.target.closest('[data-action="edit"]');
  if (editBtn) { 
    if (window.loadEventForEditing) await window.loadEventForEditing(editBtn.dataset.id); 
    return; 
  }

  const mapBtn = e.target.closest('[data-action="map"]');
  if (mapBtn) { window.location.href = `venue-designer.html?event_id=${mapBtn.dataset.id}`; return; }

  const dupBtn = e.target.closest('[data-action="duplicate"]');
  if (dupBtn) { await duplicateEvent(dupBtn.dataset.id); return; }

  const shareBtn = e.target.closest('[data-action="share"]');
  if (shareBtn) {
    const url = `${window.location.origin}/event-detail.html?id=${shareBtn.dataset.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Event link copied to clipboard!', 'success');
    } catch {
      prompt('Copy this link:', url);
    }
    return;
  }

  const delBtn = e.target.closest('[data-action="delete"]');
  if (delBtn) {
    const id = delBtn.dataset.id;
    const title = delBtn.dataset.title;
    const sold = Number(delBtn.dataset.sold || 0);
    if (sold > 0) { showToast(`Cannot delete "${title}": ${sold} ticket(s) already sold`, 'error'); return; }
    showDeleteConfirmModal(id, title);
  }
}

export async function duplicateEvent(eventId) {
  try {
    const { data: ev, error } = await supabase.from('events').select('*').eq('id', eventId).single();
    if (error || !ev) { showToast('Failed to load event', 'error'); return; }
    const user = await getCurrentUser();
    const copy = {
      organizer_id: user.id,
      title: ev.title + ' (Copy)',
      description: ev.description,
      venue: ev.venue,
      city: ev.city,
      date: ev.date,
      category: ev.category,
      status: 'draft',
    };
    const newEvent = await createEvent(copy);
    
    const { data: tiers } = await supabase.from('ticket_tiers').select('*').eq('event_id', eventId);
    if (tiers?.length) {
      for (const t of tiers) {
        await supabase.from('ticket_tiers').insert({
          event_id: newEvent.id, name: t.name, price: t.price, capacity: t.capacity
        });
      }
    }
    showToast(`Event duplicated as draft: "${copy.title}"`, 'success');
    if (window.loadDashboard) await window.loadDashboard();
  } catch (err) {
    showToast('Duplicate failed: ' + err.message, 'error');
  }
}

/**
 * Professional delete confirmation modal - replaces native confirm().
 */
export function showDeleteConfirmModal(eventId, eventTitle) {
  // Remove any previous instance
  document.getElementById('ev-delete-confirm-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ev-delete-confirm-modal';
  overlay.className = 'ev-modal-overlay active';
  overlay.style.cssText = 'z-index:10000';

  setSafeHTML(overlay, `
    <div class="ev-modal" style="max-width:420px;text-align:center;padding:32px 28px">
      <div style="width:56px;height:56px;border-radius:50%;background:rgba(239,68,68,.1);display:flex;align-items:center;justify-content:center;margin:0 auto 18px">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#ef4444" stroke-width="2">
          <path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      </div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:var(--ev-text)">Delete Event</h3>
      <p style="font-size:.88rem;color:var(--ev-text-sec);margin-bottom:6px;line-height:1.5">
        Are you sure you want to delete <strong style="color:var(--ev-text)">${escapeHTML(eventTitle)}</strong>?
      </p>
      <p style="font-size:.78rem;color:#ef4444;margin-bottom:24px">This action is permanent and cannot be undone.</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button class="ev-btn ev-btn-outline" id="ev-del-cancel" style="flex:1;max-width:160px;padding:11px">Cancel</button>
        <button class="ev-btn" id="ev-del-confirm" style="flex:1;max-width:160px;padding:11px;background:#ef4444;color:#fff;border:none;font-weight:600">Delete Event</button>
      </div>
    </div>
  `);

  document.body.appendChild(overlay);

  // Close handlers
  const close = () => overlay.remove();
  overlay.querySelector('#ev-del-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Confirm handler
  overlay.querySelector('#ev-del-confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('#ev-del-confirm');
    btn.disabled = true;
    btn.textContent = 'Deleting...';
    try {
      const result = await deleteEvent(eventId);
      if (result.success) {
        close();
        showToast('Event deleted successfully', 'success');
        if (window.loadDashboard) await window.loadDashboard();
      } else {
        // Keep modal open so user sees the problem
        btn.disabled = false;
        btn.textContent = 'Delete Event';
        showToast(result.error || 'Delete failed — please try again', 'error');
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Delete Event';
      showToast('Delete failed: ' + err.message, 'error');
    }
  });
}

export function populateEventSelects(events) {
  ['ticket-event-select', 'approval-event-select', 'fin-event-select', 'promo-event'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const first = el.querySelector('option');
    el.textContent = '';
    if (first) el.appendChild(first);
    events.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = ev.title;
      el.appendChild(opt);
    });
    if (events.length > 0 && el.options.length > 1) {
      el.selectedIndex = 1;
      el.dispatchEvent(new Event('change'));
    }
  });
}
