import { supabase } from './supabase.js';
import { safeQuery } from './api.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML, generateSkeletonRows } from './dom.js';
import { showToast } from './dashboard-ui.js';

export function setupTicketsPanel() {
  const select = document.getElementById('ticket-event-select');
  select?.addEventListener('change', async () => {
    const tbody = document.getElementById('tickets-tbody');
    const eventId = select.value;
    if (!eventId) {
      setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">Select an event to view tickets</td></tr>');
      document.getElementById('tkt-stat-sold').textContent = '0';
      document.getElementById('tkt-stat-scanned').textContent = '0';
      document.getElementById('tkt-stat-revenue').textContent = '$0';
      return;
    }
    setSafeHTML(tbody, generateSkeletonRows(['20px', '120px', '180px', '80px', '60px', '90px', '70px'], 5));
    
    try {
      const { data: tiers, error: tierErr } = await supabase.from('ticket_tiers').select('id, name, price').eq('event_id', eventId);
      if (tierErr) { console.error('Tier query error:', tierErr); setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">Error loading tiers</td></tr>'); return; }
      if (!tiers?.length) { setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No tiers found</td></tr>'); return; }
      const tierMap = {};
      tiers.forEach(t => { tierMap[t.id] = t; });

      const { data: tickets, error: tickErr } = await safeQuery(
        supabase.from('tickets').select('*').in('ticket_tier_id', tiers.map(t => t.id)).order('created_at', { ascending: false })
      );

      if (tickErr) { console.error('Ticket query error:', tickErr); setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">Error loading tickets</td></tr>'); return; }

      if (!tickets?.length) {
        setSafeHTML(tbody, '<tr><td colspan="7" class="ev-table-empty">No tickets sold yet</td></tr>');
        document.getElementById('tkt-stat-sold').textContent = '0';
        document.getElementById('tkt-stat-scanned').textContent = '0';
        document.getElementById('tkt-stat-revenue').textContent = '$0';
        return;
      }

      const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
      let orderMap = {};
      if (orderIds.length) {
        try {
          const { data: orders } = await supabase.from('orders').select('id, guest_name, guest_email, user_id').in('id', orderIds);
          if (orders) orders.forEach(o => { orderMap[o.id] = o; });
        } catch (e) { console.warn('Order lookup skipped:', e); }
      }

      const scannedCount = tickets.filter(t => t.scanned_at).length;
      const totalRev = tickets.reduce((s, t) => s + (tierMap[t.ticket_tier_id]?.price || 0), 0);
      document.getElementById('tkt-stat-sold').textContent = tickets.length;
      document.getElementById('tkt-stat-scanned').textContent = scannedCount;
      document.getElementById('tkt-stat-revenue').textContent = '$' + totalRev.toLocaleString();
      
      const htmlString = tickets.map((t, i) => {
        const order = orderMap[t.order_id] || {};
        const name = t.attendee_name || order.guest_name || (t.user_id ? t.user_id.substring(0, 8) : 'Guest');
        const email = t.attendee_email || order.guest_email || '-';
        const tierName = tierMap[t.ticket_tier_id]?.name || '-';
        return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${escapeHTML(name)}</td>
        <td>${escapeHTML(email)}</td>
        <td>${escapeHTML(tierName)}</td>
        <td>-</td>
        <td><span class="ev-badge ${t.scanned_at ? 'accepted' : 'pending'}">${t.scanned_at ? '[OK] Scanned' : 'Pending'}</span></td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(t.created_at).toLocaleDateString()}</td>
      </tr>`;
      }).join('');
      setSafeHTML(tbody, htmlString);

      const csvBtn = document.getElementById('ticket-csv-btn');
      if (csvBtn) csvBtn.onclick = () => {
        const rows = [['Name','Email','Tier','Seat','Status','Date']];
        tickets.forEach(t => rows.push([
          t.attendee_name||'', t.attendee_email||'', t.tier_name||'',
          t.seat_section ? `${t.seat_section} R${t.seat_row} S${t.seat_number}` : '',
          t.scanned_at ? 'Scanned' : 'Pending', t.created_at||''
        ]));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        a.download = `tickets_${Date.now()}.csv`;
        a.click();
        showToast('CSV exported', 'success');
      };

      const pdfBtn = document.getElementById('ticket-pdf-btn');
      if (pdfBtn) pdfBtn.onclick = () => {
        const eventName = document.getElementById('ticket-event-select')?.selectedOptions[0]?.textContent || 'Event';
        const printWin = window.open('', '_blank', 'width=800,height=600');
        printWin.document.write(`<!DOCTYPE html><html><head><title>Tickets - ${escapeHTML(eventName)}</title>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #222; }
            h1 { font-size: 1.3rem; margin-bottom: 4px; }
            p.sub { color: #666; font-size: .85rem; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: .85rem; }
            th { background: #f5f5f5; padding: 10px 8px; text-align: left; font-weight: 700; border-bottom: 2px solid #ddd; }
            td { padding: 8px; border-bottom: 1px solid #eee; }
            tr:nth-child(even) { background: #fafafa; }
            .badge { padding: 3px 8px; border-radius: 4px; font-size: .72rem; font-weight: 600; }
            .badge-scanned { background: #dcfce7; color: #16a34a; }
            .badge-pending { background: #fef3c7; color: #d97706; }
            @media print { body { padding: 0; } }
          </style></head><body>
          <h1> ${escapeHTML(eventName)} - Ticket Report</h1>
          <p class="sub">Generated: ${new Date().toLocaleString()}  Total: ${tickets.length} tickets</p>
          <table>
            <thead><tr><th>#</th><th>Attendee</th><th>Email</th><th>Tier</th><th>Seat</th><th>Status</th><th>Purchase Date</th></tr></thead>
            <tbody>${tickets.map((t, i) => `<tr>
              <td>${i + 1}</td>
              <td><strong>${escapeHTML(t.attendee_name || '-')}</strong></td>
              <td>${escapeHTML(t.attendee_email || '-')}</td>
              <td>${escapeHTML(t.tier_name || '-')}</td>
              <td>${t.seat_section ? t.seat_section + ' R' + t.seat_row + ' S' + t.seat_number : '-'}</td>
              <td><span class="badge ${t.scanned_at ? 'badge-scanned' : 'badge-pending'}">${t.scanned_at ? '[OK] Scanned' : 'Pending'}</span></td>
              <td>${new Date(t.created_at).toLocaleDateString()}</td>
            </tr>`).join('')}</tbody>
          </table>
          <script>setTimeout(() => { window.print(); }, 300);<\/script>
        </body></html>`);
        printWin.document.close();
        showToast('PDF print dialog opened', 'success');
      };
    } catch (err) {
      setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty" style="color:var(--ev-danger)">${escapeHTML(err.message)}</td></tr>`);
    }
  });
}
