import { DEFAULT_LANGUAGE } from '../config/constants'
import type { CurrencyCode } from '../types/common.types'

/**
 * Locale-aware formatters built on `Intl`.
 *
 * Numbering system is pinned to `latn` (Western digits) in every locale,
 * including Arabic. Rationale: this is a B2B estimating tool whose primary
 * content is numbers; Western digits keep the monospace numeric columns aligned
 * and readable, and currency is decoupled from UI language (it's a per-org
 * setting). See ARCHITECTURE.md → "Numerals & currency policy".
 */
function resolveLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang
  }
  return DEFAULT_LANGUAGE
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(resolveLocale(), {
    numberingSystem: 'latn',
    maximumFractionDigits: 2,
    ...options,
  }).format(value)
}

export function formatCurrency(
  amount: number,
  currency: CurrencyCode,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(resolveLocale(), {
    style: 'currency',
    currency,
    numberingSystem: 'latn',
    ...options,
  }).format(amount)
}

export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(resolveLocale(), {
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    ...options,
  }).format(new Date(value))
}
