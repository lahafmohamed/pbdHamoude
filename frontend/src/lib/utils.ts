import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format an amount in FCFA with fr-FR locale (space thousands, no decimals)
 */
export function formatFCFA(amount: number): string {
  const n = Math.abs(Math.round(amount || 0));
  return n.toLocaleString('fr-FR') + ' FCFA';
}

/**
 * Format a date as DD/MM/YYYY
 */
export function formatDateFR(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
