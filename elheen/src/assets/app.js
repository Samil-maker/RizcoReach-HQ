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

  // Live demo: choose a kind of business, a service and a time, then confirm.
  const demo = $('[data-demo]');
  if (demo) {
    const kinds = {
      salon: { name: 'Lumière Salon', place: 'Example business · Jumeirah Lakes Towers', step1: '1. Choose a service', step2: '2. Pick a time tomorrow', visit: false,
        items: [['Hair colour', '90 min · AED 450', 'AED 450'], ['Gel manicure', '45 min · AED 140', 'AED 140'], ['Signature facial', '60 min · AED 320', 'AED 320']] },
      clinic: { name: 'Noor Aesthetic Clinic', place: 'Example business · Jumeirah', step1: '1. Choose a treatment', step2: '2. Pick a time tomorrow', visit: false,
        items: [['Skin consultation', '30 min · Free', 'free'], ['Laser session', '45 min · AED 600', 'AED 600'], ['HydraFacial', '60 min · AED 550', 'AED 550']] },
      home: { name: 'Bright Home Maintenance', place: 'Example business · Serving all of Dubai', step1: '1. What do you need?', step2: '2. Pick a visit time tomorrow', visit: true,
        items: [['Kitchen renovation quote', 'Site visit · Free', 'free'], ['AC service', '60 min · AED 180', 'AED 180'], ['Bathroom remodel quote', 'Site visit · Free', 'free']] },
      interior: { name: 'Studio Layali Interiors', place: 'Example business · Dubai Design District', step1: '1. What do you need?', step2: '2. Pick a visit time tomorrow', visit: true,
        items: [['First consultation', '45 min · Free', 'free'], ['Measurement visit', '60 min · AED 300', 'AED 300'], ['Design review', '60 min · AED 400', 'AED 400']] },
    };
    const state = { kind: 'salon', service: null, price: null, time: null };
    const confirmBtn = $('[data-confirm]', demo);
    const out = $('[data-wa]');
    const opts = $('[data-opts]', demo);
    const hint = out.innerHTML;
    const sync = () => { confirmBtn.disabled = !(state.service && state.time); };
    const press = (list, btn) => list.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const render = () => {
      const k = kinds[state.kind];
      state.service = state.price = state.time = null;
      $('[data-name]', demo).textContent = k.name;
      $('[data-initial]', demo).textContent = k.name[0];
      $('[data-place]', demo).textContent = k.place;
      $('[data-step1]', demo).textContent = k.step1;
      $('[data-step2]', demo).textContent = k.step2;
      opts.replaceChildren(...k.items.map(([label, meta, price]) => {
        const b = document.createElement('button');
        b.className = 'opt'; b.type = 'button'; b.setAttribute('aria-pressed', 'false');
        b.append(label + ' ');
        const small = document.createElement('small'); small.textContent = meta; b.append(small);
        b.addEventListener('click', () => { state.service = label; state.price = price; press($$('.opt', opts), b); sync(); });
        return b;
      }));
      press($$('[data-time]', demo), null);
      confirmBtn.textContent = 'Confirm booking';
      out.innerHTML = hint;
      sync();
    };
    $$('[data-kind]').forEach((tab) => tab.addEventListener('click', () => {
      state.kind = tab.dataset.kind;
      $$('[data-kind]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      render();
    }));
    $$('[data-time]', demo).forEach((b) => b.addEventListener('click', () => {
      state.time = b.dataset.time; press($$('[data-time]', demo), b); sync();
    }));
    const bubble = (cls, text, delay) => {
      const d = document.createElement('div');
      d.className = `bub ${cls} pop`; d.style.animationDelay = `${delay}ms`; d.textContent = text;
      return d;
    };
    confirmBtn.addEventListener('click', () => {
      const k = kinds[state.kind];
      const cost = state.price === 'free' ? 'This one is free.' : `Total ${state.price}.`;
      out.replaceChildren(...(k.visit ? [
        bubble('us', `Booked. ${state.service}, tomorrow at ${state.time}.`, 0),
        bubble('us', `${cost} Please share your location so our team finds you.`, 450),
        bubble('them', 'Location sent.', 1100),
        bubble('us', 'Got it. We will message you when the team is on the way.', 1700),
      ] : [
        bubble('us', `Booked. ${state.service}, tomorrow at ${state.time}.`, 0),
        bubble('us', `${cost} We will remind you 2 hours before.`, 450),
        bubble('them', 'Perfect, thank you.', 1100),
        bubble('us', 'See you tomorrow.', 1700),
      ]));
      confirmBtn.textContent = 'Booked. Try another';
      $('[data-status]', demo).textContent = `Booking confirmed for ${state.service} at ${state.time}.`;
    });
    render();
  }
})();
