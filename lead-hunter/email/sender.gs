/* RizcoReach email sender
   Sends the emails you queue in Lead Hunter from your own Gmail, one at a time and slowly.
   It never emails anyone twice and it stops the follow ups when someone replies.

   Setup (once):
   1. Open script.google.com with the Gmail you want to send from and click New project.
   2. Delete what's there, paste this whole script and click Save.
   3. Click the + next to Services on the left, pick Gmail API, then Add.
   4. Pick setup at the top and press Run, then Allow. Google warns the app isn't verified
      because it's your own script: click Advanced, then Go to.
   5. Done. It checks every 5 minutes and only sends in the hours set in Lead Hunter.
      To turn it off pick stop and press Run. */

var SITE = '__SITE__';   // filled in by Lead Hunter
var KEY = '__KEY__';     // filled in by Lead Hunter. Keep this private.

// Run once from the editor: checks everything is in place, then starts the 5 minute timer.
function setup() {
  if (typeof Gmail === 'undefined') {
    throw new Error('Add the Gmail service first: click the + next to Services on the left, pick Gmail API, then Add.');
  }
  if (!/^https?:\/\/\w/.test(SITE) || KEY.length < 24) {
    throw new Error('The site or key is missing. Copy the script again from Lead Hunter Settings and paste it here.');
  }
  api('get'); // a wrong key or an old site shows up here, before anything runs
  removeTriggers_();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(5).create();
  tick();
  Logger.log('Email sender is running. It checks every 5 minutes.');
}

// Turns the sender off. Run setup to turn it back on.
function stop() {
  removeTriggers_();
  Logger.log('Email sender is off. Run setup to turn it back on.');
}

// Every 5 minutes: look for replies (every 10 minutes), then send at most one email.
// Errors are logged, not thrown, so Google doesn't email you about every failed run.
function tick() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    if (Date.now() - Number(props.getProperty('lastInboxCheck') || 0) >= 10 * 60 * 1000) {
      checkInbox(); // replies first, so nobody who answered gets a follow up
      props.setProperty('lastInboxCheck', String(Date.now()));
    }
    const res = api('post', { action: 'claim' });
    if (res.job) sendJob(res.job);
    else Logger.log('Nothing to send now (' + res.reason + ')');
  } catch (e) {
    Logger.log('Email sender: ' + errorText_(e));
  } finally {
    lock.releaseLock();
  }
}

// Talks to the email queue on your site.
function api(method, body) {
  const options = { method: method, contentType: 'application/json', headers: { Authorization: 'Bearer ' + KEY }, muteHttpExceptions: true };
  if (body) options.payload = JSON.stringify(body);
  // Reads skip the email texts: the sender only needs where each email stands.
  const res = UrlFetchApp.fetch(SITE.replace(/\/+$/, '') + '/api/email-queue' + (method === 'get' ? '?lite=1' : ''), options);
  const code = res.getResponseCode();
  let data = null;
  try {
    data = JSON.parse(res.getContentText());
  } catch (e) {}
  if (code >= 200 && code < 300 && data) return data;
  const known = {
    401: 'The key does not match your site. Copy the script again from Lead Hunter Settings.',
    404: 'Your site does not have the email sender yet. Deploy the latest site code first.',
    503: 'Your site has no LEAD_QUEUE_KEY yet. Add it in Netlify and deploy again.',
  };
  throw new Error(known[code] || 'Your site answered ' + code + (data && data.error ? ' (' + data.error + ')' : ''));
}

// Sends one email from the queue and tells your site how it went.
function sendJob(job) {
  const me = Session.getEffectiveUser().getEmail();
  const subject = job.step > 0 ? 'Re: ' + job.subject : job.subject;
  const report = (extra) => api('post', Object.assign({ action: 'report', id: job.id, step: job.step }, extra));

  // The last try may have sent it without telling the site: look in Sent so nobody gets it twice.
  const found = job.verify ? findSent_(job, me) : null;
  if (found) {
    report({ ok: true, threadId: found.threadId, messageId: found.messageId });
    Logger.log('Already sent email ' + (job.step + 1) + ' to ' + job.to);
    return;
  }

  const ref = job.step > 0 ? clean_(job.messageId) : '';
  const head = [
    'From: ' + (job.fromName ? word_(job.fromName) + ' ' : '') + '<' + me + '>',
    'To: ' + clean_(job.to),
    'Subject: ' + word_(subject),
  ];
  if (ref) head.push('In-Reply-To: ' + ref, 'References: ' + ref);
  head.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  const body = Utilities.base64Encode(job.body, Utilities.Charset.UTF_8).replace(/.{76}(?=.)/g, '$&\r\n');
  const message = { raw: Utilities.base64EncodeWebSafe(head.join('\r\n') + '\r\n\r\n' + body, Utilities.Charset.UTF_8) };
  if (job.step > 0 && job.threadId) message.threadId = job.threadId; // follow ups stay in the same thread

  let sent;
  try {
    sent = Gmail.Users.Messages.send(message, 'me');
  } catch (e) {
    const error = errorText_(e);
    const failure = { ok: false, error: error.slice(0, 300) };
    if (/\b(limits?|quota|rate limit|too many)\b/i.test(error)) failure.limit = true; // Gmail says slow down: wait for tomorrow
    else if (/invalid to|invalid address|recipient address rejected|invalid.*header/i.test(error)) failure.permanent = true;
    report(failure);
    Logger.log('Could not send to ' + job.to + ': ' + error);
    return;
  }
  const messageId = job.step === 0 ? messageIdOf_(sent.id) : job.messageId;
  report({ ok: true, threadId: sent.threadId || job.threadId, messageId: messageId || '' });
  Logger.log('Sent email ' + (job.step + 1) + ' to ' + job.to);
}

// Looks for replies, bounces and "no thanks" so your site stops the follow ups.
function checkInbox() {
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const state = api('get');
  const since = Date.now() - 21 * 24 * 3600 * 1000;
  const byThread = {};
  const byEmail = {};
  (state.items || []).forEach((item) => {
    const sentAt = item.sentAt || [];
    if (!item.threadId || !sentAt.length) return;
    // Stopped emails still count: a reply to one is still a reply.
    if (item.status === 'active' || (['done', 'cancelled'].includes(item.status) && sentAt[sentAt.length - 1] > since)) {
      byThread[item.threadId] = item;
      byEmail[item.email] = item;
    }
  });
  const events = [];
  const seen = {};
  const add = (item, type) => {
    if (seen[item.id + ' ' + type]) return;
    seen[item.id + ' ' + type] = true;
    events.push({ id: item.id, type: type });
  };

  const read = (thread, item) =>
    thread.getMessages().forEach((m) => {
      const from = m.getFrom();
      if (m.getDate().getTime() <= item.sentAt[0] || address_(from) === me) return;
      if (/mailer-daemon|postmaster/i.test(from)) {
        if (!isDelay_(m)) add(item, 'bounced'); // before the auto reply check: bounces are auto replies too
      } else if (!isAutoReply_(m)) add(item, saysNo_(m.getPlainBody()) ? 'optout' : 'replied');
    });
  const done = {};
  GmailApp.search('newer_than:3d -in:sent -in:chats', 0, 200).forEach((thread) => {
    const item = byThread[thread.getId()];
    if (!item) return;
    done[thread.getId()] = true;
    read(thread, item);
  });

  // A reply that started a new email: look for anything from the people we emailed, 20 addresses per search.
  const emails = Object.keys(byEmail);
  for (let i = 0; i < emails.length; i += 20) {
    GmailApp.search('newer_than:3d -in:sent -in:chats from:(' + emails.slice(i, i + 20).join(' OR ') + ')', 0, 50).forEach((thread) => {
      if (done[thread.getId()]) return;
      done[thread.getId()] = true;
      thread.getMessages().forEach((m) => {
        const item = byEmail[address_(m.getFrom())];
        if (item && m.getDate().getTime() > item.sentAt[0] && !isAutoReply_(m)) add(item, saysNo_(m.getPlainBody()) ? 'optout' : 'replied');
      });
    });
  }

  // Some bounces start a thread of their own: match them by the address inside.
  GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:3d', 0, 50).forEach((thread) => {
    thread.getMessages().forEach((m) => {
      if (!/mailer-daemon|postmaster/i.test(m.getFrom()) || isDelay_(m)) return;
      (m.getPlainBody().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || []).forEach((email) => {
        const item = byEmail[email.toLowerCase()];
        if (item && m.getDate().getTime() > item.sentAt[0]) add(item, 'bounced');
      });
    });
  });

  if (events.length) api('post', { action: 'events', events: events });
  return events;
}

/* Helpers. Names ending in _ stay out of the Run menu. */

// Finds this email in Sent. Counts my emails in the thread: the first email, then each follow up.
function findSent_(job, me) {
  const threads = GmailApp.search('in:sent to:' + job.to + ' newer_than:30d', 0, 20);
  for (let i = 0; i < threads.length; i++) {
    if (job.step > 0 && threads[i].getId() !== job.threadId) continue;
    const mine = threads[i].getMessages().filter((m) =>
      address_(m.getFrom()) === me.toLowerCase() && (m.getSubject() === job.subject || m.getSubject() === 'Re: ' + job.subject));
    if (mine.length > job.step) {
      return { threadId: threads[i].getId(), messageId: job.step > 0 ? job.messageId : mine[0].getHeader('Message-ID') || '' };
    }
  }
  return null;
}

// The Message-ID header of a sent email, so follow ups can say which email they answer. Never fatal.
function messageIdOf_(id) {
  try {
    return GmailApp.getMessageById(id).getHeader('Message-ID') || '';
  } catch (e) {
    return '';
  }
}

// Auto replies say so in a header or in the subject ("Out of office").
function isAutoReply_(m) {
  const auto = String(m.getHeader('Auto-Submitted') || '').trim().toLowerCase();
  return (auto !== '' && auto !== 'no') || /automatic reply|out of office|auto.?reply/i.test(m.getSubject());
}

// Gmail also writes when delivery is only delayed and it will keep trying. That is not a bounce.
function isDelay_(m) {
  return /\bdelay(ed)?\b|delivery incomplete/i.test(m.getSubject()) || /will (retry|keep trying)|delivery incomplete/i.test(String(m.getPlainBody() || '').slice(0, 800));
}

// True when the reply itself (not our email quoted under it) asks us to stop.
function saysNo_(body) {
  const text = String(body || '');
  const quote = text.search(/^\s*>|^On\b[^\n]*\n?[^\n]*wrote:|^-+ ?Original Message|^From: |^_{8,}/im);
  const own = (quote >= 0 ? text.slice(0, quote) : text).slice(0, 600);
  if (/^\s*stop\W*$/i.test(own)) return true; // just "STOP"
  return /\b(unsubscribe|stop (emailing|sending|contacting)|please stop|remove me|no thanks|no thank you|not interested|don['’]?t (email|contact)|do not (email|contact))\b/i.test(own);
}

// "Samil <samil@gmail.com>" -> "samil@gmail.com"
function address_(from) {
  const m = String(from || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(from || '')).trim().toLowerCase();
}

// Header text that works in any language (Arabic, emoji): =?UTF-8?B?...?=
function word_(text) {
  return '=?UTF-8?B?' + Utilities.base64Encode(text, Utilities.Charset.UTF_8) + '?=';
}

// One header line: no line breaks can sneak in.
function clean_(text) {
  return String(text || '').replace(/[\r\n]+/g, ' ').trim();
}

function errorText_(e) {
  return String((e && e.message) || e);
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t);
  });
}
