import { supabase, getCurrentUser } from './supabase.js';
import { safeQuery } from './api.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';
import { dashboardState } from './state.js';

let revenueChartInstance = null, tierChartInstance = null;
  const tbody = document.getElementById('financial-tbody');
  if (!tbody) return;
  const eventId = document.getElementById('fin-event-select')?.value;



  try {
    const user = await getCurrentUser();
    const { data, error } = await supabase.rpc('get_organizer_revenue', { p_organizer_id: user.id });

    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>';
      return;
    }

    let filtered = data;
    if (eventId) filtered = data.filter(r => r.event_id === eventId);
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No data for selected event</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((r, i) => {
      const gross = Number(r.gross_revenue || 0);
      const fee = Math.round(gross * 0.05 * 100) / 100;
      const net = gross - fee;
      return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${escapeHTML(r.event_title || '—')}</td>
      <td>${r.total_tickets_sold || 0} tickets</td>
      <td style="font-weight:600">$${gross.toLocaleString()}</td>
      <td style="color:var(--ev-danger);font-size:.8rem">-$${fee.toLocaleString()}</td>
      <td style="color:var(--ev-success);font-weight:700">$${net.toLocaleString()}</td>
      <td><span class="ev-badge ${net > 0 ? 'published' : 'pending'}">${net > 0 ? 'Earned' : 'Pending'}</span></td>
    </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="ev-table-empty">No financial data yet</td></tr>';
  }
}

/* ══════════════════════════════════
   PAYOUT SETTINGS PANEL
   ══════════════════════════════════ */
export function setupPayoutPanel() {
  // Load existing payout data
  loadPayoutData();

export function renderRevenueBreakdown(data) {
  const el = document.getElementById('revenue-breakdown');
  el.innerHTML = `<div class="ev-table-wrap"><table class="ev-table">
    <thead><tr><th>Event</th><th style="text-align:right">Gross</th><th style="text-align:right">Fee (5%)</th><th style="text-align:right">Net Payout</th><th style="text-align:center">Scan %</th></tr></thead>
    <tbody>${data.map(r => `<tr>
      <td><div style="font-weight:600">${escapeHTML(r.event_title)}</div><div style="font-size:.76rem;color:var(--ev-text-sec)">${r.total_tickets_sold} tickets</div></td>
      <td style="text-align:right;font-weight:600">$${Number(r.gross_revenue).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-text-sec)">-$${Number(r.platform_fee).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-pink);font-weight:700">$${Number(r.net_revenue).toLocaleString()}</td>
      <td style="text-align:center">${Number(r.scan_rate)}%</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ══════════════════════════════════

export function initCharts(revenueData, events) {
  if (typeof Chart === 'undefined') return;

  // Revenue line chart
  const rCtx = document.getElementById('revenue-chart');
  if (rCtx && revenueData?.length) {
    if (revenueChartInstance) revenueChartInstance.destroy();
    revenueChartInstance = new Chart(rCtx, {
      type: 'line',
      data: {
        labels: revenueData.map(d => {
          const dt = new Date(d.day || d.event_title);
          return isNaN(dt) ? (d.event_title || '—') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [{
          label: 'Revenue ($)',
          data: revenueData.map(d => Number(d.revenue || d.net_revenue || 0)),
          borderColor: '#F5C518', backgroundColor: 'rgba(245,197,24,.08)',
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: '#F5C518', pointBorderWidth: 0,
          borderWidth: 2.5,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#999', font: { size: 10 } } },
          y: { grid: { color: 'rgba(0,0,0,.04)' }, ticks: { color: '#999', font: { size: 10 } } },
        }
      }
    });
  }

  // Tier doughnut
  const tCtx = document.getElementById('tier-chart');
  if (tCtx && events?.length) {
    const tierMap = {};
    events.forEach(ev => {
      (ev.ticket_tiers || []).forEach(t => { tierMap[t.name] = (tierMap[t.name] || 0) + (t.sold_count || 0); });
    });
    const labels = Object.keys(tierMap);
    const values = Object.values(tierMap);
    if (labels.length) {
      if (tierChartInstance) tierChartInstance.destroy();
      tierChartInstance = new Chart(tCtx, {
        type: 'doughnut',
        data: {
          labels, datasets: [{
            data: values,
            backgroundColor: ['#F5C518','#E91E63','#2196F3','#4CAF50','#FF9800','#9C27B0','#00BCD4','#FF5722'],
            borderWidth: 0, hoverOffset: 8,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '68%',
          plugins: { legend: { position: 'bottom', labels: { color: '#777', font: { size: 11 }, padding: 16 } } }
        }
      });
    }
  }
}

