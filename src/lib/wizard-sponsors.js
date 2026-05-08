/* ===================================
   EVENTSLI — Wizard Sponsors & Images
   =================================== */

import { handleCeFileUpload, setupCeUpload } from './wizard-uploads.js';
import { setSafeHTML } from './dom.js';

export let ceGalleryCount = 1;

export function setCeGalleryCount(count) {
  ceGalleryCount = count;
}

export function setupSponsorsTab() {
  // Image Uploads (Basic ones are setup here for convenience or in wizard-basic.js)
  setupCeUpload('ce-main-photo', 'ce-main-photo-area');
  setupCeUpload('ce-logo', 'ce-logo-area');
  setupCeUpload('ce-organizer-logo', 'ce-organizer-logo-area');

  // Gallery
  document.getElementById('ce-add-gallery')?.addEventListener('click', () => {
    ceGalleryCount++;
    const grid = document.getElementById('ce-gallery-grid');
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    setSafeHTML(item, `<label>Photo ${ceGalleryCount}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Photo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`);
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // Sponsors
  document.getElementById('ce-add-sponsor')?.addEventListener('click', () => {
    const grid = document.getElementById('ce-sponsors-grid');
    const count = grid.children.length + 1;
    const item = document.createElement('div');
    item.className = 'ce-gallery-item';
    setSafeHTML(item, `<label>Sponsor ${count}</label><div class="ce-upload-area ce-gallery-upload"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Upload Logo</span><small>Size (100 * 100)</small><input type="file" accept="image/jpeg,image/png" /></div>`);
    grid.appendChild(item);
    const fileInput = item.querySelector('input[type="file"]');
    const area = item.querySelector('.ce-upload-area');
    fileInput.addEventListener('change', (e) => handleCeFileUpload(e, area));
  });

  // Initial gallery upload listener
  const initialGalleryInput = document.querySelector('#ce-gallery-grid input[type="file"]');
  const initialGalleryArea = document.querySelector('#ce-gallery-grid .ce-upload-area');
  if (initialGalleryInput && initialGalleryArea) {
    initialGalleryInput.addEventListener('change', (e) => handleCeFileUpload(e, initialGalleryArea));
  }
}
