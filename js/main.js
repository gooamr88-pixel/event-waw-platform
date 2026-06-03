/* ===================================
   EVENTSLI - Main JavaScript (Landing Page)
   ===================================
   This file is loaded via <script src> on index.html
   (non-module). It handles landing-page-specific features
   like scroll reveal, stat counters, hero slideshow, and filters.

   Theme, nav, mobile menu, and particles are handled by
   src/lib/ui.js which is imported as a module on each page.
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
  initReveal();
  initCounters();
  initFilters();
  initSlideshow();
});

/* -- Scroll Reveal -- */
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

/* -- Stat Counters -- */
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

/* -- Filter Buttons -- */
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

/* -- Hero Slideshow -- */
let _slideshowInterval = null; // H30 FIX: Track interval to prevent duplicates
function initSlideshow() {
  // H30 FIX: Clear any existing interval to prevent duplicate timers
  if (_slideshowInterval) clearInterval(_slideshowInterval);

  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length < 2) return;

  // H30 FIX: Don't start slideshow if the CMS hero has taken over the container
  const heroContainer = document.querySelector('.hero-img-container, .hero-section');
  if (heroContainer && heroContainer.dataset.cmsHero === 'true') return;

  let current = 0;
  _slideshowInterval = setInterval(() => {
    // Guard: if CMS replaced the slides mid-cycle, stop
    if (!document.querySelector('.hero-slide')) {
      clearInterval(_slideshowInterval);
      _slideshowInterval = null;
      return;
    }
    slides[current].classList.remove('active');
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
  }, 5000);
}
