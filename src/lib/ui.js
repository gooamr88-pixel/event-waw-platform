/* ═══════════════════════════════════
   EVENT WAW — Shared UI Utilities
   ═══════════════════════════════════
   Single source of truth for theme,
   nav, mobile menu, and particles.
   ═══════════════════════════════════ */

/**
 * Initialize all standard UI components.
 * Call this from DOMContentLoaded in every page.
 */
export function initUI() {
  initThemeFromStorage();
  initThemeToggle();
  initNavScroll();
  initMobileMenu();
}

/* ── Theme ── */

export function initThemeFromStorage() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcons(saved);
}

export function initThemeToggle() {
  document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateThemeIcons(next);
    });
  });
}

function updateThemeIcons(theme) {
  const icon = theme === 'dark' ? '☀️' : '🌙';
  const label = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(btn => {
    if (btn.classList.contains('mobile-theme-toggle')) {
      btn.textContent = `${icon} ${label}`;
    } else {
      btn.textContent = icon;
    }
  });
}

/* ── Navbar Scroll ── */

export function initNavScroll() {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const check = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', check, { passive: true });
  check();
}

/* ── Mobile Menu ── */

export function initMobileMenu() {
  const toggle = document.getElementById('nav-toggle');
  const menu = document.getElementById('mobile-menu');
  const close = document.getElementById('mobile-close');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => menu.classList.add('active'));
  if (close) close.addEventListener('click', () => menu.classList.remove('active'));
  menu.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => menu.classList.remove('active'));
  });
}

/* ── Password Toggle ── */

export function initPasswordToggles() {
  document.querySelectorAll('.fi-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.parentElement.querySelector('input');
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    });
  });
}

/* ── Particles ── */

export function initParticles() {
  document.querySelectorAll('.particles').forEach(c => {
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const s = Math.random() * 2.5 + 1;
      p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random() * 100}%;bottom:-5%;animation-duration:${Math.random() * 16 + 10}s;animation-delay:${Math.random() * 12}s;`;
      c.appendChild(p);
    }
  });
}
