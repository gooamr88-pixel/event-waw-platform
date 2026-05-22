/**
 * ===================================
 * EVENTSLI - Content Security Policy
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
    //
    // ⚠️  SECURITY WARNING (H-5): 'unsafe-inline' weakens XSS protection
    // ──────────────────────────────────────────────────────────────────
    // 'unsafe-inline' allows ANY inline <script> to execute. If an attacker
    // injects HTML (e.g., via a stored XSS in event descriptions), they can
    // execute arbitrary JavaScript despite CSP being enabled.
    //
    // WHY IT'S HERE: The codebase uses inline <script type="module"> tags in
    // every HTML page. Removing 'unsafe-inline' requires migrating ALL inline
    // scripts to external .js files — a substantial refactor (Phase 3).
    //
    // MITIGATION: All user-facing HTML uses escapeHTML() and setSafeHTML()
    // (see src/lib/dom.js, src/lib/utils.js) to prevent injection.
    //
    // TODO (Phase 3): Migrate inline scripts → external files, add nonce-based
    // CSP, remove 'unsafe-inline', then consider adding 'strict-dynamic'.
    // ──────────────────────────────────────────────────────────────────
    "script-src 'self' 'unsafe-inline' https://js.stripe.com https://static.cloudflareinsights.com https://esm.sh https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.google.com https://maps.googleusercontent.com https://maps.gstatic.com",
    
    // Styles: self + inline (needed for our inline <style> blocks) + Google
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://maps.googleapis.com https://maps.gstatic.com",
    
    // Fonts from Google Fonts
    "font-src 'self' https://fonts.gstatic.com",
    
    // Images: self + supabase storage + data URIs (for QR codes) + Google Maps
    `img-src 'self' ${supabaseUrl} data: blob: https://*.tile.openstreetmap.org https://maps.googleapis.com https://maps.gstatic.com https://*.ggpht.com https://lh3.googleusercontent.com https://streetviewpixels-pa.googleapis.com`,
    
    // Connect: API calls to Supabase + Stripe + Brevo + Cloudflare + esm.sh + Google Maps
    `connect-src 'self' ${supabaseUrl} wss://*.supabase.co https://api.stripe.com https://api.brevo.com https://cloudflareinsights.com https://esm.sh https://cdn.jsdelivr.net https://*.tile.openstreetmap.org https://ipapi.co https://www.cloudflare.com https://maps.googleapis.com https://places.googleapis.com`,
    
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

  // ═══════════════════════════════════
  // GLOBAL ERROR BOUNDARY (UX-01)
  // Catches uncaught exceptions and unhandled
  // promise rejections platform-wide.
  // ═══════════════════════════════════

  let _errorToastTimeout = null;

  function showErrorToast(msg) {
    // Throttle: max 1 toast every 3 seconds
    if (_errorToastTimeout) return;
    _errorToastTimeout = setTimeout(() => { _errorToastTimeout = null; }, 3000);

    // Don't show for navigation/redirect interruptions
    if (msg && (msg.includes('Script error') || msg.includes('ResizeObserver'))) return;

    const toast = document.createElement('div');
    toast.className = 'ev-error-toast';
    toast.textContent = 'Something went wrong. Please try again.';
    toast.setAttribute('role', 'alert');
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#1c1917', color: '#fca5a5', padding: '12px 24px',
      borderRadius: '12px', fontSize: '0.85rem', fontFamily: 'system-ui, sans-serif',
      border: '1px solid rgba(239,68,68,.25)', boxShadow: '0 8px 32px rgba(0,0,0,.4)',
      zIndex: '99999', opacity: '0', transition: 'opacity .3s ease',
      maxWidth: '90vw', textAlign: 'center',
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  window.onerror = function(message, source, lineno, colno, error) {
    console.error('[Global Error]', { message, source, lineno, colno, error });
    showErrorToast(typeof message === 'string' ? message : 'Unexpected error');
    return false; // Don't suppress — let browser console still show it
  };

  window.addEventListener('unhandledrejection', function(event) {
    const reason = event.reason;
    const msg = reason?.message || reason?.toString() || 'Async operation failed';
    console.error('[Unhandled Promise]', reason);
    // Don't toast for AbortError (intentional fetch cancellations)
    if (msg.includes('AbortError') || msg.includes('abort')) return;
    showErrorToast(msg);
  });

})();
