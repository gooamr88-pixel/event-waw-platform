/* ===================================
   EVENT WAW — Dashboard Modals Facade
   =================================== */

// Re-export the extracted domain modules
export { showGoogleMapPreview, initGooglePlacesAutocomplete } from './wizard-maps.js';
export { setupCeUpload, handleCeFileUpload, uploadCoverImage, uploadEventFile } from './wizard-uploads.js';
export { renderCeTicketsTable } from './wizard-tickets.js';

// Re-export orchestrator functions
export { 
  setupCreateModal, 
  loadEventForEditing, 
  resetCreateEventForm, 
  showEditModal 
} from './modal-orchestrator.js';

export { updateCePreview } from './wizard-publishing.js';
export { renderGoogleKeywords } from './wizard-basic.js';
