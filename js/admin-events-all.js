/* ===================================
   EVENTSLI — Admin All Events Panel
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML } from '../src/lib/utils.js';
import { showPromptModal } from '../src/lib/ui-modals.js';
import { showToast, downloadCSV } from './admin-ui.js';
import { showEventDetailModal } from './admin-approvals.js';

/**
 * Loads all events into the global registry table.
 */
export async function loadAllEvents(onRefresh) {
  const tbody = document.getElementById('all-events-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, description, cover_image, status, admin_approved, admin_rejected_reason, date, end_date, category, venue, venue_address, city, organizer_id, created_at, custom_commission_pct, custom_commission_fixed, profiles!events_organizer_id_fkey(full_name, email, phone, avatar_url), ticket_tiers(id, name, price, capacity, sold_count)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events in the system</td></tr>');
      return;
    }

    const exportBtn = document.getElementById('export-events-btn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const rows = [['Title', 'Organizer Email', 'Date', 'Status', 'Approved', 'Tickets Sold', 'Capacity', 'Revenue']];
        data.forEach(ev => {
          const org = ev.profiles || {};
          const tiers = ev.ticket_tiers || [];
          const sold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
          const cap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
          const rev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);
          rows.push([
            ev.title || '', org.email || '', 
            ev.date ? new Date(ev.date).toLocaleDateString() : '',
            ev.status || '', ev.admin_approved ? 'Yes' : 'No',
            sold, cap, rev
          ]);
        });
        downloadCSV(rows, `events_${Date.now()}.csv`);
      };
    }

    setSafeHTML(tbody, data.map((ev, i) => {
      const org = ev.profiles || {};
      const date = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const tiers = ev.ticket_tiers || [];
      const sold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
      const cap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
      const rev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);

      let statusBadge, statusLabel;
      if (ev.status === 'published' && ev.admin_approved) {
        statusBadge = 'published'; statusLabel = 'Live';
      } else if (ev.status === 'published' && !ev.admin_approved) {
        statusBadge = 'pending'; statusLabel = 'Pending';
      } else if (ev.status === 'draft') {
        statusBadge = 'draft'; statusLabel = 'Draft';
      } else {
        statusBadge = 'draft'; statusLabel = (ev.status || 'Unknown').charAt(0).toUpperCase() + (ev.status || 'Unknown').slice(1);
      }

      const hasCustomFee = ev.custom_commission_pct != null;
      const feeLabel = hasCustomFee ? ev.custom_commission_pct + '%' + (ev.custom_commission_fixed ? ' + $' + ev.custom_commission_fixed : '') : '';

      return `<tr>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td><a href="#" class="ev-event-detail-link" data-event-idx="${i}" style="font-weight:600;color:var(--ev-accent);text-decoration:none;cursor:pointer">${escapeHTML(ev.title)}</a>${hasCustomFee ? '<span class="ev-badge" style="display:inline-block;margin-left:6px;background:rgba(5,150,105,.1);color:var(--es-emerald-600);font-weight:700;vertical-align:middle" title="Custom Fee: ' + escapeHTML(feeLabel) + '">FEE</span>' : ''}</td>
        <td>${escapeHTML(org.full_name || org.email || '—')}</td>
        <td>${date}</td>
        <td><span class="ev-badge ${statusBadge}">${statusLabel}</span></td>
        <td>${ev.admin_approved ? '<span style="color:var(--ev-success)">✓</span>' : '<span style="color:var(--ev-text-muted)">—</span>'}</td>
        <td>${sold}/${cap}</td>
        <td style="font-weight:600">${rev > 0 ? '$' + rev.toLocaleString() : '—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="ev-btn ev-btn-outline ev-btn-sm ev-admin-suspend-btn" style="color:var(--es-color-warning);border-color:var(--es-color-warning)" data-id="${ev.id}" data-title="${escapeHTML(ev.title)}" data-email="${escapeHTML(org.email || '')}" ${ev.status === 'draft' ? 'disabled' : ''}>Suspend</button>
            <button class="ev-btn ev-btn-outline ev-btn-sm ev-admin-delete-btn" style="color:var(--ev-danger);border-color:var(--ev-danger)" data-id="${ev.id}" data-title="${escapeHTML(ev.title)}" data-email="${escapeHTML(org.email || '')}">Delete</button>
          </div>
        </td>
      </tr>`;
    }).join(''));

    tbody.querySelectorAll('.ev-admin-suspend-btn').forEach(btn => {
      btn.addEventListener('click', () => handleAdminSuspendEvent(btn.dataset.id, btn.dataset.title, btn.dataset.email, onRefresh));
    });
    tbody.querySelectorAll('.ev-admin-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => handleAdminDeleteEvent(btn.dataset.id, btn.dataset.title, btn.dataset.email, onRefresh));
    });
    tbody.querySelectorAll('.ev-event-detail-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.eventIdx, 10);
        if (data[idx]) showEventDetailModal(data[idx]);
      });
    });
  } catch (err) {
    console.error('loadAllEvents error:', err);
    setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

export async function handleAdminSuspendEvent(eventId, title, organizerEmail, onRefresh) {
  const reason = await showPromptModal({
    title: 'Suspend Event',
    message: `Suspend "${title}"? This will hide it from the public. Provide a reason:`,
    placeholder: 'Reason for suspension...',
    confirmText: 'Suspend Event',
    confirmColor: '#f59e0b'
  });
  if (!reason || !reason.trim()) return;
  try {
    const { error } = await supabase.rpc('admin_reject_event', { p_event_id: eventId, p_reason: reason.trim() });
    if (error) throw error;
    showToast(`Event "${title}" has been suspended.`, 'success');
    
    if (organizerEmail) {
      window.open(`mailto:${organizerEmail}?subject=Event%20Suspended:%20${encodeURIComponent(title)}&body=Dear%20Organizer,%0A%0AYour%20event%20"${encodeURIComponent(title)}"%20has%20been%20suspended.%0A%0AReason:%0A${encodeURIComponent(reason.trim())}%0A%0AEventsli%20Admin%20Team`, '_blank');
    }
    onRefresh();
  } catch (err) {
    showToast('Failed to suspend event: ' + err.message, 'error');
  }
}

export async function handleAdminDeleteEvent(eventId, title, organizerEmail, onRefresh) {
  const reason = await showPromptModal({
    title: 'Delete Event',
    message: `Are you sure you want to completely delete "${title}"? This cannot be undone. Provide a reason for deletion:`,
    placeholder: 'Reason for deletion...',
    confirmText: 'Delete Event',
    confirmColor: '#dc2626'
  });
  if (!reason || !reason.trim()) return;
  try {
    const { error } = await supabase.rpc('admin_delete_event', { p_event_id: eventId });
    if (error) throw error;
    showToast(`Event "${title}" has been deleted.`, 'success');

    if (organizerEmail) {
      window.open(`mailto:${organizerEmail}?subject=Event%20Deleted:%20${encodeURIComponent(title)}&body=Dear%20Organizer,%0A%0AYour%20event%20"${encodeURIComponent(title)}"%20has%20been%20deleted.%0A%0AReason:%0A${encodeURIComponent(reason.trim())}%0A%0AEventsli%20Admin%20Team`, '_blank');
    }
    onRefresh();
  } catch (err) {
    showToast('Failed to delete event: ' + err.message, 'error');
  }
}
