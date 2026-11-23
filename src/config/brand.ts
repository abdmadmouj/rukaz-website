/**
 * Brand tokens from the RUKAZ brand book.
 *
 * Colour (ch. 04) with its intended share of any composition:
 *   Obsidian 50% (ground) · Deep Emerald 20% (depth) · Ivory 15% (paper)
 *   Glass Mist 10% (glass) · Glass Emerald 5% (accent, the only bright colour)
 *
 * Contrast notes from the book: Ivory on Obsidian 16:1, Ivory on Deep Emerald 8:1,
 * Glass Emerald on Obsidian 6:1. Glass Emerald on Ivory is 2.6:1, graphics only.
 *
 * Always RUKAZ, in capitals. Change `wordmark` (and `wordmarkAr`) here and the header,
 * footer, document title and form copy all follow.
 */
export const brand = {
  wordmark: 'RUKAZ',
  wordmarkAr: 'ركاز',
  descriptor: 'VENTURES',
  colors: {
    obsidian: '#071411',
    deepEmerald: '#0D4F42',
    glassEmerald: '#1BA97D',
    glassMist: '#B8C8C5',
    ivory: '#ECEFEC',
    surface: '#0B1C18',
    hairline: 'rgba(236, 239, 236, 0.14)',
    success: '#1BA97D',
    warning: '#D9B45A',
    error: '#E5806F',
  },
  /**
   * Social profiles, shown in the footer in this order. Paste each profile's full https link;
   * a network with no link yet shows as plain text. `icon`: drop that network's official icon
   * (from its brand resources page) at public/images/social/<key>.svg and set icons: true.
   */
  social: [
    { key: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/rukazventures/' },
    { key: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/rukaz-ventures/' },
    { key: 'x', label: 'X', url: 'https://x.com/RukazVentures' },
    { key: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/profile.php?id=61596497288332' },
  ] as { key: string; label: string; url: string }[],
  socialIcons: false,
  /**
   * Where introductions go when the site runs as plain files (GitHub Pages). Sent through
   * FormSubmit to this address; the very first one triggers an activation email to it, and
   * after one click every introduction arrives there. To use Web3Forms instead, put the
   * access key it emails you in web3formsKey. (With the Node server, RUKAZ_WEBHOOK_URL is used.)
   */
  forms: { email: 'info@rukazventures.com', web3formsKey: '' },
  /** UI ease (strong ease-out): things arrive quickly and settle. Never a bounce. */
  ease: [0.23, 1, 0.32, 1] as const,
} as const;

export type BrandColor = keyof typeof brand.colors;
