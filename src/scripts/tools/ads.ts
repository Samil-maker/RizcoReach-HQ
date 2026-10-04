import { bindRanges, readRange, setRange } from './fields';
import { $, $$, tween, num, aed, setLive } from './util';

/** CPL drift as budget scales (bigger budgets reach colder audiences). */
const SCENARIOS = [
  { m: 0.5, drift: 0.95 },
  { m: 1, drift: 1 },
  { m: 2, drift: 1.1 },
  { m: 3, drift: 1.18 },
];

export function initAdsCalc() {
  const root = $('[data-ads]');
  if (!root) return;
  const t = JSON.parse(root.dataset.i18n!);
  const ar = t.ar as boolean;
  const gate = $('#ads-gate')!;
  const out = (k: string) => $(`[data-out="${k}"]`, root);
  let raf = 0;

  const industry = () => {
    const k = $<HTMLInputElement>('[name="ads-industry"]:checked', root)?.value;
    return t.industries.find((i: { k: string }) => i.k === k) ?? t.industries[0];
  };

  const calc = () => {
    const ind = industry();
    const budget = readRange(root, 'ads-budget');
    const cpl = Math.max(1, readRange(root, 'ads-cpl'));
    const close = readRange(root, 'ads-close') / 100;
    const value = readRange(root, 'ads-value');
    const leads = budget / cpl;
    const customers = leads * close;
    const revenue = customers * value;
    const roas = budget ? revenue / budget : 0;
    const lo = Math.round(budget / ind.cpl[1]);
    const hi = Math.round(budget / ind.cpl[0]);

    tween(out('leads'), leads, (v) => `~${num(Math.round(v))}`);
    out('range')!.textContent = ar ? `النطاق التقديري لقطاعك: ${num(lo)}–${num(hi)}` : `Indicative range for your industry: ${num(lo)}–${num(hi)}`;
    setLive(ar ? `عملاء محتملون شهرياً · العائد ${roas.toFixed(1)}×` : `Leads / month · ROAS ${roas.toFixed(1)}×`, `~${num(Math.round(leads))}`);
    tween(out('cpl'), cpl, (v) => aed(v, ar));
    tween(out('customers'), customers, (v) => num(v, v < 10 ? 1 : 0));
    tween(out('revenue'), revenue, (v) => aed(v, ar));
    tween(out('roas'), roas, (v) => `${v.toFixed(1)}×`);
    out('breakeven')!.textContent = value ? `${Math.min(100, (cpl / value) * 100).toFixed(1)}%` : '—';
    out('cpc')!.textContent = close ? aed(cpl / close, ar) : '—';

    $('[data-scenarios] tbody', root)!.innerHTML = SCENARIOS.map(({ m, drift }) => {
      const b = budget * m;
      const l = b / (cpl * drift);
      const cu = l * close;
      const r = cu * value;
      return `<tr class="${m === 1 ? 'is-current' : ''}"><td class="num">${aed(b, ar)}</td><td class="num">${num(Math.round(l))}</td><td class="num">${num(cu, cu < 10 ? 1 : 0)}</td><td class="num">${aed(r, ar)}</td><td class="num">${(b ? r / b : 0).toFixed(1)}×</td></tr>`;
    }).join('');

    gate.dataset.details = `Meta Ads calculator · ${ind.t} · budget AED ${num(budget)}/mo · CPL AED ${num(cpl)} · close ${Math.round(close * 100)}% · value AED ${num(value)} · ≈ ${num(Math.round(leads))} leads, ROAS ${roas.toFixed(1)}×`;
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(calc);
  };

  bindRanges(root, ar, schedule);
  $$<HTMLInputElement>('[name="ads-industry"]', root).forEach((r) =>
    r.addEventListener('change', () => {
      const ind = industry();
      setRange(root, 'ads-cpl', Math.round((ind.cpl[0] + ind.cpl[1]) / 2 / 5) * 5);
      schedule();
    }),
  );
  gate.addEventListener('gate:unlocked', () => {
    $('[data-locked]', root)!.classList.add('is-open');
    const body = $('[data-locked-body]', root)!;
    body.removeAttribute('inert');
    body.removeAttribute('aria-hidden');
  });
  calc();
}
