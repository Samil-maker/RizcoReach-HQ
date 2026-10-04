// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.rizcoreach.ae',
  trailingSlash: 'never',
  build: {
    // Emit page.html files so legacy URLs like /construction-home-improvement.html keep resolving.
    format: 'file',
    inlineStylesheets: 'auto',
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  integrations: [
    sitemap({
      filter: (page) => !/\/(thankyou|404)(\.html)?$/.test(page),
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-AE', ar: 'ar-AE' },
      },
    }),
  ],
});
