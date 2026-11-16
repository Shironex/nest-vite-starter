/**
 * Money primitive: string amount + ISO 4217 currency code.
 *
 * Why string and not number? IEEE-754 cannot represent 0.1 exactly, so any
 * arithmetic on `Money.amount` as `number` silently corrupts to 0.30000000000000004
 * the moment two values are added. A string is safe across the wire and inside
 * Prisma (which stores `Decimal` as a `string`-shaped class).
 *
 * Why a thin shape and not a class? The shape stays JSON-safe: superjson
 * already preserves `Money` as a plain object on the wire. Apps that need
 * arithmetic should pull in `decimal.js` (or `Prisma.Decimal`) and convert at
 * the boundary:
 *
 *   import Decimal from 'decimal.js';
 *   const d = new Decimal(money.amount).mul(0.23); // a 23% tax rate
 *
 * For DB columns use `Decimal @db.Decimal(<precision>, <scale>)` in Prisma.
 * Pick precision/scale to match the regulatory floor for your jurisdiction:
 * many require 4 fractional digits for unit prices and 2 for totals.
 */

/** ISO 4217 alphabetic currency code (uppercased, exactly 3 letters). */
export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

export interface Money {
  /** Decimal amount as a string. e.g. "1234.56", "-0.01". */
  amount: string;
  currency: CurrencyCode;
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const AMOUNT_RE = /^-?\d+(\.\d+)?$/;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCY_RE.test(value);
}

export function asCurrencyCode(value: string): CurrencyCode {
  const upper = value.toUpperCase();
  if (!CURRENCY_RE.test(upper)) {
    throw new Error(`Invalid currency code: ${value}`);
  }
  return upper as CurrencyCode;
}

export function isMoneyAmount(value: string): boolean {
  return AMOUNT_RE.test(value);
}

export function createMoney(amount: string | number, currency: string): Money {
  const amountStr = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!isMoneyAmount(amountStr)) {
    throw new Error(`Invalid money amount: ${String(amount)}`);
  }
  return {
    amount: amountStr,
    currency: asCurrencyCode(currency),
  };
}

/**
 * Format a Money value for display using Intl.NumberFormat. Formatting is
 * presentational only: never round-trip a formatted string back into a
 * `Money` (locale separators differ, `1.234,56` vs `1,234.56`).
 */
export function formatMoney(money: Money, locale: string = 'en-US'): string {
  const num = Number(money.amount);
  if (!Number.isFinite(num)) {
    return `${money.amount} ${money.currency}`;
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(num);
}
