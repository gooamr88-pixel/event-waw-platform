import { supabase, getCurrentUser } from './supabase.js';
import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

let revenueChartInstance = null, tierChartInstance = null;

/* ==================================
   REVENUE BREAKDOWN
   ================================== */
export function renderRevenueBreakdown(data) {
  const el = document.getElementById('revenue-breakdown');
  if (!el) return;
  setSafeHTML(el, `<div class="ev-table-wrap"><table class="ev-table">
    <thead><tr><th>Event</th><th style="text-align:right">Gross</th><th style="text-align:right">Fee (5%)</th><th style="text-align:right">Net Payout</th><th style="text-align:center">Scan %</th></tr></thead>
    <tbody>${data.map(r => `<tr>
      <td><div style="font-weight:600">${escapeHTML(r.event_title)}</div><div style="font-size:.76rem;color:var(--ev-text-sec)">${r.total_tickets_sold} tickets</div></td>
      <td style="text-align:right;font-weight:600">$${Number(r.gross_revenue).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-text-sec)">-$${Number(r.platform_fee).toLocaleString()}</td>
      <td style="text-align:right;color:var(--ev-pink);font-weight:700">$${Number(r.net_revenue).toLocaleString()}</td>
      <td style="text-align:center">${Number(r.scan_rate)}%</td>
    </tr>`).join('')}</tbody></table></div>`);
}

/* ==================================
   CHARTS
   ================================== */
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
          return isNaN(dt) ? (d.event_title || '-') : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }),
        datasets: [{
          label: 'Revenue ($)',
          data: revenueData.map(d => Number(d.revenue || d.net_revenue || 0)),
          borderColor: '#2563EB', backgroundColor: 'rgba(37,99,235,.08)',
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: '#2563EB', pointBorderWidth: 0,
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
            backgroundColor: ['#2563EB','#E91E63','#3b82f6','#4CAF50','#FF9800','#9C27B0','#00BCD4','#FF5722'],
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
