import { supabase } from './supabase.js';
import { escapeHTML, formatCurrency } from './utils.js';
import { setSafeHTML } from './dom.js';

let revenueChartInstance = null;
let tierChartInstance = null;
let paymentChartInstance = null;

let _cachedEvents = [];
let _cachedPayments = [];
let _cachedOrders = [];
let _cachedTickets = [];

/* ==================================
   INITIALIZATION
   ================================== */
export async function initAnalyticsPanel(events) {
  _cachedEvents = events || [];

  const eventSelect = document.getElementById('ana-filter-event');
  const timeframeSelect = document.getElementById('ana-filter-timeframe');
  if (!eventSelect) return;

  // Populate event dropdown
  let options = '<option value="all">All Events</option>';
  _cachedEvents.forEach(ev => {
    options += `<option value="${ev.id}">${escapeHTML(ev.title)}</option>`;
  });
  setSafeHTML(eventSelect, options);

  const selectedEventId = eventSelect.value || 'all';
  const timeframeDays = timeframeSelect ? timeframeSelect.value : '30';

  // Event listeners for responsive instant filtering
  eventSelect.addEventListener('change', () => {
    renderAnalytics(eventSelect.value, timeframeSelect ? timeframeSelect.value : '30');
  });
  if (timeframeSelect) {
    timeframeSelect.addEventListener('change', () => {
      renderAnalytics(eventSelect.value, timeframeSelect.value);
    });
  }

  // Load and cache records from Supabase in parallel
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const [payRes, ordRes, tktRes] = await Promise.all([
      supabase.from('payments').select('*'),
      supabase.from('orders').select('*'),
      supabase.from('tickets').select('id, ticket_tier_id, status, scanned_at, created_at')
    ]);

    if (payRes.error) throw payRes.error;
    if (ordRes.error) throw ordRes.error;
    if (tktRes.error) throw tktRes.error;

    _cachedPayments = payRes.data || [];
    _cachedOrders = ordRes.data || [];
    _cachedTickets = tktRes.data || [];

    // Trigger render with current dropdown selections
    renderAnalytics(selectedEventId, timeframeDays);

  } catch (err) {
    console.error('Error fetching analytics data:', err);
    const insightsContainer = document.getElementById('ana-insights-container');
    if (insightsContainer) {
      setSafeHTML(insightsContainer, `<div style="color:var(--ev-danger); font-size:0.8rem; padding:20px 0">Failed to load analytics: ${escapeHTML(err.message)}</div>`);
    }
  }
}

/* ==================================
   CORE RENDER
   ================================== */
function renderAnalytics(selectedEventId, timeframeDays) {
  // 1. Calculate timeframe cutoff date
  const now = new Date();
  let cutoffDate = null;
  if (timeframeDays !== 'all') {
    cutoffDate = new Date();
    cutoffDate.setDate(now.getDate() - parseInt(timeframeDays));
  }

  // 2. Filter payments & orders
  let filteredPayments = _cachedPayments.filter(p => p.status === 'paid');
  let filteredOrders = _cachedOrders.filter(o => o.status === 'paid');

  if (selectedEventId !== 'all') {
    filteredPayments = filteredPayments.filter(p => p.event_id === selectedEventId);
    filteredOrders = filteredOrders.filter(o => o.event_id === selectedEventId);
  }

  if (cutoffDate) {
    filteredPayments = filteredPayments.filter(p => new Date(p.created_at || p.paid_at) >= cutoffDate);
    filteredOrders = filteredOrders.filter(o => new Date(o.created_at) >= cutoffDate);
  }

  // 3. Map ticket tier metadata
  const tierToEventMap = {};
  const tierMap = {};
  _cachedEvents.forEach(ev => {
    (ev.ticket_tiers || []).forEach(t => {
      tierToEventMap[t.id] = ev.id;
      tierMap[t.id] = t;
    });
  });

  // 4. Filter tickets
  let filteredTickets = _cachedTickets.filter(t => t.status === 'valid' || t.status === 'scanned');
  if (selectedEventId !== 'all') {
    filteredTickets = filteredTickets.filter(t => tierToEventMap[t.ticket_tier_id] === selectedEventId);
  }
  if (cutoffDate) {
    filteredTickets = filteredTickets.filter(t => new Date(t.created_at) >= cutoffDate);
  }

  // 5. Compute stats metrics
  let grossRevenue = 0;
  let netPayout = 0;
  let promoSavings = 0;

  filteredPayments.forEach(p => {
    grossRevenue += Number(p.total_amount || 0);
    netPayout += Number(p.organizer_net || 0);
    promoSavings += Number(p.promo_discount || 0);
  });

  const ticketsSold = filteredTickets.length;
  const scannedCount = filteredTickets.filter(t => t.scanned_at || t.status === 'scanned').length;
  const scanRate = ticketsSold > 0 ? Math.round((scannedCount / ticketsSold) * 100) : 0;
  const ordersCount = filteredOrders.length;
  const aov = ordersCount > 0 ? (grossRevenue / ordersCount) : 0;

  // 6. Format metrics display
  const currency = filteredPayments[0]?.currency || _cachedEvents[0]?.currency || 'USD';

  document.getElementById('ana-gross-revenue').textContent = formatCurrency(grossRevenue, currency);
  document.getElementById('ana-net-payout').textContent = formatCurrency(netPayout, currency);
  document.getElementById('ana-tickets-sold').textContent = ticketsSold.toLocaleString();
  document.getElementById('ana-scan-rate').textContent = scanRate + '%';
  document.getElementById('ana-aov').textContent = formatCurrency(aov, currency);
  document.getElementById('ana-promo-savings').textContent = formatCurrency(promoSavings, currency);

  // 7. Update charts
  renderRevenueTrendsChart(filteredPayments, timeframeDays);
  renderTicketsByTierChart(filteredTickets, tierMap);
  renderPaymentMethodsChart(filteredPayments, filteredOrders);

  // 8. Render transaction feeds & insights
  renderRecentTransactions(filteredPayments, filteredOrders);
  renderSmartInsights(filteredPayments, filteredTickets, tierMap, scanRate);
  renderRevenueBreakdownTable(filteredPayments, filteredTickets, tierToEventMap);
}

/* ==================================
   REVENUE TRENDS CHART
   ================================== */
function renderRevenueTrendsChart(payments, timeframeDays) {
  const canvas = document.getElementById('revenue-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (revenueChartInstance) revenueChartInstance.destroy();

  const dateMap = {};
  const days = timeframeDays === 'all' ? 30 : parseInt(timeframeDays);

  const labels = [];
  let currentCumulative = 0;

  // Pre-populate timeframe slots
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    dateMap[dateStr] = 0;
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }

  // Populate with data
  payments.forEach(p => {
    const dateStr = new Date(p.created_at || p.paid_at).toISOString().split('T')[0];
    if (dateMap[dateStr] !== undefined) {
      dateMap[dateStr] += Number(p.total_amount || 0);
    } else if (timeframeDays === 'all') {
      dateMap[dateStr] = (dateMap[dateStr] || 0) + Number(p.total_amount || 0);
    }
  });

  let finalLabels = labels;
  let finalValues = [];

  if (timeframeDays === 'all') {
    const sortedDates = Object.keys(dateMap).sort();
    finalLabels = sortedDates.map(ds => {
      const d = new Date(ds);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    sortedDates.forEach(ds => {
      currentCumulative += dateMap[ds];
      finalValues.push(currentCumulative);
    });
  } else {
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      currentCumulative += dateMap[dateStr] || 0;
      finalValues.push(currentCumulative);
    }
  }

  const isDark = document.body.classList.contains('dark') || document.body.dataset.theme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';
  const labelColor = isDark ? '#888' : '#999';

  revenueChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: finalLabels,
      datasets: [{
        label: 'Cumulative Revenue',
        data: finalValues,
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, .06)',
        fill: true,
        tension: 0.35,
        pointRadius: finalValues.length > 30 ? 1 : 4,
        pointHoverRadius: 6,
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: labelColor, font: { size: 10 } } },
        y: { grid: { color: gridColor }, ticks: { color: labelColor, font: { size: 10 } } }
      }
    }
  });
}

/* ==================================
   TICKETS BY TIER DOUGHNUT CHART
   ================================== */
function renderTicketsByTierChart(tickets, tierMap) {
  const canvas = document.getElementById('tier-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (tierChartInstance) tierChartInstance.destroy();

  const countMap = {};
  tickets.forEach(t => {
    const tierName = tierMap[t.ticket_tier_id]?.name || 'Unknown Tier';
    countMap[tierName] = (countMap[tierName] || 0) + 1;
  });

  const labels = Object.keys(countMap);
  const values = Object.values(countMap);

  if (labels.length === 0) {
    labels.push('No tickets sold');
    values.push(0);
  }

  const isDark = document.body.classList.contains('dark') || document.body.dataset.theme === 'dark';
  const labelColor = isDark ? '#ccc' : '#777';

  tierChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#10B981', '#EC4899', '#8B5CF6', '#F59E0B', '#3B82F6', '#EF4444', '#14B8A6'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: labelColor, font: { size: 11 }, padding: 12, boxWidth: 10 }
        }
      }
    }
  });
}

/* ==================================
   PAYMENT METHODS SPLIT CHART
   ================================== */
function renderPaymentMethodsChart(payments, orders) {
  const canvas = document.getElementById('payment-methods-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (paymentChartInstance) paymentChartInstance.destroy();

  const orderMap = {};
  orders.forEach(o => { orderMap[o.id] = o; });

  const methodMap = {};
  payments.forEach(p => {
    const order = orderMap[p.order_id];
    let method = order?.payment_method || 'other';

    const readableMethods = {
      stripe: 'Credit Card (Stripe)',
      card: 'Credit Card',
      vodafone_cash: 'Vodafone Cash',
      instapay: 'InstaPay',
      bank_transfer: 'Bank Transfer',
      fawry: 'Fawry',
      manual: 'Manual Payment'
    };

    const methodLabel = readableMethods[method] || method.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
    methodMap[methodLabel] = (methodMap[methodLabel] || 0) + 1;
  });

  const labels = Object.keys(methodMap);
  const values = Object.values(methodMap);

  if (labels.length === 0) {
    labels.push('No transactions');
    values.push(0);
  }

  const isDark = document.body.classList.contains('dark') || document.body.dataset.theme === 'dark';
  const labelColor = isDark ? '#ccc' : '#777';

  paymentChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: ['#6366F1', '#10B981', '#F59E0B', '#3B82F6', '#EF4444', '#EC4899', '#8B5CF6'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: labelColor, font: { size: 11 }, padding: 12, boxWidth: 10 }
        }
      }
    }
  });
}

/* ==================================
   TRANSACTIONS TABLE
   ================================== */
function renderRecentTransactions(payments, orders) {
  const tbody = document.getElementById('ana-transactions-tbody');
  const countEl = document.getElementById('ana-tx-count');
  if (!tbody) return;

  const orderMap = {};
  orders.forEach(o => { orderMap[o.id] = o; });

  const eventMap = {};
  _cachedEvents.forEach(e => { eventMap[e.id] = e; });

  const totalOrders = payments.length;
  if (countEl) countEl.textContent = `${totalOrders} orders total`;

  const sortedPayments = [...payments]
    .sort((a, b) => new Date(b.created_at || b.paid_at) - new Date(a.created_at || a.paid_at))
    .slice(0, 5);

  if (sortedPayments.length === 0) {
    setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No transactions found</td></tr>');
    return;
  }

  const methodLabels = {
    stripe: '💳 Card',
    card: '💳 Card',
    vodafone_cash: '📱 Vodafone Cash',
    instapay: '🏦 InstaPay',
    bank_transfer: '🏧 Bank Transfer',
    fawry: '💳 Fawry',
    other: '💰 Other'
  };

  const rows = sortedPayments.map(p => {
    const order = orderMap[p.order_id];
    const event = eventMap[p.event_id];
    const customerName = order ? (order.guest_name || order.guest_email || 'Guest Customer') : 'Customer';
    const eventTitle = event ? event.title : 'Event';
    const amountStr = formatCurrency(p.total_amount, p.currency);
    const methodStr = methodLabels[order?.payment_method] || order?.payment_method || 'Payment';
    const dateStr = new Date(p.created_at || p.paid_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    return `<tr>
      <td style="font-weight: 600">${escapeHTML(customerName)}</td>
      <td style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${escapeHTML(eventTitle)}</td>
      <td style="font-weight: 700; color: var(--ev-pink)">${amountStr}</td>
      <td style="font-size: 0.8rem">${escapeHTML(methodStr)}</td>
      <td><span class="ev-badge ev-badge-green">Paid</span></td>
      <td style="font-size: 0.76rem; color: var(--ev-text-sec)">${dateStr}</td>
    </tr>`;
  }).join('');

  setSafeHTML(tbody, rows);
}

/* ==================================
   SMART INSIGHTS
   ================================== */
function renderSmartInsights(payments, tickets, tierMap, scanRate) {
  const container = document.getElementById('ana-insights-container');
  if (!container) return;

  if (payments.length === 0) {
    setSafeHTML(container, `
      <div style="text-align:center; padding:30px; color:var(--ev-text-muted); font-size:0.82rem">
        <div style="font-size: 1.5rem; margin-bottom: 8px">💡</div>
        <p>Not enough transaction data to generate insights yet.</p>
      </div>
    `);
    return;
  }

  // Peak Purchase Hour
  const hourCounts = {};
  payments.forEach(p => {
    const date = new Date(p.created_at || p.paid_at);
    if (!isNaN(date)) {
      const hr = date.getHours();
      hourCounts[hr] = (hourCounts[hr] || 0) + 1;
    }
  });

  let peakHour = null;
  let maxHourlySales = 0;
  for (const hr in hourCounts) {
    if (hourCounts[hr] > maxHourlySales) {
      maxHourlySales = hourCounts[hr];
      peakHour = parseInt(hr);
    }
  }

  let peakHourText = "Your sales are evenly distributed.";
  if (peakHour !== null) {
    const displayHour = peakHour === 0 ? "12 AM" : peakHour === 12 ? "12 PM" : peakHour > 12 ? `${peakHour - 12} PM` : `${peakHour} AM`;
    const nextHour = (peakHour + 1) === 12 ? "12 PM" : (peakHour + 1) === 24 ? "12 AM" : (peakHour + 1) > 12 ? `${peakHour + 1 - 12} PM` : `${peakHour + 1} AM`;
    peakHourText = `Sales peak between <strong>${displayHour} and ${nextHour}</strong>. Schedule marketing campaigns during this window for optimal conversions.`;
  }

  // Top Ticket Tier
  const tierCounts = {};
  tickets.forEach(t => {
    const tierName = tierMap[t.ticket_tier_id]?.name || 'Unknown Tier';
    tierCounts[tierName] = (tierCounts[tierName] || 0) + 1;
  });

  let topTier = null;
  let maxTierSales = 0;
  for (const tier in tierCounts) {
    if (tierCounts[tier] > maxTierSales) {
      maxTierSales = tierCounts[tier];
      topTier = tier;
    }
  }

  let topTierText = "Ticket tiers are performing equally.";
  if (topTier) {
    topTierText = `Tier <strong>${escapeHTML(topTier)}</strong> is your best-seller, accounting for <strong>${maxTierSales} tickets</strong>. Consider boosting capacity or adding early bird locks.`;
  }

  // Check-in status
  let scanText = "Your check-in scanning has not started yet.";
  let scanIcon = "🎟️";
  if (scanRate === 0) {
    scanText = "Check-in rate is at 0%. Assign staff scanners via the <strong>Gate Team</strong> tab to prepare for event day entry.";
  } else if (scanRate > 0 && scanRate < 60) {
    scanText = `Check-in is in progress (<strong>${scanRate}%</strong>). Monitor scan velocities at the door to prevent entry congestion.`;
    scanIcon = "⚡";
  } else if (scanRate >= 60 && scanRate < 90) {
    scanText = `Great progress! <strong>${scanRate}%</strong> of ticket holders have entered the venue successfully.`;
    scanIcon = "✅";
  } else {
    scanText = `Check-in is almost complete (<strong>${scanRate}%</strong>). High check-in efficiency achieved by your door scanners!`;
    scanIcon = "🏆";
  }

  const html = `
    <div class="insight-item">
      <div class="insight-icon">🔥</div>
      <div class="insight-text">
        <div class="insight-title">Peak Sales Windows</div>
        <div>${peakHourText}</div>
      </div>
    </div>
    <div class="insight-item">
      <div class="insight-icon">🎯</div>
      <div class="insight-text">
        <div class="insight-title">Top Ticket Tier</div>
        <div>${topTierText}</div>
      </div>
    </div>
    <div class="insight-item">
      <div class="insight-icon">${scanIcon}</div>
      <div class="insight-text">
        <div class="insight-title">Check-in Status</div>
        <div>${scanText}</div>
      </div>
    </div>
  `;

  setSafeHTML(container, html);
}

/* ==================================
   REVENUE BREAKDOWN PER-EVENT TABLE
   ================================== */
function renderRevenueBreakdownTable(payments, tickets, tierToEventMap) {
  const breakdownEl = document.getElementById('revenue-breakdown');
  if (!breakdownEl) return;

  const eventBreakdown = {};
  _cachedEvents.forEach(ev => {
    eventBreakdown[ev.id] = {
      event_title: ev.title,
      currency: ev.currency,
      total_tickets_sold: 0,
      gross_revenue: 0,
      platform_fee: 0,
      net_revenue: 0,
      scanned_count: 0
    };
  });

  payments.forEach(p => {
    if (eventBreakdown[p.event_id]) {
      eventBreakdown[p.event_id].gross_revenue += Number(p.total_amount || 0);
      eventBreakdown[p.event_id].platform_fee += Number(p.platform_fee_total || 0);
      eventBreakdown[p.event_id].net_revenue += Number(p.organizer_net || 0);
    }
  });

  tickets.forEach(t => {
    const evId = tierToEventMap[t.ticket_tier_id];
    if (evId && eventBreakdown[evId]) {
      eventBreakdown[evId].total_tickets_sold++;
      if (t.scanned_at || t.status === 'scanned') {
        eventBreakdown[evId].scanned_count++;
      }
    }
  });

  const rows = Object.values(eventBreakdown)
    .filter(eb => eb.gross_revenue > 0 || eb.total_tickets_sold > 0)
    .map(eb => {
      const sRate = eb.total_tickets_sold > 0 ? Math.round((eb.scanned_count / eb.total_tickets_sold) * 100) : 0;
      return `<tr>
        <td>
          <div style="font-weight:600">${escapeHTML(eb.event_title)}</div>
          <div style="font-size:.76rem;color:var(--ev-text-sec)">${eb.total_tickets_sold} tickets</div>
        </td>
        <td style="text-align:right;font-weight:600">${formatCurrency(eb.gross_revenue, eb.currency || 'USD')}</td>
        <td style="text-align:right;color:var(--ev-text-sec)">-${formatCurrency(eb.platform_fee, eb.currency || 'USD')}</td>
        <td style="text-align:right;color:var(--ev-pink);font-weight:700">${formatCurrency(eb.net_revenue, eb.currency || 'USD')}</td>
        <td style="text-align:center">${sRate}%</td>
      </tr>`;
    }).join('');

  if (rows.length === 0) {
    setSafeHTML(breakdownEl, `<p style="text-align:center;padding:24px;color:var(--ev-text-muted)">No revenue data for the selected filters</p>`);
  } else {
    setSafeHTML(breakdownEl, `<div class="ev-table-wrap"><table class="ev-table">
      <thead><tr><th>Event</th><th style="text-align:right">Gross</th><th style="text-align:right">Fee</th><th style="text-align:right">Net Payout</th><th style="text-align:center">Scan %</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`);
  }
}

/* ==================================
   BACKWARDS COMPATIBILITY WRAPPERS
   ================================== */
export function renderRevenueBreakdown(_data) {
  // Let the dynamic render breakdownTable handle updates; this acts as a stub
}

export function initCharts(_revenueData, _events) {
  // This is replaced by initAnalyticsPanel, but left for safety
}
