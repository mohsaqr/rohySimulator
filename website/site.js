// Rohy public website — shared behaviour for every page.
// Smooth in-page scrolling, reveal-on-scroll, and the screenshot lightbox.

// Smooth scroll for in-page anchors.
document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', (e) => {
        const id = a.getAttribute('href').slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            history.replaceState(null, '', '#' + id);
        }
    });
});

// Reveal on scroll.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('in');
                io.unobserve(entry.target);
            }
        }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
    document.querySelectorAll('.reveal').forEach(el => io.observe(el));
} else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
}

// Lightbox — click any screenshot to view it full-screen. Backdrop, close
// button and Escape all dismiss. Each shot takes focus so Enter and Space
// open it like a button.
(function setupLightbox() {
    const lb = document.getElementById('lightbox');
    if (!lb) return;
    const lbImg = document.getElementById('lightbox-img');
    const lbClose = document.getElementById('lightbox-close');
    let lastFocus = null;

    function open(src, alt) {
        lastFocus = document.activeElement;
        lbImg.src = src;
        lbImg.alt = alt || '';
        lb.hidden = false;
        void lb.offsetWidth; // reflow so the fade-in keyframe runs
        lb.classList.add('open');
        document.body.classList.add('no-scroll');
        lbClose.focus();
    }
    function close() {
        lb.classList.remove('open');
        lb.hidden = true;
        document.body.classList.remove('no-scroll');
        lbImg.removeAttribute('src');
        if (lastFocus && typeof lastFocus.focus === 'function') {
            lastFocus.focus();
            lastFocus = null;
        }
    }

    document.querySelectorAll('.pillar-shot img, .hero-shot img, .shot img').forEach(img => {
        img.setAttribute('role', 'button');
        img.setAttribute('tabindex', '0');
        img.setAttribute('aria-haspopup', 'dialog');
        img.addEventListener('click', () => open(img.currentSrc || img.src, img.alt));
        img.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open(img.currentSrc || img.src, img.alt);
            }
        });
    });

    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
    lbImg.addEventListener('click', (e) => e.stopPropagation());
    lbClose.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
        if (!lb.hidden && e.key === 'Escape') close();
    });
})();
