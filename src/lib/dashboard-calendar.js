import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calEvents = [];

/** Set the events array used by the calendar renderer */
export function setCalendarEvents(events) {
  calEvents = events;
}

/** Wire prev/next/today buttons */
export function setupCalendar() {
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
  document.getElementById('cal-today')?.addEventListener('click', () => {
    calMonth = new Date().getMonth();
    calYear = new Date().getFullYear();
    renderCalendar();
  });
}

export function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month').textContent = `${monthNames[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();

  let html = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    .map(d => `<div class="ev-calendar-day-header">${d}</div>`).join('');

  // Previous month fill
  const prevDays = new Date(calYear, calMonth, 0).getDate();
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="ev-calendar-cell other-month"><div class="ev-calendar-date">${prevDays - i}</div></div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calYear, calMonth, d);
    const isToday = date.toDateString() === today.toDateString();
    const dayEvents = calEvents.filter(ev => {
      const evDate = new Date(ev.date);
      return evDate.getDate() === d && evDate.getMonth() === calMonth && evDate.getFullYear() === calYear;
    });

    html += `<div class="ev-calendar-cell${isToday ? ' today' : ''}">`;
    html += `<div class="ev-calendar-date">${d}</div>`;
    dayEvents.forEach(ev => {
      const isPast = new Date(ev.date) < today;
      const cls = ev.status === 'draft' ? 'draft' : isPast ? 'past' : '';
      html += `<a href="event-detail.html?id=${ev.id}" class="ev-calendar-event ${cls}" title="${escapeHTML(ev.title)}">${escapeHTML(ev.title)}</a>`;
    });
    html += '</div>';
  }

  // Next month fill
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="ev-calendar-cell other-month"><div class="ev-calendar-date">${i}</div></div>`;
  }

  setSafeHTML(grid, html);
}
