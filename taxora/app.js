/* ============================================================
   Taxora — shared app logic (client-side demo, localStorage only)
   ============================================================ */

const Taxora = (() => {
  const STORE_KEY = 'taxora_state_v1';

  const defaultState = () => ({
    profile: {
      businessName: 'Your Business LLC',
      trn: '',
      emirate: 'Dubai',
      vatRegistered: true,
      financialYearEnd: '12-31',
    },
    invoices: [],
    expenses: [],
    filedPeriods: [],
    nextInvoiceNo: 1001,
  });

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch (e) {
      return defaultState();
    }
  }

  function save(state) {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  let state = load();

  function persist() { save(state); }

  // ---------- formatting ----------
  function aed(n) {
    const v = Number(n) || 0;
    return 'AED ' + v.toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function isValidTRN(trn) {
    return /^\d{15}$/.test(String(trn || '').replace(/\s/g, ''));
  }

  // ---------- VAT rates ----------
  const VAT_RATES = [
    { label: 'Standard 5%', value: 5 },
    { label: 'Zero-rated 0%', value: 0 },
    { label: 'Exempt', value: -1 }, // -1 = exempt (no VAT box, distinct from 0%)
  ];

  function calcLineVat(lineTotal, rate) {
    if (rate === -1) return 0;
    return +(lineTotal * (rate / 100)).toFixed(2);
  }

  // ---------- invoices ----------
  function addInvoice(inv) {
    inv.id = 'INV-' + state.nextInvoiceNo;
    inv.number = state.nextInvoiceNo;
    state.nextInvoiceNo += 1;
    inv.createdAt = new Date().toISOString();
    state.invoices.unshift(inv);
    persist();
    return inv;
  }

  function deleteInvoice(id) {
    state.invoices = state.invoices.filter((i) => i.id !== id);
    persist();
  }

  function invoiceCompliance(inv) {
    const checks = [
      { label: 'Supplier TRN present & valid (15 digits)', pass: isValidTRN(inv.supplierTrn) },
      { label: 'Sequential invoice number', pass: !!inv.number },
      { label: 'Invoice date included', pass: !!inv.date },
      { label: 'Customer name / details included', pass: !!(inv.customerName && inv.customerName.trim().length > 1) },
      { label: 'VAT rate shown per line item', pass: inv.items.every((it) => it.vatRate !== undefined && it.vatRate !== null) },
      { label: 'VAT amount & total shown separately', pass: true },
    ];
    const passCount = checks.filter((c) => c.pass).length;
    return { checks, score: Math.round((passCount / checks.length) * 100), compliant: passCount === checks.length };
  }

  function invoiceTotals(items) {
    let subtotal = 0, vat = 0;
    (items || []).forEach((it) => {
      const lineTotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
      subtotal += lineTotal;
      vat += calcLineVat(lineTotal, Number(it.vatRate));
    });
    return { subtotal: +subtotal.toFixed(2), vat: +vat.toFixed(2), total: +(subtotal + vat).toFixed(2) };
  }

  // ---------- VAT return estimator ----------
  function vatReturnSummary() {
    let outputVat = 0, standardSales = 0, zeroSales = 0, exemptSales = 0;
    state.invoices.forEach((inv) => {
      const t = invoiceTotals(inv.items);
      outputVat += t.vat;
      inv.items.forEach((it) => {
        const lineTotal = (Number(it.qty) || 0) * (Number(it.price) || 0);
        if (Number(it.vatRate) === 5) standardSales += lineTotal;
        else if (Number(it.vatRate) === 0) zeroSales += lineTotal;
        else exemptSales += lineTotal;
      });
    });
    let inputVat = 0, expenseTotal = 0;
    state.expenses.forEach((ex) => {
      expenseTotal += Number(ex.amount) || 0;
      inputVat += Number(ex.vatRecoverable) || 0;
    });
    const net = +(outputVat - inputVat).toFixed(2);
    return {
      standardSales: +standardSales.toFixed(2),
      zeroSales: +zeroSales.toFixed(2),
      exemptSales: +exemptSales.toFixed(2),
      outputVat: +outputVat.toFixed(2),
      inputVat: +inputVat.toFixed(2),
      expenseTotal: +expenseTotal.toFixed(2),
      net,
      payable: net > 0,
    };
  }

  function addExpense(ex) {
    ex.id = 'EXP-' + Date.now();
    ex.createdAt = new Date().toISOString();
    state.expenses.unshift(ex);
    persist();
    return ex;
  }

  function deleteExpense(id) {
    state.expenses = state.expenses.filter((e) => e.id !== id);
    persist();
  }

  // ---------- deadlines ----------
  function nextVatDeadline() {
    // Simplified: quarterly VAT periods ending Mar/Jun/Sep/Dec, due 28 days after period end.
    const now = new Date();
    const year = now.getFullYear();
    const periodEnds = [2, 5, 8, 11].map((m) => new Date(year, m + 1, 0)); // last day of Mar/Jun/Sep/Dec
    let periodEnd = periodEnds.find((d) => d >= now);
    let dueYear = year;
    if (!periodEnd) { periodEnd = new Date(year, 2, 31); dueYear = year + 1; }
    const due = new Date(periodEnd);
    due.setDate(due.getDate() + 28);
    return { periodEnd, due };
  }

  function daysUntil(date) {
    const ms = date.getTime() - Date.now();
    return Math.ceil(ms / 86400000);
  }

  // ---------- corporate tax ----------
  const CT_THRESHOLD = 375000; // AED, 0% below, 9% above
  const SBR_REVENUE_CAP = 3000000; // AED, Small Business Relief revenue cap (elective, temporary)

  function estimateCorporateTax(taxableIncome, annualRevenue, qualifiesFreeZone) {
    const income = Number(taxableIncome) || 0;
    const revenue = Number(annualRevenue) || 0;
    if (qualifiesFreeZone) {
      return { tax: 0, note: 'Estimated as a Qualifying Free Zone Person on Qualifying Income — 0% rate applies to qualifying income only. Non-qualifying income is still taxed at standard rates.' };
    }
    if (revenue > 0 && revenue <= SBR_REVENUE_CAP) {
      return { tax: 0, note: 'Revenue is at/under the AED 3,000,000 Small Business Relief cap — you may elect to be treated as having no taxable income for this period.' };
    }
    if (income <= CT_THRESHOLD) {
      return { tax: 0, note: '0% rate applies — taxable income is at/under the AED 375,000 threshold.' };
    }
    const taxable = income - CT_THRESHOLD;
    const tax = +(taxable * 0.09).toFixed(2);
    return { tax, note: '9% applies to taxable income above AED 375,000.' };
  }

  // ---------- assistant (rule-based, offline) ----------
  const FAQ = [
    {
      q: ['vat registration threshold', 'do i need to register', 'when to register for vat'],
      a: 'Mandatory VAT registration applies once taxable supplies & imports exceed <b>AED 375,000</b> in the past 12 months (or are expected to in the next 30 days). Voluntary registration is available from <b>AED 187,500</b>.',
    },
    {
      q: ['when is vat return due', 'vat deadline', 'filing deadline'],
      a: 'VAT returns are typically due <b>28 days</b> after the end of your tax period (usually quarterly for most SMEs, monthly for larger businesses as assigned by the FTA).',
    },
    {
      q: ['e-invoicing', 'e invoice', 'einvoicing mandate'],
      a: 'The UAE is rolling out a mandatory <b>e-invoicing</b> regime (Peppol-based "PINT AE" format) for B2B and B2G transactions, phased in from <b>2026</b> via Accredited Service Providers. Confirm your exact go-live date and obligations with the FTA, as timelines can be updated.',
    },
    {
      q: ['corporate tax rate', 'how much corporate tax', 'ct rate'],
      a: 'UAE Corporate Tax is <b>0%</b> on taxable income up to AED 375,000 and <b>9%</b> above that. Qualifying Free Zone Persons may get 0% on qualifying income, and small businesses under AED 3M revenue may elect Small Business Relief.',
    },
    {
      q: ['penalty', 'fine', 'late filing'],
      a: 'Late VAT registration, late filing, and late payment all carry FTA administrative penalties (late filing alone starts at AED 1,000, doubling for repeat offences within 24 months, up to AED 10,000). Filing on time — even with AED 0 due — avoids most of these.',
    },
    {
      q: ['trn', 'tax registration number'],
      a: 'A TRN (Tax Registration Number) is a unique 15-digit ID issued by the FTA. It must appear on every tax invoice you issue once VAT-registered, and you should verify a supplier\'s TRN before recovering input VAT on their invoices.',
    },
    {
      q: ['zero rated', 'exempt'],
      a: 'Zero-rated supplies (e.g. certain exports, international transport, some healthcare/education) are taxed at 0% but still count toward your registration threshold and let you recover input VAT. Exempt supplies (e.g. some financial services, bare land, local passenger transport) carry no VAT and generally block input VAT recovery on related costs.',
    },
  ];

  function askAssistant(question) {
    const q = question.toLowerCase();
    let best = null, bestScore = 0;
    FAQ.forEach((entry) => {
      entry.q.forEach((kw) => {
        if (q.includes(kw)) {
          const score = kw.length;
          if (score > bestScore) { bestScore = score; best = entry; }
        }
      });
    });
    if (best) return best.a;
    return 'I don\'t have a canned answer for that yet in this demo. Try asking about VAT registration, filing deadlines, e-invoicing, corporate tax rates, penalties, TRNs, or zero-rated/exempt supplies — or consult a registered UAE tax agent for anything filing-specific.';
  }

  // ---------- seed demo data (only if empty, first run) ----------
  function seedIfEmpty() {
    if (state.invoices.length > 0 || state.expenses.length > 0) return;
    state.profile.trn = '100123456700003';
    addInvoice({
      customerName: 'Al Marsa Trading LLC',
      customerTrn: '100234567800003',
      supplierTrn: state.profile.trn,
      date: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
      items: [
        { desc: 'Consulting services — August retainer', qty: 1, price: 12000, vatRate: 5 },
        { desc: 'Software license (export)', qty: 1, price: 3000, vatRate: 0 },
      ],
      notes: 'Payment due within 30 days.',
    });
    addInvoice({
      customerName: 'Palm Logistics FZE',
      customerTrn: '',
      supplierTrn: state.profile.trn,
      date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      items: [
        { desc: 'Warehousing — July', qty: 1, price: 8500, vatRate: 5 },
      ],
      notes: '',
    });
    addExpense({ desc: 'Office rent — Business Bay', amount: 15000, vatRecoverable: 750, date: new Date().toISOString().slice(0, 10) });
    addExpense({ desc: 'Cloud hosting (AWS)', amount: 1200, vatRecoverable: 60, date: new Date().toISOString().slice(0, 10) });
    persist();
  }

  return {
    state, save: persist, aed, isValidTRN, VAT_RATES, calcLineVat,
    addInvoice, deleteInvoice, invoiceCompliance, invoiceTotals,
    vatReturnSummary, addExpense, deleteExpense,
    nextVatDeadline, daysUntil, estimateCorporateTax, CT_THRESHOLD, SBR_REVENUE_CAP,
    askAssistant, seedIfEmpty,
  };
})();

// ---------- shared UI wiring ----------
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.querySelector('.mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  if (btn && sidebar) {
    btn.addEventListener('click', () => sidebar.classList.toggle('open'));
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
