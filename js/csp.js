/**
 * ===================================
 * EVENT WAW - Content Security Policy
 * ===================================
 * 
 * This script injects a CSP meta tag into all pages.
 * Import this FIRST in every page, before any other scripts.
 * 
 * NOTE: This is a defense-in-depth measure. For full protection,
 * also configure CSP headers on your Nginx server or Cloudflare.
 * 
 * Usage: <script src="js/csp.js"></script>  (before </head>)
 */

(function() {
  // Only inject if not already present
  if (document.querySelector('meta[http-equiv="Content-Security-Policy"]')) return;

  const supabaseUrl = 'https://bmtwdwoibvoewbesohpu.supabase.co';

  const policy = [
    // Default: restrict to same origin
    "default-src 'self'",
    
    // Scripts: self + inline + Stripe + Cloudflare analytics + esm.sh CDN + Google Maps
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://static.cloudflareinsights.com https://esm.sh https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.google.com https://maps.googleusercontent.com https://maps.gstatic.com",
    
    // Styles: self + inline (needed for our inline <style> blocks) + Google
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.gstatic.com",
    
    // Fonts from Google Fonts
    "font-src 'self' https://fonts.gstatic.com",
    
    // Images: self + supabase storage + data URIs (for QR codes) + Google Maps
    `img-src 'self' ${supabaseUrl} data: blob: https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://lh3.googleusercontent.com https://streetviewpixels-pa.googleapis.com`,
    
    // Connect: API calls to Supabase + Stripe + Brevo + Cloudflare + esm.sh + Google Maps
    `connect-src 'self' ${supabaseUrl} wss://*.supabase.co https://api.stripe.com https://api.brevo.com https://cloudflareinsights.com https://esm.sh https://*.tile.openstreetmap.org https://ipapi.co https://www.cloudflare.com https://maps.googleapis.com https://places.googleapis.com`,
    
    // Frames: Stripe Checkout + Google Maps
    "frame-src https://js.stripe.com https://hooks.stripe.com https://maps.google.com https://www.google.com",
    
    // Media: camera for QR scanner
    "media-src 'self' blob:",
    
    // Workers for Google Maps
    "worker-src 'self' blob:",
    
    // Base URI restriction
    "base-uri 'self'",
    
    // Form action restriction
    "form-action 'self'",
  ].join('; ');

  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = policy;
  document.head.prepend(meta);
})();
