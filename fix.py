import sys
with open('src/lib/dashboard-modals.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Make sure setSafeHTML is imported
if "import { setSafeHTML } from './dom.js';" not in content:
    content = "import { setSafeHTML } from './dom.js';\n" + content

reps = [
    (
        "keywordsWrap.innerHTML = ceKeywords.map((k, i) =>\n      `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n    ).join('');",
        "setSafeHTML(keywordsWrap, ceKeywords.map((k, i) =>\n      `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n    ).join(''));"
    ),
    (
        "row.innerHTML = `<select class=\"ev-form-input ce-social-select\"><option value=\"\">Select Platform</option><option value=\"facebook\">Facebook</option><option value=\"instagram\">Instagram</option><option value=\"twitter\">X (Twitter)</option><option value=\"tiktok\">TikTok</option><option value=\"linkedin\">LinkedIn</option><option value=\"youtube\">YouTube</option></select><input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" /><button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button>`;",
        "setSafeHTML(row, `<select class=\"ev-form-input ce-social-select\"><option value=\"\">Select Platform</option><option value=\"facebook\">Facebook</option><option value=\"instagram\">Instagram</option><option value=\"twitter\">X (Twitter)</option><option value=\"tiktok\">TikTok</option><option value=\"linkedin\">LinkedIn</option><option value=\"youtube\">YouTube</option></select><input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" /><button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button>`);"
    ),
    (
        "item.innerHTML = `<label>Photo ${ceGalleryCount}</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div>`;",
        "setSafeHTML(item, `<label>Photo ${ceGalleryCount}</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div>`);"
    ),
    (
        "item.innerHTML = `<label>Sponsor ${count}</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Logo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div>`;",
        "setSafeHTML(item, `<label>Sponsor ${count}</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Logo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div>`);"
    ),
    (
        "btn.innerHTML = ceEditingEventId ? ' Update Event' : ' Publish Event';",
        "setSafeHTML(btn, ceEditingEventId ? ' Update Event' : ' Publish Event');"
    ),
    (
        "if (publishBtn) publishBtn.innerHTML = ' Update Event';",
        "if (publishBtn) setSafeHTML(publishBtn, ' Update Event');"
    ),
    (
        "if (editor && ev.description) editor.innerHTML = ev.description;",
        "if (editor && ev.description) setSafeHTML(editor, ev.description);"
    ),
    (
        "tagsWrap.innerHTML = ceKeywords.map((k, i) =>\n          `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n        ).join('');",
        "setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>\n          `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n        ).join(''));"
    ),
    (
        "container.innerHTML = ev.social_links.map(link => `\n          <div class=\"ce-social-row\">\n            <select class=\"ev-form-input ce-social-select\">\n              <option value=\"\">Select Platform</option>\n              <option value=\"facebook\" ${link.platform==='facebook'?'selected':''}>Facebook</option>\n              <option value=\"instagram\" ${link.platform==='instagram'?'selected':''}>Instagram</option>\n              <option value=\"twitter\" ${link.platform==='twitter'?'selected':''}>X (Twitter)</option>\n              <option value=\"tiktok\" ${link.platform==='tiktok'?'selected':''}>TikTok</option>\n              <option value=\"linkedin\" ${link.platform==='linkedin'?'selected':''}>LinkedIn</option>\n              <option value=\"youtube\" ${link.platform==='youtube'?'selected':''}>YouTube</option>\n            </select>\n            <input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" value=\"${escapeHTML(link.url || '')}\" />\n            <button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button>\n          </div>\n        `).join('');",
        "setSafeHTML(container, ev.social_links.map(link => `\n          <div class=\"ce-social-row\">\n            <select class=\"ev-form-input ce-social-select\">\n              <option value=\"\">Select Platform</option>\n              <option value=\"facebook\" ${link.platform==='facebook'?'selected':''}>Facebook</option>\n              <option value=\"instagram\" ${link.platform==='instagram'?'selected':''}>Instagram</option>\n              <option value=\"twitter\" ${link.platform==='twitter'?'selected':''}>X (Twitter)</option>\n              <option value=\"tiktok\" ${link.platform==='tiktok'?'selected':''}>TikTok</option>\n              <option value=\"linkedin\" ${link.platform==='linkedin'?'selected':''}>LinkedIn</option>\n              <option value=\"youtube\" ${link.platform==='youtube'?'selected':''}>YouTube</option>\n            </select>\n            <input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" value=\"${escapeHTML(link.url || '')}\" />\n            <button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button>\n          </div>\n        `).join(''));"
    ),
    (
        "if (editor) editor.innerHTML = '';",
        "if (editor) editor.textContent = '';"
    ),
    (
        "if (galleryGrid) galleryGrid.innerHTML = `<div class=\"ce-gallery-item\"><label>Photo 1</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div></div>`;",
        "if (galleryGrid) setSafeHTML(galleryGrid, `<div class=\"ce-gallery-item\"><label>Photo 1</label><div class=\"ce-upload-area ce-gallery-upload\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"8.5\" cy=\"8.5\" r=\"1.5\"/><path d=\"M21 15l-5-5L5 21\"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type=\"file\" accept=\"image/jpeg,image/png\" /></div></div>`);"
    ),
    (
        "if (sponsorsGrid) sponsorsGrid.innerHTML = '';",
        "if (sponsorsGrid) sponsorsGrid.textContent = '';"
    ),
    (
        "if (socialLinks) socialLinks.innerHTML = `<div class=\"ce-social-row\"><select class=\"ev-form-input ce-social-select\"><option value=\"\">Select Platform</option><option value=\"facebook\">Facebook</option><option value=\"instagram\">Instagram</option><option value=\"twitter\">X (Twitter)</option><option value=\"tiktok\">TikTok</option><option value=\"linkedin\">LinkedIn</option><option value=\"youtube\">YouTube</option></select><input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" /><button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button></div>`;",
        "if (socialLinks) setSafeHTML(socialLinks, `<div class=\"ce-social-row\"><select class=\"ev-form-input ce-social-select\"><option value=\"\">Select Platform</option><option value=\"facebook\">Facebook</option><option value=\"instagram\">Instagram</option><option value=\"twitter\">X (Twitter)</option><option value=\"tiktok\">TikTok</option><option value=\"linkedin\">LinkedIn</option><option value=\"youtube\">YouTube</option></select><input class=\"ev-form-input\" type=\"url\" placeholder=\"https://...\" /><button type=\"button\" class=\"ce-social-del\" title=\"Remove\"></button></div>`);"
    ),
    (
        "if (tagsWrap) tagsWrap.innerHTML = '';",
        "if (tagsWrap) tagsWrap.textContent = '';"
    ),
    (
        "if (publishBtn) publishBtn.innerHTML = ' Publish Event';",
        "if (publishBtn) setSafeHTML(publishBtn, ' Publish Event');"
    ),
    (
        "if (catSelect) catSelect.innerHTML = '<option value=\"\">Select Category</option>';",
        "if (catSelect) setSafeHTML(catSelect, '<option value=\"\">Select Category</option>');"
    ),
    (
        "if (ticketTbody) ticketTbody.innerHTML = '<tr><td colspan=\"6\" class=\"ev-table-empty\">No tickets added yet</td></tr>';",
        "if (ticketTbody) setSafeHTML(ticketTbody, '<tr><td colspan=\"6\" class=\"ev-table-empty\">No tickets added yet</td></tr>');"
    ),
    (
        "tagsWrap.innerHTML = ceKeywords.map((k, i) =>\n      `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n    ).join('');",
        "setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>\n      `<span class=\"ce-tag\">${escapeHTML(k)} <button type=\"button\" data-idx=\"${i}\">x</button></span>`\n    ).join(''));"
    ),
    (
        "addressBar.innerHTML = `\n      <div style=\"flex:1\">\n        <div style=\"font-weight:600;font-size:1.05rem\">${escapeHTML(venueName)}</div>\n        <div style=\"color:var(--ev-text-sec);font-size:.9rem\">${escapeHTML(venueAddress)}</div>\n      </div>\n      <button type=\"button\" class=\"ev-btn ev-btn-pink\" onclick=\"window.open('https://www.google.com/maps/search/?api=1&query=${lat},${lng}', '_blank')\">\n        Open in Maps\n      </button>\n    `;",
        "setSafeHTML(addressBar, `\n      <div style=\"flex:1\">\n        <div style=\"font-weight:600;font-size:1.05rem\">${escapeHTML(venueName)}</div>\n        <div style=\"color:var(--ev-text-sec);font-size:.9rem\">${escapeHTML(venueAddress)}</div>\n      </div>\n      <button type=\"button\" class=\"ev-btn ev-btn-pink\" onclick=\"window.open('https://www.google.com/maps/search/?api=1&query=${lat},${lng}', '_blank')\">\n        Open in Maps\n      </button>\n    `);"
    ),
    (
        "markerContent.innerHTML = `\n      <div style=\"text-align:center\">\n        <div style=\"background:var(--ev-pink);color:white;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 4px 12px rgba(233,30,99,0.4)\">\n          <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/></svg>\n        </div>\n        <div style=\"background:var(--ev-surface);color:var(--ev-text);padding:6px 12px;border-radius:100px;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:8px;white-space:nowrap;border:1px solid var(--ev-border)\">\n          ${escapeHTML(venueName)}\n        </div>\n      </div>\n    `;",
        "setSafeHTML(markerContent, `\n      <div style=\"text-align:center\">\n        <div style=\"background:var(--ev-pink);color:white;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 4px 12px rgba(233,30,99,0.4)\">\n          <svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><path d=\"M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z\"/><circle cx=\"12\" cy=\"10\" r=\"3\"/></svg>\n        </div>\n        <div style=\"background:var(--ev-surface);color:var(--ev-text);padding:6px 12px;border-radius:100px;font-size:12px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.1);margin-top:8px;white-space:nowrap;border:1px solid var(--ev-border)\">\n          ${escapeHTML(venueName)}\n        </div>\n      </div>\n    `);"
    ),
    (
        "mapDiv.innerHTML = `<iframe \n        width=\"100%\" \n        height=\"100%\" \n        style=\"border:0;\" \n        loading=\"lazy\" \n        allowfullscreen \n        referrerpolicy=\"no-referrer-when-downgrade\" \n        src=\"https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed\">\n      </iframe>`;",
        "setSafeHTML(mapDiv, `<iframe \n        width=\"100%\" \n        height=\"100%\" \n        style=\"border:0;\" \n        loading=\"lazy\" \n        allowfullscreen \n        referrerpolicy=\"no-referrer-when-downgrade\" \n        src=\"https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed\">\n      </iframe>`);"
    ),
    (
        "tbody.innerHTML = '<tr><td colspan=\"6\" class=\"ev-table-empty\">No tickets added yet</td></tr>';",
        "setSafeHTML(tbody, '<tr><td colspan=\"6\" class=\"ev-table-empty\">No tickets added yet</td></tr>');"
    ),
    (
        "tbody.innerHTML = ceTicketsList.map((t, i) => {\n    const p = parseFloat(t.price);\n    const ep = parseFloat(t.earlyPrice);\n    const isFree = p === 0;\n    return `<tr>\n      <td>${i + 1}</td>\n      <td style=\"font-weight:600\">${escapeHTML(t.name)}\n        ${t.category ? `<div style=\"font-size:.8rem;color:var(--ev-pink)\">${escapeHTML(t.category)}</div>` : ''}\n      </td>\n      <td>${t.qty}</td>\n      <td>\n        ${isFree ? '<span class=\"ev-badge published\">Free</span>' : '$' + p}\n        ${ep ? `<div style=\"font-size:.8rem;color:var(--ev-text-sec)\">Early: $${ep}</div>` : ''}\n      </td>\n      <td>${t.currency}</td>\n      <td>\n        <button type=\"button\" class=\"ev-btn-icon\" title=\"Delete\" data-ce-del-ticket=\"${i}\">\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2\"/></svg>\n        </button>\n      </td>\n    </tr>`;\n  }).join('');",
        "setSafeHTML(tbody, ceTicketsList.map((t, i) => {\n    const p = parseFloat(t.price);\n    const ep = parseFloat(t.earlyPrice);\n    const isFree = p === 0;\n    return `<tr>\n      <td>${i + 1}</td>\n      <td style=\"font-weight:600\">${escapeHTML(t.name)}\n        ${t.category ? `<div style=\"font-size:.8rem;color:var(--ev-pink)\">${escapeHTML(t.category)}</div>` : ''}\n      </td>\n      <td>${t.qty}</td>\n      <td>\n        ${isFree ? '<span class=\"ev-badge published\">Free</span>' : '$' + p}\n        ${ep ? `<div style=\"font-size:.8rem;color:var(--ev-text-sec)\">Early: $${ep}</div>` : ''}\n      </td>\n      <td>${t.currency}</td>\n      <td>\n        <button type=\"button\" class=\"ev-btn-icon\" title=\"Delete\" data-ce-del-ticket=\"${i}\">\n          <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polyline points=\"3 6 5 6 21 6\"/><path d=\"M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2\"/></svg>\n        </button>\n      </td>\n    </tr>`;\n  }).join(''));"
    ),
    (
        "if (!pImg) { pImg = document.createElement('img'); previewImgDiv.innerHTML = ''; previewImgDiv.appendChild(pImg); }",
        "if (!pImg) { pImg = document.createElement('img'); previewImgDiv.textContent = ''; previewImgDiv.appendChild(pImg); }"
    ),
    (
        "modal.innerHTML = `<div class=\"ev-modal\" style=\"max-width:520px\">\n    <div class=\"ev-modal-header\">\n      <h2>Upload ${label}</h2>\n      <button class=\"ev-modal-close\" id=\"ce-crop-close\">x</button>\n    </div>\n    <div class=\"ev-modal-body\">\n      <div style=\"max-height:400px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;border-radius:12px;margin-bottom:20px\">\n        <img id=\"ce-crop-img\" src=\"${imgUrl}\" style=\"max-width:100%;max-height:400px;display:block\" />\n      </div>\n      <div style=\"display:flex;gap:10px\">\n        <button class=\"ev-btn ev-btn-outline\" id=\"ce-crop-cancel\" style=\"flex:1\">Cancel</button>\n        <button class=\"ev-btn ev-btn-pink\" id=\"ce-crop-save\" style=\"flex:1\">Apply Image</button>\n      </div>\n    </div>\n  </div>`;",
        "setSafeHTML(modal, `<div class=\"ev-modal\" style=\"max-width:520px\">\n    <div class=\"ev-modal-header\">\n      <h2>Upload ${label}</h2>\n      <button class=\"ev-modal-close\" id=\"ce-crop-close\">x</button>\n    </div>\n    <div class=\"ev-modal-body\">\n      <div style=\"max-height:400px;overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center;border-radius:12px;margin-bottom:20px\">\n        <img id=\"ce-crop-img\" src=\"${imgUrl}\" style=\"max-width:100%;max-height:400px;display:block\" />\n      </div>\n      <div style=\"display:flex;gap:10px\">\n        <button class=\"ev-btn ev-btn-outline\" id=\"ce-crop-cancel\" style=\"flex:1\">Cancel</button>\n        <button class=\"ev-btn ev-btn-pink\" id=\"ce-crop-save\" style=\"flex:1\">Apply Image</button>\n      </div>\n    </div>\n  </div>`);"
    )
]

replaced = 0
for r in reps:
    from_str = r[0]
    to_str = r[1]
    if from_str in content:
        content = content.replace(from_str, to_str)
        replaced += 1
    else:
        # try matching ignoring carriage returns
        from_str_cr = from_str.replace('\n', '\r\n')
        if from_str_cr in content:
            to_str_cr = to_str.replace('\n', '\r\n')
            content = content.replace(from_str_cr, to_str_cr)
            replaced += 1

with open('src/lib/dashboard-modals.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Replaced:', replaced)
