/** Branded-ish primitives shared across every feature. */
export type ID = string

/** An ISO-8601 timestamp string (UTC). */
export type ISODateString = string

/** ISO 4217 currency code, e.g. 'AED' | 'SAR' | 'USD'. */
export type CurrencyCode = string

/**
 * Money is a precise decimal *string* + currency — never a JS float.
 * The backend (Prisma `Decimal`) returns decimals as strings to avoid IEEE
 * rounding drift; the formatting layer parses only for display.
 */
export interface Money {
  amount: string
  currency: CurrencyCode
}

/** Standard paginated envelope for list endpoints. */
export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * Minimal translator signature. Lets framework-free layers (domain schemas,
 * pure helpers) accept i18n without importing i18next's types.
 */
export type Translate = (key: string, options?: Record<string, unknown>) => string
