// The real email queue (netlify/functions/email-queue.mts) in a worker thread, for tests/email-flow.test.mjs.
// Apps Script's UrlFetchApp is synchronous, so the test blocks on a shared buffer while this thread answers.
import { parentPort, workerData } from 'node:worker_threads';
import { handle } from '../netlify/functions/email-queue.mts';
import { memStore } from '../lead-hunter/test/fixtures.mjs';

const store = memStore();
const flag = new Int32Array(workerData.flag);
const out = new Uint8Array(workerData.out);

parentPort.on('message', async ({ url, method, headers, body, now }) => {
  let reply;
  try {
    const res = await handle(new Request(url, { method, headers, body }), store, workerData.key, () => now);
    reply = { code: res.status, text: await res.text() };
  } catch (e) {
    reply = { code: 599, text: JSON.stringify({ error: String(e && e.stack) }) };
  }
  const bytes = new TextEncoder().encode(JSON.stringify(reply));
  new DataView(workerData.out).setUint32(0, bytes.length);
  out.set(bytes, 4);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
