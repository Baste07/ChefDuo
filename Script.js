document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    document.body.classList.add('splash-active');

    window.setTimeout(() => {
      splash.classList.add('splash-hide');

      const finishSplash = () => {
        splash.remove();
        document.body.classList.remove('splash-active');
      };

      splash.addEventListener('transitionend', finishSplash, { once: true });
      window.setTimeout(finishSplash, 950);
    }, 1000);
  }

  const navToggle = document.getElementById('navToggle');
  const mainNav = document.getElementById('mainNav');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    mainNav.querySelectorAll('.nav-link').forEach((link) => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  const initCarousel = ({ trackId, dotsId, viewportSelector, dotClass, autoplayMs, autoplay }) => {
    const track = document.getElementById(trackId);
    const dotsWrap = document.getElementById(dotsId);
    const viewport = document.querySelector(viewportSelector);

    if (!track || !dotsWrap || !viewport) return;

    const slides = Array.from(track.children);
    if (!slides.length) return;

    let current = 0;
    let autoplayTimer = null;
    let startX = 0;
    let deltaX = 0;
    let isDragging = false;

    slides.forEach((_, index) => {
      const dot = document.createElement('button');
      dot.className = dotClass;
      dot.type = 'button';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Show item ${index + 1}`);
      dot.addEventListener('click', () => {
        goTo(index);
        restartAutoplay();
      });
      dotsWrap.appendChild(dot);
    });

    const dots = Array.from(dotsWrap.children);

    const updateDots = () => {
      dots.forEach((dot, index) => dot.classList.toggle('active', index === current));
    };

    const goTo = (index) => {
      current = (index + slides.length) % slides.length;
      track.style.transform = `translateX(-${current * 100}%)`;
      updateDots();
    };

    const next = () => goTo(current + 1);

    const startAutoplay = () => {
      if (!autoplay) return;
      autoplayTimer = window.setInterval(next, autoplayMs);
    };

    const stopAutoplay = () => {
      window.clearInterval(autoplayTimer);
    };

    const restartAutoplay = () => {
      stopAutoplay();
      startAutoplay();
    };

    const dragStart = (x) => {
      isDragging = true;
      startX = x;
      deltaX = 0;
      stopAutoplay();
      track.style.transition = 'none';
    };

    const dragMove = (x) => {
      if (!isDragging) return;
      deltaX = x - startX;
      track.style.transform = `translateX(calc(-${current * 100}% + ${deltaX}px))`;
    };

    const dragEnd = () => {
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
    };

    viewport.addEventListener('touchstart', (event) => dragStart(event.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchmove', (event) => dragMove(event.touches[0].clientX), { passive: true });
    viewport.addEventListener('touchend', dragEnd);
    viewport.addEventListener('mousedown', (event) => {
      event.preventDefault();
      dragStart(event.clientX);
    });
    window.addEventListener('mousemove', (event) => dragMove(event.clientX));
    window.addEventListener('mouseup', dragEnd);

    updateDots();
    startAutoplay();
  };

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

  const sidebarLinks = document.querySelectorAll('.sidebar-link');
  const productCards = document.querySelectorAll('.product-card');
  const fullMenuSection = document.getElementById('full-menu');

  if (sidebarLinks.length && productCards.length) {
    const applyFilter = (filter, { scroll = false } = {}) => {
      sidebarLinks.forEach((link) => {
        link.classList.toggle('active', link.dataset.filter === filter);
      });

      productCards.forEach((card) => {
        const matches = filter === 'all' || card.dataset.category === filter;
        card.style.display = matches ? '' : 'none';
      });

      if (scroll && fullMenuSection) {
        fullMenuSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    sidebarLinks.forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        applyFilter(link.dataset.filter, { scroll: true });
      });
    });

    const params = new URLSearchParams(window.location.search);
    const urlFilter = params.get('filter');
    if (urlFilter) applyFilter(urlFilter);
  }

  const reviewsViewport = document.querySelector('.reviews-viewport');
  const reviewsTrack = document.getElementById('reviewsTrack');
  const reviewPrev = document.getElementById('reviewPrev');
  const reviewNext = document.getElementById('reviewNext');

  if (reviewsViewport && reviewsTrack && reviewPrev && reviewNext) {
    const getReviewScrollAmount = () => {
      const card = reviewsTrack.querySelector('.review-card');
      if (!card) return 0;
      const gap = Number.parseFloat(getComputedStyle(reviewsTrack).columnGap) || 0;
      return card.getBoundingClientRect().width + gap;
    };

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
    reviewForm.addEventListener('submit', (event) => {
      event.preventDefault();
      formFeedback.textContent = 'Thank you! Your review has been submitted.';
      formFeedback.classList.add('success');
      reviewForm.reset();
    });
  }

  const happeningsViewport = document.querySelector('.happenings-viewport');
  const happeningsTrack = document.getElementById('happeningsTrack');
  const happeningsPrev = document.getElementById('happeningsPrev');
  const happeningsNext = document.getElementById('happeningsNext');

  if (happeningsViewport && happeningsTrack && happeningsPrev && happeningsNext) {
    const getHappeningScrollAmount = () => {
      const card = happeningsTrack.querySelector('.happening-card');
      if (!card) return 0;
      const gap = Number.parseFloat(getComputedStyle(happeningsTrack).columnGap) || 0;
      return card.getBoundingClientRect().width + gap;
    };

    happeningsPrev.addEventListener('click', () => {
      happeningsViewport.scrollBy({ left: -getHappeningScrollAmount(), behavior: 'smooth' });
    });

    happeningsNext.addEventListener('click', () => {
      happeningsViewport.scrollBy({ left: getHappeningScrollAmount(), behavior: 'smooth' });
    });
  }

  const footerPlaceholder = document.getElementById('footer-placeholder');
  if (footerPlaceholder) {
    fetch('footer.html')
      .then((response) => response.text())
      .then((data) => {
        footerPlaceholder.innerHTML = data;
      })
      .catch(() => {
        footerPlaceholder.innerHTML = '';
      });
  }

  (() => {
    const imageModal = document.getElementById('imageModal');
    const imageModalImg = document.getElementById('imageModalImg');
    const imageModalClose = document.getElementById('imageModalClose');
    const lightboxTriggers = document.querySelectorAll('.product-card, .menu-slide-media');

    if (!imageModal || !imageModalImg || !imageModalClose || !lightboxTriggers.length) return;

    let lastFocused = null;

    const openImageModal = (img) => {
      if (!img || !img.src) return;
      lastFocused = document.activeElement;
      imageModalImg.src = img.src;
      imageModalImg.alt = img.alt || '';
      imageModal.classList.add('open');
      imageModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      imageModalClose.focus();
    };

    const closeImageModal = () => {
      imageModal.classList.remove('open');
      imageModal.setAttribute('aria-hidden', 'true');
      imageModalImg.src = '';
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    };

    lightboxTriggers.forEach((trigger) => {
      const img = trigger.querySelector('img');
      if (!img) return;

      trigger.addEventListener('click', (event) => {
        if (event.target.closest('a, button')) return;
        openImageModal(img);
      });

      trigger.setAttribute('tabindex', '0');
      trigger.setAttribute('role', 'button');
      trigger.setAttribute('aria-label', `View full image: ${img.alt || 'photo'}`);
      trigger.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImageModal(img);
        }
      });
    });

    imageModalClose.addEventListener('click', closeImageModal);
    imageModal.addEventListener('click', (event) => {
      if (event.target === imageModal) closeImageModal();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && imageModal.classList.contains('open')) closeImageModal();
    });
  })();

  const status = document.getElementById('hoursStatus');
  if (status) {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const day = now.getDay();
    const hour = now.getHours();
    const isOpenDay = (value) => value >= 1 && value <= 6;
    const isOpen = (hour >= 15 && isOpenDay(day)) || (hour < 3 && isOpenDay((day + 6) % 7));

    status.textContent = isOpen ? 'Open now' : 'Closed now';
    status.className = `hours-status ${isOpen ? 'open' : 'closed'}`;

    const today = document.querySelector(`.hours-day[data-d="${day}"]`);
    if (today && isOpenDay(day)) today.classList.add('today');
  }

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});