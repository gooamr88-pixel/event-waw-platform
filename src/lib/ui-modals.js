import { setSafeHTML } from './dom.js';
import { escapeHTML } from './utils.js';

// P1-12 FIX: Sanitize color values to prevent CSS injection
function safeColor(color, fallback = '#e91e8c') {
  if (!color) return fallback;
  // Allow hex colors, named colors, rgb/hsl functions only
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  if (/^[a-zA-Z]{1,20}$/.test(color)) return color;
  if (/^(rgb|hsl)a?\([0-9,\s.%]+\)$/.test(color)) return color;
  return fallback;
}

// U1 FIX: Focus trapping helper for modal accessibility
function trapFocus(overlayEl) {
  const focusable = overlayEl.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  first.focus();
  overlayEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });
}

export function showConfirmModal({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', confirmColor = '#059669', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    // Remove existing
    document.getElementById('ev-global-confirm')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-confirm';
    overlay.style.zIndex = '999999';

    setSafeHTML(overlay, `
      <div class="ev-modal" style="max-width:400px">
        <div class="ev-modal-header">
          <h2>${escapeHTML(title)}</h2>
          <button type="button" class="ev-modal-close" id="ev-global-confirm-close">✕</button>
        </div>
        <p style="font-size:.9rem;color:var(--ev-text-muted);margin-bottom:24px;">
          ${escapeHTML(message)}
        </p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button type="button" class="ev-btn ev-btn-outline" id="ev-global-confirm-cancel">${escapeHTML(cancelText)}</button>
          <button type="button" class="ev-btn" id="ev-global-confirm-btn" style="background:${safeColor(confirmColor)};color:#fff;border:none;">${escapeHTML(confirmText)}</button>
        </div>
      </div>
    `);

    document.body.appendChild(overlay);
    trapFocus(overlay); // U1 FIX
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
      resolve(false);
    };

    overlay.querySelector('#ev-global-confirm-close').addEventListener('click', close);
    overlay.querySelector('#ev-global-confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    overlay.querySelector('#ev-global-confirm-btn').addEventListener('click', () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
      resolve(true);
    });
  });
}

export function showPromptModal({ title = 'Input Required', message = 'Please enter a value:', placeholder = '', defaultValue = '', confirmText = 'Submit', confirmColor = '#059669', cancelText = 'Cancel', required = true }) {
  return new Promise((resolve) => {
    // Remove existing
    document.getElementById('ev-global-prompt')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-prompt';
    overlay.style.zIndex = '999999';

    setSafeHTML(overlay, `
      <div class="ev-modal" style="max-width:400px">
        <div class="ev-modal-header">
          <h2>${escapeHTML(title)}</h2>
          <button type="button" class="ev-modal-close" id="ev-global-prompt-close">✕</button>
        </div>
        <p style="font-size:.9rem;color:var(--ev-text-muted);margin-bottom:16px;">
          ${escapeHTML(message)}
        </p>
        <div class="ev-form-group">
          <input type="text" id="ev-global-prompt-input" class="ev-form-input" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(defaultValue)}" />
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
          <button type="button" class="ev-btn ev-btn-outline" id="ev-global-prompt-cancel">${escapeHTML(cancelText)}</button>
          <button type="button" class="ev-btn" id="ev-global-prompt-btn" style="background:${safeColor(confirmColor)};color:#fff;border:none;">${escapeHTML(confirmText)}</button>
        </div>
      </div>
    `);

    document.body.appendChild(overlay);
    trapFocus(overlay); // U1 FIX

    const input = overlay.querySelector('#ev-global-prompt-input');
    input.focus();

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
      resolve(null);
    };

    overlay.querySelector('#ev-global-prompt-close').addEventListener('click', close);
    overlay.querySelector('#ev-global-prompt-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    const submit = () => {
      const val = input.value.trim();
      if (required && !val) {
        input.style.borderColor = 'var(--ev-danger)';
        return;
      }
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
      resolve(val);
    };

    overlay.querySelector('#ev-global-prompt-btn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') close();
    });
  });
}



export function showAlertModal({ title = 'Alert', message = '', buttonText = 'OK', buttonColor = '#059669' }) {
  return new Promise((resolve) => {
    document.getElementById('ev-global-alert')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-alert';
    overlay.style.zIndex = '999999';

    setSafeHTML(overlay, `
      <div class="ev-modal" style="max-width:400px; text-align:center;">
        <h2 style="margin-bottom:16px;">${escapeHTML(title)}</h2>
        <p style="font-size:.95rem;color:var(--ev-text-muted);margin-bottom:24px;">
          ${escapeHTML(message)}
        </p>
        <button type="button" class="ev-btn" id="ev-global-alert-btn" style="background:${safeColor(buttonColor)};color:#fff;border:none;width:100%;">${escapeHTML(buttonText)}</button>
      </div>
    `);

    document.body.appendChild(overlay);
    trapFocus(overlay); // U1 FIX
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
      resolve();
    };

    overlay.querySelector('#ev-global-alert-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
}
