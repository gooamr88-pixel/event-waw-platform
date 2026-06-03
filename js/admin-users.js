/* ===================================
   EVENTSLI — Admin Users Panel
   =================================== */

import { supabase } from '../src/lib/supabase.js';
import { setSafeHTML } from '../src/lib/dom.js';
import { escapeHTML } from '../src/lib/utils.js';
import { showConfirmModal, showPromptModal } from '../src/lib/ui-modals.js';
import { showToast, downloadCSV } from './admin-ui.js';

/**
 * Loads all users into the users table.
 */
export async function loadAllUsers(adminRole, onRefresh) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, is_blocked, blocked_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    if (!data || data.length === 0) {
      setSafeHTML(tbody, '<tr><td colspan="6" class="ev-table-empty">No users found</td></tr>');
      return;
    }

    const exportBtn = document.getElementById('export-users-btn');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const rows = [['ID', 'Name', 'Email', 'Role', 'Blocked', 'Joined Date']];
        data.forEach(u => rows.push([
          u.id, 
          u.full_name || '', 
          u.email || '', 
          u.role || 'attendee',
          u.is_blocked ? 'Yes' : 'No',
          new Date(u.created_at).toLocaleDateString()
        ]));
        downloadCSV(rows, `users_${Date.now()}.csv`);
      };
    }

    setSafeHTML(tbody, data.map((u, i) => {
      const joined = new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const roleStyleMap = {
        super_admin: { badge: 'admin-role', label: 'Super Admin', extra: 'background:rgba(124,58,237,.12);color:#7c3aed' },
        admin: { badge: 'admin-role', label: 'Admin', extra: '' },
        moderator: { badge: 'organizer-role', label: 'Moderator', extra: 'background:rgba(8,145,178,.12);color:#0891b2' },
        organizer: { badge: 'organizer-role', label: 'Organizer', extra: '' },
        attendee: { badge: 'attendee-role', label: 'Attendee', extra: '' },
      };
      const rs = roleStyleMap[u.role] || roleStyleMap.attendee;
      const isBlocked = u.is_blocked === true;
      const blockedBadge = isBlocked ? ' <span class="ev-badge rejected" style="font-size:.65rem;margin-left:4px">BLOCKED</span>' : '';
      
      const getLevel = (r) => {
        if (r === 'super_admin') return 3;
        if (r === 'admin') return 2;
        if (r === 'moderator') return 1;
        return 0;
      };

      const myLevel = getLevel(adminRole);
      const targetLevel = getLevel(u.role);
      const canManage = myLevel > targetLevel;

      return `<tr${isBlocked ? ' style="opacity:.6"' : ''}>
        <td style="font-weight:600;color:var(--ev-text-muted)">${i + 1}</td>
        <td style="font-weight:600;color:var(--ev-text)">${escapeHTML(u.full_name || '—')}${blockedBadge}</td>
        <td>${escapeHTML(u.email || '—')}</td>
        <td><span class="ev-badge ${rs.badge}"${rs.extra ? ` style="${rs.extra}"` : ''}>${rs.label}</span></td>
        <td>${joined}</td>
        <td>
          ${canManage ? `<div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="ev-btn ev-btn-outline ev-btn-sm" data-set-role="${u.id}" data-current="${u.role}" data-name="${escapeHTML(u.full_name || u.email || '')}">Change Role</button>
            ${isBlocked 
              ? `<button class="ev-btn ev-btn-sm ev-btn-pink" data-unblock="${u.id}" data-name="${escapeHTML(u.full_name || u.email || '')}">Unblock</button>` 
              : `<button class="ev-btn ev-btn-sm ev-btn-danger" data-block="${u.id}" data-name="${escapeHTML(u.full_name || u.email || '')}">Block</button>`
            }
          </div>` : '<span style="color:var(--ev-text-muted);font-size:.75rem">\u2014</span>'}
        </td>
      </tr>`;
    }).join(''));

    tbody.querySelectorAll('[data-set-role]').forEach(btn => {
      btn.addEventListener('click', () => handleRoleChange(btn.dataset.setRole, btn.dataset.current, btn.dataset.name, adminRole, onRefresh));
    });
    tbody.querySelectorAll('[data-block]').forEach(btn => {
      btn.addEventListener('click', () => handleBlockUser(btn.dataset.block, btn.dataset.name, onRefresh));
    });
    tbody.querySelectorAll('[data-unblock]').forEach(btn => {
      btn.addEventListener('click', () => handleUnblockUser(btn.dataset.unblock, btn.dataset.name, onRefresh));
    });
  } catch (err) {
    console.error('loadAllUsers error:', err);
    setSafeHTML(tbody, `<tr><td colspan="6" class="ev-table-empty" style="color:var(--ev-danger)">Error: ${escapeHTML(err.message)}</td></tr>`);
  }
}

export function handleRoleChange(userId, currentRole, name, adminRole, onRefresh) {
  const existing = document.getElementById('admin-role-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ev-modal-overlay active';
  overlay.id = 'admin-role-modal';
  overlay.style.zIndex = '999999';

  const getLevel = (r) => {
    if (r === 'super_admin') return 3;
    if (r === 'admin') return 2;
    if (r === 'moderator') return 1;
    return 0;
  };
  const myLevel = getLevel(adminRole);

  const modalHTML = `
    <div class="ev-modal" style="max-width: 400px;">
      <div class="ev-modal-header">
        <h2>Change Role</h2>
        <button class="ev-modal-close" id="role-modal-close">✕</button>
      </div>
      <p style="font-size: .9rem; color: var(--ev-text-muted); margin-bottom: 20px;">
        Select a new role for <strong>${escapeHTML(name)}</strong>.
      </p>
      <div class="ev-form-group">
        <label class="ev-form-label">User Role</label>
        <select id="role-modal-select" class="ev-form-input">
          <option value="attendee" ${currentRole === 'attendee' ? 'selected' : ''}>Attendee</option>
          <option value="organizer" ${currentRole === 'organizer' ? 'selected' : ''}>Organizer</option>
          ${myLevel >= 1 ? `<option value="moderator" ${currentRole === 'moderator' ? 'selected' : ''}>Moderator</option>` : ''}
          ${myLevel >= 3 ? `<option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Admin</option>` : ''}
          ${myLevel >= 3 ? `<option value="super_admin" ${currentRole === 'super_admin' ? 'selected' : ''}>Super Admin</option>` : ''}
        </select>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:24px;">
        <button class="ev-btn ev-btn-outline" id="role-modal-cancel">Cancel</button>
        <button class="ev-btn" id="role-modal-save">Save Changes</button>
      </div>
    </div>
  `;
  
  setSafeHTML(overlay, modalHTML);
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('role-modal-close');
  const cancelBtn = document.getElementById('role-modal-cancel');
  const saveBtn = document.getElementById('role-modal-save');
  const selectEl = document.getElementById('role-modal-select');

  const closeModal = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  saveBtn.addEventListener('click', async () => {
    const newRole = selectEl.value;
    if (newRole === currentRole) { closeModal(); return; }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="ev-spinner" style="width:16px;height:16px;border-width:2px;display:inline-block"></span>';

    try {
      const { error } = await supabase.rpc('admin_set_user_role', { p_target_user_id: userId, p_new_role: newRole });
      if (error) throw error;
      showToast(`${name} is now ${newRole}`, 'success');
      onRefresh();
      closeModal();
    } catch (err) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
      showToast('Role change failed: ' + err.message, 'error');
    }
  });
}

export async function handleBlockUser(userId, name, onRefresh) {
  const reason = await showPromptModal({
    title: '🚫 Block User',
    message: `Block <strong>${escapeHTML(name)}</strong> from the entire platform? They will be immediately signed out and unable to log in.\n\nProvide a reason:`,
    placeholder: 'Reason for blocking (e.g. Terms of Service violation)...',
    confirmText: 'Block User',
    confirmColor: '#dc2626'
  });
  if (!reason || !reason.trim()) return;

  try {
    const { error } = await supabase.rpc('admin_block_user', { p_target_user_id: userId, p_reason: reason.trim() });
    if (error) throw error;
    showToast(`${name} has been blocked from the platform.`, 'success');
    onRefresh();
  } catch (err) {
    showToast('Block failed: ' + err.message, 'error');
  }
}

export async function handleUnblockUser(userId, name, onRefresh) {
  const confirmed = await showConfirmModal({
    title: '✅ Unblock User',
    message: `Unblock <strong>${escapeHTML(name)}</strong>? They will be able to log in and use the platform again.`,
    confirmText: 'Unblock User',
    confirmColor: '#10b981'
  });
  if (!confirmed) return;

  try {
    const { error } = await supabase.rpc('admin_unblock_user', { p_target_user_id: userId });
    if (error) throw error;
    showToast(`${name} has been unblocked.`, 'success');
    onRefresh();
  } catch (err) {
    showToast('Unblock failed: ' + err.message, 'error');
  }
}
