"""Patch event-detail.html and events-page.js for short_description support."""
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── 1. Patch event-detail.html: Add short description section ───
ed_path = os.path.join(BASE, 'event-detail.html')
with open(ed_path, 'r', encoding='utf-8') as f:
    html = f.read()

old_desc = '<!-- Description with See More -->\r\n          <div class="event-detail-section">\r\n            <div id="event-description-wrap" class="ed-desc-wrap">\r\n              <p id="event-description" style="color:var(--text-secondary);line-height:1.8;font-size:0.95rem;">Loading event details\u2026</p>\r\n            </div>\r\n            <button id="desc-toggle" class="ed-see-more" style="display:none;">See more</button>\r\n          </div>'

new_desc = '''<!-- Short Description (blurb) -->
          <div class="event-detail-section" id="ed-short-desc-section" style="display:none;">
            <p id="event-short-description" style="font-size:1.05rem;line-height:1.7;color:var(--text-primary);font-weight:500;padding:20px 24px;background:rgba(5,150,105,.04);border-left:4px solid rgba(5,150,105,.4);border-radius:0 12px 12px 0;"></p>
          </div>

          <!-- Full Description with See More -->
          <div class="event-detail-section" id="ed-full-desc-section">
            <h2 style="font-family:var(--font-serif);font-size:1.1rem;font-weight:700;margin-bottom:16px;">\U0001f4dd About This Event</h2>
            <div id="event-description-wrap" class="ed-desc-wrap">
              <p id="event-description" style="color:var(--text-secondary);line-height:1.8;font-size:0.95rem;">Loading event details\u2026</p>
            </div>
            <button id="desc-toggle" class="ed-see-more" style="display:none;">See more</button>
          </div>'''.replace('\n', '\r\n')

if old_desc in html:
    html = html.replace(old_desc, new_desc)
    with open(ed_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('[OK] event-detail.html: description section patched')
else:
    print('[SKIP] event-detail.html: target not found')

# ─── 2. Patch event-detail.html JS: render short_description ───
with open(ed_path, 'r', encoding='utf-8') as f:
    html = f.read()

old_render = "// Render rich HTML description securely (supports bold, italic, links from editor)"
new_render = """// Render short description blurb
      if (event.short_description) {
        const shortDescSection = document.getElementById('ed-short-desc-section');
        const shortDescEl = document.getElementById('event-short-description');
        if (shortDescSection && shortDescEl) {
          shortDescEl.textContent = event.short_description;
          shortDescSection.style.display = 'block';
        }
      }

      // Render rich HTML description securely (supports bold, italic, links from editor)"""

if old_render in html:
    html = html.replace(old_render, new_render.replace('\n', '\r\n'))
    with open(ed_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('[OK] event-detail.html: JS render patched')
else:
    print('[SKIP] event-detail.html: JS render target not found')

# ─── 3. Patch event-detail.html: OG description to use short_description ───
with open(ed_path, 'r', encoding='utf-8') as f:
    html = f.read()

old_og = """if (ogDesc) ogDesc.setAttribute('content', event.description || `Book tickets for ${event.title} on Eventsli.`);"""
new_og = """if (ogDesc) ogDesc.setAttribute('content', event.short_description || event.description || `Book tickets for ${event.title} on Eventsli.`);"""

if old_og in html:
    html = html.replace(old_og, new_og)
    with open(ed_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('[OK] event-detail.html: OG meta patched')
else:
    print('[SKIP] event-detail.html: OG meta target not found')

# ─── 4. Patch events-page.js: add short_description to cards ───
ep_path = os.path.join(BASE, 'js', 'events-page.js')
with open(ep_path, 'r', encoding='utf-8') as f:
    js = f.read()

old_card = """        <h3>${escapeHTML(ev.title)}</h3>
        <div class="ep-card-location">"""

new_card = """        <h3>${escapeHTML(ev.title)}</h3>
        ${ev.short_description ? `<p style="font-size:.82rem;color:var(--text-muted);line-height:1.5;margin:4px 0 8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHTML(ev.short_description)}</p>` : ''}
        <div class="ep-card-location">"""

if old_card in js:
    js = js.replace(old_card, new_card)
    with open(ep_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print('[OK] events-page.js: card short_description added')
else:
    print('[SKIP] events-page.js: card target not found')

# ─── 5. Patch events-page.js: include short_description in search ───
with open(ep_path, 'r', encoding='utf-8') as f:
    js = f.read()

old_search = "(e.description||'').toLowerCase().includes(q)"
new_search = "(e.short_description||'').toLowerCase().includes(q) || (e.description||'').toLowerCase().includes(q)"

if old_search in js:
    js = js.replace(old_search, new_search)
    with open(ep_path, 'w', encoding='utf-8') as f:
        f.write(js)
    print('[OK] events-page.js: search includes short_description')
else:
    print('[SKIP] events-page.js: search target not found')

print('\nDone! All patches applied.')
