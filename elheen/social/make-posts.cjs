// Draws the Elheen Instagram posts (1080 x 1350) from the list in posts.json.
// Run from the elheen folder:  node social/make-posts.cjs
// Needs Playwright (npm i -D playwright, then npx playwright install chromium).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const assets = path.join(here, '..', 'src', 'assets');
const out = path.join(here, 'posts');
fs.mkdirSync(out, { recursive: true });
const data = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const font = data(path.join(assets, 'fonts', 'jakarta.woff2'), 'font/woff2');
const arabic = data(path.join(assets, 'fonts', 'readex-arabic.woff2'), 'font/woff2');
const logoDark = data(path.join(assets, 'logo-on-dark.svg'), 'image/svg+xml');
const logoLight = data(path.join(assets, 'logo.svg'), 'image/svg+xml');
const posts = JSON.parse(fs.readFileSync(path.join(here, 'posts.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// *word* in a headline is shown in the softer colour
const soft = (s) => esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>');

const css = `
@font-face{font-family:J;src:url(${font}) format("woff2");font-weight:200 800}
@font-face{font-family:R;src:url(${arabic}) format("woff2");font-weight:200 700}
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1350px;font-family:J,sans-serif;overflow:hidden}
.post{width:1080px;height:1350px;padding:84px 88px;display:flex;flex-direction:column}
.dark{background:#1F0A24;color:#fff}
.light{background:#F6F6F8;color:#1D1320}
.white{background:#fff;color:#1D1320}
.top{display:flex;justify-content:space-between;align-items:center}
.top img{height:46px}
.eyebrow{font-size:25px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#A31A8A}
.dark .eyebrow{color:rgba(255,255,255,.7)}
h1{font-size:96px;line-height:1.02;letter-spacing:-.045em;font-weight:760}
h1 em{font-style:normal;color:#A31A8A}
.dark h1 em{color:rgba(255,255,255,.55)}
.body{font-size:36px;line-height:1.4;color:#5D5D69;font-weight:500;max-width:860px}
.dark .body{color:#B4B2BF}
.foot{display:flex;justify-content:space-between;font-size:26px;font-weight:650;color:#5D5D69}
.dark .foot{color:#B4B2BF}
.grow{flex:1}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:40px}
.ar{font-family:R,sans-serif;font-size:150px;line-height:1;direction:rtl;color:rgba(255,255,255,.9)}
ol{list-style:none;padding:0;display:grid;gap:22px}
ol li{display:grid;grid-template-columns:118px 1fr;gap:22px;align-items:start;font-size:42px;line-height:1.25;font-weight:650;letter-spacing:-.015em;padding:26px 0;border-top:2px solid rgba(0,0,0,.08)}
.dark ol li{border-color:rgba(255,255,255,.14)}
ol li b{font-size:30px;font-weight:750;color:#A31A8A;letter-spacing:.02em;padding-top:8px}
.dark ol li b{color:rgba(255,255,255,.6)}
ol li span small{display:block;font-size:30px;font-weight:500;color:#5D5D69;margin-top:6px}
.dark ol li span small{color:#B4B2BF}
.screen .head{display:grid;gap:22px;margin:52px 0 44px}
.screen h1{font-size:76px}
.phone{flex:1;border-radius:46px 46px 0 0;background:#fff;box-shadow:0 0 0 12px #1F0A24,0 30px 80px rgba(31,10,36,.25);overflow:hidden;margin:0 70px -84px;position:relative}
.phone img{width:100%;display:block}
`;

function html(p) {
  const logo = p.theme === 'dark' ? logoDark : logoLight;
  const top = `<div class="top"><img src="${logo}"><span class="eyebrow">${esc(p.eyebrow)}</span></div>`;
  const foot = `<div class="foot"><span>elheen.com</span><span>@getelheen</span></div>`;
  let inner;
  if (p.kind === 'screen') {
    inner = `${top}<div class="head"><h1>${soft(p.title)}</h1>${p.body ? `<p class="body">${esc(p.body)}</p>` : ''}</div>
      <div class="phone"><img src="${data(path.join(here, 'screens', p.screen), 'image/png')}"></div>`;
  } else if (p.kind === 'list') {
    inner = `${top}<div class="mid"><h1>${soft(p.title)}</h1><ol>${p.items.map(([n, t, sub]) => `<li><b>${esc(n)}</b><span>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></li>`).join('')}</ol></div>${p.body ? `<p class="body" style="margin-bottom:40px">${esc(p.body)}</p>` : ''}${foot}`;
  } else {
    inner = `${top}<div class="mid">${p.arabic ? `<p class="ar">${esc(p.arabic)}</p>` : ''}<h1>${soft(p.title)}</h1>${p.body ? `<p class="body">${esc(p.body)}</p>` : ''}</div>${foot}`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="post ${p.theme} ${p.kind}">${inner}</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  const rows = [['day', 'file', 'caption']];
  for (const [i, p] of posts.entries()) {
    const file = `${String(i + 1).padStart(2, '0')}-${p.slug}.png`;
    await page.setContent(html(p));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(out, file) });
    rows.push([String(i + 1), `posts/${file}`, p.caption]);
    console.log('drew', file);
  }
  const cell = (v) => `"${String(v).replace(/"/g, '""')}"`;
  fs.writeFileSync(path.join(here, 'schedule.csv'), rows.map((r) => r.map(cell).join(',')).join('\n') + '\n');
  await browser.close();
})();
