/*
 * Lead scoring for the Lead Finder side panel: Instagram handles and follower
 * counts, website issues from the website check, the lead score and verdict,
 * the WhatsApp message to send, and the export formats.
 * Needs leads.js first (extends globalThis.LF).
 */
(function (root) {
  'use strict';

  const LF = root.LF;
  const instagramHandle = LF.instagramHandle;

  // ─── Instagram ─────────────────────────────────────────────────────────────

  /** Reads the follower count out of Instagram's page description ("1,234 Followers, …", "12.5K Followers", "1.2m followers"). */
  function parseFollowers(text) {
    const m = String(text || '').match(/(\d[\d.,\s]*?)\s*([KkMmBb])?\s+Followers?\b/i);
    if (!m) return null;
    let num = m[1].replace(/\s/g, '');
    const unit = (m[2] || '').toUpperCase();
    if (unit) {
      num = num.replace(',', '.'); // "12,5K" in some locales
      const value = parseFloat(num);
      if (isNaN(value)) return null;
      return Math.round(value * { K: 1e3, M: 1e6, B: 1e9 }[unit]);
    }
    // No unit: commas and dots are thousand separators ("1,234" / "1.234").
    if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(num)) return null;
    return parseInt(num.replace(/[.,]/g, ''), 10);
  }

  /** 5234 → "5.2K" */
  function formatCount(n) {
    if (n == null) return '';
    if (n >= 1e6) return trim1(n / 1e6) + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    if (n >= 1e3) return trim1(n / 1e3) + 'K';
    return String(n);
  }

  function trim1(x) {
    return (Math.round(x * 10) / 10).toString();
  }

  /** The Instagram account we know for a lead: from Maps or their website, or a check result. */
  function instagramOf(lead) {
    const check = (lead.checks && lead.checks.instagram) || null;
    const handle =
      (check && check.handle) ||
      (lead.socials && lead.socials.instagram) ||
      instagramHandle(lead.website) ||
      siteInstagram(lead) ||
      '';
    return { handle: handle, check: check };
  }

  /**
   * The Instagram account linked from their website. When the site links several
   * (e.g. the web designer's too), prefer one that looks like the business name.
   */
  function siteInstagram(lead) {
    const site = lead.checks && lead.checks.site;
    const list = (site && site.signals && site.signals.instagram) || [];
    if (list.length < 2) return list[0] || '';
    const compact = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const name = compact(lead.name);
    const words = String(lead.name || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const match = list.find((h) => {
      const handle = compact(h);
      return (name && (name.indexOf(handle) >= 0 || handle.indexOf(name) >= 0)) || words.some((w) => handle.indexOf(w) >= 0);
    });
    return match || list[0];
  }

  // ─── Website ───────────────────────────────────────────────────────────────

  /** 'none' (no website), 'social' (only an Instagram/Facebook/booking page) or 'site'. */
  function websiteKind(lead, s) {
    const url = lead.website || '';
    if (!LF.hostOf(url)) return 'none';
    if (LF.hasRealWebsite([url], true)) return 'site';
    return s.socialIsNoWebsite ? 'social' : 'site';
  }

  /**
   * Everything the website check can flag. `test` gets the signals from the
   * check (see qualify.js) and returns a detail object when the issue applies.
   * `pitch` is how the issue is described in a WhatsApp message (null = never mentioned).
   */
  const ISSUES = [
    {
      id: 'down',
      label: 'Website not loading',
      critical: true,
      test: (sig) => (sig.reachable === false ? { why: sig.failure || '' } : null),
      chip: () => 'not loading',
      pitch: () => "your website isn't loading at the moment",
    },
    {
      id: 'slow',
      label: 'Slow to load',
      test: (sig, s) => {
        const ms = sig.timedOut ? Math.max(sig.loadMs || 0, 20000) : sig.loadMs;
        return ms && ms > s.slowSeconds * 1000 ? { seconds: Math.round(ms / 100) / 10, timedOut: !!sig.timedOut } : null;
      },
      chip: (d) => (d.timedOut ? 'very slow (20s+)' : 'slow (' + d.seconds + 's)'),
      pitch: (d) => (d.timedOut ? 'it takes over 20 seconds to load' : 'it takes about ' + Math.round(d.seconds) + ' seconds to load'),
    },
    {
      id: 'lowPagespeed',
      label: 'Low Google PageSpeed score',
      test: (sig, s, ps) => (ps && typeof ps.performance === 'number' && ps.performance < 50 ? { score: ps.performance } : null),
      chip: (d) => 'PageSpeed ' + d.score + '/100',
      pitch: (d) => "it scores " + d.score + "/100 on Google's mobile speed test",
    },
    {
      id: 'noForm',
      label: 'No contact form',
      test: (sig) => (sig.form && !sig.form.found ? {} : null),
      chip: () => 'no contact form',
      pitch: () => "there's no contact form for enquiries",
    },
    {
      id: 'notMobile',
      label: 'Not set up for phones',
      critical: true,
      test: (sig) => (sig.viewport === false ? {} : null),
      chip: () => 'not mobile-friendly',
      pitch: () => "it isn't set up properly for phones",
    },
    {
      id: 'noHttps',
      label: 'No HTTPS (shows "Not secure")',
      critical: true,
      test: (sig) => (sig.https === false ? {} : null),
      chip: () => 'no HTTPS',
      pitch: () => 'browsers mark it as "Not secure"',
    },
    {
      id: 'noPreloader',
      label: 'No preloader',
      test: (sig) => (sig.preloader === false ? {} : null),
      chip: () => 'no preloader',
      pitch: null,
    },
    {
      id: 'noWhatsApp',
      label: 'No WhatsApp button',
      test: (sig) => (sig.whatsapp === false ? {} : null),
      chip: () => 'no WhatsApp button',
      pitch: () => "there's no WhatsApp button",
    },
    {
      id: 'outdated',
      label: 'Looks outdated (old © year)',
      test: (sig) => {
        const year = sig.copyrightYear;
        return year && year <= new Date().getFullYear() - 2 ? { year: year } : null;
      },
      chip: (d) => '© ' + d.year,
      pitch: (d) => 'the footer still says © ' + d.year,
    },
    {
      id: 'noCall',
      label: 'No tap-to-call link',
      test: (sig) => (sig.tel === false ? {} : null),
      chip: () => 'no tap-to-call',
      pitch: () => "visitors on phones can't tap to call you",
    },
    {
      id: 'weakSeo',
      label: 'Missing SEO basics (title, description, H1)',
      test: (sig) => (sig.title === '' || sig.metaDescription === false || sig.h1 === 0 ? {} : null),
      chip: () => 'weak SEO',
      pitch: () => "it's missing basic Google search setup",
    },
    {
      id: 'noPixel',
      label: 'No Meta Pixel or Google Analytics',
      test: (sig) => (sig.metaPixel === false && sig.analytics === false ? {} : null),
      chip: () => 'no Pixel/Analytics',
      pitch: () => "there's no tracking set up for ads",
    },
    {
      id: 'diyBuilder',
      label: 'Built with a DIY website builder',
      test: (sig) => (DIY_BUILDERS.indexOf(sig.builder) >= 0 ? { builder: sig.builder } : null),
      chip: (d) => 'built on ' + d.builder,
      pitch: null,
    },
  ];
  const DIY_BUILDERS = ['Wix', 'GoDaddy', 'Weebly', 'Google Sites', 'Hostinger', 'Jimdo', 'Site123', 'Strikingly'];

  const DEFAULT_CRITERIA = {
    down: true,
    slow: true,
    lowPagespeed: true,
    noForm: true,
    notMobile: true,
    noHttps: true,
    noPreloader: true,
    noWhatsApp: false,
    outdated: true,
    noCall: false,
    weakSeo: false,
    noPixel: false,
    diyBuilder: false,
  };

  /** The issues this website has, among the ones switched on in Settings. */
  function websiteIssues(signals, s, pagespeed) {
    if (!signals) return [];
    const criteria = Object.assign({}, DEFAULT_CRITERIA, s.criteria || {});
    // A site that doesn't load can't be judged on anything else.
    const down = signals.reachable === false;
    const out = [];
    ISSUES.forEach((issue) => {
      if (!criteria[issue.id]) return;
      if (down && issue.id !== 'down') return;
      const detail = issue.test(signals, s, pagespeed);
      if (!detail) return;
      out.push({
        id: issue.id,
        label: issue.label,
        critical: !!issue.critical,
        chip: issue.chip(detail),
        pitch: issue.pitch ? issue.pitch(detail) : '',
      });
    });
    return out;
  }

  // ─── Score & verdict ───────────────────────────────────────────────────────

  function followerPoints(n) {
    if (n >= 10000) return 25;
    if (n >= 5000) return 21;
    if (n >= 2000) return 17;
    if (n >= 1000) return 13;
    if (n >= 500) return 8;
    return 3;
  }

  function googlePoints(rating, reviews) {
    let pts;
    if (reviews == null) pts = 2;
    else if (reviews >= 200) pts = 15;
    else if (reviews >= 100) pts = 12;
    else if (reviews >= 50) pts = 9;
    else if (reviews >= 20) pts = 6;
    else if (reviews >= 5) pts = 3;
    else pts = 1;
    if (rating != null && reviews) {
      if (rating >= 4.5) pts += 5;
      else if (rating >= 4.0) pts += 3;
      else if (rating < 3.5) pts -= 3;
    }
    return Math.max(0, Math.min(20, pts));
  }

  /**
   * Scores a lead from what has been checked so far.
   * verdict: 'hot' | 'good' | 'low' | 'checking'
   * opportunity: 'noSite' | 'social' | 'broken' | 'weak' | 'ok' | 'pending' | 'unchecked'
   */
  function evaluate(lead, s) {
    const checks = lead.checks || {};
    const kind = websiteKind(lead, s);
    const reasons = [];
    const blockers = [];
    let opportunity;
    let issues = [];
    let pending = false;

    // What we could sell them.
    if (kind === 'none') {
      opportunity = 'noSite';
      reasons.push({ text: 'No website', tone: 'good' });
    } else if (kind === 'social') {
      opportunity = 'social';
      const where = socialName(lead.website);
      reasons.push({ text: 'Only ' + (/^[AEIOU]/.test(where) ? 'an ' : 'a ') + where + ' page, no website', tone: 'good' });
    } else {
      const site = checks.site;
      if (!site) {
        opportunity = s.checkWebsites ? 'pending' : 'unchecked';
        pending = !!s.checkWebsites;
        reasons.push({ text: s.checkWebsites ? 'Checking website…' : 'Website not checked', tone: 'neutral' });
      } else if (site.state === 'error') {
        opportunity = 'unchecked';
        reasons.push({ text: "Couldn't check website", tone: 'neutral' });
      } else {
        issues = websiteIssues(site.signals, s, checks.pagespeed && checks.pagespeed.state === 'done' ? checks.pagespeed : null);
        const weak = issues.some((i) => i.critical) || issues.length >= Math.max(1, s.weakAt || 1);
        if (issues.some((i) => i.id === 'down')) {
          opportunity = 'broken';
          reasons.push({ text: 'Website not loading', tone: 'good' });
        } else if (weak) {
          opportunity = 'weak';
          reasons.push({ text: 'Weak website: ' + issues.map((i) => i.chip).join(' · '), tone: 'good' });
        } else {
          opportunity = 'ok';
          const note = issues.length ? ' (only ' + issues.map((i) => i.chip).join(', ') + ')' : '';
          reasons.push({ text: 'Website looks fine' + note, tone: 'bad' });
          blockers.push('website');
        }
      }
    }

    // How big the business is: Instagram.
    const ig = instagramOf(lead);
    let followers = null;
    if (ig.check && ig.check.state === 'done' && typeof ig.check.followers === 'number') {
      followers = ig.check.followers;
      const under = s.minFollowers && followers < s.minFollowers;
      reasons.push({ text: 'Instagram @' + ig.check.handle + ' · ' + formatCount(followers) + ' followers', tone: under ? 'bad' : 'good' });
      if (under) blockers.push('followers');
    } else if (ig.check && ig.check.state === 'not_found') {
      reasons.push({ text: 'No Instagram found', tone: s.requireInstagram ? 'bad' : 'neutral' });
      if (s.requireInstagram) blockers.push('instagram');
    } else if (ig.check && ig.check.state === 'error') {
      reasons.push({ text: "Couldn't read Instagram" + (ig.handle ? ' @' + ig.handle : ''), tone: 'neutral' });
    } else if (s.checkInstagram) {
      pending = true;
      reasons.push({ text: 'Checking Instagram…', tone: 'neutral' });
    }

    // An unclaimed Google listing means nobody looks after their online presence.
    if (lead.unclaimed) reasons.push({ text: 'Google listing not claimed by the owner', tone: 'good' });

    // …and Google reviews.
    const reviews = typeof lead.reviews === 'number' ? lead.reviews : null;
    const rating = typeof lead.rating === 'number' ? lead.rating : null;
    if (reviews) {
      const under = s.minReviews && reviews < s.minReviews;
      reasons.push({ text: (rating ? rating.toFixed(1) + '★ · ' : '') + reviews.toLocaleString('en') + ' Google reviews', tone: under ? 'bad' : 'neutral' });
      if (under) blockers.push('reviews');
    } else {
      reasons.push({ text: 'No Google reviews', tone: s.minReviews ? 'bad' : 'neutral' });
      if (s.minReviews) blockers.push('reviews');
    }

    const opportunityPts = {
      noSite: 45,
      social: 42,
      broken: 45,
      weak: Math.min(40, 22 + 6 * Math.max(0, issues.length - 1)),
      ok: 5,
      pending: 22,
      unchecked: 22,
    }[opportunity];
    let igPts = 8;
    if (followers != null) igPts = followerPoints(followers);
    else if (ig.check && ig.check.state === 'not_found') igPts = 6;
    const contactPts = lead.phoneType === 'mobile' || !lead.phoneType ? 10 : 4;
    const unclaimedPts = lead.unclaimed ? 4 : 0;
    const score = Math.max(0, Math.min(100, opportunityPts + igPts + googlePoints(rating, reviews) + contactPts + unclaimedPts));

    let verdict;
    if (blockers.length) verdict = 'low';
    else if (pending) verdict = 'checking';
    else verdict = score >= 70 ? 'hot' : score >= 50 ? 'good' : 'low';
    // Without knowing what their website is like, a lead can be Good but never Hot.
    if (verdict === 'hot' && opportunity === 'unchecked') verdict = 'good';

    return {
      verdict: verdict,
      score: score,
      opportunity: opportunity,
      issues: issues,
      reasons: reasons,
      blockers: blockers,
      followers: followers,
      handle: ig.handle,
      pending: pending,
    };
  }

  function socialName(url) {
    const host = LF.hostOf(url);
    const names = {
      'instagram.com': 'Instagram',
      'facebook.com': 'Facebook',
      'fb.com': 'Facebook',
      'linktr.ee': 'Linktree',
      'tiktok.com': 'TikTok',
      'wa.me': 'WhatsApp',
      'whatsapp.com': 'WhatsApp',
      'fresha.com': 'Fresha',
      'talabat.com': 'Talabat',
      'deliveroo.ae': 'Deliveroo',
      'linkedin.com': 'LinkedIn',
    };
    for (const domain in names) if (host === domain || host.slice(-(domain.length + 1)) === '.' + domain) return names[domain];
    return host || 'social';
  }

  // ─── Messages ──────────────────────────────────────────────────────────────

  const DEFAULT_WEAK_MESSAGE =
    "Hi 👋 We had a look at {name}'s website and noticed {issues}. " +
    "We're RizcoReach, a Dubai web design studio. We'd be happy to show you a free redesign idea, no strings attached. " +
    "Interested? (Reply STOP and we won't message again.)";

  /** "a, b and c" from the two most important issues we'd mention to the business. */
  function issueSentence(issues) {
    const pitched = issues.filter((i) => i.pitch).map((i) => i.pitch).slice(0, 2);
    if (!pitched.length) return 'a few quick fixes that could bring you more enquiries';
    return pitched.join(' and ');
  }

  /** The WhatsApp message for a lead: the no-website one or the weak-website one. */
  function messageFor(lead, s, evaluation) {
    const ev = evaluation || evaluate(lead, s);
    const noSite = ev.opportunity === 'noSite' || ev.opportunity === 'social';
    const template = noSite ? s.messageNoSite || LF.DEFAULT_MESSAGE : s.messageWeakSite || DEFAULT_WEAK_MESSAGE;
    return LF.fillMessage(template, lead, {
      issues: issueSentence(ev.issues),
      followers: ev.followers != null ? formatCount(ev.followers) : '',
    });
  }

  // ─── Exports ───────────────────────────────────────────────────────────────

  const VERDICT_NAMES = { hot: 'Hot', good: 'Good', low: 'Low', checking: 'Checking' };

  /** Google Contacts "Google CSV" import format. */
  function contactsRows(leads, s) {
    const rows = [['Name', 'Given Name', 'Organization 1 - Name', 'Phone 1 - Type', 'Phone 1 - Value', 'Notes', 'Group Membership']];
    leads.forEach((l) => {
      const ev = evaluate(l, s);
      const display = [s.contactPrefix, LF.cleanName(l.name) || LF.formatPhone(l.e164)].filter(Boolean).join(' ');
      const notes = [
        VERDICT_NAMES[ev.verdict] + ' lead (' + ev.score + '/100): ' + ev.reasons.map((r) => r.text).join('; '),
        l.website ? 'Website: ' + l.website : '',
        l.query ? 'Google Maps search: ' + l.query : 'From Google Maps',
        l.category,
        l.address,
        l.mapsUrl,
      ].filter(Boolean).join('\n');
      const groups = s.contactLabel ? s.contactLabel + ' ::: * myContacts' : '* myContacts';
      rows.push([display, display, LF.cleanName(l.name), 'Mobile', l.e164, notes, groups]);
    });
    return rows;
  }

  /** Stops spreadsheet apps from running text that starts like a formula (=, +, -, @). */
  function cell(v) {
    if (typeof v !== 'string') return v;
    return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
  }

  function sheetRows(leads, s) {
    const rows = [[
      'Mobile', 'Business', 'Verdict', 'Score', 'Why', 'Website', 'Website issues', 'Instagram', 'Followers',
      'Google rating', 'Google reviews', 'Category', 'Address', 'Status', 'Added', 'Last contacted', 'Google Maps', 'Search',
    ]];
    leads.forEach((l) => {
      const ev = evaluate(l, s);
      rows.push(
        [
          LF.formatPhone(l.e164), // "+971 50 …" with spaces stays text in spreadsheets
          cell(l.name),
          VERDICT_NAMES[ev.verdict],
          ev.score,
          cell(ev.reasons.map((r) => r.text).join('; ')),
          cell(l.website || ''),
          cell(ev.issues.map((i) => i.chip).join(', ')),
          ev.handle ? 'https://www.instagram.com/' + ev.handle + '/' : '',
          ev.followers != null ? ev.followers : '',
          l.rating != null ? l.rating : '',
          l.reviews != null ? l.reviews : '',
          cell(l.category),
          cell(l.address),
          l.status,
          (l.added || '').slice(0, 10),
          (l.contacted || '').slice(0, 10),
          cell(l.mapsUrl),
          cell(l.query),
        ]
      );
    });
    return rows;
  }

  Object.assign(LF, {
    ISSUES,
    DEFAULT_CRITERIA,
    DEFAULT_WEAK_MESSAGE,
    parseFollowers,
    formatCount,
    instagramOf,
    websiteKind,
    websiteIssues,
    evaluate,
    issueSentence,
    messageFor,
    contactsRows,
    sheetRows,
  });
})(globalThis);
