import { bindRanges, readRange, columnChart } from './fields';
import { $, $$, tween, num, compact, aed, setLive } from './util';

/** Average organic click-through rate by Google position band (industry averages). */
const CTR: Record<string, number> = { none: 0, p2: 0.01, p4: 0.05, top3: 0.18, p1: 0.28 };
const ORDER = ['none', 'p2', 'p4', 'top3', 'p1'];
/** Share of the full uplift reached each month: SEO compounds, it doesn't switch on. */
const RAMP = [0.04, 0.09, 0.16, 0.25, 0.35, 0.46, 0.57, 0.67, 0.76, 0.84, 0.91, 0.96];

export function initSeoCalc() {
  const root = $('[data-seo]');
  if (!root) return;
  const t = JSON.parse(root.dataset.i18n!);
  const ar = t.ar as boolean;
  const gate = $('#seo-gate')!;
  const out = (k: string) => $(`[data-out="${k}"]`, root);
  let raf = 0;

  const calc = () => {
    const searches = readRange(root, 'seo-searches');
    const conv = readRange(root, 'seo-conv') / 100;
    const close = readRange(root, 'seo-close') / 100;
    const value = readRange(root, 'seo-value');
    const cur = $<HTMLInputElement>('[name="seo-current"]:checked', root)?.value ?? 'p2';
    const tgt = $<HTMLInputElement>('[name="seo-target"]:checked', root)?.value ?? 'top3';
    const uplift = ORDER.indexOf(tgt) > ORDER.indexOf(cur) ? CTR[tgt] - CTR[cur] : 0;
    const visitors = searches * uplift;
    const leads = visitors * conv;
    const customers = leads * close;
    const monthly = customers * value;

    tween(out('monthly'), monthly, (v) => aed(v, ar));
    out('sub')!.textContent = uplift ? t.perMonth : t.noUplift;
    setLive(t.perMonth, aed(monthly, ar));
    tween(out('visitors'), visitors, (v) => num(Math.round(v)));
    tween(out('leads'), leads, (v) => num(v, v < 10 ? 1 : 0));
    tween(out('customers'), customers, (v) => num(v, v < 10 ? 1 : 0));
    tween(out('year'), monthly * 12, (v) => aed(v, ar));

    const series = RAMP.map((r, i) => ({ label: String(i + 1), value: Math.round(monthly * r) }));
    const y1 = series.reduce((a, d) => a + d.value, 0);
    out('y1')!.textContent = aed(y1, ar);
    out('y2')!.textContent = aed(monthly * 12, ar);
    columnChart($('[data-chart]', root)!, series, (v) => compact(v), { rtl: ar, endLabel: true });
    $('[data-table] tbody', root)!.innerHTML = series.map((d) => `<tr><td>${t.month} ${d.label}</td><td>${num(d.value)}</td></tr>`).join('');

    gate.dataset.details = `SEO calculator · ${num(searches)} searches/mo · ${cur} → ${tgt} · conv ${conv * 100}% · close ${Math.round(close * 100)}% · value AED ${num(value)} · ≈ AED ${num(Math.round(monthly))}/mo`;
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(calc);
  };

  bindRanges(root, ar, schedule);
  $$<HTMLInputElement>('input[type=radio]', root).forEach((r) => r.addEventListener('change', schedule));
  gate.addEventListener('gate:unlocked', () => {
    const locked = $('[data-locked]', root)!;
    locked.classList.add('is-open');
    const body = $('[data-locked-body]', root)!;
    body.removeAttribute('inert');
    body.removeAttribute('aria-hidden');
  });
  calc();
}
