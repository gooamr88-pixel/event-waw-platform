/* ===================================
   EVENTSLI — CSV/Excel Report Engine
   Phase 8 Task 1: BRD Section 20
   ===================================
   Reusable CSV export utility with:
   - RFC 4180 compliant cell escaping
   - CSV formula injection prevention
   - UTF-8 BOM for Excel Arabic support
   - Multiple report types
   =================================== */

/**
 * Sanitize a single CSV cell value.
 * - Prevents formula injection (=, +, -, @, \t, \r)
 * - Wraps in quotes if contains comma, quote, or newline
 * - Escapes double-quotes by doubling
 */
function sanitizeCsvCell(val) {
  let str = String(val ?? '');

  // L-5: Prevent CSV formula injection
  // Prefix with single-quote if starts with dangerous char
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  // RFC 4180: Escape double-quotes by doubling
  str = str.replace(/"/g, '""');

  // Wrap in quotes (always — safer and handles commas/newlines)
  return `"${str}"`;
}

/**
 * Convert a 2D array of rows into a downloadable CSV file.
 * @param {string[][]} rows - Array of arrays (first row = headers)
 * @param {string} filename - Download filename (without .csv)
 */
export function downloadCSV(rows, filename) {
  // Build CSV string
  const csvContent = rows
    .map(row => row.map(cell => sanitizeCsvCell(cell)).join(','))
    .join('\n');

  // UTF-8 BOM for proper Arabic/Unicode handling in Excel
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  // Trigger download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export attendee report for a given event.
 * Fetches tickets + orders + tiers and generates a comprehensive CSV.
 * @param {string} eventId - Event UUID
 * @param {string} eventTitle - Event name for filename
 * @param {object} supabase - Supabase client instance
 */
export async function exportAttendeeReport(eventId, eventTitle, supabase) {
  if (!eventId) throw new Error('No event selected');

  // Fetch tiers
  const { data: tiers, error: tierErr } = await supabase
    .from('ticket_tiers')
    .select('id, name, price')
    .eq('event_id', eventId);

  if (tierErr) throw tierErr;
  if (!tiers?.length) throw new Error('No ticket tiers found');

  const tierMap = {};
  tiers.forEach(t => { tierMap[t.id] = t; });

  // Fetch tickets
  const { data: tickets, error: tickErr } = await supabase
    .from('tickets')
    .select('*')
    .in('ticket_tier_id', tiers.map(t => t.id))
    .order('created_at', { ascending: false });

  if (tickErr) throw tickErr;
  if (!tickets?.length) throw new Error('No tickets sold yet');

  // Fetch orders for guest info
  const orderIds = [...new Set(tickets.map(t => t.order_id).filter(Boolean))];
  let orderMap = {};
  if (orderIds.length) {
    const { data: orders } = await supabase
      .from('orders')
      .select('id, guest_name, guest_email, user_id, total_amount, promo_code')
      .in('id', orderIds);
    if (orders) orders.forEach(o => { orderMap[o.id] = o; });
  }

  // Build CSV rows
  const headers = [
    'No.', 'Attendee Name', 'Email', 'Ticket Type', 'Ticket Price',
    'Seat', 'Status', 'Order ID', 'Promo Code', 'Purchase Date'
  ];

  const rows = [headers];

  tickets.forEach((t, i) => {
    const order = orderMap[t.order_id] || {};
    const name = t.attendee_name || order.guest_name || 'Guest';
    const email = t.attendee_email || order.guest_email || '';
    const tier = tierMap[t.ticket_tier_id];
    const tierName = tier?.name || 'Unknown';
    const price = tier?.price != null ? tier.price.toFixed(2) : '0.00';
    const seat = t.seat_section
      ? `${t.seat_section} Row ${t.seat_row} Seat ${t.seat_number}`
      : 'General Admission';
    const status = t.scanned_at
      ? `Scanned (${new Date(t.scanned_at).toLocaleString()})`
      : t.status === 'valid' ? 'Valid'
      : t.status === 'cancelled' ? 'Cancelled'
      : 'Pending';
    const orderId = t.order_id ? t.order_id.substring(0, 8) : '';
    const promo = order.promo_code || '';
    const purchaseDate = t.created_at
      ? new Date(t.created_at).toLocaleString()
      : '';

    rows.push([
      String(i + 1), name, email, tierName, price,
      seat, status, orderId, promo, purchaseDate
    ]);
  });

  // Summary row
  rows.push([]);
  rows.push(['Summary']);
  rows.push(['Total Tickets', String(tickets.length)]);
  rows.push(['Scanned', String(tickets.filter(t => t.scanned_at).length)]);
  rows.push(['Pending', String(tickets.filter(t => !t.scanned_at && t.status === 'valid').length)]);
  rows.push(['Total Revenue', tickets.reduce((s, t) => s + (tierMap[t.ticket_tier_id]?.price || 0), 0).toFixed(2)]);

  // Generate filename
  const safeName = (eventTitle || 'event').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];

  downloadCSV(rows, `attendees_${safeName}_${dateStr}`);
  return tickets.length;
}

/**
 * Export financial summary for all organizer events.
 * @param {object[]} revenueData - Array from get_organizer_revenue RPC
 */
export function exportFinancialReport(revenueData) {
  if (!revenueData?.length) throw new Error('No financial data to export');

  const headers = [
    'Event', 'Tickets Sold', 'Gross Revenue', 'Platform Fee',
    'Tax', 'Net Revenue', 'Scan Rate'
  ];

  const rows = [headers];
  let totalGross = 0, totalNet = 0, totalTickets = 0;

  revenueData.forEach(r => {
    const gross = Number(r.gross_revenue || 0);
    const fee = Number(r.platform_fee || 0);
    const tax = Number(r.tax_amount || 0);
    const net = Number(r.net_revenue || 0);
    const tickets = Number(r.total_tickets_sold || 0);
    const scanned = Number(r.scanned_count || 0);
    const scanRate = tickets > 0 ? ((scanned / tickets) * 100).toFixed(1) + '%' : '0%';

    totalGross += gross;
    totalNet += net;
    totalTickets += tickets;

    rows.push([
      r.event_title || 'Untitled',
      String(tickets),
      gross.toFixed(2),
      fee.toFixed(2),
      tax.toFixed(2),
      net.toFixed(2),
      scanRate
    ]);
  });

  // Summary
  rows.push([]);
  rows.push(['TOTAL', String(totalTickets), totalGross.toFixed(2), '', '', totalNet.toFixed(2), '']);

  downloadCSV(rows, `financial_report_${new Date().toISOString().split('T')[0]}`);
  return revenueData.length;
}

/**
 * Export payout history.
 * @param {object[]} payouts - Array of payout objects
 */
export function exportPayoutReport(payouts) {
  if (!payouts?.length) throw new Error('No payout data to export');

  const headers = [
    'Payout ID', 'Amount', 'Currency', 'Method', 'Status',
    'Requested', 'Processed', 'External Ref', 'Notes'
  ];

  const rows = [headers];
  payouts.forEach(po => {
    rows.push([
      po.id?.substring(0, 8) || '',
      String(po.net_amount || 0),
      po.currency || 'USD',
      po.payout_method || '',
      po.status || '',
      po.requested_at ? new Date(po.requested_at).toLocaleString() : '',
      po.processed_at ? new Date(po.processed_at).toLocaleString() : '',
      po.external_ref || '',
      po.notes || ''
    ]);
  });

  downloadCSV(rows, `payouts_${new Date().toISOString().split('T')[0]}`);
  return payouts.length;
}
