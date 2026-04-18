/**
 * ═══════════════════════════════════
 * EVENT WAW — Content Security Policy
 * ═══════════════════════════════════
 * 
 * This script injects a CSP meta tag into all pages.
 * Import this FIRST in every page, before any other scripts.
 * 
 * NOTE: This is a defense-in-depth measure. For full protection,
 * also configure CSP headers on your hosting provider (Vercel/Netlify/Cloudflare).
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
    
    // Scripts: self + inline for Vite HMR (dev only) + module scripts
    "script-src 'self' 'unsafe-inline' https://js.stripe.com",
    
    // Styles: self + inline (needed for our inline <style> blocks)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    
    // Fonts from Google Fonts
    "font-src 'self' https://fonts.gstatic.com",
    
    // Images: self + supabase storage + data URIs (for QR codes)
    `img-src 'self' ${supabaseUrl} data: blob:`,
    
    // Connect: API calls to Supabase + Stripe + Brevo
    `connect-src 'self' ${supabaseUrl} wss://*.supabase.co https://api.stripe.com https://api.brevo.com`,
    
    // Frames: Stripe Checkout
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    
    // Media: camera for QR scanner
    "media-src 'self' blob:",
    
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
