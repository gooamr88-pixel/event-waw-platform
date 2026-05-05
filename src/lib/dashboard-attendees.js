import { supabase, getCurrentUser } from './supabase.js';
import { showToast } from './dashboard-ui.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

export function setupEmailAttendees() {
  document.getElementById('ticket-email-btn')?.addEventListener('click', async () => {
    const eventId = document.getElementById('ticket-event-select')?.value;
    if (!eventId) { showToast('Select an event first', 'error'); return; }

    const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';

    // Fetch attendee emails
    try {
      const { data: tiers } = await supabase.from('ticket_tiers').select('id').eq('event_id', eventId);
      if (!tiers?.length) { showToast('No tiers found', 'error'); return; }
      const { data: tickets } = await supabase
        .from('tickets')
        .select('*')
        .in('ticket_tier_id', tiers.map(t => t.id));

      // Get emails from orders table (where guest emails are stored)
      const orderIds = [...new Set((tickets || []).map(t => t.order_id).filter(Boolean))];
      let allEmails = [];
      (tickets || []).forEach(t => { if (t.attendee_email) allEmails.push(t.attendee_email); });
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_email').in('id', orderIds);
          if (orders) orders.forEach(o => { if (o.guest_email) allEmails.push(o.guest_email); });
        } catch (_) {}
      }
      const emails = [...new Set(allEmails)];
      if (!emails.length) { showToast('No attendee emails found', 'error'); return; }

      // Show compose modal
      const modal = document.createElement('div');
      modal.className = 'ev-modal-overlay active';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      setSafeHTML(modal, `<div class="ev-modal" style="max-width:560px">
        <div class="ev-modal-header">
          <h2>Email Attendees</h2>
          <button class="ev-modal-close" id="email-close">x</button>
        </div>
        <div class="ev-email-compose">
          <div class="ev-email-to">
            <span>To:</span>
            <strong>${escapeHTML(eventName)}</strong>
            <span class="ev-email-count">${emails.length} attendees</span>
          </div>
          <div class="ev-form-group">
            <label>Subject</label>
            <input class="ev-form-input" type="text" id="email-subject" value="Important Update: ${escapeHTML(eventName)}" />
          </div>
          <div class="ev-form-group">
            <label>Message</label>
            <textarea class="ev-form-input" id="email-body" rows="6" placeholder="Write your message to all attendees..."></textarea>
          </div>
          <div style="display:flex;gap:10px">
            <button class="ev-btn ev-btn-outline" id="email-cancel" style="flex:1">Cancel</button>
            <button class="ev-btn ev-btn-pink" id="email-send" style="flex:1">Open in Email Client</button>
          </div>
        </div>
      </div>`);
      document.body.appendChild(modal);

      document.getElementById('email-close').onclick = () => modal.remove();
      document.getElementById('email-cancel').onclick = () => modal.remove();
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

      document.getElementById('email-send').addEventListener('click', () => {
        const subject = encodeURIComponent(document.getElementById('email-subject').value);
        const body = encodeURIComponent(document.getElementById('email-body').value);
        const bcc = emails.join(',');
        window.open(`mailto:?bcc=${bcc}&subject=${subject}&body=${body}`, '_self');
        showToast('Email client opened with attendee list!', 'success');
        modal.remove();
      });
    } catch (err) {
      showToast('Error loading attendees: ' + err.message, 'error');
    }
  });
}
