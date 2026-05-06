export function showConfirmModal({ title = 'Confirm Action', message = 'Are you sure?', confirmText = 'Confirm', confirmColor = '#2563eb', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    // Remove existing
    document.getElementById('ev-global-confirm')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-confirm';
    overlay.style.zIndex = '999999';

    overlay.innerHTML = `
      <div class="ev-modal" style="max-width:400px">
        <div class="ev-modal-header">
          <h2>${escapeHTML(title)}</h2>
          <button class="ev-modal-close" id="ev-global-confirm-close">✕</button>
        </div>
        <p style="font-size:.9rem;color:var(--ev-text-muted);margin-bottom:24px;">
          ${escapeHTML(message)}
        </p>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="ev-btn ev-btn-outline" id="ev-global-confirm-cancel">${escapeHTML(cancelText)}</button>
          <button class="ev-btn" id="ev-global-confirm-btn" style="background:${confirmColor};color:#fff;border:none;">${escapeHTML(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

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

export function showPromptModal({ title = 'Input Required', message = 'Please enter a value:', placeholder = '', defaultValue = '', confirmText = 'Submit', confirmColor = '#2563eb', cancelText = 'Cancel', required = true }) {
  return new Promise((resolve) => {
    // Remove existing
    document.getElementById('ev-global-prompt')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-prompt';
    overlay.style.zIndex = '999999';

    overlay.innerHTML = `
      <div class="ev-modal" style="max-width:400px">
        <div class="ev-modal-header">
          <h2>${escapeHTML(title)}</h2>
          <button class="ev-modal-close" id="ev-global-prompt-close">✕</button>
        </div>
        <p style="font-size:.9rem;color:var(--ev-text-muted);margin-bottom:16px;">
          ${escapeHTML(message)}
        </p>
        <div class="ev-form-group">
          <input type="text" id="ev-global-prompt-input" class="ev-form-input" placeholder="${escapeHTML(placeholder)}" value="${escapeHTML(defaultValue)}" />
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px;">
          <button class="ev-btn ev-btn-outline" id="ev-global-prompt-cancel">${escapeHTML(cancelText)}</button>
          <button class="ev-btn" id="ev-global-prompt-btn" style="background:${confirmColor};color:#fff;border:none;">${escapeHTML(confirmText)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

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

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function showAlertModal({ title = 'Alert', message = '', buttonText = 'OK', buttonColor = '#2563eb' }) {
  return new Promise((resolve) => {
    document.getElementById('ev-global-alert')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ev-modal-overlay active';
    overlay.id = 'ev-global-alert';
    overlay.style.zIndex = '999999';

    overlay.innerHTML = `
      <div class="ev-modal" style="max-width:400px; text-align:center;">
        <h2 style="margin-bottom:16px;">${escapeHTML(title)}</h2>
        <p style="font-size:.95rem;color:var(--ev-text-muted);margin-bottom:24px;">
          ${escapeHTML(message)}
        </p>
        <button class="ev-btn" id="ev-global-alert-btn" style="background:${buttonColor};color:#fff;border:none;width:100%;">${escapeHTML(buttonText)}</button>
      </div>
    `;

    document.body.appendChild(overlay);

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
