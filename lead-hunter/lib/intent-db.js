/* Lead Hunter: intent posts in IndexedDB (they can be many and long, so they stay out of chrome.storage).
   Shared by the background (writes new posts) and the dashboard (lists them, marks them contacted or dismissed). */
(function (root) {
  const LH = (root.LH = root.LH || {});
  let opening = null;
  const open = () =>
    opening ||
    (opening = new Promise((resolve, reject) => {
      const req = indexedDB.open('lead-finder', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const posts = db.createObjectStore('posts', { keyPath: 'id' });
        posts.createIndex('keys', 'keys', { multiEntry: true }); // post URL and author+words: the same post is saved once
        posts.createIndex('foundAt', 'foundAt');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opening = null;
        reject(req.error);
      };
    }));
  const done = (tx) => new Promise((resolve, reject) => ((tx.oncomplete = () => resolve()), (tx.onerror = tx.onabort = () => reject(tx.error))));
  const ask = (req) => new Promise((resolve, reject) => ((req.onsuccess = () => resolve(req.result)), (req.onerror = () => reject(req.error))));

  LH.intentDb = {
    /** Saves the posts that are not there yet (by id, post URL or author and words). Returns { added, duplicates }. */
    async add(posts) {
      const db = await open();
      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');
      const added = [];
      let duplicates = 0;
      for (const p of posts) {
        const seen = (await ask(store.get(p.id))) || (await Promise.all((p.keys || []).map((k) => ask(store.index('keys').getKey(k))))).some(Boolean);
        if (seen) {
          duplicates++;
          continue;
        }
        store.put(p);
        added.push(p);
      }
      await done(tx);
      return { added, duplicates };
    },
    async all() {
      const db = await open();
      return ask(db.transaction('posts').objectStore('posts').getAll());
    },
    async get(id) {
      const db = await open();
      return ask(db.transaction('posts').objectStore('posts').get(id));
    },
    async update(id, patch) {
      const db = await open();
      const tx = db.transaction('posts', 'readwrite');
      const store = tx.objectStore('posts');
      const p = await ask(store.get(id));
      if (p) store.put({ ...p, ...patch });
      await done(tx);
      return p ? { ...p, ...patch } : null;
    },
    async clear() {
      const db = await open();
      const tx = db.transaction('posts', 'readwrite');
      tx.objectStore('posts').clear();
      await done(tx);
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
