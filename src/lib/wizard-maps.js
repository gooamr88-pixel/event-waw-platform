/**
 * src/lib/wizard-maps.js
 * Domain: Google Places Autocomplete, Map Preview, Markers
 * Extracted from dashboard-modals.js (Operation Defuse)
 */
import { escapeHTML } from './utils.js';
import { showToast } from './dashboard-ui.js';
import { setSafeHTML } from './dom.js';

/* ── Shared state ── */
let googleAutocompleteInitialized = false;
let googleMapInstance = null;
let googleMapMarker = null;

/** Country code -> timezone mapping for common countries */
const COUNTRY_TIMEZONE_MAP = {
  EG: 'Africa/Cairo', SA: 'Asia/Riyadh', AE: 'Asia/Dubai', US: 'America/New_York',
  CA: 'America/Toronto', GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris',
  TR: 'Europe/Istanbul', JO: 'Asia/Amman', LB: 'Asia/Beirut', KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis', JP: 'Asia/Tokyo',
};

/** ISO country -> select option mapping */
const ISO_TO_SELECT = {
  EG: 'EG', SA: 'SA', AE: 'AE', US: 'US', CA: 'CA', GB: 'GB', DE: 'DE', FR: 'FR',
  TR: 'TR', JO: 'JO', LB: 'LB', KW: 'KW', QA: 'QA', BH: 'BH', OM: 'OM', MA: 'MA', TN: 'TN',
};

/** Country code -> default currency */
const COUNTRY_CURRENCY_MAP = {
  EG: 'EGP', SA: 'SAR', AE: 'AED', US: 'USD', CA: 'CAD', GB: 'GBP', DE: 'EUR', FR: 'EUR',
};

/* ── State accessors ── */
export function isAutocompleteInitialized() { return googleAutocompleteInitialized; }

export function resetMapState() {
  googleMapInstance = null;
  googleMapMarker = null;
}

/**
 * Initialize Google Places Autocomplete (PlaceAutocompleteElement API).
 * @param {Object} deps - { getKeywords, setKeywords, renderKeywords }
 */
let googleMapsRetries = 0;
export async function initGooglePlacesAutocomplete(deps) {
  if (googleAutocompleteInitialized) return;

  // Guard: wait for Google Maps API to load
  if (typeof google === 'undefined' || !google.maps || !google.maps.importLibrary) {
    if (googleMapsRetries++ < 20) {
      setTimeout(() => initGooglePlacesAutocomplete(deps), 500);
    } else {
      console.warn('Google Maps API failed to load after 10 seconds.');
    }
    return;
  }

  try {
    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');

    const searchWrap = document.querySelector('.ce-google-search-wrap');
    if (!searchWrap) return;

    // Remove the old static input + decorations — PlaceAutocompleteElement owns the input
    const oldInput = document.getElementById('ce-google-search');
    if (oldInput) oldInput.remove();
    searchWrap.querySelector('.ce-google-search-icon')?.remove();
    searchWrap.querySelector('.ce-google-badge')?.remove();

    // Create modern PlaceAutocompleteElement
    const autocompleteEl = new PlaceAutocompleteElement({
      types: ['establishment', 'geocode'],
    });
    autocompleteEl.id = 'ce-google-search';
    autocompleteEl.setAttribute('placeholder', 'Search for a venue, address, or place...');
    searchWrap.appendChild(autocompleteEl);

    // Listen for gmp-select event (modern PlaceAutocompleteElement API)
    autocompleteEl.addEventListener('gmp-select', async ({ placePrediction }) => {
      let place;
      try {
        place = placePrediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location', 'addressComponents', 'websiteURI', 'types'],
        });
      } catch (fetchErr) {
        console.warn('fetchFields failed:', fetchErr);
        showToast('Could not load place details', 'error');
        return;
      }

      // ── Fill fields ──
      const setField = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
      const setSelect = (id, val) => {
        const el = document.getElementById(id);
        if (!el || !val) return;
        const opt = Array.from(el.options).find(o => o.value === val);
        if (opt) { el.value = val; el.dispatchEvent(new Event('change')); }
      };

      // Venue name (displayName can be a string or an object)
      let venueName = '';
      if (place.displayName) {
        venueName = typeof place.displayName === 'string' ? place.displayName : (place.displayName.text || String(place.displayName));
      }
      if (!venueName) {
        venueName = place.formattedAddress || '';
      }
      setField('ce-place', venueName);

      // Full address (new API: formattedAddress)
      const fullAddress = place.formattedAddress || '';
      if (fullAddress) setField('ce-address', fullAddress);

      // Parse address components (new API: longText / shortText)
      let city = '', countryCode = '';
      if (place.addressComponents) {
        for (const comp of place.addressComponents) {
          if (comp.types.includes('locality')) city = comp.longText;
          if (comp.types.includes('administrative_area_level_1') && !city) city = comp.longText;
          if (comp.types.includes('country')) {
            countryCode = comp.shortText;
          }
        }
      }

      if (city) setField('ce-city', city);

      const selectCode = ISO_TO_SELECT[countryCode] || 'OTHER';
      setSelect('ce-country', selectCode);

      // Latitude & Longitude (new API: place.location is a LatLng)
      if (place.location) {
        const lat = place.location.lat();
        const lng = place.location.lng();
        setField('ce-latitude', lat.toFixed(6));
        setField('ce-longitude', lng.toFixed(6));

        // ── Show Map Preview ──
        showGoogleMapPreview(lat, lng, venueName, fullAddress);
      }

      // Timezone
      const tz = COUNTRY_TIMEZONE_MAP[countryCode];
      if (tz) setSelect('ce-timezone', tz);

      // Currency
      const currency = COUNTRY_CURRENCY_MAP[countryCode];
      if (currency) setSelect('ce-currency', currency);

      // Website (new API: websiteURI)
      if (place.websiteURI) {
        const websiteField = document.getElementById('ce-website');
        if (websiteField && !websiteField.value) setField('ce-website', place.websiteURI);
      }

      // Add venue type as keyword
      if (place.types && place.types.length > 0 && deps) {
        const venueTypeKeywords = place.types
          .filter(t => !['point_of_interest', 'establishment', 'geocode', 'political'].includes(t))
          .map(t => t.replace(/_/g, ' '))
          .slice(0, 2);
        const keywords = deps.getKeywords();
        venueTypeKeywords.forEach(kw => {
          if (!keywords.includes(kw)) keywords.push(kw);
        });
        deps.setKeywords(keywords);
        deps.renderKeywords();
      }

      // Highlight filled fields
      ['ce-place', 'ce-address', 'ce-city', 'ce-country', 'ce-latitude', 'ce-longitude', 'ce-timezone', 'ce-currency'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value) {
          el.style.transition = 'box-shadow 0.3s ease, border-color 0.3s ease';
          el.style.boxShadow = '0 0 0 3px rgba(66, 133, 244, 0.25)';
          el.style.borderColor = '#4285F4';
          setTimeout(() => { el.style.boxShadow = ''; el.style.borderColor = ''; }, 2000);
        }
      });

      showToast(`Location filled: ${venueName || fullAddress}`, 'success');
    });

    googleAutocompleteInitialized = true;
    console.log('Google Places (PlaceAutocompleteElement) initialized');
  } catch (err) {
    console.warn('Google Places init failed:', err);
    googleAutocompleteInitialized = false;
  }
}

/**
 * Show an interactive Google Map preview with a custom marker.
 */
export async function showGoogleMapPreview(lat, lng, name, address) {
  const wrap = document.getElementById('ce-map-preview-wrap');
  const mapDiv = document.getElementById('ce-map-preview');
  const addressBar = document.getElementById('ce-map-address-bar');
  if (!wrap || !mapDiv) return;

  wrap.style.display = '';

  // Update address bar
  if (addressBar) {
    setSafeHTML(addressBar, `
      <div class="ce-map-address-info">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#4285F4" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div>
          <strong>${escapeHTML(name || 'Selected Location')}</strong>
          <span>${escapeHTML(address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`)}</span>
        </div>
      </div>
      <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener noreferrer" class="ce-map-open-btn" title="Get Directions">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Get Directions
      </a>`);
  }

  const location = { lat, lng };

  try {
    const { Map } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

    if (!googleMapInstance) {
      googleMapInstance = new Map(mapDiv, {
        zoom: 16,
        center: location,
        mapId: 'event_waw_map',
        disableDefaultUI: true,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        gestureHandling: 'cooperative',
      });
    } else {
      googleMapInstance.setCenter(location);
      googleMapInstance.setZoom(16);
    }

    // Custom marker
    if (googleMapMarker) googleMapMarker.map = null;
    
    const markerContent = document.createElement('div');
    setSafeHTML(markerContent, `
      <div style="
        display: flex; align-items: center; gap: 8px;
        background: linear-gradient(135deg, #1a1a2e, #16213e);
        color: #fff; padding: 10px 16px;
        border-radius: 24px; font-size: 13px; font-weight: 600;
        box-shadow: 0 6px 24px rgba(0,0,0,.35), 0 0 0 2px rgba(66,133,244,.5);
        white-space: nowrap;
        animation: markerBounce .5s ease;
      ">
        <span style="
          width:28px;height:28px;border-radius:50%;
          background:linear-gradient(135deg,#4285F4,#34A853);
          display:flex;align-items:center;justify-content:center;
          font-size:14px;flex-shrink:0;
        ">📍</span>
        <span>${escapeHTML((name || 'Location').substring(0, 30))}</span>
      </div>
      <div style="
        width:0;height:0;
        border-left:8px solid transparent;
        border-right:8px solid transparent;
        border-top:10px solid #1a1a2e;
        margin:-1px auto 0;
        filter:drop-shadow(0 2px 4px rgba(0,0,0,.3));
      "></div>
      <div style="
        width:10px;height:10px;
        background:#4285F4;border-radius:50%;
        margin:4px auto 0;
        box-shadow:0 0 0 4px rgba(66,133,244,.3), 0 0 0 8px rgba(66,133,244,.1);
        animation: markerPulse 2s ease-in-out infinite;
      "></div>
      <style>
        @keyframes markerBounce { 0%{transform:translateY(-20px);opacity:0} 100%{transform:translateY(0);opacity:1} }
        @keyframes markerPulse { 0%,100%{box-shadow:0 0 0 4px rgba(66,133,244,.3),0 0 0 8px rgba(66,133,244,.1)} 50%{box-shadow:0 0 0 6px rgba(66,133,244,.4),0 0 0 12px rgba(66,133,244,.15)} }
      </style>`);

    googleMapMarker = new AdvancedMarkerElement({
      map: googleMapInstance,
      position: location,
      content: markerContent,
      title: name || 'Event Location',
    });
  } catch (err) {
    // Fallback: use static map image
    // NOTE: Cannot use setSafeHTML here because the sanitizer strips <iframe> tags.
    // We construct the iframe safely with no user-controlled strings in dangerous positions.
    console.warn('Interactive map failed, using static fallback:', err);
    mapDiv.textContent = '';
    const iframe = document.createElement('iframe');
    iframe.width = '100%';
    iframe.height = '100%';
    iframe.style.cssText = 'border:0;border-radius:12px';
    iframe.src = `https://www.google.com/maps/embed/v1/place?key=AIzaSyDDM_2NLmIH3acVqZgKX6lD21YNh01a4K4&q=${lat},${lng}&zoom=16`;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('loading', 'lazy');
    mapDiv.appendChild(iframe);
  }
}
