import { normalizeUrl } from '../lead';
import { $, $$, tween, reduced } from './util';

type Status = 'pass' | 'warn' | 'fail';
type Cat = 'seo' | 'speed' | 'mobile' | 'trust';
interface Check {
  id: string;
  cat: Cat;
  status: Status;
  value?: string | number;
  weight?: number;
}
interface AuditResult {
  url: string;
  finalUrl: string;
  checks: Check[];
  pagespeed: boolean;
  error?: string;
  status?: number;
}

const CATS: Cat[] = ['seo', 'speed', 'mobile', 'trust'];
const CAT_WEIGHT: Record<Cat, number> = { seo: 0.35, speed: 0.25, mobile: 0.25, trust: 0.15 };
const ICONS: Record<Status, string> = {
  pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>',
  fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M17 7 7 17M7 7l10 10"/></svg>',
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pts = (s: Status) => (s === 'pass' ? 1 : s === 'warn' ? 0.5 : 0);

export function initAudit() {
  const form = $<HTMLFormElement>('[data-audit-form]');
  if (!form) return;
  const t = JSON.parse(form.dataset.i18n!);
  const input = $<HTMLInputElement>('#au-url', form)!;
  const errEl = $('[data-audit-error]', form)!;
  const runBtn = $<HTMLButtonElement>('[data-audit-run]', form)!;
  const intro = $('[data-audit-intro]')!;
  const loading = $('[data-audit-loading]')!;
  const results = $('[data-audit-results]')!;
  const gate = $('#audit-gate')!;
  const locked = $('[data-audit-locked]')!;
  const full = $('[data-audit-full]')!;
  let stepTimer = 0;
  let current: { checks: Check[]; url: string; lh?: Record<string, number | null> } | null = null;

  const msg = (id: string, c: Check) => {
    const copy = t.checks[id];
    if (!copy) return { name: id, text: '', fix: '' };
    return { name: copy.name, text: String(copy[c.status]).replace('{v}', String(c.value ?? '')), fix: copy.fix };
  };

  const scoreOf = (checks: Check[], cat: Cat) => {
    const cs = checks.filter((c) => c.cat === cat);
    if (!cs.length) return 100;
    const w = cs.reduce((a, c) => a + (c.weight ?? 1), 0);
    return Math.round((100 * cs.reduce((a, c) => a + (c.weight ?? 1) * pts(c.status), 0)) / w);
  };

  const scores = () => {
    const s = Object.fromEntries(CATS.map((c) => [c, scoreOf(current!.checks, c)])) as Record<Cat, number>;
    const perf = current!.lh?.performance;
    if (typeof perf === 'number') s.speed = Math.round(s.speed * 0.5 + perf * 0.5);
    const overall = Math.round(CATS.reduce((a, c) => a + s[c] * CAT_WEIGHT[c], 0));
    return { ...s, overall };
  };

  const setStep = (i: number) => {
    $$('[data-audit-step]').forEach((li, k) => {
      li.classList.toggle('is-done', k < i);
      li.classList.toggle('is-active', k === i);
    });
  };

  const showError = (key: string, v = '') => {
    errEl.textContent = (t.errors[key] || t.errors.generic).replace('{v}', v);
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };

  const issueHTML = (c: Check, withFix = true) => {
    const m = msg(c.id, c);
    return `<li class="issue issue--${c.status}">
      <span class="issue__icon" aria-hidden="true">${ICONS[c.status]}</span>
      <div class="issue__body">
        <p class="issue__top"><strong>${esc(m.name)}</strong><span class="issue__badge">${esc(t.status[c.status])}</span></p>
        <p class="issue__text">${esc(m.text)}</p>
        ${withFix && c.status !== 'pass' ? `<p class="issue__fix"><span>${esc(t.howTo)}:</span> ${esc(m.fix)}</p>` : ''}
      </div>
    </li>`;
  };

  const render = () => {
    if (!current) return;
    const s = scores();
    const { checks } = current;

    // Overall ring + hero number
    const ring = $<SVGCircleElement>('[data-audit-ring]')!;
    const C = 326.73;
    ring.style.strokeDashoffset = String(C - (C * s.overall) / 100);
    tween($('[data-audit-score]'), s.overall, (v) => String(Math.round(v)), 1200);
    $('[data-audit-ring-label]')!.setAttribute('aria-label', `${s.overall} / 100`);
    const grade = s.overall >= 85 ? 'great' : s.overall >= 60 ? 'ok' : 'poor';
    $('[data-audit-grade]')!.textContent = t.grade[grade];
    $('[data-audit-grade-sub]')!.textContent = t.gradeSub[grade];

    // Category meters
    $('[data-audit-cats]')!.innerHTML = CATS.map((cat) => {
      const cs = checks.filter((c) => c.cat === cat);
      const passed = cs.filter((c) => c.status === 'pass').length;
      return `<li class="meter">
        <div class="meter__top"><span>${esc(t.cats[cat])}</span><strong>${s[cat]}</strong></div>
        <div class="meter__track" role="img" aria-label="${esc(t.cats[cat])}: ${s[cat]} / 100"><span style="--w:${s[cat]}%"></span></div>
        <p class="meter__sub">${passed}/${cs.length} ${esc(t.passed)}</p>
      </li>`;
    }).join('');
    requestAnimationFrame(() => $$('.meter__track span').forEach((el) => el.classList.add('is-in')));

    // Top issues (free)
    const ranked = checks
      .filter((c) => c.status !== 'pass')
      .sort((a, b) => (a.status === b.status ? (b.weight ?? 1) - (a.weight ?? 1) : a.status === 'fail' ? -1 : 1));
    $('[data-audit-top]')!.innerHTML = ranked.length
      ? ranked.slice(0, 3).map((c) => issueHTML(c)).join('')
      : `<li class="issue issue--pass"><span class="issue__icon" aria-hidden="true">${ICONS.pass}</span><div class="issue__body"><p class="issue__text">${esc(t.noIssues)}</p></div></li>`;

    // Full report (gated)
    $('[data-audit-full-list]')!.innerHTML = CATS.map((cat) => {
      const cs = checks.filter((c) => c.cat === cat).sort((a, b) => pts(a.status) - pts(b.status));
      return `<section class="full-cat"><h3 class="full-cat__h"><span>${esc(t.cats[cat])}</span><span>${s[cat]}/100</span></h3><ul role="list" class="full-cat__list">${cs
        .map((c) => issueHTML(c))
        .join('')}</ul></section>`;
    }).join('');

    // Lead details for the gate
    const issues = ranked.map((c) => `${msg(c.id, c).name} (${c.status})`).join('; ');
    gate.dataset.website = current.url;
    gate.dataset.details = `Website audit ${s.overall}/100 · SEO ${s.seo} · Speed ${s.speed} · Mobile ${s.mobile} · Trust ${s.trust} · Issues: ${issues}`.slice(0, 900);
  };

  const renderLighthouse = (lh: Record<string, number | null> | null) => {
    const box = $('[data-audit-lh]')!;
    const status = $('[data-audit-lh-status]')!;
    const grid = $('[data-audit-lh-grid]')!;
    if (!lh) {
      status.textContent = t.lighthouseNA;
      grid.innerHTML = '';
      return;
    }
    box.hidden = false;
    status.textContent = '';
    const tile = (label: string, v: string) => `<div class="kpi"><span class="kpi__label">${esc(label)}</span><span class="kpi__value">${v}</span></div>`;
    grid.innerHTML = [
      ...(['performance', 'accessibility', 'bestPractices', 'seo'] as const).map((k) => tile(t.lh[k], lh[k] == null ? '—' : String(lh[k]))),
      tile(t.vitals.lcp, lh.lcp == null ? '—' : `${(lh.lcp / 1000).toFixed(1)}s`),
      tile(t.vitals.cls, lh.cls == null ? '—' : lh.cls.toFixed(2)),
      tile(t.vitals.tbt, lh.tbt == null ? '—' : `${Math.round(lh.tbt)}ms`),
    ].join('');
  };

  const run = async (raw: string) => {
    errEl.textContent = '';
    input.removeAttribute('aria-invalid');
    const url = normalizeUrl(raw);
    if (!url) return showError('invalid_url');
    runBtn.disabled = true;
    intro.hidden = true;
    results.hidden = true;
    loading.hidden = false;
    let step = 0;
    setStep(0);
    clearInterval(stepTimer);
    stepTimer = window.setInterval(() => setStep(Math.min(++step, t.steps.length - 1)), reduced() ? 400 : 1300);
    loading.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });

    const params = new URLSearchParams(location.search);
    params.set('url', url.replace(/^https:\/\//, '').replace(/\/$/, ''));
    history.replaceState(null, '', `${location.pathname}?${params}`);

    let data: AuditResult;
    try {
      const res = await fetch(`/api/audit?url=${encodeURIComponent(url)}`, { headers: { accept: 'application/json' } });
      data = await res.json().catch(() => ({ error: 'generic' }) as AuditResult);
      if (!res.ok || data.error) throw Object.assign(new Error(data.error || 'generic'), { status: data.status });
    } catch (e) {
      clearInterval(stepTimer);
      loading.hidden = true;
      intro.hidden = false;
      runBtn.disabled = false;
      const err = e as Error & { status?: number };
      return showError(err.message, String(err.status ?? ''));
    }

    clearInterval(stepTimer);
    setStep(t.steps.length);
    current = { checks: data.checks, url: data.finalUrl || url };
    $('[data-audit-url]')!.textContent = (data.finalUrl || url).replace(/^https?:\/\//, '').replace(/\/$/, '');
    await new Promise((r) => setTimeout(r, reduced() ? 0 : 350));
    loading.hidden = true;
    results.hidden = false;
    runBtn.disabled = false;
    render();
    window.__lenis?.resize();
    results.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });

    // Optional Lighthouse (only when the server has a PageSpeed key).
    const lhBox = $('[data-audit-lh]')!;
    if (data.pagespeed) {
      lhBox.hidden = false;
      try {
        const res = await fetch(`/api/pagespeed?url=${encodeURIComponent(current.url)}`);
        const lh = res.ok ? await res.json() : null;
        if (lh && !lh.error) {
          current.lh = lh;
          renderLighthouse(lh);
          render();
        } else renderLighthouse(null);
      } catch {
        renderLighthouse(null);
      }
    } else lhBox.hidden = true;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run(input.value);
  });
  $('[data-audit-again]')?.addEventListener('click', () => {
    results.hidden = true;
    intro.hidden = false;
    input.value = '';
    input.focus();
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
  });
  $('[data-audit-print]')?.addEventListener('click', () => window.print());

  gate.addEventListener('gate:unlocked', () => {
    locked.classList.add('is-open');
    full.removeAttribute('inert');
    full.removeAttribute('aria-hidden');
    $('[data-audit-print]')!.hidden = false;
    window.__lenis?.resize();
  });

  const preset = new URLSearchParams(location.search).get('url');
  if (preset) {
    input.value = preset;
    run(preset);
  }
}
