/* ===================================
   EVENTSLI — Admin Email Templates Editor
   Phase 6 Task 4: BRD Section 16
   ===================================
   Provides UI for admins to view, edit, preview,
   and toggle email templates.
   Loaded by admin-dashboard.js
   =================================== */
import { supabase } from './supabase.js';
import { setSafeHTML } from './dom.js';

/**
 * Renders the email templates editor into the given container.
 */
export async function renderEmailTemplatesEditor(container) {
  if (!container) return;

  try {
    const { data: templates, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('category, name');

    if (error) throw error;

    if (!templates || templates.length === 0) {
      setSafeHTML(container, '<div style="text-align:center;padding:40px;color:var(--ev-text-muted)">No email templates found. Run migration v23 to seed default templates.</div>');
      return;
    }

    // Inject styles
    injectStyles();

    // Group by category
    const categories = {};
    for (const t of templates) {
      if (!categories[t.category]) categories[t.category] = [];
      categories[t.category].push(t);
    }

    const categoryLabels = {
      organizer: '📋 Organizer Notifications',
      buyer: '🎫 Buyer Notifications',
      reminder: '⏰ Reminders',
      admin: '🛡️ Admin',
      general: '📧 General',
    };

    // Build template list
    let html = `
      <p style="font-size:.85rem;color:var(--ev-text-sec);margin-bottom:24px">
        Edit email templates used by the notification system. Changes are saved directly and used on the next email send.
        Use <code style="background:var(--ev-bg-alt);padding:2px 6px;border-radius:4px;font-size:.8rem">{{variable_name}}</code> placeholders for dynamic content.
      </p>
    `;

    for (const [cat, tpls] of Object.entries(categories)) {
      html += `
        <div class="ev-card" style="margin-bottom:16px">
          <div class="ev-card-header">
            <span class="ev-card-title">${categoryLabels[cat] || cat}</span>
            <span style="font-size:.7rem;color:var(--ev-text-muted)">${tpls.length} template${tpls.length > 1 ? 's' : ''}</span>
          </div>
          <div style="padding:12px">
      `;

      for (const tpl of tpls) {
        const updated = tpl.updated_at ? new Date(tpl.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        html += `
          <div class="emt-row" data-tpl-id="${esc(tpl.id)}" data-tpl-name="${esc(tpl.name)}">
            <div class="emt-row-header">
              <div class="emt-row-info">
                <div class="emt-row-label">${esc(tpl.label)}</div>
                <div class="emt-row-meta">
                  <code class="emt-name-badge">${esc(tpl.name)}</code>
                  ${updated ? `<span class="emt-ts">Updated ${updated}</span>` : ''}
                </div>
              </div>
              <div class="emt-row-actions">
                <label class="emt-toggle" title="${tpl.is_active ? 'Active' : 'Disabled'}">
                  <input type="checkbox" class="emt-active-toggle" ${tpl.is_active ? 'checked' : ''} data-id="${esc(tpl.id)}" />
                  <span class="emt-toggle-slider"></span>
                </label>
                <button class="ev-btn ev-btn-outline ev-btn-sm emt-edit-btn" data-id="${esc(tpl.id)}">Edit</button>
                <button class="ev-btn ev-btn-outline ev-btn-sm emt-preview-btn" data-id="${esc(tpl.id)}" title="Preview">👁</button>
              </div>
            </div>
            <div class="emt-editor" id="emt-editor-${esc(tpl.id)}" style="display:none">
              <div style="margin-bottom:12px">
                <label class="cms-label">Subject Line</label>
                <input class="cms-input emt-subject" value="${escAttr(tpl.subject)}" data-id="${esc(tpl.id)}" />
              </div>
              <div style="margin-bottom:12px">
                <label class="cms-label">Available Variables</label>
                <div class="emt-vars">${(tpl.available_variables || '').split(',').map(v => `<code class="emt-var-chip">${esc(v.trim())}</code>`).join(' ')}</div>
              </div>
              <div style="margin-bottom:12px">
                <label class="cms-label">HTML Body</label>
                <textarea class="cms-input emt-body" rows="14" data-id="${esc(tpl.id)}" style="font-family:monospace;font-size:.8rem;line-height:1.5;resize:vertical">${esc(tpl.body_html)}</textarea>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="ev-btn ev-btn-pink emt-save-btn" data-id="${esc(tpl.id)}">Save Template</button>
                <button class="ev-btn ev-btn-outline ev-btn-sm emt-cancel-btn" data-id="${esc(tpl.id)}">Cancel</button>
              </div>
            </div>
          </div>
        `;
      }

      html += `</div></div>`;
    }

    // Email logs section
    html += `
      <div class="ev-card" style="margin-bottom:16px">
        <div class="ev-card-header">
          <span class="ev-card-title">📊 Recent Email Logs</span>
          <button class="ev-btn ev-btn-outline ev-btn-sm" id="emt-refresh-logs">Refresh</button>
        </div>
        <div style="padding:12px" id="emt-logs-container">
          <p style="color:var(--ev-text-muted);text-align:center;font-size:.85rem">Loading...</p>
        </div>
      </div>
    `;

    setSafeHTML(container, html);

    // ── Attach event handlers ──

    // Toggle active
    container.querySelectorAll('.emt-active-toggle').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const active = e.target.checked;
        const { error: err } = await supabase
          .from('email_templates')
          .update({ is_active: active })
          .eq('id', id);

        if (err) {
          e.target.checked = !active; // revert
          fireEvent('cms-error', { message: 'Failed to update: ' + err.message });
        } else {
          fireEvent('cms-saved', { label: active ? 'Template activated' : 'Template disabled' });
        }
      });
    });

    // Edit toggle
    container.querySelectorAll('.emt-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const editor = document.getElementById(`emt-editor-${id}`);
        editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
        btn.textContent = editor.style.display === 'none' ? 'Edit' : 'Close';
      });
    });

    // Cancel
    container.querySelectorAll('.emt-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        document.getElementById(`emt-editor-${id}`).style.display = 'none';
        const editBtn = container.querySelector(`.emt-edit-btn[data-id="${id}"]`);
        if (editBtn) editBtn.textContent = 'Edit';
      });
    });

    // Save
    container.querySelectorAll('.emt-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const subject = container.querySelector(`.emt-subject[data-id="${id}"]`).value;
        const body_html = container.querySelector(`.emt-body[data-id="${id}"]`).value;

        btn.textContent = 'Saving...';
        btn.disabled = true;

        const { error: err } = await supabase
          .from('email_templates')
          .update({ subject, body_html })
          .eq('id', id);

        btn.textContent = 'Save Template';
        btn.disabled = false;

        if (err) {
          fireEvent('cms-error', { message: 'Save failed: ' + err.message });
        } else {
          fireEvent('cms-saved', { label: 'Email template saved' });
          // Update timestamp in UI
          const row = container.querySelector(`.emt-row[data-tpl-id="${id}"]`);
          const ts = row?.querySelector('.emt-ts');
          if (ts) ts.textContent = 'Updated just now';
        }
      });
    });

    // Preview
    container.querySelectorAll('.emt-preview-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const bodyTextarea = container.querySelector(`.emt-body[data-id="${id}"]`);
        const subjectInput = container.querySelector(`.emt-subject[data-id="${id}"]`);

        // Use current editor value (or fetch original)
        let bodyHtml = bodyTextarea?.value;
        let subject = subjectInput?.value;

        if (!bodyHtml) {
          const tpl = templates.find(t => t.id === id);
          bodyHtml = tpl?.body_html || '<p>No template body</p>';
          subject = tpl?.subject || 'Preview';
        }

        // Replace variables with sample data
        const sampleVars = {
          organizer_name: 'Ahmad Organizer',
          buyer_name: 'Sarah Buyer',
          event_title: 'Riyadh Tech Summit 2025',
          event_date: 'Saturday, June 15, 2025 at 7:00 PM',
          event_venue: 'King Fahad Cultural Center, Riyadh',
          tier_name: 'VIP',
          dashboard_url: '#',
          ticket_link: '#',
          rejection_reason: 'Event poster does not meet quality standards. Please upload a higher resolution image.',
          change_details: '📅 Date changed from "Jun 10, 2025" to "Jun 15, 2025"',
        };

        const rendered = bodyHtml.replace(/\{\{(\w+)\}\}/g, (m, k) => sampleVars[k] || `{{${k}}}`);
        const renderedSubject = subject.replace(/\{\{(\w+)\}\}/g, (m, k) => sampleVars[k] || `{{${k}}}`);

        // Open preview modal
        showPreviewModal(renderedSubject, rendered);
      });
    });

    // Load logs
    loadEmailLogs(container.querySelector('#emt-logs-container'));
    document.getElementById('emt-refresh-logs')?.addEventListener('click', () => {
      loadEmailLogs(container.querySelector('#emt-logs-container'));
    });

  } catch (err) {
    setSafeHTML(container, `<div style="text-align:center;padding:40px;color:var(--ev-danger)">Failed to load templates: ${esc(err.message)}</div>`);
  }
}

/* ── Email Logs ── */

async function loadEmailLogs(container) {
  if (!container) return;

  const { data: logs, error } = await supabase
    .from('email_logs')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(30);

  if (error || !logs) {
    setSafeHTML(container, '<p style="color:var(--ev-danger);text-align:center">Failed to load logs</p>');
    return;
  }

  if (logs.length === 0) {
    setSafeHTML(container, '<p style="color:var(--ev-text-muted);text-align:center;font-size:.85rem">No emails sent yet</p>');
    return;
  }

  const statusColors = {
    sent: 'color:#22c55e',
    failed: 'color:#ef4444',
    bounced: 'color:#f59e0b',
    queued: 'color:#3b82f6',
  };

  setSafeHTML(container, `
    <div style="max-height:400px;overflow-y:auto;">
      <table style="width:100%;font-size:.8rem;border-collapse:collapse">
        <thead>
          <tr style="text-align:left;border-bottom:1px solid var(--ev-border)">
            <th style="padding:8px 6px;color:var(--ev-text-muted);font-weight:600">Template</th>
            <th style="padding:8px 6px;color:var(--ev-text-muted);font-weight:600">Recipient</th>
            <th style="padding:8px 6px;color:var(--ev-text-muted);font-weight:600">Status</th>
            <th style="padding:8px 6px;color:var(--ev-text-muted);font-weight:600">Sent</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(log => `
            <tr style="border-bottom:1px solid var(--ev-border)">
              <td style="padding:8px 6px"><code style="font-size:.75rem;background:var(--ev-bg-alt);padding:2px 6px;border-radius:4px">${esc(log.template_name)}</code></td>
              <td style="padding:8px 6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(log.recipient_email)}">${esc(log.recipient_email)}</td>
              <td style="padding:8px 6px;${statusColors[log.status] || ''};font-weight:600">${esc(log.status)}${log.error_message ? ` <span title="${escAttr(log.error_message)}" style="cursor:help">⚠</span>` : ''}</td>
              <td style="padding:8px 6px;color:var(--ev-text-muted)">${new Date(log.sent_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
}

/* ── Preview Modal ── */

function showPreviewModal(subject, html) {
  // Remove existing
  document.getElementById('emt-preview-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'emt-preview-modal';
  modal.className = 'emt-preview-overlay';
  modal.innerHTML = `
    <div class="emt-preview-dialog">
      <div class="emt-preview-header">
        <div>
          <div style="font-size:.7rem;color:var(--ev-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Subject Preview</div>
          <div style="font-size:.9rem;font-weight:600">${esc(subject)}</div>
        </div>
        <button class="emt-preview-close" id="emt-preview-close">&times;</button>
      </div>
      <iframe class="emt-preview-frame" id="emt-preview-iframe" sandbox="allow-same-origin"></iframe>
    </div>
  `;

  document.body.appendChild(modal);

  // Write HTML into iframe
  const iframe = document.getElementById('emt-preview-iframe');
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Close handlers
  document.getElementById('emt-preview-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

/* ── Utilities ── */

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fireEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/* ── Inject Styles ── */

function injectStyles() {
  if (document.getElementById('emt-styles')) return;

  const style = document.createElement('style');
  style.id = 'emt-styles';
  style.textContent = `
    .emt-row {
      padding: 14px;
      border: 1px solid var(--ev-border);
      border-radius: 10px;
      margin-bottom: 10px;
      background: var(--ev-bg);
      transition: border-color 0.2s;
    }
    .emt-row:hover { border-color: var(--ev-yellow, #a78bfa); }
    .emt-row-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }
    .emt-row-info { flex: 1; min-width: 0; }
    .emt-row-label { font-size: .9rem; font-weight: 600; margin-bottom: 4px; }
    .emt-row-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .emt-name-badge {
      font-size: .7rem; background: var(--ev-bg-alt); padding: 2px 8px;
      border-radius: 4px; color: var(--ev-text-muted);
    }
    .emt-ts { font-size: .7rem; color: var(--ev-text-muted); }
    .emt-row-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

    /* Toggle switch */
    .emt-toggle {
      position: relative; display: inline-block; width: 36px; height: 20px;
    }
    .emt-toggle input { opacity: 0; width: 0; height: 0; }
    .emt-toggle-slider {
      position: absolute; cursor: pointer; inset: 0;
      background: var(--ev-border); border-radius: 20px; transition: background 0.3s;
    }
    .emt-toggle-slider::before {
      content: ''; position: absolute; width: 16px; height: 16px;
      left: 2px; bottom: 2px; background: #fff; border-radius: 50%;
      transition: transform 0.3s;
    }
    .emt-toggle input:checked + .emt-toggle-slider { background: #22c55e; }
    .emt-toggle input:checked + .emt-toggle-slider::before { transform: translateX(16px); }

    /* Editor panel */
    .emt-editor {
      margin-top: 16px; padding-top: 16px;
      border-top: 1px solid var(--ev-border);
    }
    .emt-vars { display: flex; flex-wrap: wrap; gap: 6px; }
    .emt-var-chip {
      font-size: .7rem; background: rgba(167,139,250,.1);
      color: #a78bfa; padding: 3px 10px; border-radius: 20px;
      border: 1px solid rgba(167,139,250,.2);
    }

    /* Preview modal */
    .emt-preview-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.6); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: emtFadeIn 0.2s ease;
    }
    @keyframes emtFadeIn { from { opacity: 0; } to { opacity: 1; } }
    .emt-preview-dialog {
      width: 680px; max-width: 95vw; max-height: 90vh;
      background: var(--ev-bg-card, #fff); border-radius: 16px;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3);
      display: flex; flex-direction: column;
    }
    .emt-preview-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--ev-border);
    }
    .emt-preview-close {
      background: none; border: none; font-size: 1.5rem;
      color: var(--ev-text-muted); cursor: pointer; padding: 4px 8px;
    }
    .emt-preview-close:hover { color: var(--ev-danger); }
    .emt-preview-frame {
      width: 100%; height: 500px; border: none; background: #fff;
    }
  `;
  document.head.appendChild(style);
}
