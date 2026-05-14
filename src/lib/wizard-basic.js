/* ===================================
   EVENTSLI — Wizard Basic & General
   =================================== */

import { setSafeHTML } from './dom.js';
import { showPromptModal } from './ui-modals.js';
import { showToast } from './dashboard-ui.js';
import { escapeHTML } from './utils.js';

export function setupBasicTab(getOrchestratorState) {
  const EVENT_CATEGORIES = [
    'Music & Concerts', 'Technology & Innovation', 'Business & Professional',
    'Sports & Fitness', 'Education & Learning', 'Arts & Culture',
    'Food & Drink', 'Health & Wellness', 'Community & Culture',
    'Family & Kids', 'Fashion & Beauty', 'Film & Media',
    'Hobbies & Special Interest', 'Travel & Outdoor', 'Charity & Causes',
    'Spirituality & Religion', 'Science & Tech', 'Auto, Boat & Air',
    'Government & Politics', 'Festival', 'Other'
  ];
  const categorySelect = document.getElementById('ce-category');
  if (categorySelect) {
    setSafeHTML(categorySelect, '<option value="">Select Category</option>' +
      EVENT_CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join(''));
  }

  const timezoneSelect = document.getElementById('ce-timezone');
  if (timezoneSelect) {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      const optionsHTML = '<option value="">Select Time Zone</option>' +
        timezones.map(tz => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`).join('');
      setSafeHTML(timezoneSelect, optionsHTML);
    } catch (e) {
      console.warn('Intl.supportedValuesOf not supported, timezone select fallback to default.');
    }
  }

  // Rich Text Editor
  document.querySelectorAll('.ce-editor-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const url = await showPromptModal({
          title: 'Insert Link',
          message: 'Enter URL:',
          placeholder: 'https://...',
          confirmText: 'Insert Link'
        });
        if (url) {
          const trimmed = url.trim();
          if (/^\s*(javascript|data|vbscript|blob):/i.test(trimmed)) {
            showToast('Blocked: unsafe URL protocol.', 'error');
            return;
          }
          if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed) || !/^[a-z]+:/i.test(trimmed)) {
            document.execCommand(cmd, false, trimmed);
          } else {
            showToast('Only http/https URLs are allowed.', 'error');
          }
        }
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  // Keywords
  const keywordsInput = document.getElementById('ce-keywords');
  keywordsInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = keywordsInput.value.trim();
      const { ceKeywords } = getOrchestratorState();
      if (val && !ceKeywords.includes(val)) {
        ceKeywords.push(val);
        renderGoogleKeywords(ceKeywords);
      }
      keywordsInput.value = '';
    }
  });

  // Social Links
  document.getElementById('ce-add-social')?.addEventListener('click', () => {
    const container = document.getElementById('ce-social-links');
    const row = document.createElement('div');
    row.className = 'ce-social-row';
    setSafeHTML(row, `<select class="ev-form-input ce-social-select"><option value="">Select Platform</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="twitter">X (Twitter)</option><option value="tiktok">TikTok</option><option value="linkedin">LinkedIn</option><option value="youtube">YouTube</option></select><input class="ev-form-input" type="url" placeholder="https://..." /><button type="button" class="ce-social-del" title="Remove">🗑️</button>`);
    container.appendChild(row);
  });
  document.getElementById('ce-social-links')?.addEventListener('click', (e) => {
    const del = e.target.closest('.ce-social-del');
    if (del) del.closest('.ce-social-row')?.remove();
  });

  // Short Description character counter
  const shortDesc = document.getElementById('ce-short-desc');
  const shortDescCount = document.getElementById('ce-short-desc-count');
  if (shortDesc && shortDescCount) {
    shortDesc.addEventListener('input', () => {
      const len = shortDesc.value.length;
      shortDescCount.textContent = `${len}/200`;
      shortDescCount.style.color = len > 180 ? '#ef4444' : '';
    });
  }

  // Performers Logic
  document.getElementById('ce-add-performer')?.addEventListener('click', () => {
    const container = document.getElementById('ce-performers-container');
    const row = document.createElement('div');
    row.className = 'ce-performer-row';
    const id = Date.now() + Math.random().toString(36).substring(2, 5);
    setSafeHTML(row, `
      <div class="ce-performer-photo-area" id="perf-area-${id}">
        <span style="font-size: 1.5rem; color: #9ca3af;">👤</span>
        <input type="file" accept="image/jpeg,image/png" class="perf-upload" id="perf-input-${id}" />
      </div>
      <div class="ce-performer-inputs">
        <input type="text" class="ev-form-input perf-name" placeholder="Name (e.g. DJ Snake)" required />
        <input type="text" class="ev-form-input perf-role" placeholder="Role (e.g. DJ, Singer, Speaker)" />
      </div>
      <button type="button" class="ce-performer-del" title="Remove">✕</button>
    `);
    container.appendChild(row);

    // Wire up image preview
    const input = row.querySelector('.perf-upload');
    const area = row.querySelector('.ce-performer-photo-area');
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
        area.innerHTML = '';
        const img = document.createElement('img');
        img.src = ev.target.result;
        area.appendChild(img);
        area.appendChild(input); // keep input
      };
      reader.readAsDataURL(file);
    });
  });

  document.getElementById('ce-performers-container')?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.ce-performer-del');
    if (delBtn) delBtn.closest('.ce-performer-row')?.remove();
  });
}

export function renderGoogleKeywords(ceKeywords) {
  const tagsWrap = document.getElementById('ce-keywords-tags');
  if (!tagsWrap) return;
  setSafeHTML(tagsWrap, ceKeywords.map((k, i) =>
    `<span class="ce-tag">${escapeHTML(k)} <button type="button" data-idx="${i}">✕</button></span>`
  ).join(''));
  tagsWrap.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => { 
      ceKeywords.splice(Number(btn.dataset.idx), 1); 
      renderGoogleKeywords(ceKeywords); 
    });
  });
}
