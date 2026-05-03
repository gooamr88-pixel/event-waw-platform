/* ===================================
   EVENT WAW - Shared UI Utilities
   ===================================
   Single source of truth for theme,
   nav, mobile menu, and particles.
   =================================== */

import { setSafeHTML } from './dom.js';

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

/* ==================================
   THEME ENGINE
   ==================================
   Priority:
   1. localStorage (user's manual choice)
   2. OS prefers-color-scheme (auto-detect)
   3. Fallback: 'dark'
   ================================== */

const THEME_KEY = 'theme';
const ATTR = 'data-theme';
const LIGHT = 'light';
const DARK = 'dark';

/**
 * Resolve the initial theme and apply it.
 * Also listens for OS preference changes when no manual choice is saved.
 */
export function initThemeFromStorage() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (matchDark() ? DARK : LIGHT);
  applyTheme(theme);

  // Live OS preference listener (only when user hasn't manually chosen)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(THEME_KEY)) {
      applyTheme(e.matches ? DARK : LIGHT);
    }
  });
}

/**
 * Bind click handlers on all theme toggle buttons.
 * Supports both desktop (.theme-toggle) and mobile (#theme-toggle).
 */
export function initThemeToggle() {
  document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute(ATTR) || DARK;
      const next = current === DARK ? LIGHT : DARK;
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next);
    });
  });
}

/**
 * Apply a theme to the document and update all toggle icons.
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute(ATTR, theme);
  // The CSS handles icon visibility via [data-theme] selectors.
  // No JS DOM manipulation needed for SVG icons.
}

/**
 * Check if the OS prefers dark mode.
 */
function matchDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * Get the current active theme.
 * @returns {'light'|'dark'}
 */
export function getCurrentTheme() {
  return document.documentElement.getAttribute(ATTR) || DARK;
}

/* -- Navbar Scroll -- */

export function initNavScroll() {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const check = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', check, { passive: true });
  check();
}

/* -- Mobile Menu -- */

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

/* -- Password Toggle -- */

export function initPasswordToggles() {
  document.querySelectorAll('.fi-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = btn.parentElement.querySelector('input');
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      setSafeHTML(btn, show
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>');
    });
  });
}

/* -- Particles -- */

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
