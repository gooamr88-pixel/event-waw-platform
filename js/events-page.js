/* ===================================
   EVENT WAW - Events Page Logic
   =================================== */
import { getEvents } from '../src/lib/events.js';
import { escapeHTML } from '../src/lib/utils.js';
import { detectUserLocation, sortByProximity, formatDistance } from '../src/lib/geo.js';
import { semiProtectPage, updateNavForAuth, performSignOut } from '../src/lib/guard.js';
import { setSafeHTML } from '../src/lib/dom.js';

const PER_PAGE = 12;
let allEvents = [], filtered = [], userLocation = null, currentPage = 1;
let searchQuery = '', catFilter = 'all', cityFilter = 'all', countryFilter = 'all';
let venueFilter = 'all', dateFilter = 'all', timeFilter = 'all';
let debounceTimer = null, viewMode = 'grid';

document.addEventListener('DOMContentLoaded', async () => {
  initTheme(); initNav(); initMobileMenu();
  const authState = await semiProtectPage();
  updateNavForAuth(authState);
  handleAuth(authState);
  await Promise.allSettled([loadEvents(), detectGeo()]);
  initSearch(); initFilters(); initViewToggle();
});

/* -- Auth -- */
function handleAuth(s) {
  if (!s.user || !s.isFullyAuth) return;
  const si = document.getElementById('nav-signin');
  const su = document.getElementById('nav-signup');
  if (si) { si.textContent = 'Dashboard'; si.href = 'dashboard.html'; si.classList.remove('btn-outline'); si.classList.add('btn-primary'); const rd = document.querySelector('.nav-role-dropdown'); if (rd) rd.remove(); }
  if (su) { su.textContent = 'Sign Out'; su.href = '#'; su.classList.remove('btn-primary'); su.classList.add('btn-outline'); su.addEventListener('click', e => { e.preventDefault(); performSignOut('/index.html'); }); }
}

/* -- Theme & Nav -- */
function initTheme() {
  const tt = document.getElementById('theme-toggle');
  if (tt) tt.addEventListener('click', () => { const d = document.documentElement, c = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; d.setAttribute('data-theme', c); localStorage.setItem('theme', c); });
}
function initNav() {
  const nav = document.getElementById('main-nav');
  if (nav) window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 60), { passive: true });
}
function initMobileMenu() {
  const mt = document.getElementById('nav-toggle'), mm = document.getElementById('mobile-menu'), mc = document.getElementById('mobile-close');
  if (mt && mm) mt.addEventListener('click', () => mm.classList.add('active'));
  if (mc && mm) mc.addEventListener('click', () => mm.classList.remove('active'));
  if (mm) mm.querySelectorAll('a').forEach(a => a.addEventListener('click', () => mm.classList.remove('active')));
}

/* -- Geo -- */
async function detectGeo() {
  const el = document.getElementById('ep-geo-status'), txt = document.getElementById('ep-geo-text');
  try {
    const loc = await detectUserLocation();
    if (loc && loc.lat && loc.lng) {
      userLocation = loc;
      el.classList.add('active');
      txt.textContent = [loc.city, loc.country].filter(Boolean).join(', ') || 'Located';
      document.getElementById('ep-sort-indicator').style.display = '';
      const si = document.getElementById('ep-search-input');
      if (si && loc.city) si.placeholder = `Search events near ${loc.city}...`;
      if (allEvents.length) applyAndRender();
    } else { txt.textContent = 'Location unavailable'; }
  } catch { txt.textContent = 'Location unavailable'; }
}

/* -- Load Events -- */
async function loadEvents() {
  try {
    allEvents = await getEvents({ limit: 100 });
    document.querySelectorAll('.ep-skeleton').forEach(s => s.remove());
    if (!allEvents.length) { showEmpty(); return; }
    populateFilterOptions(allEvents);
    updateStats(allEvents);
    applyAndRender();
  } catch (err) {
    console.warn('Events fetch failed:', err);
    document.querySelectorAll('.ep-skeleton').forEach(s => s.remove());
    showEmpty();
  }
}

function populateFilterOptions(events) {
  const fill = (id, vals) => { const sel = document.getElementById(id); if (!sel) return; vals.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }); };
  fill('ep-filter-city', [...new Set(events.map(e => (e.city || '').trim()).filter(Boolean))].sort());
  fill('ep-filter-country', [...new Set(events.map(e => (e.country || '').trim()).filter(Boolean))].sort());
  fill('ep-filter-venue', [...new Set(events.map(e => (e.venue || '').trim()).filter(Boolean))].sort());
}

function updateStats(events) {
  const t = document.getElementById('ep-stat-total'), ci = document.getElementById('ep-stat-cities'), ca = document.getElementById('ep-stat-cats');
  if (t) t.textContent = `${events.length} Event${events.length !== 1 ? 's' : ''}`;
  if (ci) { const c = new Set(events.map(e => e.city).filter(Boolean)).size; ci.textContent = `${c} Cit${c !== 1 ? 'ies' : 'y'}`; }
  if (ca) { const c = new Set(events.map(e => e.category).filter(Boolean)).size; ca.textContent = `${c} Categor${c !== 1 ? 'ies' : 'y'}`; }
}

/* -- Filter & Render -- */
function applyAndRender() {
  filtered = [...allEvents];
  const now = new Date();
  // Time filter
  if (timeFilter === 'week') { const end = new Date(now); end.setDate(end.getDate() + 7); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= now && d <= end; }); }
  else if (timeFilter === 'month') { const end = new Date(now); end.setDate(end.getDate() + 30); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= now && d <= end; }); }
  // Select filters
  if (catFilter !== 'all') filtered = filtered.filter(e => (e.category || '').toLowerCase() === catFilter.toLowerCase());
  if (cityFilter !== 'all') filtered = filtered.filter(e => (e.city || '').toLowerCase() === cityFilter.toLowerCase());
  if (countryFilter !== 'all') filtered = filtered.filter(e => (e.country || '').toLowerCase() === countryFilter.toLowerCase());
  if (venueFilter !== 'all') filtered = filtered.filter(e => (e.venue || '').toLowerCase() === venueFilter.toLowerCase());
  // Date filter
  if (dateFilter !== 'all') {
    const today = new Date(); today.setHours(0,0,0,0);
    if (dateFilter === 'today') { const end = new Date(today); end.setDate(end.getDate()+1); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= today && d < end; }); }
    else if (dateFilter === 'tomorrow') { const s = new Date(today); s.setDate(s.getDate()+1); const end = new Date(s); end.setDate(end.getDate()+1); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= s && d < end; }); }
    else if (dateFilter === 'week') { const end = new Date(today); end.setDate(end.getDate()+7); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= today && d <= end; }); }
    else if (dateFilter === 'month') { const end = new Date(today); end.setMonth(end.getMonth()+1); filtered = filtered.filter(e => { const d = new Date(e.date); return d >= today && d <= end; }); }
  }
  // Search
  if (searchQuery.trim()) { const q = searchQuery.toLowerCase(); filtered = filtered.filter(e => (e.title||'').toLowerCase().includes(q) || (e.description||'').toLowerCase().includes(q) || (e.venue||'').toLowerCase().includes(q) || (e.city||'').toLowerCase().includes(q) || (e.category||'').toLowerCase().includes(q)); }
  // Proximity sort
  if (userLocation) filtered = sortByProximity(filtered, userLocation.lat, userLocation.lng);
  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PER_PAGE;
  const page = filtered.slice(start, start + PER_PAGE);
  updateResultsMeta(page.length, filtered.length);
  renderEvents(page);
  renderPagination(totalPages);
  updateResetBtn();
}

function updateResultsMeta(showing, total) {
  const el = document.getElementById('ep-results-count');
  if (!el) return;
  let text = `Showing <strong>${showing}</strong>`;
  if (total > showing) text += ` of ${total}`;
  text += ` event${total !== 1 ? 's' : ''}`;
  if (searchQuery.trim()) text += ` for "<strong>${escapeHTML(searchQuery)}</strong>"`;
  if (userLocation && userLocation.city) text += ` near <strong>${escapeHTML(userLocation.city)}</strong>`;
  setSafeHTML(el, text);
}

function renderEvents(events) {
  const grid = document.getElementById('ep-events-grid');
  const empty = document.getElementById('ep-empty');
  grid.querySelectorAll('.ep-event-card').forEach(c => c.remove());
  if (!events.length) { grid.style.display = 'none'; empty.style.display = ''; return; }
  grid.style.display = ''; empty.style.display = 'none';
  events.forEach(ev => {
    const tiers = ev.ticket_tiers || [];
    const totalAvail = tiers.reduce((s, t) => s + (t.capacity - t.sold_count), 0);
    const totalCap = tiers.reduce((s, t) => s + t.capacity, 0);
    const soldPct = totalCap > 0 ? ((totalCap - totalAvail) / totalCap) * 100 : 0;
    const prices = tiers.map(t => t.price).filter(p => p != null);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    let badge = ev.category || 'Event';
    if (soldPct >= 90) badge = 'Selling Fast'; else if (totalAvail <= 0) badge = 'Sold Out';
    const date = new Date(ev.date);
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const distHtml = ev._distance && ev._distance < Infinity ? `<div class="ep-card-distance">${formatDistance(ev._distance)}</div>` : '';
    const card = document.createElement('div');
    card.className = 'ep-event-card';
    card.onclick = () => window.location.href = `event-detail.html?id=${ev.id}`;
    setSafeHTML(card, `
      <div class="ep-card-image">
        <img src="${escapeHTML(ev.cover_url || ev.cover_image || 'images/event-concert.png')}" alt="${escapeHTML(ev.title)}" loading="lazy" />
        <div class="ep-card-badge"><span class="dot"></span>${escapeHTML(badge)}</div>
        ${distHtml}
      </div>
      <div class="ep-card-body">
        <div class="ep-card-date">${dateStr}</div>
        <h3>${escapeHTML(ev.title)}</h3>
        <div class="ep-card-location"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>${escapeHTML(ev.venue || ev.city || 'TBA')}</div>
        <div class="ep-card-footer">
          <div class="ep-card-price">${minPrice > 0 ? '$' + minPrice.toLocaleString() : 'Free'}<small>${prices.length > 1 ? '+' : ''}</small></div>
          <span class="ep-card-cta">View Details <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/></svg></span>
        </div>
      </div>`);
    grid.appendChild(card);
  });
}

function renderPagination(totalPages) {
  const el = document.getElementById('ep-pagination');
  if (!el) return;
  if (totalPages <= 1) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = '';
  // Prev
  const prev = document.createElement('button');
  prev.className = 'ep-page-btn'; prev.disabled = currentPage <= 1;
  setSafeHTML(prev, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>');
  prev.onclick = () => { currentPage--; applyAndRender(); window.scrollTo({ top: 400, behavior: 'smooth' }); };
  el.appendChild(prev);
  // Pages
  for (let i = 1; i <= totalPages; i++) {
    if (totalPages > 7 && i > 3 && i < totalPages - 1 && Math.abs(i - currentPage) > 1) {
      if (i === 4 || i === totalPages - 2) { const dots = document.createElement('span'); dots.className = 'ep-page-info'; dots.textContent = '...'; el.appendChild(dots); }
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'ep-page-btn' + (i === currentPage ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => { currentPage = i; applyAndRender(); window.scrollTo({ top: 400, behavior: 'smooth' }); };
    el.appendChild(btn);
  }
  // Next
  const next = document.createElement('button');
  next.className = 'ep-page-btn'; next.disabled = currentPage >= totalPages;
  setSafeHTML(next, '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>');
  next.onclick = () => { currentPage++; applyAndRender(); window.scrollTo({ top: 400, behavior: 'smooth' }); };
  el.appendChild(next);
}

function showEmpty() {
  document.getElementById('ep-events-grid').style.display = 'none';
  document.getElementById('ep-empty').style.display = '';
}

/* -- Search -- */
function initSearch() {
  const input = document.getElementById('ep-search-input');
  const clear = document.getElementById('ep-clear-btn');
  if (!input) return;
  input.addEventListener('input', () => {
    searchQuery = input.value;
    clear.classList.toggle('visible', searchQuery.length > 0);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; applyAndRender(); }, 300);
  });
  clear.addEventListener('click', () => { input.value = ''; searchQuery = ''; clear.classList.remove('visible'); currentPage = 1; applyAndRender(); input.focus(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(debounceTimer); searchQuery = input.value; currentPage = 1; applyAndRender(); } });
}

/* -- Filters -- */
function initFilters() {
  const bind = (id, setter) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { setter(el.value); currentPage = 1; applyAndRender(); }); };
  bind('ep-filter-category', v => catFilter = v);
  bind('ep-filter-city', v => cityFilter = v);
  bind('ep-filter-country', v => countryFilter = v);
  bind('ep-filter-venue', v => venueFilter = v);
  bind('ep-filter-date', v => dateFilter = v);
  // Time buttons
  document.querySelectorAll('.ep-time-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ep-time-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timeFilter = btn.dataset.filter || 'all';
      currentPage = 1; applyAndRender();
    });
  });
  // Reset
  const reset = document.getElementById('ep-reset-btn');
  if (reset) reset.addEventListener('click', () => {
    catFilter = cityFilter = countryFilter = venueFilter = dateFilter = timeFilter = 'all';
    searchQuery = '';
    currentPage = 1;
    ['ep-filter-category','ep-filter-city','ep-filter-country','ep-filter-venue','ep-filter-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 'all'; });
    const si = document.getElementById('ep-search-input'); if (si) si.value = '';
    document.getElementById('ep-clear-btn')?.classList.remove('visible');
    document.querySelectorAll('.ep-time-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    applyAndRender();
  });
}

function updateResetBtn() {
  const btn = document.getElementById('ep-reset-btn');
  if (!btn) return;
  btn.style.display = (catFilter !== 'all' || cityFilter !== 'all' || countryFilter !== 'all' || venueFilter !== 'all' || dateFilter !== 'all' || timeFilter !== 'all' || searchQuery.trim()) ? '' : 'none';
}

/* -- View Toggle -- */
function initViewToggle() {
  const grid = document.getElementById('ep-events-grid');
  const gridBtn = document.getElementById('ep-view-grid');
  const listBtn = document.getElementById('ep-view-list');
  if (!grid || !gridBtn || !listBtn) return;
  gridBtn.addEventListener('click', () => { viewMode = 'grid'; grid.classList.remove('list-view'); gridBtn.classList.add('active'); listBtn.classList.remove('active'); });
  listBtn.addEventListener('click', () => { viewMode = 'list'; grid.classList.add('list-view'); listBtn.classList.add('active'); gridBtn.classList.remove('active'); });
}
