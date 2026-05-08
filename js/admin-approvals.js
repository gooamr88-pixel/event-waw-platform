/* ===================================
   EVENTSLI — Admin Approvals Panel
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML } from '../src/lib/utils.js';
import { showConfirmModal, showPromptModal } from '../src/lib/ui-modals.js';
import { showToast } from './admin-ui.js';

/**
 * Loads events pending approval into the approvals table.
 */
export async function loadApprovalQueue(onRefresh) {
  const tbody = document.getElementById('approvals-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('events')
      .select('id, title, description, cover_image, status, admin_approved, admin_rejected_reason, date, end_date, category, venue, venue_address, city, organizer_id, created_at, profiles!events_organizer_id_fkey(full_name, email, phone, avatar_url), ticket_tiers(id, name, price, capacity, sold_count)')
      .eq('status', 'published')
      .eq('admin_approved', false)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="8" class="ev-table-empty">No events pending approval — all clear ✓</td></tr>');
      return;
    }

    setSafeHTML(tbody, data.map((ev, i) => {
      const org = ev.profiles || {};
      const date = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const submitted = new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `<tr>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td><a href="#" class="ev-event-detail-link" data-event-idx="${i}" style="font-weight:600;color:var(--ev-accent);text-decoration:none;cursor:pointer">${escapeHTML(ev.title)}</a></td>
        <td>${escapeHTML(org.full_name || org.email || '—')}</td>
        <td>${date}</td>
        <td>${escapeHTML(ev.category || '—')}</td>
        <td>${submitted}</td>
        <td><span class="ev-badge pending">Pending</span></td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="ev-btn ev-btn-pink" style="padding:5px 12px;font-size:.75rem" data-approve="${ev.id}">Approve</button>
            <button class="ev-btn ev-btn-danger" style="padding:5px 12px;font-size:.75rem" data-reject="${ev.id}" data-title="${escapeHTML(ev.title)}">Reject</button>
          </div>
        </td>
      </tr>`;
    }).join(''));

    tbody.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => handleApprove(btn.dataset.approve, onRefresh));
    });
    tbody.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => handleReject(btn.dataset.reject, btn.dataset.title, onRefresh));
    });

    tbody.querySelectorAll('.ev-event-detail-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = parseInt(link.dataset.eventIdx, 10);
        if (data[idx]) showEventDetailModal(data[idx]);
      });
    });
  } catch (err) {
    console.error('loadApprovalQueue error:', err);
    setSafeHTML(tbody, `<tr><td colspan="8" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

async function handleApprove(eventId, onRefresh) {
  const confirmed = await showConfirmModal({
    title: 'Approve Event',
    message: 'Approve this event for public listing?',
    confirmText: 'Approve Event',
    confirmColor: '#16a34a'
  });
  if (!confirmed) return;
  try {
    const { error } = await supabase.rpc('admin_approve_event', { p_event_id: eventId });
    if (error) throw error;
    showToast('Event approved and now live!', 'success');
    onRefresh();
  } catch (err) {
    showToast('Approve failed: ' + err.message, 'error');
  }
}

async function handleReject(eventId, title, onRefresh) {
  const reason = await showPromptModal({
    title: 'Reject Event',
    message: `Reject "${title}"? Please provide a reason:`,
    placeholder: 'Reason for rejection...',
    confirmText: 'Reject Event',
    confirmColor: '#dc2626'
  });
  if (!reason || !reason.trim()) return;
  try {
    const { error } = await supabase.rpc('admin_reject_event', { p_event_id: eventId, p_reason: reason.trim() });
    if (error) throw error;
    showToast('Event rejected and returned to organizer as draft.', 'success');
    onRefresh();
  } catch (err) {
    showToast('Reject failed: ' + err.message, 'error');
  }
}

/**
 * Shared modal to show detailed event information.
 */
export function showEventDetailModal(ev) {
  const existing = document.querySelector('.ev-event-detail-overlay');
  if (existing) existing.remove();

  const org = ev.profiles || {};
  const tiers = ev.ticket_tiers || [];
  const totalSold = tiers.reduce((s, t) => s + (t.sold_count || 0), 0);
  const totalCap = tiers.reduce((s, t) => s + (t.capacity || 0), 0);
  const totalRev = tiers.reduce((s, t) => s + (t.sold_count || 0) * (t.price || 0), 0);

  const eventDate = ev.date ? new Date(ev.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const endDate = ev.end_date ? new Date(ev.end_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const createdDate = ev.created_at ? new Date(ev.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const catLabel = ev.category ? ev.category.charAt(0).toUpperCase() + ev.category.slice(1) : '—';

  let statusHTML;
  if (ev.status === 'published' && ev.admin_approved) {
    statusHTML = '<span class="ev-badge published">Live</span>';
  } else if (ev.status === 'published' && !ev.admin_approved) {
    statusHTML = '<span class="ev-badge pending">Pending Approval</span>';
  } else {
    statusHTML = `<span class="ev-badge draft">${ev.status || 'Draft'}</span>`;
  }

  const rejectedHTML = ev.admin_rejected_reason
    ? `<div style="background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.12);border-radius:10px;padding:12px 16px;margin-top:12px">
         <strong style="color:#dc2626;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Rejection Reason</strong>
         <span style="font-size:.9rem">${escapeHTML(ev.admin_rejected_reason)}</span>
       </div>` : '';

  const coverHTML = ev.cover_image
    ? `<div style="border-radius:12px;overflow:hidden;margin-bottom:20px;max-height:220px">
         <img src="${escapeHTML(ev.cover_image)}" alt="Cover" style="width:100%;height:220px;object-fit:cover;display:block" onerror="this.style.display='none'" />
       </div>` : '';

  const tiersHTML = tiers.length > 0
    ? `<div style="margin-top:16px">
         <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px;color:var(--ev-text)">🎫 Ticket Tiers</h4>
         <table style="width:100%;border-collapse:collapse;font-size:.82rem">
           <thead><tr style="border-bottom:1px solid var(--ev-border)">
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Tier</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Price</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Sold</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Capacity</th>
             <th style="text-align:left;padding:6px 8px;color:var(--ev-text-muted)">Revenue</th>
           </tr></thead>
           <tbody>${tiers.map(t => `<tr style="border-bottom:1px solid var(--ev-border)">
             <td style="padding:6px 8px;font-weight:600">${escapeHTML(t.name || '—')}</td>
             <td style="padding:6px 8px">${t.price > 0 ? '$' + Number(t.price).toLocaleString() : 'Free'}</td>
             <td style="padding:6px 8px">${t.sold_count || 0}</td>
             <td style="padding:6px 8px">${t.capacity || 0}</td>
             <td style="padding:6px 8px;font-weight:600">${t.price > 0 ? '$' + ((t.sold_count || 0) * t.price).toLocaleString() : '—'}</td>
           </tr>`).join('')}</tbody>
         </table>
       </div>` : '<p style="color:var(--ev-text-muted);font-size:.85rem;margin-top:12px">No ticket tiers configured.</p>';

  const locationParts = [ev.venue, ev.venue_address, ev.city].filter(Boolean);
  const locationHTML = locationParts.length > 0
    ? `<div style="display:flex;gap:6px;align-items:flex-start;margin-bottom:8px">
         <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-top:2px;flex-shrink:0;color:var(--ev-text-muted)"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
         <span style="font-size:.88rem">${escapeHTML(locationParts.join(', '))}</span>
       </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'ev-modal-overlay active ev-event-detail-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  setSafeHTML(overlay, `
    <div class="ev-modal" style="max-width:640px;max-height:85vh;overflow-y:auto">
      <div class="ev-modal-header" style="position:sticky;top:0;z-index:2;background:var(--ev-bg)">
        <h2 style="font-size:1.1rem">Event Details</h2>
        <button class="ev-modal-close" id="event-detail-close">✕</button>
      </div>

      ${coverHTML}

      <div style="padding:0 0 4px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px">
          <h3 style="font-size:1.15rem;font-weight:800;margin:0;color:var(--ev-text)">${escapeHTML(ev.title)}</h3>
          ${statusHTML}
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:16px;font-size:.85rem;color:var(--ev-text-muted)">
          <span>📅 ${eventDate}</span>
          ${endDate ? `<span>→ ${endDate}</span>` : ''}
          <span>🏷 ${catLabel}</span>
          <span>📝 Created ${createdDate}</span>
        </div>

        ${locationHTML}

        ${ev.description ? `<div style="margin:16px 0;padding:14px;background:var(--ev-bg-secondary);border-radius:10px;font-size:.9rem;line-height:1.7;color:var(--ev-text);max-height:150px;overflow-y:auto">${escapeHTML(ev.description)}</div>` : ''}

        ${rejectedHTML}

        <!-- Organizer Info -->
        <div style="margin-top:16px;padding:14px;background:var(--ev-bg-secondary);border-radius:10px;display:flex;align-items:center;gap:14px">
          <div style="width:42px;height:42px;border-radius:50%;background:var(--ev-accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;flex-shrink:0">${escapeHTML((org.full_name || 'O').charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:.9rem;color:var(--ev-text)">${escapeHTML(org.full_name || '—')}</div>
            <div style="font-size:.8rem;color:var(--ev-text-muted)">${escapeHTML(org.email || '—')}${org.phone ? ' · ' + escapeHTML(org.phone) : ''}</div>
          </div>
          <span style="font-size:.7rem;background:var(--ev-bg);padding:4px 10px;border-radius:20px;font-weight:600;color:var(--ev-text-muted)">Organizer</span>
        </div>

        <!-- Stats Summary -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px">
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:var(--ev-accent)">${totalSold}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Tickets Sold</div>
          </div>
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:var(--ev-text)">${totalCap}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Capacity</div>
          </div>
          <div style="text-align:center;padding:14px;background:var(--ev-bg-secondary);border-radius:10px">
            <div style="font-size:1.3rem;font-weight:800;color:#10b981">${totalRev > 0 ? '$' + totalRev.toLocaleString() : 'Free'}</div>
            <div style="font-size:.75rem;color:var(--ev-text-muted)">Revenue</div>
          </div>
        </div>

        ${tiersHTML}

        <div style="font-size:.75rem;color:var(--ev-text-muted);margin-top:16px;text-align:right">Event ID: ${ev.id}</div>
      </div>
    </div>
  `);

  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  document.getElementById('event-detail-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}
