import nodemailer from 'nodemailer';
import { aed, diffDays, fmtDay, fmtTime, payTotal, type Invoice, type MailKind, type Settings } from './core.mts';

/**
 * Invoice emails: the invoice itself, a reminder, the receipt, and a "you got paid" note to the owner.
 * They go out from the owner's own mailbox over SMTP (set SMTP_USER and SMTP_PASS in Netlify), so
 * clients see a normal email from RizcoReach and replies land in the same inbox.
 */

export interface MailMessage {
  to: string;
  fromName: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Uint8Array; contentType: string }[];
}
export type Mailer = (msg: MailMessage) => Promise<void>;

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function smtpMailer(cfg: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
  return async (msg) => {
    await transport.sendMail({
      from: { name: msg.fromName, address: cfg.from },
      to: msg.to,
      replyTo: cfg.from,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: (msg.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })),
    });
  };
}

export interface MailContext {
  settings: Settings;
  /** The client's payment page for this invoice. */
  payUrl: string;
  /** The site the links and the logo point at, e.g. https://www.rizcoreach.ae. */
  site: string;
  test: boolean;
  today: string;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const card = (inv: Invoice) => (inv.cardLast4 ? `${inv.cardBrand ? inv.cardBrand.charAt(0) + inv.cardBrand.slice(1).toLowerCase() : 'Card'} ending ${inv.cardLast4}` : '');

interface Parts {
  subject: string;
  heading: string;
  /** Paragraphs above the amount. */
  intro: string[];
  amountLabel: string;
  amount: string;
  rows: [string, string][];
  button: { label: string; url: string };
  /** Paragraphs under the button. */
  outro: string[];
}

function parts(kind: MailKind, inv: Invoice, ctx: MailContext): Parts {
  const biz = ctx.settings.business.name;
  const total = payTotal(inv);
  const due = inv.dueOn ? fmtDay(inv.dueOn) : '';
  const lineFee = inv.onlineFee > 0;
  const invoiceRows: [string, string][] = [
    ['Invoice', inv.number],
    ['For', inv.description],
    ['Issued', fmtDay(inv.issuedOn)],
    ['Due', due || 'On receipt'],
    ...(lineFee ? ([['Invoice total', aed(inv.amount)], ['Online payment fee', aed(inv.onlineFee)]] as [string, string][]) : []),
  ];
  const payLine = 'You can pay with Apple Pay, Google Pay or card through Ziina, our payment partner, licensed by the Central Bank of the UAE.';

  if (kind === 'invoice')
    return {
      subject: `Invoice ${inv.number} from ${biz} (${aed(total)})`,
      heading: `Invoice ${inv.number}`,
      intro: [`Hello ${inv.client},`, `Here is your invoice from ${biz}${due ? `, due ${due}` : ''}.`],
      amountLabel: lineFee ? 'To pay online' : 'Amount due',
      amount: aed(total),
      rows: invoiceRows,
      button: { label: 'View and pay invoice', url: ctx.payUrl },
      outro: [payLine, 'A PDF copy of this invoice is attached.'],
    };

  if (kind === 'reminder') {
    const late = inv.dueOn ? diffDays(inv.dueOn, ctx.today) : 0;
    const state = !inv.dueOn ? 'is still open' : late > 0 ? `is ${late} ${late === 1 ? 'day' : 'days'} overdue` : late === 0 ? 'is due today' : `is due ${due}`;
    return {
      subject: `Reminder: invoice ${inv.number} ${state}`,
      heading: 'Payment reminder',
      intro: [`Hello ${inv.client},`, `This is a friendly reminder that invoice ${inv.number} from ${biz} ${state}.`],
      amountLabel: lineFee ? 'To pay online' : 'Amount due',
      amount: aed(total),
      rows: invoiceRows,
      button: { label: 'View and pay invoice', url: ctx.payUrl },
      outro: [payLine, 'If you have already paid, thank you, and please ignore this message. The invoice is attached as a PDF.'],
    };
  }

  const paidAmount = inv.paidAmount || inv.amount;
  const paidRows: [string, string][] = [
    ['Invoice', inv.number],
    ['For', inv.description],
    ['Paid on', inv.paidAt ? fmtTime(inv.paidAt) : ''],
    ['Paid via', inv.paidVia === 'ziina' ? ['Ziina', card(inv)].filter(Boolean).join(', ') : ''],
    ['Reference', inv.paidVia === 'ziina' ? inv.paymentId : ''],
  ];
  if (kind === 'receipt')
    return {
      subject: `Receipt for invoice ${inv.number} (${aed(paidAmount)} paid)`,
      heading: 'Payment received',
      intro: [`Hello ${inv.client},`, `Thank you. We received your payment for invoice ${inv.number}.`],
      amountLabel: 'Amount paid',
      amount: aed(paidAmount),
      rows: paidRows,
      button: { label: 'View receipt', url: ctx.payUrl },
      outro: ['Your receipt is attached as a PDF.'],
    };

  const fee = inv.ziinaFee;
  return {
    subject: `Paid: ${inv.number}, ${aed(paidAmount)} from ${inv.client}`,
    heading: 'You got paid',
    intro: [`${inv.client} paid invoice ${inv.number}.`],
    amountLabel: 'Amount paid',
    amount: aed(paidAmount),
    rows: [
      ...paidRows,
      ['Ziina fee', fee === null ? '' : aed(fee)],
      ['You receive', fee === null ? '' : aed(paidAmount - fee)],
    ],
    button: { label: 'Open invoices', url: `${ctx.site}/invoices` },
    outro: inv.paidTest ? ['This was a test payment. No money moved.'] : [],
  };
}

/** Subject, plain text and HTML for one email. The PDF is attached by the caller. */
export function buildEmail(kind: MailKind, inv: Invoice, ctx: MailContext): { subject: string; text: string; html: string } {
  const p = parts(kind, inv, ctx);
  const biz = ctx.settings.business;
  const rows = p.rows.filter((r) => r[1]);
  const subject = `${ctx.test ? '[TEST] ' : ''}${p.subject}`;
  const contact = [biz.email, biz.phone, biz.website].filter(Boolean).join(' · ');

  const text = [
    ...p.intro,
    '',
    `${p.amountLabel}: ${p.amount}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `${p.button.label}: ${p.button.url}`,
    '',
    ...p.outro,
    '',
    biz.name,
    contact,
  ].join('\n');

  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f3f3;${font}color:#0a0a0a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(`${p.amountLabel} ${p.amount}. ${p.intro[p.intro.length - 1]}`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f3f3;">
<tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 6px 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;"><img src="${esc(ctx.site)}/pay-assets/avatar.png" width="40" height="40" alt="" style="display:block;border:0;border-radius:50%;"></td>
      <td style="vertical-align:middle;padding-left:11px;${font}font-size:13px;font-weight:700;letter-spacing:2.4px;color:#0a0a0a;">RIZCOREACH<span style="font-weight:400;color:#8a8a8a;letter-spacing:1px;">.AE</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:24px;padding:30px 28px 28px;">
    ${ctx.test ? `<p style="margin:0 0 16px;display:inline-block;background:#f5c451;color:#1d1500;border-radius:99px;padding:4px 12px;${font}font-size:12px;font-weight:700;">Test mode</p>` : ''}
    <h1 style="margin:0 0 14px;${font}font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.3px;color:#0a0a0a;">${esc(p.heading)}</h1>
    ${p.intro.map((t) => `<p style="margin:0 0 8px;${font}font-size:15px;line-height:1.55;color:#4a4a4a;">${esc(t)}</p>`).join('\n    ')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 6px;background:#f3f3f3;border-radius:16px;"><tr><td style="padding:18px 20px;">
      <p style="margin:0 0 4px;${font}font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#6b6b6b;">${esc(p.amountLabel)}</p>
      <p style="margin:0;${font}font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.4px;color:#0a0a0a;">${esc(p.amount)}</p>
    </td></tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;">
      ${rows.map(([k, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #ececec;${font}font-size:14px;color:#6b6b6b;vertical-align:top;width:120px;">${esc(k)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #ececec;${font}font-size:14px;color:#0a0a0a;word-break:break-word;">${esc(v)}</td></tr>`).join('\n      ')}
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#0a0a0a" style="border-radius:999px;">
      <a href="${esc(p.button.url)}" style="display:block;padding:17px 24px;${font}font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(p.button.label)}</a>
    </td></tr></table>
    ${p.outro.map((t) => `<p style="margin:16px 0 0;${font}font-size:13px;line-height:1.55;color:#6b6b6b;text-align:center;">${esc(t)}</p>`).join('\n    ')}
  </td></tr>
  <tr><td style="padding:20px 10px 0;${font}font-size:12px;line-height:1.6;color:#6b6b6b;text-align:center;">
    ${esc(biz.name)}${biz.address ? ` · ${esc(biz.address.split('\n').join(', '))}` : ''}<br>${esc(contact)}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject, text, html };
}
