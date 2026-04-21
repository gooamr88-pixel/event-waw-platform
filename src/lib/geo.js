/* ═══════════════════════════════════
   EVENT WAW — Geolocation & Proximity Module
   ═══════════════════════════════════
   IP-based geolocation (no browser permission needed).
   Uses ipapi.co free API for real IP detection.
   Includes Haversine distance calculation for client-side sorting.
   ═══════════════════════════════════ */

const GEO_CACHE_KEY = 'ewaw_geo_v1';
const GEO_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Detect user location from their real IP address.
 * Uses ipapi.co (free, no API key, CORS-enabled).
 * Falls back to Cloudflare's trace endpoint.
 * Caches results in sessionStorage for performance.
 *
 * @returns {Promise<{ lat: number, lng: number, city: string, region: string, country: string } | null>}
 */
export async function detectUserLocation() {
  // 1. Check cache first
  try {
    const cached = sessionStorage.getItem(GEO_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed._ts < GEO_CACHE_TTL) {
        return parsed;
      }
    }
  } catch (_) { /* ignore storage errors */ }

  // 2. Try ipapi.co (most reliable for Vanilla JS)
  try {
    const resp = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.latitude && data.longitude) {
        const result = {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || '',
          region: data.region || '',
          country: data.country_name || '',
          ip: data.ip || '',
          _ts: Date.now(),
        };
        try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(result)); } catch (_) {}
        return result;
      }
    }
  } catch (e) {
    console.warn('[Geo] ipapi.co failed:', e.message);
  }

  // 3. Fallback: Cloudflare trace → parse text for lat/lon
  //    (Only gives country/colo, not lat/lon — use as last resort with country-level coords)
  try {
    const resp = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(4000),
    });
    if (resp.ok) {
      const text = await resp.text();
      const lines = Object.fromEntries(
        text.trim().split('\n').map(l => l.split('='))
      );
      // Cloudflare trace doesn't give lat/lng directly,
      // but we know the user's country. Use a rough center.
      if (lines.loc) {
        const coords = getCountryCenterCoords(lines.loc);
        if (coords) {
          const result = {
            lat: coords.lat,
            lng: coords.lng,
            city: lines.colo || '',
            region: '',
            country: lines.loc || '',
            ip: lines.ip || '',
            _ts: Date.now(),
            _approximate: true,
          };
          try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(result)); } catch (_) {}
          return result;
        }
      }
    }
  } catch (e) {
    console.warn('[Geo] CF trace failed:', e.message);
  }

  return null;
}

/**
 * Haversine distance between two points in kilometers.
 * Used for client-side proximity sorting.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in km
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Format distance for display.
 * @param {number} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (km == null || isNaN(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Sort events array by proximity to a reference point.
 * Events without coordinates are pushed to the end.
 *
 * @param {Array} events
 * @param {number} userLat
 * @param {number} userLng
 * @returns {Array} Sorted events with `_distance` property injected
 */
export function sortByProximity(events, userLat, userLng) {
  return events.map(ev => {
    if (ev.latitude != null && ev.longitude != null) {
      ev._distance = haversineKm(userLat, userLng, ev.latitude, ev.longitude);
    } else {
      ev._distance = Infinity;
    }
    return ev;
  }).sort((a, b) => a._distance - b._distance);
}

/**
 * Rough center coordinates for common countries (fallback).
 */
function getCountryCenterCoords(countryCode) {
  const map = {
    EG: { lat: 30.04, lng: 31.24 },   // Cairo
    SA: { lat: 24.71, lng: 46.67 },   // Riyadh
    AE: { lat: 25.20, lng: 55.27 },   // Dubai
    US: { lat: 39.83, lng: -98.58 },  // Center US
    GB: { lat: 51.51, lng: -0.13 },   // London
    DE: { lat: 52.52, lng: 13.40 },   // Berlin
    FR: { lat: 48.86, lng: 2.35 },    // Paris
    TR: { lat: 41.01, lng: 28.98 },   // Istanbul
    IN: { lat: 28.61, lng: 77.21 },   // New Delhi
    JP: { lat: 35.68, lng: 139.69 },  // Tokyo
    BR: { lat: -15.79, lng: -47.88 }, // Brasilia
    KW: { lat: 29.38, lng: 47.99 },   // Kuwait City
    QA: { lat: 25.29, lng: 51.53 },   // Doha
    BH: { lat: 26.23, lng: 50.59 },   // Manama
    OM: { lat: 23.59, lng: 58.39 },   // Muscat
    JO: { lat: 31.96, lng: 35.95 },   // Amman
    LB: { lat: 33.89, lng: 35.50 },   // Beirut
    MA: { lat: 33.97, lng: -6.85 },   // Rabat
    TN: { lat: 36.81, lng: 10.17 },   // Tunis
    DZ: { lat: 36.75, lng: 3.06 },    // Algiers
    NG: { lat: 9.06, lng: 7.49 },     // Abuja
    ZA: { lat: -33.93, lng: 18.42 },  // Cape Town
    AU: { lat: -33.87, lng: 151.21 }, // Sydney
    CA: { lat: 45.42, lng: -75.69 },  // Ottawa
    MX: { lat: 19.43, lng: -99.13 },  // Mexico City
  };
  return map[countryCode] || null;
}
