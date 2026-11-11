import {
  PDFDocument,
  PDFString,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  setCharacterSpacing,
  moveTo,
  lineTo,
  appendBezierCurve,
  closePath,
  clip,
  endPath,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import * as assets from './assets.mts';
import { aed, dubaiDay, fmtDay, fmtTime, money, payTotal, type Invoice, type Settings } from './core.mts';

/**
 * The invoice as an A4 PDF, in the same look as the payment page: Archivo, the chrome banner with the
 * amount, black pill button. Unpaid invoices carry a clickable pay button and a QR code; paid ones
 * become the receipt.
 */

export interface PdfContext {
  settings: Settings;
  /** The client's payment page, e.g. https://www.rizcoreach.ae/pay/<token>. */
  payUrl: string;
  /** Marks the document as a test (Ziina test mode). */
  test: boolean;
  now: number;
}

const W = 595.28;
const H = 841.89;
const M = 44;
const CW = W - 2 * M;
const BOTTOM = H - 62;

const INK = rgb(0.04, 0.04, 0.04);
const GREY = rgb(0.42, 0.42, 0.42);
const SOFT = rgb(0.29, 0.29, 0.29);
const LINE = rgb(0.9, 0.9, 0.9);
const PANEL = rgb(0.953, 0.953, 0.953);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.043, 0.231, 0.086);
const GREEN_BG = rgb(0.875, 0.953, 0.89);
const AMBER_BG = rgb(0.96, 0.77, 0.32);

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'));
const KAPPA = 0.5523;

export async function renderInvoicePdf(inv: Invoice, ctx: PdfContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as unknown as Parameters<typeof doc.registerFontkit>[0]);
  const [regular, semibold, wide] = await Promise.all([doc.embedFont(bytes(assets.regular), { subset: true }), doc.embedFont(bytes(assets.semibold), { subset: true }), doc.embedFont(bytes(assets.wide), { subset: true })]);
  const mark = await doc.embedPng(bytes(assets.mark));
  const banner = await doc.embedJpg(bytes(assets.banner));

  const biz = ctx.settings.business;
  const paid = inv.status === 'paid';
  const title = paid ? 'Receipt' : 'Invoice';
  doc.setTitle(`${title} ${inv.number}`);
  doc.setAuthor(biz.name);
  doc.setSubject(`${title} ${inv.number} for ${inv.client}`);
  doc.setCreator(biz.name);
  doc.setProducer(biz.name);
  doc.setCreationDate(new Date(ctx.now));
  doc.setModificationDate(new Date(ctx.now));

  // The fonts cover Latin text. Anything else is dropped rather than breaking the PDF.
  const known = new Set(regular.getCharacterSet());
  const safe = (s: string) =>
    Array.from(String(s ?? ''))
      .map((ch) => (known.has(ch.codePointAt(0) as number) ? ch : /\s/.test(ch) ? ' ' : ''))
      .join('')
      .replace(/ {2,}/g, ' ')
      .trim();

  let page!: PDFPage;
  let y = 0; // distance from the top of the page
  const top = (v: number) => H - v;

  type TextOpts = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; spacing?: number; align?: 'left' | 'right' | 'center' };
  const widthOf = (s: string, font: PDFFont, size: number, spacing = 0) => font.widthOfTextAtSize(s, size) + spacing * Math.max(0, s.length - 1);
  /** Draws one line with its baseline at `yy` from the top. `x` is the left edge, right edge or centre per `align`. */
  const put = (raw: string, x: number, yy: number, o: TextOpts = {}) => {
    const s = safe(raw);
    if (!s) return 0;
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const w = widthOf(s, font, size, o.spacing);
    const left = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    if (o.spacing) page.pushOperators(setCharacterSpacing(o.spacing));
    page.drawText(s, { x: left, y: top(yy), size, font, color: o.color ?? INK });
    if (o.spacing) page.pushOperators(setCharacterSpacing(0));
    return w;
  };
  const wrap = (raw: string, font: PDFFont, size: number, max: number): string[] => {
    const out: string[] = [];
    for (const para of String(raw ?? '').split('\n')) {
      let line = '';
      for (const word of safe(para).split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && font.widthOfTextAtSize(next, size) > max) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out.filter((l, i, a) => l || (i > 0 && i < a.length - 1));
  };
  const label = (s: string, x: number, yy: number, align: TextOpts['align'] = 'left') => put(s.toUpperCase(), x, yy, { size: 7, color: GREY, spacing: 1.1, align });
  const rule = (yy: number, x1 = M, x2 = M + CW) => page.drawLine({ start: { x: x1, y: top(yy) }, end: { x: x2, y: top(yy) }, thickness: 0.7, color: LINE });
  const roundPath = (x: number, yy: number, w: number, h: number, r: number) => {
    const b = top(yy + h); // bottom edge in PDF space
    const k = r * KAPPA;
    return [
      moveTo(x + r, b),
      lineTo(x + w - r, b),
      appendBezierCurve(x + w - r + k, b, x + w, b + r - k, x + w, b + r),
      lineTo(x + w, b + h - r),
      appendBezierCurve(x + w, b + h - r + k, x + w - r + k, b + h, x + w - r, b + h),
      lineTo(x + r, b + h),
      appendBezierCurve(x + r - k, b + h, x, b + h - r + k, x, b + h - r),
      lineTo(x, b + r),
      appendBezierCurve(x, b + r - k, x + r - k, b, x + r, b),
      closePath(),
    ];
  };
  const box = (x: number, yy: number, w: number, h: number, r: number, color: ReturnType<typeof rgb>) => {
    const rr = Math.min(r, h / 2, w / 2);
    page.drawSvgPath(`M ${rr} 0 H ${w - rr} A ${rr} ${rr} 0 0 1 ${w} ${rr} V ${h - rr} A ${rr} ${rr} 0 0 1 ${w - rr} ${h} H ${rr} A ${rr} ${rr} 0 0 1 0 ${h - rr} V ${rr} A ${rr} ${rr} 0 0 1 ${rr} 0 Z`, { x, y: top(yy), color });
  };
  const image = (img: PDFImage, x: number, yy: number, w: number, h: number, r: number) => {
    page.pushOperators(pushGraphicsState(), ...roundPath(x, yy, w, h, r), clip(), endPath());
    page.drawImage(img, { x, y: top(yy + h), width: w, height: h });
    page.pushOperators(popGraphicsState());
  };
  const pill = (s: string, x: number, yy: number, o: { bg: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb>; size?: number; h?: number; pad?: number; align?: 'left' | 'right' }) => {
    const size = o.size ?? 9;
    const h = o.h ?? 20;
    const pad = o.pad ?? 11;
    const w = widthOf(safe(s), semibold, size) + 2 * pad;
    const left = o.align === 'right' ? x - w : x;
    box(left, yy, w, h, h / 2, o.bg);
    put(s, left + pad, yy + h / 2 + size * 0.35, { font: semibold, size, color: o.fg });
    return { x: left, w, h };
  };
  const link = (x: number, yy: number, w: number, h: number, url: string) => {
    const ref = doc.context.register(
      doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, top(yy + h), x + w, top(yy)], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }),
    );
    page.node.addAnnot(ref);
  };

  const footerLine = [biz.name, ...biz.address.split('\n').slice(0, 2), biz.email, biz.phone, biz.website].map(safe).filter(Boolean).join('  ·  ');
  const newPage = (first: boolean) => {
    page = doc.addPage([W, H]);
    rule(H - 46);
    put(footerLine, W / 2, H - 31, { size: 7.5, color: GREY, align: 'center' });
    y = M;
    if (!first) {
      put(`${title} ${inv.number}`, M, y + 8, { font: semibold, size: 9, color: GREY });
      y += 28;
    }
  };
  /** Starts a new page when the next block of height `h` won't fit. */
  const need = (h: number) => {
    if (y + h > BOTTOM) newPage(false);
  };

  /* ------------------------------------------------------------- header */
  newPage(true);
  page.drawCircle({ x: M + 17, y: top(y + 17), size: 17, color: INK });
  page.drawImage(mark, { x: M + 7, y: top(y + 27), width: 20, height: 20 });
  const wordW = put('RIZCOREACH', M + 44, y + 21, { font: semibold, size: 10, spacing: 2.1 });
  put('.AE', M + 44 + wordW + 2.4, y + 21, { size: 10, color: GREY, spacing: 0.8 });
  put(title.toUpperCase(), M + CW, y + 20, { font: wide, size: 22, align: 'right' });
  put(inv.number, M + CW, y + 35, { size: 10, color: GREY, align: 'right' });
  y += 52;

  /* ------------------------------------------------------------- banner */
  const bannerH = 96;
  image(banner, M, y, CW, bannerH, 14);
  const total = payTotal(inv);
  const bannerText = paid ? `${aed(inv.paidAmount || inv.amount)} paid` : `${aed(total)} ${inv.dueOn ? `due ${fmtDay(inv.dueOn)}` : 'to pay'}`;
  pill(bannerText, M + 12, y + bannerH - 12 - 26, { bg: WHITE, fg: INK, size: 10.5, h: 26, pad: 14 });
  let tagX = M + CW - 12;
  if (paid) tagX = pill('PAID', tagX, y + 12, { bg: GREEN_BG, fg: GREEN, align: 'right' }).x - 6;
  if (ctx.test || inv.paidTest) pill('TEST', tagX, y + 12, { bg: AMBER_BG, fg: INK, align: 'right' });
  y += bannerH + 30;

  /* --------------------------------------------------------------- meta */
  const col2 = M + 186;
  const col3 = M + 372;
  const metaTop = y;
  const party = (x: number, heading: string, name: string, lines: string[], width: number) => {
    let yy = metaTop;
    label(heading, x, yy);
    yy += 16;
    for (const l of wrap(name, semibold, 11, width)) {
      put(l, x, yy, { font: semibold, size: 11 });
      yy += 14;
    }
    yy += 1;
    for (const raw of lines.filter(Boolean))
      for (const l of wrap(raw, regular, 9, width)) {
        put(l, x, yy, { size: 9, color: SOFT });
        yy += 12.5;
      }
    return yy;
  };
  const endA = party(M, 'Billed to', inv.client, [inv.clientAddress, inv.clientEmail], 168);
  const endB = party(col2, 'From', biz.name, [biz.address, biz.email, biz.phone], 168);
  let yy = metaTop;
  const fact = (k: string, v: string) => {
    if (!v) return;
    label(k, col3, yy);
    put(v, col3, yy + 14, { font: semibold, size: 10 });
    yy += 34;
  };
  fact('Invoice no.', inv.number);
  fact('Issued', fmtDay(inv.issuedOn));
  if (paid && inv.paidAt) fact('Paid on', fmtDay(dubaiDay(inv.paidAt)));
  else fact('Due', inv.dueOn ? fmtDay(inv.dueOn) : 'On receipt');
  y = Math.max(endA, endB, yy - 14) + 22;

  /* -------------------------------------------------------------- items */
  const simple = inv.items.every((i) => i.qty === 1);
  const right = M + CW;
  const descW = simple ? CW - 120 : CW - 250;
  const tableHead = () => {
    label('Description', M, y);
    if (!simple) {
      label('Qty', right - 190, y, 'right');
      label('Rate', right - 95, y, 'right');
    }
    label('Amount', right, y, 'right');
    y += 9;
    rule(y);
  };
  tableHead();
  for (const item of inv.items) {
    const lines = wrap(item.description || 'Services', regular, 10, descW);
    const rowH = Math.max(1, lines.length) * 13.5 + 15;
    if (y + rowH > BOTTOM) {
      newPage(false);
      tableHead();
    }
    let ly = y + 19;
    for (const l of lines) {
      put(l, M, ly, { size: 10 });
      ly += 13.5;
    }
    if (!simple) {
      put(String(item.qty), right - 190, y + 19, { size: 10, color: SOFT, align: 'right' });
      put(money(item.rate), right - 95, y + 19, { size: 10, color: SOFT, align: 'right' });
    }
    put(money(item.amount), right, y + 19, { size: 10, align: 'right' });
    y += rowH;
    rule(y);
  }

  /* ------------------------------------------------------------- totals */
  const tx = right - 230;
  const paidOnline = paid && inv.paidAmount > inv.amount;
  const showFee = (!paid && inv.onlineFee > 0) || paidOnline;
  need(showFee ? 92 : 56);
  y += 20;
  const totalRow = (k: string, v: string) => {
    put(k, tx, y, { size: 9.5, color: SOFT });
    put(v, right, y, { size: 9.5, align: 'right' });
    y += 18;
  };
  if (showFee) {
    totalRow('Invoice total', aed(inv.amount));
    totalRow('Online payment fee', aed(paidOnline ? inv.paidAmount - inv.amount : inv.onlineFee));
    rule(y - 8, tx, right);
    y += 8;
  }
  put(paid ? 'Amount paid' : showFee ? 'To pay online' : 'Total due', tx, y + 3, { font: semibold, size: 10.5 });
  put(aed(paid ? inv.paidAmount || inv.amount : total), right, y + 4, { font: wide, size: 15, align: 'right' });
  y += 30;

  /* ---------------------------------------------------- pay / paid panel */
  if (paid) {
    const rows: [string, string][] = [['Paid on', inv.paidAt ? fmtTime(inv.paidAt) : '']];
    if (inv.paidVia === 'ziina') {
      rows.push(['Paid via', inv.cardLast4 ? `Ziina, ${inv.cardBrand ? inv.cardBrand.charAt(0) + inv.cardBrand.slice(1).toLowerCase() : 'card'} ending ${inv.cardLast4}` : 'Ziina']);
      if (inv.paymentId) rows.push(['Reference', inv.paymentId]);
    }
    const h = 34 + rows.length * 17;
    need(h + 16);
    box(M, y, CW, h, 14, PANEL);
    put('Payment received', M + 18, y + 26, { font: semibold, size: 11.5 });
    put('Thank you. This document is your receipt.', right - 18, y + 26, { size: 9, color: SOFT, align: 'right' });
    let ry = y + 47;
    for (const [k, v] of rows.filter((r) => r[1])) {
      put(k, M + 18, ry, { size: 9, color: GREY });
      put(v, M + 110, ry, { size: 9 });
      ry += 17;
    }
    y += h + 18;
  } else if (inv.status === 'unpaid') {
    const h = 112;
    need(h + 16);
    box(M, y, CW, h, 14, PANEL);
    const qrSize = 78;
    const qx = right - 16 - qrSize;
    box(qx, y + 17, qrSize, qrSize, 8, WHITE);
    const qr = qrcode(0, 'M');
    qr.addData(ctx.payUrl);
    qr.make();
    const n = qr.getModuleCount();
    const cell = (qrSize - 12) / n;
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c)) page.drawRectangle({ x: qx + 6 + c * cell, y: top(y + 17 + 6 + (r + 1) * cell), width: cell + 0.05, height: cell + 0.05, color: INK });
    link(qx, y + 17, qrSize, qrSize, ctx.payUrl);

    put('Secure checkout with Ziina', M + 18, y + 27, { font: semibold, size: 11.5 });
    const blurb = wrap('Pay with Apple Pay, Google Pay or card. Ziina is our payment partner, licensed by the Central Bank of the UAE. Your card details go to Ziina, never to us.', regular, 8.5, qx - M - 18 - 22);
    let by = y + 42;
    for (const l of blurb) {
      put(l, M + 18, by, { size: 8.5, color: SOFT });
      by += 11.5;
    }
    const btnText = `Pay ${aed(total)} online`;
    const btn = pill(btnText, M + 18, y + h - 16 - 28, { bg: INK, fg: WHITE, size: 10, h: 28, pad: 18 });
    link(btn.x, y + h - 16 - 28, btn.w, btn.h, ctx.payUrl);
    const shown = ctx.payUrl.replace(/^https?:\/\/(www\.)?/, '');
    const urlW = put(shown.length > 52 ? `${shown.slice(0, 50)}...` : shown, btn.x + btn.w + 12, y + h - 16 - 10, { size: 7.5, color: GREY });
    link(btn.x + btn.w + 12, y + h - 16 - 20, urlW, 14, ctx.payUrl);
    y += h + 18;
  }

  /* ------------------------------------------------------ bank and notes */
  const block = (heading: string, body: string) => {
    const lines = wrap(body, regular, 9, CW);
    if (!lines.length) return;
    need(18 + lines.length * 12.5 + 10);
    label(heading, M, y + 4);
    y += 18;
    for (const l of lines) {
      put(l, M, y, { size: 9, color: SOFT });
      y += 12.5;
    }
    y += 12;
  };
  if (inv.status === 'unpaid' && biz.bank) block(inv.onlineFee > 0 ? `Bank transfer (${aed(inv.amount)}, no online fee)` : 'Bank transfer', biz.bank);
  if (inv.notes) block('Notes', inv.notes);

  if (doc.getPageCount() > 1) {
    doc.getPages().forEach((p, i, all) => {
      const s = `Page ${i + 1} of ${all.length}`;
      p.drawText(s, { x: M + CW - regular.widthOfTextAtSize(s, 7.5), y: H - 31, size: 7.5, font: regular, color: GREY });
    });
  }
  return doc.save();
}
