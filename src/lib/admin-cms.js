/* ===================================
   EVENT WAW — Admin CMS Editor
   ===================================
   Provides in-place editing UI for the
   platform_settings table (Hero, Sponsors,
   Stats Bar). Loaded by admin-dashboard.js.
   =================================== */

import { supabase } from './supabase.js';

/**
 * Renders the full CMS editor into the given container element.
 * Fetches current settings from DB and builds editable forms.
 */
export async function renderCMSEditor(container) {
  if (!container) return;

  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('key, value, updated_at')
      .order('key');

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ev-text-muted)">No CMS data found. Run migration v15 to seed initial data.</div>';
      return;
    }

    const settings = Object.fromEntries(data.map(r => [r.key, r.value]));
    const timestamps = Object.fromEntries(data.map(r => [r.key, r.updated_at]));

    container.innerHTML = `
      <p style="font-size:.85rem;color:var(--ev-text-sec);margin-bottom:24px">
        Edit the public landing page content. Changes are saved directly to the database and reflected on <a href="index.html" target="_blank" style="color:var(--ev-info)">the landing page</a> on next reload.
      </p>

      <!-- ═══ HERO EDITOR ═══ -->
      <div class="ev-card" style="margin-bottom:16px">
        <div class="ev-card-header">
          <span class="ev-card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Hero Section
          </span>
          <span class="cms-ts" style="font-size:.7rem;color:var(--ev-text-muted)">${fmtTime(timestamps.hero)}</span>
        </div>
        <div style="padding:20px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div>
              <label class="cms-label">Heading Line 1</label>
              <input class="cms-input" id="cms-hero-line1" value="${escAttr(settings.hero?.heading_line1 || '')}" />
            </div>
            <div>
              <label class="cms-label">Heading Highlight</label>
              <input class="cms-input" id="cms-hero-highlight" value="${escAttr(settings.hero?.heading_highlight || '')}" />
            </div>
          </div>
          <div style="margin-bottom:14px">
            <label class="cms-label">Description</label>
            <textarea class="cms-input" id="cms-hero-desc" rows="3" style="resize:vertical">${esc(settings.hero?.description || '')}</textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
            <div>
              <label class="cms-label">Hero Image URL</label>
              <input class="cms-input" id="cms-hero-img" value="${escAttr(settings.hero?.image_url || '')}" />
            </div>
            <div>
              <label class="cms-label">Preview</label>
              <img id="cms-hero-preview" src="${escAttr(settings.hero?.image_url || '')}" style="height:60px;border-radius:8px;border:1px solid var(--ev-border);object-fit:cover" onerror="this.style.display='none'" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:14px;margin-bottom:14px">
            <div>
              <label class="cms-label">CTA Primary Text</label>
              <input class="cms-input" id="cms-hero-cta1-text" value="${escAttr(settings.hero?.cta_primary_text || '')}" />
            </div>
            <div>
              <label class="cms-label">CTA Primary URL</label>
              <input class="cms-input" id="cms-hero-cta1-url" value="${escAttr(settings.hero?.cta_primary_url || '')}" />
            </div>
            <div>
              <label class="cms-label">CTA Secondary Text</label>
              <input class="cms-input" id="cms-hero-cta2-text" value="${escAttr(settings.hero?.cta_secondary_text || '')}" />
            </div>
            <div>
              <label class="cms-label">CTA Secondary URL</label>
              <input class="cms-input" id="cms-hero-cta2-url" value="${escAttr(settings.hero?.cta_secondary_url || '')}" />
            </div>
          </div>
          <button class="ev-btn ev-btn-pink" id="cms-save-hero">Save Hero Section</button>
        </div>
      </div>

      <!-- ═══ SPONSORS EDITOR ═══ -->
      <div class="ev-card" style="margin-bottom:16px">
        <div class="ev-card-header">
          <span class="ev-card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M16 7V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v3"/></svg>
            Sponsors
          </span>
          <span class="cms-ts" style="font-size:.7rem;color:var(--ev-text-muted)">${fmtTime(timestamps.sponsors)}</span>
        </div>
        <div style="padding:20px">
          <div id="cms-sponsors-list"></div>
          <button class="ev-btn ev-btn-outline" id="cms-add-sponsor" style="margin-top:10px">+ Add Sponsor</button>
          <div style="margin-top:14px">
            <button class="ev-btn ev-btn-pink" id="cms-save-sponsors">Save Sponsors</button>
          </div>
        </div>
      </div>

      <!-- ═══ STATS BAR EDITOR ═══ -->
      <div class="ev-card" style="margin-bottom:16px">
        <div class="ev-card-header">
          <span class="ev-card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Stats Bar
          </span>
          <span class="cms-ts" style="font-size:.7rem;color:var(--ev-text-muted)">${fmtTime(timestamps.stats_bar)}</span>
        </div>
        <div style="padding:20px">
          <div id="cms-stats-list"></div>
          <button class="ev-btn ev-btn-outline" id="cms-add-stat" style="margin-top:10px">+ Add Stat</button>
          <div style="margin-top:14px">
            <button class="ev-btn ev-btn-pink" id="cms-save-stats">Save Stats Bar</button>
          </div>
        </div>
      </div>
    `;

    // Inject inline CMS form styles
    if (!document.getElementById('cms-editor-styles')) {
      const style = document.createElement('style');
      style.id = 'cms-editor-styles';
      style.textContent = `
        .cms-label{display:block;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ev-text-muted);margin-bottom:5px}
        .cms-input{width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--ev-border);background:var(--ev-bg);color:var(--ev-text);font-family:var(--ev-font);font-size:.82rem;transition:border-color .2s}
        .cms-input:focus{outline:none;border-color:var(--ev-yellow)}
        .cms-sponsor-row,.cms-stat-row{display:grid;gap:10px;align-items:end;padding:10px;border-radius:8px;border:1px solid var(--ev-border);margin-bottom:8px;background:var(--ev-bg)}
        .cms-sponsor-row{grid-template-columns:1fr 2fr auto}
        .cms-stat-row{grid-template-columns:1fr 2fr 1fr auto}
        .cms-remove{background:none;border:none;color:var(--ev-danger);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:6px;transition:background .2s}
        .cms-remove:hover{background:rgba(220,38,38,.06)}
      `;
      document.head.appendChild(style);
    }

    // ── Render sponsors list ──
    const sponsorsList = document.getElementById('cms-sponsors-list');
    const sponsors = settings.sponsors || [];
    renderSponsorRows(sponsorsList, sponsors);

    document.getElementById('cms-add-sponsor').addEventListener('click', () => {
      sponsors.push({ name: '', logo_url: '' });
      renderSponsorRows(sponsorsList, sponsors);
    });

    // ── Render stats list ──
    const statsList = document.getElementById('cms-stats-list');
    const stats = settings.stats_bar || [];
    renderStatRows(statsList, stats);

    document.getElementById('cms-add-stat').addEventListener('click', () => {
      stats.push({ value: '', label: '', icon: 'calendar' });
      renderStatRows(statsList, stats);
    });

    // ── Save Hero ──
    document.getElementById('cms-save-hero').addEventListener('click', async () => {
      const heroData = {
        heading_line1: document.getElementById('cms-hero-line1').value.trim(),
        heading_highlight: document.getElementById('cms-hero-highlight').value.trim(),
        description: document.getElementById('cms-hero-desc').value.trim(),
        image_url: document.getElementById('cms-hero-img').value.trim(),
        cta_primary_text: document.getElementById('cms-hero-cta1-text').value.trim(),
        cta_primary_url: document.getElementById('cms-hero-cta1-url').value.trim(),
        cta_secondary_text: document.getElementById('cms-hero-cta2-text').value.trim(),
        cta_secondary_url: document.getElementById('cms-hero-cta2-url').value.trim(),
      };
      await saveSetting('hero', heroData, 'Hero section');
    });

    // ── Save Sponsors ──
    document.getElementById('cms-save-sponsors').addEventListener('click', async () => {
      const rows = sponsorsList.querySelectorAll('.cms-sponsor-row');
      const arr = [];
      rows.forEach(row => {
        const name = row.querySelector('[data-field="name"]').value.trim();
        const logo = row.querySelector('[data-field="logo_url"]').value.trim();
        if (name || logo) arr.push({ name, logo_url: logo });
      });
      await saveSetting('sponsors', arr, 'Sponsors');
    });

    // ── Save Stats ──
    document.getElementById('cms-save-stats').addEventListener('click', async () => {
      const rows = statsList.querySelectorAll('.cms-stat-row');
      const arr = [];
      rows.forEach(row => {
        const value = row.querySelector('[data-field="value"]').value.trim();
        const label = row.querySelector('[data-field="label"]').value.trim();
        const icon = row.querySelector('[data-field="icon"]').value.trim();
        if (value || label) arr.push({ value, label, icon: icon || 'calendar' });
      });
      await saveSetting('stats_bar', arr, 'Stats bar');
    });

    // ── Hero image preview ──
    document.getElementById('cms-hero-img').addEventListener('input', (e) => {
      const preview = document.getElementById('cms-hero-preview');
      if (preview) { preview.src = e.target.value; preview.style.display = ''; }
    });

  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ev-danger)">Failed to load CMS data: ${esc(err.message)}</div>`;
  }
}

/* ── Render helpers ── */

function renderSponsorRows(container, sponsors) {
  container.innerHTML = sponsors.map((s, i) => `
    <div class="cms-sponsor-row">
      <div><label class="cms-label">Name</label><input class="cms-input" data-field="name" value="${escAttr(s.name || '')}" /></div>
      <div><label class="cms-label">Logo URL</label><input class="cms-input" data-field="logo_url" value="${escAttr(s.logo_url || '')}" /></div>
      <button class="cms-remove" data-idx="${i}" title="Remove">×</button>
    </div>
  `).join('');
  container.querySelectorAll('.cms-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      sponsors.splice(Number(btn.dataset.idx), 1);
      renderSponsorRows(container, sponsors);
    });
  });
}

function renderStatRows(container, stats) {
  container.innerHTML = stats.map((s, i) => `
    <div class="cms-stat-row">
      <div><label class="cms-label">Value</label><input class="cms-input" data-field="value" value="${escAttr(s.value || '')}" /></div>
      <div><label class="cms-label">Label</label><input class="cms-input" data-field="label" value="${escAttr(s.label || '')}" /></div>
      <div><label class="cms-label">Icon</label><input class="cms-input" data-field="icon" value="${escAttr(s.icon || 'calendar')}" placeholder="calendar, users, layers" /></div>
      <button class="cms-remove" data-idx="${i}" title="Remove">×</button>
    </div>
  `).join('');
  container.querySelectorAll('.cms-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      stats.splice(Number(btn.dataset.idx), 1);
      renderStatRows(container, stats);
    });
  });
}

async function saveSetting(key, value, label) {
  try {
    const { error } = await supabase
      .from('platform_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key);

    if (error) throw error;

    // Dispatch custom event for toast (admin-dashboard.js listens)
    window.dispatchEvent(new CustomEvent('cms-saved', { detail: { label } }));
  } catch (err) {
    window.dispatchEvent(new CustomEvent('cms-error', { detail: { message: err.message } }));
  }
}

/* ── Escape utilities ── */

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTime(iso) {
  if (!iso) return '';
  return 'Updated ' + new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
