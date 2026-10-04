export type Lang = 'en' | 'ar';

export const LANGS: Lang[] = ['en', 'ar'];

export const SITE = {
  url: 'https://www.rizcoreach.ae',
  name: 'RizcoReach',
  email: 'support@rizcoreach.ae',
  phone: '+971568461835',
  phoneDisplay: '+971 56 846 1835',
  whatsapp: 'https://wa.me/971568461835',
  instagram: 'https://www.instagram.com/tryrizcoreach',
  instagramHandle: '@tryrizcoreach',
  facebook: 'https://www.facebook.com/rizcoreach',
  address: {
    street: 'Latifa Tower, Sheikh Zayed Road',
    city: 'Dubai',
    country: 'AE',
  },
};

/** getStaticPaths helper: one entry for English (root) and one for Arabic (/ar). */
export function localeStaticPaths() {
  return [
    { params: { lang: undefined }, props: { lang: 'en' as Lang } },
    { params: { lang: 'ar' }, props: { lang: 'ar' as Lang } },
  ];
}

/** Build a localized href from an English path such as "/contact" or "/". */
export function href(lang: Lang, path: string): string {
  const [base, rest = ''] = path.split(/(?=[?#])/);
  if (lang === 'en') return path;
  const localized = base === '/' ? '/ar' : `/ar${base}`;
  return localized + rest;
}

/** Strip the /ar prefix to get the English equivalent of a pathname. */
export function basePath(pathname: string): string {
  let p = pathname.replace(/\.html$/, '').replace(/\/index$/, '');
  if (p === '/ar' || p === '/ar/') return '/';
  if (p.startsWith('/ar/')) p = p.slice(3);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

export function dir(lang: Lang) {
  return lang === 'ar' ? 'rtl' : 'ltr';
}

/** Pick the right locale from a {en, ar} object. */
export function t<T>(obj: { en: T; ar: T }, lang: Lang): T {
  return obj[lang];
}
