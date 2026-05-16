/* ===================================
   EVENTSLI — Gate Team Management
   Organizer can add/remove scanner staff
   =================================== */
import { supabase, getCurrentUser } from './supabase.js';
import { showToast } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';
import { escapeHTML } from './utils.js';

export function setupGateTeamPanel() {
  const addBtn = document.getElementById('gate-team-add-btn');
  const form = document.getElementById('gate-team-invite-form');
  const cancelBtn = document.getElementById('gate-invite-cancel');
  const submitBtn = document.getElementById('gate-invite-submit');

  addBtn?.addEventListener('click', () => {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    populateEventDropdown();
  });

  cancelBtn?.addEventListener('click', () => {
    form.style.display = 'none';
  });

  submitBtn?.addEventListener('click', async () => {
    const email = document.getElementById('gate-invite-email')?.value?.trim();
    const name = document.getElementById('gate-invite-name')?.value?.trim() || '';
    const eventId = document.getElementById('gate-invite-event')?.value || 'all';

    if (!email || !email.includes('@')) {
      showToast('Please enter a valid email address', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      const user = await getCurrentUser();

      // Store the scanner staff invitation in gate_team table
      const { error } = await supabase.from('gate_team').insert({
        organizer_id: user.id,
        staff_email: email.toLowerCase(),
        staff_name: name,
        event_id: eventId === 'all' ? null : eventId,
        status: 'invited',
      });

      if (error) {
        if (error.code === '23505') {
          showToast('This email is already on your gate team', 'error');
        } else {
          throw error;
        }
      } else {
        showToast(`Invited ${email} as scanner staff`, 'success');
        document.getElementById('gate-invite-email').value = '';
        document.getElementById('gate-invite-name').value = '';
        form.style.display = 'none';
        await loadGateTeam();
      }
    } catch (err) {
      showToast('Failed to invite: ' + err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Invite';
    }
  });

  // Initial load
  loadGateTeam();
}

async function populateEventDropdown() {
  const select = document.getElementById('gate-invite-event');
  if (!select || select.options.length > 1) return;

  try {
    const user = await getCurrentUser();
    const { data: events } = await supabase
      .from('events')
      .select('id, title')
      .eq('organizer_id', user.id)
      .in('status', ['published', 'draft'])
      .order('date', { ascending: false });

    if (events) {
      for (const ev of events) {
        const opt = document.createElement('option');
        opt.value = ev.id;
        opt.textContent = ev.title;
        select.appendChild(opt);
      }
    }
  } catch (err) {
    console.error('Failed to load events for gate team:', err);
  }
}

async function loadGateTeam() {
  const tbody = document.getElementById('gate-team-tbody');
  if (!tbody) return;

  try {
    const user = await getCurrentUser();
    const { data: staff, error } = await supabase
      .from('gate_team')
      .select('id, staff_email, staff_name, event_id, status, created_at')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!staff || staff.length === 0) {
      setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty">
        <div style="font-size:2.5rem;margin-bottom:12px">👥</div>
        <p style="font-weight:600;margin-bottom:4px">No gate staff yet</p>
        <p style="font-size:.84rem">Add your first scanner staff member to manage check-ins at your events.</p>
      </td></tr>`);
      return;
    }

    // Fetch event titles for display
    const eventIds = [...new Set(staff.map(s => s.event_id).filter(Boolean))];
    let eventMap = {};
    if (eventIds.length) {
      const { data: events } = await supabase.from('events').select('id, title').in('id', eventIds);
      if (events) events.forEach(e => { eventMap[e.id] = e.title; });
    }

    const html = staff.map((s, i) => {
      const statusClass = s.status === 'active' ? 'accepted' : (s.status === 'invited' ? 'pending' : 'rejected');
      const statusLabel = s.status === 'active' ? '✓ Active' : (s.status === 'invited' ? '⏳ Invited' : '✗ Removed');
      const eventName = s.event_id ? (eventMap[s.event_id] || 'Unknown') : 'All Events';

      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${escapeHTML(s.staff_name || '—')}</td>
        <td>${escapeHTML(s.staff_email)}</td>
        <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(eventName)}</td>
        <td><span class="ev-badge ${statusClass}">${statusLabel}</span></td>
        <td style="font-size:.8rem;color:var(--ev-text-sec)">${new Date(s.created_at).toLocaleDateString()}</td>
        <td>
          <button class="ev-btn-icon gate-team-remove" data-id="${s.id}" title="Remove staff" style="color:var(--ev-danger)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');

    setSafeHTML(tbody, html);

    // Wire up remove buttons
    tbody.querySelectorAll('.gate-team-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this staff member from your gate team?')) return;
        const id = btn.dataset.id;
        btn.disabled = true;

        try {
          const { error } = await supabase.from('gate_team').delete().eq('id', id);
          if (error) throw error;
          showToast('Staff member removed', 'success');
          await loadGateTeam();
        } catch (err) {
          showToast('Failed to remove: ' + err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    setSafeHTML(tbody, `<tr><td colspan="7" class="ev-table-empty" style="color:var(--ev-danger)">${escapeHTML(err.message)}</td></tr>`);
  }
}
