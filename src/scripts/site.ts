/**
 * Site-wide interaction layer. Everything here is progressive enhancement:
 * the page is fully readable without it, and reduced-motion users get the
 * final states immediately.
 */
import Lenis from 'lenis';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const root = document.documentElement;

declare global {
  interface Window {
    __lenis?: Lenis;
  }
}

/* ------------------------------------------------------------------ Lenis */
let lenis: Lenis | undefined;
if (!reduced && finePointer) {
  lenis = new Lenis({ autoRaf: true, lerp: 0.11, anchors: { offset: -90 }, wheelMultiplier: 0.95 });
  window.__lenis = lenis;
}
const onScroll = (fn: () => void) => {
  if (lenis) lenis.on('scroll', fn);
  else window.addEventListener('scroll', fn, { passive: true });
};

/* --------------------------------------------------------------------- Nav */
const nav = document.querySelector<HTMLElement>('[data-nav]');
let lastY = window.scrollY;
const menu = document.querySelector<HTMLElement>('[data-menu]');
const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
let menuOpen = false;

function updateNav() {
  const y = window.scrollY;
  if (!nav) return;
  nav.classList.toggle('is-scrolled', y > 24);
  const goingDown = y > lastY + 4;
  const goingUp = y < lastY - 4;
  if (!menuOpen && goingDown && y > 520) nav.classList.add('is-hidden');
  else if (goingUp || y < 520) nav.classList.remove('is-hidden');
  lastY = y;
}
onScroll(updateNav);
updateNav();

function setMenu(open: boolean) {
  if (!menu || !toggle) return;
  menuOpen = open;
  toggle.setAttribute('aria-expanded', String(open));
  const label = toggle.querySelector<HTMLElement>('[data-menu-label]');
  if (label) label.textContent = open ? label.dataset.close! : label.dataset.open!;
  if (open) {
    menu.hidden = false;
    requestAnimationFrame(() => menu.classList.add('is-open'));
    lenis?.stop();
    document.body.style.overflow = 'hidden';
    nav?.classList.remove('is-hidden');
    nav?.classList.add('is-scrolled');
    menu.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
  } else {
    menu.classList.remove('is-open');
    lenis?.start();
    document.body.style.overflow = '';
    window.setTimeout(() => {
      if (!menuOpen) menu.hidden = true;
    }, 700);
  }
}
toggle?.addEventListener('click', () => setMenu(!menuOpen));
menu?.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a')) setMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuOpen) {
    setMenu(false);
    toggle?.focus();
  }
});

document.querySelectorAll<HTMLAnchorElement>('[data-back-top]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    if (lenis) lenis.scrollTo(0, { duration: 1.6 });
    else window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }),
);

/* ------------------------------------------------- Mobile action bar */
// Shown once the page's own CTAs are out of view; hidden over forms/footer CTA.
{
  const blockers = new Set<Element>();
  let pastTop = false;
  const sync = () => document.body.classList.toggle('bar-on', pastTop && blockers.size === 0 && !menuOpen);
  const heroCtas = document.querySelector('[data-hero-ctas]');
  const updateTop = () => {
    if (heroCtas) {
      const r = heroCtas.getBoundingClientRect();
      pastTop = r.bottom < 0;
    } else pastTop = window.scrollY > window.innerHeight * 0.5;
    sync();
  };
  onScroll(updateTop);
  updateTop();
  const bio = new IntersectionObserver((entries) => {
    entries.forEach((e) => (e.isIntersecting ? blockers.add(e.target) : blockers.delete(e.target)));
    sync();
  });
  document.querySelectorAll('[data-hide-bar], .fcta, footer .fbottom').forEach((el) => bio.observe(el));
  toggle?.addEventListener('click', () => setTimeout(sync, 0));
}

/* ------------------------------------------------------------------ Reveal */
const revealTargets = document.querySelectorAll<HTMLElement>('[data-reveal], [data-split]');
if (reduced || !('IntersectionObserver' in window)) {
  revealTargets.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  revealTargets.forEach((el) => {
    // Elements already in view on load animate in immediately.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.92 && r.bottom > 0 && el.closest('[data-hero]')) {
      requestAnimationFrame(() => el.classList.add('is-in'));
    } else io.observe(el);
  });
}

/* ---------------------------------------------------------------- Counters */
const fmt = (n: number, decimals: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
function runCounter(el: HTMLElement) {
  const target = parseFloat(el.dataset.count || '0');
  const decimals = (el.dataset.count || '').split('.')[1]?.length ?? 0;
  if (reduced) {
    el.textContent = fmt(target, decimals);
    return;
  }
  const dur = 1600;
  const start = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = fmt(target * eased, decimals);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const counters = document.querySelectorAll<HTMLElement>('[data-count]');
if (counters.length) {
  const cio = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          runCounter(e.target as HTMLElement);
          cio.unobserve(e.target);
        }
      });
    },
    { threshold: 0.6 },
  );
  counters.forEach((c) => cio.observe(c));
}

/* ------------------------------------------- Scroll-linked: scrub + stack */
const scrubBlocks = Array.from(document.querySelectorAll<HTMLElement>('[data-scrub]')).map((el) => ({
  el,
  words: Array.from(el.querySelectorAll<HTMLElement>('.sw')),
}));
const stacks = Array.from(document.querySelectorAll<HTMLElement>('[data-stack-card]'));

let ticking = false;
function scrollEffects() {
  ticking = false;
  const vh = window.innerHeight;
  for (const { el, words } of scrubBlocks) {
    const r = el.getBoundingClientRect();
    // 0 when block top hits 85% of viewport, 1 when block bottom reaches 45%.
    const start = vh * 0.85;
    const end = vh * 0.45;
    const total = r.height + (start - end);
    const p = Math.min(1, Math.max(0, (start - r.top) / total));
    const lit = p * words.length;
    for (let i = 0; i < words.length; i++) {
      const o = Math.min(1, Math.max(0, lit - i));
      words[i].style.setProperty('--o', o.toFixed(3));
    }
  }
  for (let i = 0; i < stacks.length - 1; i++) {
    const card = stacks[i];
    const next = stacks[i + 1];
    const r = next.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, 1 - (r.top - cr.top) / Math.max(1, cr.height)));
    card.style.setProperty('--stack-p', p.toFixed(3));
  }
}
function requestEffects() {
  if (!ticking) {
    ticking = true;
    requestAnimationFrame(scrollEffects);
  }
}
if (scrubBlocks.length || stacks.length) {
  if (reduced) {
    scrubBlocks.forEach(({ words }) => words.forEach((w) => w.style.setProperty('--o', '1')));
  } else {
    onScroll(requestEffects);
    window.addEventListener('resize', requestEffects);
    scrollEffects();
  }
}

/* ---------------------------------------------------- Pointer: cursor etc */
if (finePointer) {
  const cursor = document.querySelector<HTMLElement>('.cursor');
  const label = cursor?.querySelector<HTMLElement>('.cursor__label');
  let mx = -100,
    my = -100,
    cx = -100,
    cy = -100;
  let raf = 0;
  const loop = () => {
    cx += (mx - cx) * 0.2;
    cy += (my - cy) * 0.2;
    if (cursor) cursor.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    raf = Math.abs(mx - cx) + Math.abs(my - cy) > 0.1 ? requestAnimationFrame(loop) : 0;
  };
  window.addEventListener(
    'pointermove',
    (e) => {
      mx = e.clientX;
      my = e.clientY;
      cursor?.classList.add('is-active');
      if (!raf) raf = requestAnimationFrame(loop);
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => cursor?.classList.remove('is-active'));

  const setState = (target: Element | null) => {
    if (!cursor) return;
    const labelled = target?.closest<HTMLElement>('[data-cursor]');
    const link = target?.closest('a, button, [data-cursor-link], label.choice__box, summary');
    const text = target?.closest('input:not([type=range]):not([type=radio]):not([type=checkbox]), textarea');
    cursor.classList.toggle('is-label', !!labelled);
    cursor.classList.toggle('is-link', !labelled && !!link);
    cursor.classList.toggle('is-text', !labelled && !link && !!text);
    if (label) label.textContent = labelled?.dataset.cursor ?? '';
  };
  document.addEventListener('pointerover', (e) => setState(e.target as Element), { passive: true });

  if (!reduced) {
    document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate3d(${x * 0.22}px, ${y * 0.32}px, 0)`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.transition = 'transform 700ms cubic-bezier(.16,1,.3,1)';
        el.style.transform = '';
        window.setTimeout(() => (el.style.transition = ''), 700);
      });
    });
  }

  document.addEventListener(
    'pointermove',
    (e) => {
      const g = (e.target as Element)?.closest?.<HTMLElement>('.glint');
      if (!g) return;
      const r = g.getBoundingClientRect();
      g.style.setProperty('--mx', `${e.clientX - r.left}px`);
      g.style.setProperty('--my', `${e.clientY - r.top}px`);
    },
    { passive: true },
  );
}

/* ------------------------------------------------------- Horizontal rails */
document.querySelectorAll<HTMLElement>('[data-rail]').forEach((rail) => {
  const track = rail.querySelector<HTMLElement>('[data-rail-track]');
  const prev = rail.querySelector<HTMLButtonElement>('[data-rail-prev]');
  const next = rail.querySelector<HTMLButtonElement>('[data-rail-next]');
  if (!track) return;
  const rtl = root.dir === 'rtl';
  const step = () => {
    const card = track.querySelector<HTMLElement>(':scope > *');
    return card ? card.getBoundingClientRect().width + 20 : track.clientWidth * 0.8;
  };
  prev?.addEventListener('click', () => track.scrollBy({ left: (rtl ? 1 : -1) * step(), behavior: reduced ? 'auto' : 'smooth' }));
  next?.addEventListener('click', () => track.scrollBy({ left: (rtl ? -1 : 1) * step(), behavior: reduced ? 'auto' : 'smooth' }));

  const sync = () => {
    const max = track.scrollWidth - track.clientWidth;
    const pos = Math.abs(track.scrollLeft);
    if (prev) prev.disabled = pos < 8;
    if (next) next.disabled = pos > max - 8;
  };
  track.addEventListener('scroll', sync, { passive: true });
  sync();

  // Drag to scroll on desktop
  if (finePointer) {
    let down = false,
      startX = 0,
      startLeft = 0,
      moved = false;
    track.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('a, button, audio')) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = track.scrollLeft;
      track.classList.add('is-dragging');
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      track.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      track.classList.remove('is-dragging');
    });
    track.addEventListener('click', (e) => moved && e.preventDefault(), true);
  }
});

/* -------------------------------------------------------- FAQ: animate */
document.querySelectorAll<HTMLDetailsElement>('details[data-acc]').forEach((d) => {
  const summary = d.querySelector('summary');
  const body = d.querySelector<HTMLElement>('[data-acc-body]');
  if (!summary || !body || reduced) return;
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    if (d.open) {
      const h = body.scrollHeight;
      body.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], {
        duration: 380,
        easing: 'cubic-bezier(.65,0,.35,1)',
      }).onfinish = () => {
        d.open = false;
        lenis?.resize();
      };
    } else {
      d.open = true;
      const h = body.scrollHeight;
      body.animate([{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }], {
        duration: 520,
        easing: 'cubic-bezier(.16,1,.3,1)',
      }).onfinish = () => lenis?.resize();
    }
  });
});

/* ---------------------------------------------------- Video facades */
document.querySelectorAll<HTMLButtonElement>('[data-wistia]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.wistia!;
    const aspect = btn.dataset.aspect || '1.7777';
    const wrap = btn.parentElement!;
    if (!document.querySelector('script[data-wistia-player]')) {
      const s = document.createElement('script');
      s.src = 'https://fast.wistia.com/player.js';
      s.async = true;
      s.dataset.wistiaPlayer = '';
      document.head.appendChild(s);
    }
    const s2 = document.createElement('script');
    s2.src = `https://fast.wistia.com/embed/${id}.js`;
    s2.async = true;
    s2.type = 'module';
    document.head.appendChild(s2);
    const player = document.createElement('wistia-player');
    player.setAttribute('media-id', id);
    player.setAttribute('aspect', aspect);
    player.setAttribute('autoplay', '');
    player.style.display = 'block';
    player.style.width = '100%';
    btn.replaceWith(player);
    wrap.classList.add('is-playing');
  });
});

/* -------------------------------------------------------- Audio player */
document.querySelectorAll<HTMLElement>('[data-audio]').forEach((wrap) => {
  const audio = wrap.querySelector('audio');
  const btn = wrap.querySelector<HTMLButtonElement>('[data-audio-toggle]');
  const bar = wrap.querySelector<HTMLElement>('[data-audio-progress]');
  const time = wrap.querySelector<HTMLElement>('[data-audio-time]');
  if (!audio || !btn) return;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  btn.addEventListener('click', () => {
    if (audio.paused) audio.play();
    else audio.pause();
  });
  audio.addEventListener('play', () => {
    wrap.classList.add('is-playing');
    btn.setAttribute('aria-pressed', 'true');
  });
  audio.addEventListener('pause', () => {
    wrap.classList.remove('is-playing');
    btn.setAttribute('aria-pressed', 'false');
  });
  audio.addEventListener('timeupdate', () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    bar?.style.setProperty('--p', `${p * 100}%`);
    if (time) time.textContent = mmss(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => {
    const total = wrap.querySelector<HTMLElement>('[data-audio-total]');
    if (total && isFinite(audio.duration)) total.textContent = mmss(audio.duration);
  });
  wrap.querySelector<HTMLElement>('[data-audio-seek]')?.addEventListener('click', (e) => {
    const t = e.currentTarget as HTMLElement;
    const r = t.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width;
    if (root.dir === 'rtl') x = 1 - x;
    if (audio.duration) audio.currentTime = x * audio.duration;
  });
});
