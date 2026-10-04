import { paintRange, num } from './util';

/**
 * Wires every [data-rf] slider inside root: keeps the filled track, the
 * displayed value and (when editable) the number input in sync, and calls
 * onChange. Values typed above the slider max are allowed.
 */
export function bindRanges(root: ParentNode, ar: boolean, onChange: () => void) {
  root.querySelectorAll<HTMLElement>('[data-rf]').forEach((rf) => {
    const range = rf.querySelector<HTMLInputElement>('input[type=range]')!;
    const out = rf.querySelector<HTMLElement>('[data-rf-out]');
    const numIn = rf.querySelector<HTMLInputElement>('[data-rf-num]');
    const unit = rf.dataset.unit;
    const show = (v: number) => (unit === 'pct' ? `${v}%` : unit === 'aed' ? (ar ? `${num(v)} درهم` : `AED ${num(v)}`) : num(v));
    const sync = () => {
      paintRange(range);
      if (out) out.textContent = show(+range.value);
      if (numIn && document.activeElement !== numIn) numIn.value = num(+(numIn.dataset.raw ?? range.value));
    };
    range.addEventListener('input', () => {
      if (numIn) numIn.dataset.raw = range.value;
      sync();
      onChange();
    });
    numIn?.addEventListener('input', () => {
      const v = Math.max(0, parseFloat(numIn.value.replace(/[^\d.]/g, '')) || 0);
      numIn.dataset.raw = String(v);
      range.value = String(Math.min(+range.max, Math.max(+range.min, v)));
      paintRange(range);
      onChange();
    });
    numIn?.addEventListener('blur', sync);
    sync();
  });
}

/** Read a slider's value (or the typed value when it exceeds the slider range). */
export function readRange(root: ParentNode, id: string): number {
  const range = root.querySelector<HTMLInputElement>(`#${id}`)!;
  const numIn = range.closest('[data-rf]')?.querySelector<HTMLInputElement>('[data-rf-num]');
  return numIn?.dataset.raw ? +numIn.dataset.raw : +range.value;
}

export function setRange(root: ParentNode, id: string, v: number) {
  const range = root.querySelector<HTMLInputElement>(`#${id}`)!;
  range.value = String(v);
  const numIn = range.closest('[data-rf]')?.querySelector<HTMLInputElement>('[data-rf-num]');
  if (numIn) numIn.dataset.raw = String(v);
  range.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Accessible single-series column chart (SVG) with hover/focus tooltips. */
export function columnChart(
  host: HTMLElement,
  data: { label: string; value: number }[],
  fmtValue: (v: number) => string,
  opts: { rtl?: boolean; endLabel?: boolean } = {},
) {
  const W = 640,
    H = 260,
    padL = 56,
    padR = 8,
    padT = 24,
    padB = 30;
  const max = Math.max(1, ...data.map((d) => d.value));
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / mag / 2) * 2 * mag || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const band = (W - padL - padR) / data.length;
  const bw = Math.min(24, band * 0.56);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / niceMax);
  const order = opts.rtl ? [...data].reverse() : data;
  const bar = (x: number, v: number) => {
    const top = y(v);
    const base = H - padB;
    const h = Math.max(0, base - top);
    if (h < 1) return '';
    const r = Math.min(4, h, bw / 2);
    return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z`;
  };
  const cols = order
    .map((d, i) => {
      const x = padL + band * i + (band - bw) / 2;
      return `<g class="chart__col" data-i="${data.indexOf(d)}">
        <path class="chart__bar" d="${bar(x, d.value)}"/>
        <rect class="chart__hit" x="${padL + band * i}" y="${padT}" width="${band}" height="${H - padT - padB}" tabindex="0" role="img" aria-label="${d.label}: ${fmtValue(d.value)}"/>
        <text class="chart__tick" x="${padL + band * i + band / 2}" y="${H - 10}" text-anchor="middle">${d.label}</text>
      </g>`;
    })
    .join('');
  const last = data[data.length - 1];
  const lastIdx = order.indexOf(last);
  const endLabel = opts.endLabel
    ? `<text class="chart__end" x="${padL + band * lastIdx + band / 2}" y="${y(last.value) - 8}" text-anchor="middle">${fmtValue(last.value)}</text>`
    : '';
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group">
    <g class="chart__grid">${ticks
      .map((tv) => `<line x1="${padL}" x2="${W - padR}" y1="${y(tv)}" y2="${y(tv)}"/><text class="chart__tick" x="${padL - 10}" y="${y(tv) + 4}" text-anchor="end">${fmtValue(tv)}</text>`)
      .join('')}</g>
    ${cols}${endLabel}</svg><div class="tooltip" hidden></div>`;
  const tip = host.querySelector<HTMLElement>('.tooltip')!;
  const svg = host.querySelector('svg')!;
  const show = (g: SVGGElement) => {
    const d = data[+g.dataset.i!];
    const hit = g.querySelector('rect')!.getBoundingClientRect();
    const box = host.getBoundingClientRect();
    tip.innerHTML = `${d.label}<strong>${fmtValue(d.value)}</strong>`;
    tip.hidden = false;
    tip.style.left = `${hit.left - box.left + hit.width / 2}px`;
    tip.style.top = `${y(d.value) * (svg.getBoundingClientRect().height / H) + (svg.getBoundingClientRect().top - box.top)}px`;
  };
  host.querySelectorAll<SVGGElement>('.chart__col').forEach((g) => {
    g.addEventListener('pointerenter', () => show(g));
    g.addEventListener('focusin', () => show(g));
    g.addEventListener('pointerleave', () => (tip.hidden = true));
    g.addEventListener('focusout', () => (tip.hidden = true));
  });
}
