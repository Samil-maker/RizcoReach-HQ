// Elheen site behaviour. No dependencies.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Header: solid background after scrolling, current page, mobile menu.
  const header = $('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', scrollY > 12);
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });

  const current = document.body.dataset.nav;
  $$('[data-nav-link]').forEach((a) => {
    if (a.dataset.navLink === current) a.setAttribute('aria-current', 'page');
  });

  const menuBtn = $('.menu-btn');
  const menu = $('.mobile-menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      const open = menu.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  // Reveal on scroll, with a small stagger inside each group.
  const reveals = $$('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('seen'));
  } else {
    $$('[data-stagger]').forEach((group) => {
      $$('.reveal', group).forEach((el, i) => el.style.setProperty('--d', `${i * 90}ms`));
    });
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('seen'); io.unobserve(e.target); }
      }),
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' }
    );
    reveals.forEach((el) => io.observe(el));
  }

  // Hero headline: rotating word.
  const rot = $('.rotator');
  if (rot) {
    const words = $$('span', rot);
    let i = 0;
    const fit = () => { rot.style.width = `${words[i].offsetWidth}px`; };
    words[0].classList.add('on');
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(fit);
    addEventListener('resize', fit);
    if (!reduce && words.length > 1) {
      setInterval(() => {
        const prev = words[i];
        i = (i + 1) % words.length;
        prev.classList.remove('on');
        prev.classList.add('off');
        words[i].classList.remove('off');
        words[i].classList.add('on');
        fit();
        setTimeout(() => prev.classList.remove('off'), 750);
      }, 2400);
    }
  }

  // Hero stage: the calendar fills, a message arrives, a booking lands. Loops.
  const stage = $('.stage');
  if (stage) {
    const parts = $$('[data-at]', stage);
    const show = () => parts.forEach((el) => el.classList.add('in'));
    if (reduce) {
      show();
    } else {
      let timers = [];
      const play = () => {
        timers.forEach(clearTimeout);
        parts.forEach((el) => el.classList.remove('in'));
        timers = parts.map((el) => setTimeout(() => el.classList.add('in'), Number(el.dataset.at)));
        timers.push(setTimeout(play, 14000));
      };
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) { play(); io.disconnect(); }
      }, { threshold: 0.2 });
      io.observe(stage);

      // Gentle tilt toward the pointer on larger screens.
      const inner = $('.stage-inner', stage);
      if (inner && matchMedia('(hover:hover) and (min-width:900px)').matches) {
        stage.addEventListener('pointermove', (e) => {
          const r = stage.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          inner.style.transform = `rotateX(${(-y * 3).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg)`;
        });
        stage.addEventListener('pointerleave', () => { inner.style.transform = ''; });
      }
    }
  }

  // Live demo: pick a service and a time, confirm, see the WhatsApp message.
  const demo = $('[data-demo]');
  if (demo) {
    const state = { service: null, price: null, time: null };
    const confirmBtn = $('[data-confirm]', demo);
    const out = $('[data-wa]', demo);
    const pick = (group, btn) => {
      $$(`[data-${group}]`, demo).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    };
    $$('[data-service]', demo).forEach((b) => b.addEventListener('click', () => {
      state.service = b.dataset.service; state.price = b.dataset.price; pick('service', b); sync();
    }));
    $$('[data-time]', demo).forEach((b) => b.addEventListener('click', () => {
      state.time = b.dataset.time; pick('time', b); sync();
    }));
    const sync = () => { confirmBtn.disabled = !(state.service && state.time); };
    const bubble = (cls, text, delay) => {
      const d = document.createElement('div');
      d.className = `bub ${cls} pop`;
      d.style.animationDelay = `${delay}ms`;
      d.textContent = text;
      return d;
    };
    confirmBtn.addEventListener('click', () => {
      out.replaceChildren(
        bubble('us', `Booked. ${state.service}, tomorrow at ${state.time}.`, 0),
        bubble('us', `Total AED ${state.price}. We will remind you 2 hours before.`, 450),
        bubble('them', 'Perfect, thank you.', 1100),
        bubble('us', 'See you tomorrow.', 1700)
      );
      confirmBtn.textContent = 'Booked. Try another';
      $('[data-status]', demo).textContent = `Booking confirmed for ${state.service} at ${state.time}.`;
    });
  }
})();
