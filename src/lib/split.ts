/**
 * Server-side word splitter for reveal animations.
 * Accepts a small HTML string (text plus inline tags like <em>, <span>, <br>)
 * and wraps every word in `.w > .wi` spans with a stagger index (--i).
 * Doing this at build time means no layout shift and no client JS for splitting.
 */
export function split(html: string, start = 0): string {
  let i = start;
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part) return '';
      if (part.startsWith('<')) return part;
      return part
        .split(/(\s+)/)
        .map((tok) => {
          if (!tok) return '';
          if (/^\s+$/.test(tok)) return ' ';
          return `<span class="w"><span class="wi" style="--i:${i++}">${tok}</span></span>`;
        })
        .join('');
    })
    .join('');
}

/** Split into plain word spans for scroll-scrubbed opacity (manifesto). */
export function words(text: string): string {
  return text
    .split(/(\s+)/)
    .map((tok) => (/^\s+$/.test(tok) ? ' ' : tok ? `<span class="sw">${tok}</span>` : ''))
    .join('');
}

export function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
