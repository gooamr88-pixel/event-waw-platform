/* ═══════════════════════════════════
   VIA — Main JavaScript (Roya Architecture)
   ═══════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavScroll();
  initMobileMenu();
  initParticles();
  initReveal();
  initCounters();
  initToggles();
  initFilters();
  initSlideshow();
});

/* ── Theme Toggle ── */
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);

  document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
      updateThemeIcon(next);
    });
  });
}

function updateThemeIcon(theme) {
  document.querySelectorAll('.theme-toggle, #theme-toggle').forEach(btn => {
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  });
}

/* ── Navbar Scroll ── */
function initNavScroll() {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const check = () => nav.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', check, { passive: true });
  check();
}

/* ── Mobile Menu ── */
function initMobileMenu() {
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

/* ── Particles ── */
function initParticles() {
  document.querySelectorAll('.particles').forEach(c => {
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const s = Math.random() * 2.5 + 1;
      p.style.cssText = `width:${s}px;height:${s}px;left:${Math.random()*100}%;bottom:-5%;animation-duration:${Math.random()*16+10}s;animation-delay:${Math.random()*12}s;`;
      c.appendChild(p);
    }
  });
}

/* ── Scroll Reveal ── */
function initReveal() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('ani-up');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('[data-reveal]').forEach(el => {
    el.style.opacity = '0';
    io.observe(el);
  });

  // Stagger children
  const sio = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        Array.from(e.target.children).forEach((ch, i) => {
          ch.style.opacity = '0';
          setTimeout(() => ch.classList.add('ani-up'), i * 120);
        });
        sio.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('[data-stagger]').forEach(el => sio.observe(el));
}

/* ── Stat Counters ── */
function initCounters() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('[data-count]').forEach(animCount);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.3 });

  document.querySelectorAll('.hero-stats').forEach(el => io.observe(el));
}

function animCount(el) {
  const target = +el.dataset.count;
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const duration = 2000;
  const start = performance.now();

  (function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 4); // easeOutQuart
    const value = Math.floor(eased * target);
    el.textContent = prefix + value.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  })(start);
}

/* ── Password Toggles ── */
function initToggles() {
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

/* ── Filter Buttons ── */
function initFilters() {
  document.addEventListener('click', e => {
    if (e.target.classList.contains('filter-btn')) {
      const group = e.target.closest('.filters');
      if (!group) return;
      group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    }
  });
}

/* ── Hero Slideshow ── */
function initSlideshow() {
  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;
  let current = 0;
  setInterval(() => {
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
}
