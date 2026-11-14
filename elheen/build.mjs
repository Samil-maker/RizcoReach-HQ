// Builds the Elheen site: src/pages + src/partials -> dist. No dependencies.
// Run: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const read = (p) => readFileSync(join(src, p), 'utf8');

const header = read('partials/header.html');
const footer = read('partials/footer.html');
const SITE = 'https://elheen.com';
const include = (html) => html.replace(/<!--@(\w+)-->/g, (_, name) => read(`partials/${name}.html`));

const layout = ({ title, description, nav, body, file, noindex }) => `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE}/${file === 'index.html' ? '' : file}">`}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Elheen">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${SITE}/assets/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#06140F">
<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="assets/fonts/jakarta.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/styles.css">
<script>document.documentElement.classList.remove("no-js")</script>
</head>
<body data-nav="${nav || ''}">
<a class="skip" href="#main">Skip to content</a>
${header}
<main id="main">
${body}
</main>
${footer}
<script src="assets/app.js" defer></script>
</body>
</html>
`;

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(src, 'assets'), join(dist, 'assets'), { recursive: true });

for (const file of readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html'))) {
  const raw = read(`pages/${file}`);
  const m = raw.match(/^<!--(\{[\s\S]*?\})-->/);
  if (!m) throw new Error(`${file}: missing <!--{...}--> settings on the first line`);
  const meta = JSON.parse(m[1]);
  writeFileSync(join(dist, file), layout({ ...meta, file, body: include(raw.slice(m[0].length).trim()) }));
  console.log('built', file);
}
