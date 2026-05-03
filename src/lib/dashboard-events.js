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
    if (confirm(`Delete "${title}"? This cannot be undone.`)) {
      const result = await deleteEvent(id);
      if (result.success) { 
        showToast('Event deleted', 'success'); 
        if (window.loadDashboard) await window.loadDashboard(); 
      }
      else { showToast(result.error || 'Delete failed', 'error'); }
    }
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
