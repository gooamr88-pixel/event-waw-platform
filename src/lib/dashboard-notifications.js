import { supabase, getCurrentUser } from './supabase.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

let dashNotifications = [];

/* ==================================
   NOTIFICATIONS
   ================================== */

export async function loadNotifications() {
  try {
    const user = await getCurrentUser();
    const lastSeen = localStorage.getItem('ev-last-notif') || new Date(Date.now() - 86400000).toISOString();

    const { data: events } = await supabase.from('events').select('id, title').eq('organizer_id', user.id);
    if (!events?.length) return;

    const { data: tiers } = await supabase.from('ticket_tiers').select('id, event_id').in('event_id', events.map(e => e.id));
    if (!tiers?.length) return;

    const eventMap = {};
    events.forEach(e => { eventMap[e.id] = e.title; });
    const tierEventMap = {};
    tiers.forEach(t => { tierEventMap[t.id] = t.event_id; });

    // Also get tier names for display
    const { data: tiersWithNames } = await supabase.from('ticket_tiers').select('id, name, event_id').in('event_id', events.map(e => e.id));
    const tierNameMap = {};
    (tiersWithNames || []).forEach(t => { tierNameMap[t.id] = t.name; tierEventMap[t.id] = t.event_id; });

    const { data: tickets } = await supabase
      .from('tickets')
      .select('*')
      .in('ticket_tier_id', tiers.map(t => t.id))
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tickets?.length) {
      // Try to get attendee names from orders
      const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
      let orderMap = {};
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_name').in('id', orderIds);
          if (orders) orders.forEach(o => { orderMap[o.id] = o; });
        } catch (_) {}
      }

      dashNotifications = tickets.map(t => {
        const guestName = orderMap[t.order_id]?.guest_name || t.attendee_name || 'Someone';
        const tierName = tierNameMap[t.ticket_tier_id] || '';
        return {
          icon: '',
          text: `<strong>${escapeHTML(guestName)}</strong> purchased a <strong>${escapeHTML(tierName)}</strong> ticket for <strong>${escapeHTML(eventMap[tierEventMap[t.ticket_tier_id]] || '')}</strong>`,
          time: t.created_at,
          unread: true
        };
      });
    }
    renderNotifications();
  } catch (_) { /* Notifications are optional */ }
}

export function renderNotifications() {
  const list = document.getElementById('notif-list');
  const bell = document.getElementById('notif-bell');
  if (!list) return;

  // Remove old badge
  bell?.querySelector('.ev-notif-badge')?.remove();

  if (!dashNotifications.length) {
    setSafeHTML(list, '<div class="ev-notif-empty"> No new notifications</div>');
    bell?.classList.remove('has-notif');
    return;
  }

  // Add badge
  const badge = document.createElement('span');
  badge.className = 'ev-notif-badge';
  badge.textContent = dashNotifications.length;
  bell?.insertBefore(badge, bell.firstChild);
  bell?.classList.add('has-notif');

  setSafeHTML(list, dashNotifications.map(n => `
    <div class="ev-notif-item ${n.unread ? 'unread' : ''}">
      <div class="ev-notif-icon">${n.icon}</div>
      <div class="ev-notif-text">
        <p>${n.text}</p>
        <time>${timeAgo(n.time)}</time>
      </div>
    </div>
  `).join(''));
}

export function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
