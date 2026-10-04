export const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const num = (n: number, d = 0) =>
  (Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Compact: 1,284 / 12.9K / 4.2M */
export const compact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 10_000) return `${Math.round(n / 1000)}K`;
  return num(Math.round(n));
};

export const aed = (n: number, ar = false) => (ar ? `${num(Math.round(n))} درهم` : `AED ${num(Math.round(n))}`);

/** Tween a number into an element (respects reduced motion). */
export function tween(el: Element | null, to: number, render: (v: number) => string, dur = 700) {
  if (!el) return;
  const from = parseFloat((el as HTMLElement).dataset.v || '0') || 0;
  (el as HTMLElement).dataset.v = String(to);
  if (reduced() || from === to) {
    el.textContent = render(to);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = render(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Keep a range input's filled track in sync (CSS uses --p). */
export function paintRange(r: HTMLInputElement) {
  const min = +r.min || 0;
  const max = +r.max || 100;
  r.style.setProperty('--p', `${((+r.value - min) / (max - min)) * 100}%`);
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/** Update the mobile live-result bar (if present). */
export function setLive(label: string, value: string) {
  const l = document.querySelector('[data-live-label]');
  const v = document.querySelector('[data-live-value]');
  if (l) l.textContent = label;
  if (v) v.textContent = value;
}
