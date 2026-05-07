/* ===================================
   EVENT WAW — Admin CMS Editor
   ===================================
   Provides in-place editing UI for the
   platform_settings table (Hero, Sponsors,
   Stats Bar). Loaded by admin-dashboard.js.
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';

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
      setSafeHTML(container, '<div style="text-align:center;padding:40px;color:var(--ev-text-muted)">No CMS data found. Run migration v15 to seed initial data.</div>');
      return;
    }

    const settings = Object.fromEntries(data.map(r => [r.key, r.value]));
    const timestamps = Object.fromEntries(data.map(r => [r.key, r.updated_at]));

    setSafeHTML(container, `
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
          <div style="margin-bottom:14px">
            <label class="cms-label">Hero Slides (Drag to Reorder)</label>
            <div id="cms-hero-slides-list"></div>
            <button class="ev-btn ev-btn-outline" id="cms-add-hero-slide" style="margin-top:10px">+ Add Hero Slide</button>
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
    `);

    // Add safe error handler logic for hero preview image
    const previewImg = document.getElementById('cms-hero-preview');
    if (previewImg) {
      previewImg.addEventListener('error', () => { previewImg.style.display = 'none'; });
    }

    // Inject inline CMS form styles
    if (!document.getElementById('cms-editor-styles')) {
      const style = document.createElement('style');
      style.id = 'cms-editor-styles';
      style.textContent = `
        .cms-label{display:block;font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ev-text-muted);margin-bottom:5px}
        .cms-input{width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--ev-border);background:var(--ev-bg);color:var(--ev-text);font-family:var(--ev-font);font-size:.82rem;transition:border-color .2s}
        .cms-input:focus{outline:none;border-color:var(--ev-yellow)}
        .cms-sponsor-row,.cms-stat-row{display:grid;gap:10px;align-items:end;padding:10px;border-radius:8px;border:1px solid var(--ev-border);margin-bottom:8px;background:var(--ev-bg)}
        .cms-sponsor-row{grid-template-columns:120px 1fr auto; align-items:center;}
        .cms-stat-row{grid-template-columns:1fr 2fr 1fr auto}
        .cms-remove{background:none;border:none;color:var(--ev-danger);cursor:pointer;font-size:1.1rem;padding:4px 8px;border-radius:6px;transition:background .2s}
        .cms-remove:hover{background:rgba(220,38,38,.06)}
        .cms-slide-row{display:flex;gap:15px;align-items:flex-start;padding:15px;border-radius:8px;border:1px solid var(--ev-border);margin-bottom:12px;background:var(--ev-bg);position:relative;transition:all 0.2s ease;}
        .cms-slide-row.dragging{opacity:0.5;background:var(--ev-bg-alt);border:2px dashed var(--ev-yellow);}
        .cms-slide-drag-handle{cursor:grab;padding-top:5px;color:var(--ev-text-muted);font-size:1.2rem;user-select:none;}
        .cms-slide-drag-handle:active{cursor:grabbing;}
        .cms-dropzone{border:2px dashed var(--ev-border);border-radius:8px;text-align:center;cursor:pointer;background:var(--ev-bg-alt);transition:all .2s ease;position:relative;overflow:hidden;height:80px;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .cms-dropzone:hover,.cms-dropzone.dragover{border-color:var(--ev-yellow);background:rgba(245,158,11,.05)}
        .cms-dropzone img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:var(--ev-bg);z-index:1}
        .cms-dropzone input[type="file"]{position:absolute;top:0;left:0;width:100%;height:100%;opacity:0;cursor:pointer;z-index:2}
      `;
      document.head.appendChild(style);
    }

    // ── Render hero slides list ──
    const heroSlidesList = document.getElementById('cms-hero-slides-list');
    let heroSlides = settings.hero?.slides || [];
    
    // Backward compatibility
    if (heroSlides.length === 0 && settings.hero) {
       const h = settings.hero;
       const urls = h.image_urls || (h.image_url ? [h.image_url] : []);
       if (urls.length > 0 || h.heading_line1) {
          heroSlides = urls.map((url, i) => ({
             image_url: url,
             heading_line1: i === 0 ? h.heading_line1 : '',
             heading_highlight: i === 0 ? h.heading_highlight : '',
             description: i === 0 ? h.description : '',
             cta_primary_text: i === 0 ? h.cta_primary_text : '',
             cta_primary_url: i === 0 ? h.cta_primary_url : '',
             cta_secondary_text: i === 0 ? h.cta_secondary_text : '',
             cta_secondary_url: i === 0 ? h.cta_secondary_url : ''
          }));
          if (heroSlides.length === 0) heroSlides.push(h);
       }
    }

    renderHeroSlideRows(heroSlidesList, heroSlides);

    document.getElementById('cms-add-hero-slide').addEventListener('click', () => {
      heroSlides.push({ image_url: '', heading_line1: '', heading_highlight: '', description: '', cta_primary_text: '', cta_primary_url: '', cta_secondary_text: '', cta_secondary_url: '' });
      renderHeroSlideRows(heroSlidesList, heroSlides);
    });

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
      const rows = heroSlidesList.querySelectorAll('.cms-slide-row');
      const arr = [];
      rows.forEach(row => {
         arr.push({
            image_url: row.querySelector('[data-field="image_url"]').value.trim(),
            heading_line1: row.querySelector('[data-field="heading_line1"]').value.trim(),
            heading_highlight: row.querySelector('[data-field="heading_highlight"]').value.trim(),
            description: row.querySelector('[data-field="description"]').value.trim(),
            cta_primary_text: row.querySelector('[data-field="cta_primary_text"]').value.trim(),
            cta_primary_url: row.querySelector('[data-field="cta_primary_url"]').value.trim(),
            cta_secondary_text: row.querySelector('[data-field="cta_secondary_text"]').value.trim(),
            cta_secondary_url: row.querySelector('[data-field="cta_secondary_url"]').value.trim()
         });
      });
      await saveSetting('hero', { slides: arr }, 'Hero section');
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

  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ev-danger)">Failed to load CMS data: ${esc(err.message)}</div>`;
  }
}

/* ── Render helpers ── */

async function handleSponsorUpload(file, rowEl, spinnerEl) {
  if (!file) return;
  spinnerEl.style.display = 'block';
  const ext = file.name.split('.').pop();
  const path = `cms/sponsors/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  try {
    const { error } = await supabase.storage.from('event-covers').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    if (urlData?.publicUrl) {
      rowEl.querySelector('[data-field="logo_url"]').value = urlData.publicUrl;
      let img = rowEl.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        rowEl.querySelector('.cms-dropzone').appendChild(img);
      }
      img.src = urlData.publicUrl;
    }
  } catch (err) {
    window.dispatchEvent(new CustomEvent('cms-error', { detail: { message: 'Upload failed: ' + err.message } }));
  } finally {
    spinnerEl.style.display = 'none';
  }
}

function renderSponsorRows(container, sponsors) {
  setSafeHTML(container, sponsors.map((s, i) => `
    <div class="cms-sponsor-row">
      <div class="cms-dropzone">
        <div class="dz-content" style="font-size:0.75rem;opacity:0.7;line-height:1.2;margin-top:5px">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><br/>
          Drop Logo
        </div>
        ${s.logo_url ? `<img src="${escAttr(s.logo_url)}" />` : ''}
        <div class="dz-spinner" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;background:rgba(0,0,0,0.6);color:#fff;padding:4px;border-radius:4px;font-size:12px">⏳</div>
        <input type="file" accept="image/*" class="dz-file-input" title="Drag & drop or click to upload" />
        <input type="hidden" data-field="logo_url" value="${escAttr(s.logo_url || '')}" />
      </div>
      <div>
        <label class="cms-label">Sponsor Name</label>
        <input class="cms-input" data-field="name" value="${escAttr(s.name || '')}" placeholder="e.g. Acme Corp" />
      </div>
      <button class="cms-remove" data-idx="${i}" title="Remove">×</button>
    </div>
  `).join(''));
  
  container.querySelectorAll('.cms-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      sponsors.splice(Number(btn.dataset.idx), 1);
      renderSponsorRows(container, sponsors);
    });
  });

  container.querySelectorAll('.cms-dropzone').forEach(dz => {
    const fileInput = dz.querySelector('.dz-file-input');
    const spinner = dz.querySelector('.dz-spinner');
    const rowEl = dz.closest('.cms-sponsor-row');

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleSponsorUpload(e.dataTransfer.files[0], rowEl, spinner);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        handleSponsorUpload(e.target.files[0], rowEl, spinner);
      }
    });
  });
}

function renderStatRows(container, stats) {
  setSafeHTML(container, stats.map((s, i) => `
    <div class="cms-stat-row">
      <div><label class="cms-label">Value</label><input class="cms-input" data-field="value" value="${escAttr(s.value || '')}" /></div>
      <div><label class="cms-label">Label</label><input class="cms-input" data-field="label" value="${escAttr(s.label || '')}" /></div>
      <div><label class="cms-label">Icon</label><input class="cms-input" data-field="icon" value="${escAttr(s.icon || 'calendar')}" placeholder="calendar, users, layers" /></div>
      <button class="cms-remove" data-idx="${i}" title="Remove">×</button>
    </div>
  `).join(''));
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

async function handleHeroImageUpload(file, rowEl, spinnerEl) {
  if (!file) return;
  spinnerEl.style.display = 'block';
  const ext = file.name.split('.').pop();
  const path = `cms/hero/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  try {
    const { error } = await supabase.storage.from('event-covers').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('event-covers').getPublicUrl(path);
    if (urlData?.publicUrl) {
      rowEl.querySelector('[data-field="hero_img_url"]').value = urlData.publicUrl;
      let img = rowEl.querySelector('img');
      if (!img) {
        img = document.createElement('img');
      rowEl.querySelector('[data-field="image_url"]').value = urlData.publicUrl;
      let img = rowEl.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        rowEl.querySelector('.cms-dropzone').appendChild(img);
      }
      img.src = urlData.publicUrl;
    }
  } catch (err) {
    window.dispatchEvent(new CustomEvent('cms-error', { detail: { message: 'Upload failed: ' + err.message } }));
  } finally {
    spinnerEl.style.display = 'none';
  }
}

function renderHeroSlideRows(container, slides) {
  setSafeHTML(container, slides.map((s, i) => `
    <div class="cms-slide-row" draggable="true" data-idx="${i}">
      <div class="cms-remove" data-idx="${i}" style="position:absolute; top:10px; right:10px; z-index:10;" title="Remove Slide">✕</div>
      <div class="cms-slide-drag-handle" title="Drag to reorder">☰</div>
      <div style="flex: 0 0 160px; display:flex; flex-direction:column; gap:10px;">
        <div class="cms-dropzone" style="height:110px;">
          <div class="dz-content" style="font-size:0.75rem;opacity:0.7;line-height:1.2;margin-top:5px">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><br/>
            Drop Image
          </div>
          ${s.image_url ? `<img src="${escAttr(s.image_url)}" />` : ''}
          <div class="dz-spinner" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;background:rgba(0,0,0,0.6);color:#fff;padding:4px;border-radius:4px;font-size:12px">⏳</div>
          <input type="file" accept="image/*" class="dz-file-input" title="Drag & drop or click to upload" />
        </div>
        <input class="cms-input" data-field="image_url" value="${escAttr(s.image_url || '')}" placeholder="Image URL..." style="font-size:0.75rem; padding:6px;" />
        <div style="text-align:center; font-size:0.7rem; color:var(--ev-text-muted); pointer-events:none;">Slide ${i+1}</div>
      </div>
      <div style="flex: 1; display: grid; gap: 10px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div><label class="cms-label">Heading Line 1</label><input class="cms-input" data-field="heading_line1" value="${escAttr(s.heading_line1 || '')}" /></div>
          <div><label class="cms-label">Heading Highlight</label><input class="cms-input" data-field="heading_highlight" value="${escAttr(s.heading_highlight || '')}" /></div>
        </div>
        <div>
          <label class="cms-label">Description</label>
          <textarea class="cms-input" data-field="description" rows="2" style="resize:vertical">${esc(s.description || '')}</textarea>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px;">
          <div><label class="cms-label">CTA 1 Text</label><input class="cms-input" data-field="cta_primary_text" value="${escAttr(s.cta_primary_text || '')}" /></div>
          <div><label class="cms-label">CTA 1 URL</label><input class="cms-input" data-field="cta_primary_url" value="${escAttr(s.cta_primary_url || '')}" /></div>
          <div><label class="cms-label">CTA 2 Text</label><input class="cms-input" data-field="cta_secondary_text" value="${escAttr(s.cta_secondary_text || '')}" /></div>
          <div><label class="cms-label">CTA 2 URL</label><input class="cms-input" data-field="cta_secondary_url" value="${escAttr(s.cta_secondary_url || '')}" /></div>
        </div>
      </div>
    </div>
  `).join(''));
  
  container.querySelectorAll('.cms-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      slides.splice(Number(btn.dataset.idx), 1);
      renderHeroSlideRows(container, slides);
    });
  });

  setupDragAndDrop(container, slides, renderHeroSlideRows);

  container.querySelectorAll('.cms-dropzone').forEach(dz => {
    const fileInput = dz.querySelector('.dz-file-input');
    const spinner = dz.querySelector('.dz-spinner');
    const rowEl = dz.closest('.cms-slide-row');

    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault(); dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleHeroImageUpload(e.dataTransfer.files[0], rowEl, spinner);
    });
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleHeroImageUpload(e.target.files[0], rowEl, spinner);
    });
  });
}

function setupDragAndDrop(container, dataArray, renderFn) {
  let draggedIdx = null;
  container.querySelectorAll('.cms-slide-row').forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedIdx = Number(row.dataset.idx);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedIdx = null;
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIdx = Number(row.dataset.idx);
      if (draggedIdx !== null && draggedIdx !== targetIdx) {
        const rows = container.querySelectorAll('.cms-slide-row');
        rows.forEach((r, idx) => {
          dataArray[idx].image_url = r.querySelector('[data-field="image_url"]').value;
          dataArray[idx].heading_line1 = r.querySelector('[data-field="heading_line1"]').value;
          dataArray[idx].heading_highlight = r.querySelector('[data-field="heading_highlight"]').value;
          dataArray[idx].description = r.querySelector('[data-field="description"]').value;
          dataArray[idx].cta_primary_text = r.querySelector('[data-field="cta_primary_text"]').value;
          dataArray[idx].cta_primary_url = r.querySelector('[data-field="cta_primary_url"]').value;
          dataArray[idx].cta_secondary_text = r.querySelector('[data-field="cta_secondary_text"]').value;
          dataArray[idx].cta_secondary_url = r.querySelector('[data-field="cta_secondary_url"]').value;
        });
        const item = dataArray.splice(draggedIdx, 1)[0];
        dataArray.splice(targetIdx, 0, item);
        renderFn(container, dataArray);
      }
    });
  });
}
