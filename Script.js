document.addEventListener('DOMContentLoaded', () => {

  /* ---- Splash / intro screen ---- */
  const splash = document.getElementById('splashScreen');
  if (splash) {
    document.body.classList.add('splash-active');

    setTimeout(() => {
      splash.classList.add('splash-hide');

      const finishSplash = () => {
        splash.remove();
        document.body.classList.remove('splash-active');
      };

      splash.addEventListener('transitionend', finishSplash, { once: true });
      setTimeout(finishSplash, 950);
    }, 1000);
  }

  /* ---- Mobile nav toggle ---- */
  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', isOpen);
    });

    mainNav.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---- Highlight active nav link based on scroll position ---- */
  const sections = document.querySelectorAll('main section[id]');
  const navLinks = document.querySelectorAll('.nav-link');

const setActiveLink = (id) => {
  navLinks.forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      link.classList.toggle('active', href === `#${id}`);
    }
  });
};

  function initCarousel({ trackId, dotsId, viewportSelector, dotClass, autoplayMs, autoplay }) {
    const track = document.getElementById(trackId);
    const dotsWrap = document.getElementById(dotsId);
    const viewport = document.querySelector(viewportSelector);

    if (!track || !dotsWrap || !viewport) return;

    const slides = Array.from(track.children);
    const total = slides.length;
    if (!total) return;

    let current = 0;
    let autoplayTimer = null;

    slides.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = dotClass;
      dot.type = 'button';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Show item ${i + 1}`);
      dot.addEventListener('click', () => {
        goTo(i);
        restartAutoplay();
      });
      dotsWrap.appendChild(dot);
    });
    const dots = Array.from(dotsWrap.children);

    function updateDots() {
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }

    function goTo(index) {
      current = (index + total) % total;
      track.style.transform = `translateX(-${current * 100}%)`;
      updateDots();
    }

    function next() { goTo(current + 1); }

    function startAutoplay() {
      if (!autoplay) return;
      autoplayTimer = setInterval(next, autoplayMs);
    }

    function stopAutoplay() {
      clearInterval(autoplayTimer);
    }

    function restartAutoplay() {
      stopAutoplay();
      startAutoplay();
    }

    let startX = 0;
    let deltaX = 0;
    let isDragging = false;

    function dragStart(x) {
      isDragging = true;
      startX = x;
      deltaX = 0;
      stopAutoplay();
      track.style.transition = 'none';
    }

    function dragMove(x) {
      if (!isDragging) return;
      deltaX = x - startX;
      track.style.transform = `translateX(calc(-${current * 100}% + ${deltaX}px))`;
    }

    function dragEnd() {
      if (!isDragging) return;
      isDragging = false;
      track.style.transition = 'transform 0.5s ease';

      const threshold = viewport.offsetWidth * 0.15;
      if (deltaX < -threshold) {
        goTo(current + 1);
      } else if (deltaX > threshold) {
        goTo(current - 1);
      } else {
        goTo(current);
      }
      restartAutoplay();
    }

    viewport.addEventListener('touchstart', (e) => dragStart(e.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchmove', (e) => dragMove(e.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchend', dragEnd);

    viewport.addEventListener('mousedown', (e) => { e.preventDefault(); dragStart(e.clientX); });
    window.addEventListener('mousemove', (e) => dragMove(e.clientX));
    window.addEventListener('mouseup', dragEnd);

    updateDots();
    startAutoplay();
  }

  initCarousel({
    trackId: 'carouselTrack',
    dotsId: 'carouselDots',
    viewportSelector: '.carousel-viewport',
    dotClass: 'carousel-dot',
    autoplayMs: 3000,
    autoplay: true
  });

  initCarousel({
    trackId: 'menuTrack',
    dotsId: 'menuDots',
    viewportSelector: '.menu-viewport',
    dotClass: 'menu-dot',
    autoplayMs: 4000,
    autoplay: true
  });

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

});

  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  const productCards = document.querySelectorAll('.product-card');
  const fullMenuSection = document.getElementById('full-menu');

  if (sidebarLinks.length && productCards.length) {

    function applyFilter(filter, { scroll = false } = {}) {
      sidebarLinks.forEach(l => {
        l.classList.toggle('active', l.dataset.filter === filter);
      });

      productCards.forEach(card => {
        const matches = filter === 'all' || card.dataset.category === filter;
        card.style.display = matches ? '' : 'none';
      });

      if (scroll && fullMenuSection) {
        fullMenuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    sidebarLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        applyFilter(link.dataset.filter, { scroll: true });
      });
    });

    // Apply filter from URL on page load (e.g. menu2.html?filter=rice-meal)
    const params = new URLSearchParams(window.location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) {
      applyFilter(urlFilter);
    }
  }

  const reviewsViewport = document.querySelector('.reviews-viewport');
  const reviewsTrack = document.getElementById('reviewsTrack');
  const reviewPrev = document.getElementById('reviewPrev');
  const reviewNext = document.getElementById('reviewNext');

  if (reviewsViewport && reviewsTrack && reviewPrev && reviewNext) {
    function getReviewScrollAmount() {
      const card = reviewsTrack.querySelector('.review-card');
      if (!card) return 0;
      const gap = parseFloat(getComputedStyle(reviewsTrack).columnGap) || 0;
      return card.getBoundingClientRect().width + gap;
    }

    reviewPrev.addEventListener('click', () => {
      reviewsViewport.scrollBy({ left: -getReviewScrollAmount(), behavior: 'smooth' });
    });

    reviewNext.addEventListener('click', () => {
      reviewsViewport.scrollBy({ left: getReviewScrollAmount(), behavior: 'smooth' });
    });
  }
  const reviewForm = document.getElementById('reviewForm');
  const formFeedback = document.getElementById('formFeedback');

  if (reviewForm && formFeedback) {
    reviewForm.addEventListener('submit', (e) => {
      e.preventDefault();

      formFeedback.textContent = 'Thank you! Your review has been submitted.';
      formFeedback.classList.add('success');
      reviewForm.reset();
    });
  }

/* ---- Recent Happenings carousel (about.html) ---- */
const happeningsViewport = document.querySelector('.happenings-viewport');
const happeningsTrack = document.getElementById('happeningsTrack');
const happeningsPrev = document.getElementById('happeningsPrev');
const happeningsNext = document.getElementById('happeningsNext');

if (happeningsViewport && happeningsTrack && happeningsPrev && happeningsNext) {
  function getHappeningScrollAmount() {
    const card = happeningsTrack.querySelector('.happening-card');
    if (!card) return 0;
    const gap = parseFloat(getComputedStyle(happeningsTrack).columnGap) || 0;
    return card.getBoundingClientRect().width + gap;
  }

  happeningsPrev.addEventListener('click', () => {
    happeningsViewport.scrollBy({ left: -getHappeningScrollAmount(), behavior: 'smooth' });
  });

  happeningsNext.addEventListener('click', () => {
    happeningsViewport.scrollBy({ left: getHappeningScrollAmount(), behavior: 'smooth' });
  });
}

fetch('footer.html')
  .then(res => res.text())
  .then(data => document.getElementById('footer-placeholder').innerHTML = data);

/* ---- Image lightbox (product cards + featured menu images) ---- */
(function () {
  const imageModal = document.getElementById('imageModal');
  const imageModalImg = document.getElementById('imageModalImg');
  const imageModalClose = document.getElementById('imageModalClose');
  const lightboxTriggers = document.querySelectorAll('.product-card, .menu-slide-media');

  if (!imageModal || !imageModalImg || !imageModalClose || !lightboxTriggers.length) return;

  let lastFocused = null;

  function openImageModal(img) {
    if (!img || !img.src) return;
    lastFocused = document.activeElement;
    imageModalImg.src = img.src;
    imageModalImg.alt = img.alt || '';
    imageModal.classList.add('open');
    imageModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    imageModalClose.focus();
  }

  function closeImageModal() {
    imageModal.classList.remove('open');
    imageModal.setAttribute('aria-hidden', 'true');
    imageModalImg.src = '';
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  lightboxTriggers.forEach(trigger => {
    const img = trigger.querySelector('img');
    if (!img) return;

    trigger.addEventListener('click', (e) => {
      // Don't hijack clicks on links/buttons that may live inside the trigger
      if (e.target.closest('a, button')) return;
      openImageModal(img);
    });

    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', `View full image: ${img.alt || 'photo'}`);
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openImageModal(img);
      }
    });
  });

  imageModalClose.addEventListener('click', closeImageModal);

  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) closeImageModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal.classList.contains('open')) closeImageModal();
  });
})();