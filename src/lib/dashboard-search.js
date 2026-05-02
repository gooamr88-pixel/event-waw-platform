import { escapeHTML } from './utils.js';
import { setSafeHTML } from './dom.js';

export function setupSearch() {
  document.getElementById('ev-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#events-tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

