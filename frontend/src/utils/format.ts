/**
 * Normalize search input: strip accents, collapse whitespace, lowercase.
 * Lets users type "cafe" and find "café", or "produit" and find "Produit".
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy match: returns score 0..100 (0 = no match). Higher = better.
 * Strategy (tried in order, first hit wins):
 *  1. Exact substring         → 100
 *  2. Starts-with token       → 80
 *  3. All query tokens found  → 60
 *  4. Subsequence (chars in order, gaps allowed) → 20..50 based on tightness
 *  5. Otherwise               → 0
 */
export function fuzzyScore(query: string, target: string): number {
  const q = normalizeSearch(query);
  const t = normalizeSearch(target);
  if (!q) return 0;
  if (!t) return 0;

  if (t.includes(q)) {
    if (t.startsWith(q)) return 100;
    return 90;
  }

  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) {
    return 60;
  }
  if (tokens.some((tok) => t.split(' ').some((tw) => tw.startsWith(tok)))) {
    return 70;
  }

  // Subsequence match on the un-tokenized query (handles typos/missing letters)
  const qChars = q.replace(/\s+/g, '');
  let ti = 0;
  let matched = 0;
  let firstIdx = -1;
  let lastIdx = -1;
  for (const ch of qChars) {
    const found = t.indexOf(ch, ti);
    if (found === -1) break;
    if (firstIdx === -1) firstIdx = found;
    lastIdx = found;
    matched++;
    ti = found + 1;
  }
  if (matched === qChars.length && qChars.length >= 2) {
    // Tightness: shorter span = better match
    const span = lastIdx - firstIdx + 1;
    const tightness = qChars.length / Math.max(span, 1);
    return Math.round(20 + tightness * 30);
  }

  return 0;
}

export function fuzzyMatch(query: string, target: string): boolean {
  return fuzzyScore(query, target) > 0;
}

/**
 * Format a number as FCFA. Zero decimals, French thousand separator.
 */
export function formatFCFA(montant: number | string | undefined | null): string {
  const value = typeof montant === 'string' ? parseFloat(montant) : (montant ?? 0);
  if (isNaN(value)) return '0 FCFA';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(value)) + ' FCFA';
}

export const formatXOF = formatFCFA;

/**
 * Format a date string to French locale.
 */
export function formatDate(date: string | Date | undefined): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format a short date (numeric).
 */
export function formatDateShort(date: string | Date | undefined): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('fr-FR');
}
