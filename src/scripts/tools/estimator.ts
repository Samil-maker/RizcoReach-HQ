import { bindRanges, readRange } from './fields';
import { $, $$, num, setLive } from './util';

/* ==========================================================================
   ESTIMATOR CONFIG: tune these to match how the studio actually works.
   Weeks are typical build durations once content is ready. No prices are
   shown anywhere; the quote is sent after review.
   ========================================================================== */
const BASE_WEEKS: Record<string, number> = { landing: 1.5, business: 3, ecommerce: 5, webapp: 8 };
const INCLUDED_PAGES: Record<string, number> = { landing: 1, business: 5, ecommerce: 6, webapp: 6 };
const WEEKS_PER_EXTRA_PAGE = 0.18;
const FEATURE_WEEKS: Record<string, number> = {
  bilingual: 1,
  booking: 0.75,
  cms: 0.5,
  shop: 2,
  integrations: 1,
  motion: 1.5,
  copy: 1,
  branding: 1.5,
  portal: 2.5,
};
const DESIGN_FACTOR: Record<string, number> = { clean: 1, premium: 1.25, flagship: 1.55 };
const TIMING_FACTOR: Record<string, number> = { flexible: 1.1, standard: 1, urgent: 0.85 };
/** Complexity points → tier. */
const TIERS: [number, string][] = [
  [30, 'launch'],
  [55, 'growth'],
  [80, 'flagship'],
  [101, 'custom'],
];
/* ========================================================================== */

export function initEstimator() {
  const root = $('[data-est]');
  if (!root) return;
  const t = JSON.parse(root.dataset.i18n!);
  const gate = $('#est-gate')!;
  const out = (k: string) => $(`[data-out="${k}"]`, root)!;
  const label = (list: { k: string; t: string }[], k: string) => list.find((x) => x.k === k)?.t ?? k;

  const calc = () => {
    const type = $<HTMLInputElement>('[name="est-type"]:checked', root)?.value ?? 'business';
    const pages = type === 'landing' ? Math.min(readRange(root, 'est-pages'), 3) : readRange(root, 'est-pages');
    const feats = $$<HTMLInputElement>('[name="est-feature"]:checked', root).map((i) => i.value);
    const design = $<HTMLInputElement>('[name="est-design"]:checked', root)?.value ?? 'premium';
    const timing = $<HTMLInputElement>('[name="est-timing"]:checked', root)?.value ?? 'standard';

    let weeks = BASE_WEEKS[type] + Math.max(0, pages - INCLUDED_PAGES[type]) * WEEKS_PER_EXTRA_PAGE;
    weeks += feats.reduce((a, f) => a + (type === 'ecommerce' && f === 'shop' ? 0 : FEATURE_WEEKS[f] ?? 0), 0);
    weeks *= DESIGN_FACTOR[design] * TIMING_FACTOR[timing];
    const lo = Math.max(1, Math.round(weeks * 0.85));
    const hi = Math.max(lo + 1, Math.round(weeks * 1.2));

    // Complexity 0–100 from the raw (pre-timing) effort.
    const effort = weeks / TIMING_FACTOR[timing];
    const cx = Math.min(100, Math.round((effort / 22) * 100));
    const tier = TIERS.find(([max]) => cx < max)?.[1] ?? 'custom';

    out('tier').textContent = t.tiers[tier];
    out('weeks').textContent = `${lo}–${hi} ${t.weeks}`;
    out('cx').textContent = `${cx}/100`;
    setLive(t.tiers[tier], `${lo}–${hi} ${t.weeks}`);
    out('cx-bar').style.setProperty('--w', `${Math.max(6, cx)}%`);
    out('cx-label').setAttribute('aria-label', `${cx} / 100`);

    const scope = [
      label(t.types, type),
      `${num(pages)} ${t.pagesUnit}`,
      ...feats.map((f) => label(t.features, f)),
      label(t.designs, design),
    ];
    out('scope').innerHTML = scope.map((s) => `<li><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>${s}</li>`).join('');

    gate.dataset.details = `Website estimator · ${type} · ${pages} pages · features: ${feats.join(', ') || 'none'} · design: ${design} · timing: ${timing} · tier ${tier} · ${lo}-${hi} weeks`;
  };

  bindRanges(root, t.ar, calc);
  $$<HTMLInputElement>('input[type=radio], input[type=checkbox]', root).forEach((i) => i.addEventListener('change', calc));
  calc();
}
