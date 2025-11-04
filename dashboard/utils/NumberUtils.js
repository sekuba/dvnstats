/**
 * NumberUtils - Centralized utilities for safe number and BigInt operations
 *
 * This module provides consistent, safe number conversion and BigInt handling
 * across the dashboard codebase, eliminating duplicated conversion logic.
 */

/**
 * Safely converts a value to BigInt, returning null if conversion fails
 * or if the value is null/undefined.
 *
 * @param {*} value - The value to convert to BigInt
 * @returns {BigInt|null} The BigInt value or null if conversion fails
 *
 * @example
 * bigIntSafe("12345")  // Returns 12345n
 * bigIntSafe(null)     // Returns null
 * bigIntSafe("abc")    // Returns null
 */
export function bigIntSafe(value) {
  try {
    return value !== undefined && value !== null ? BigInt(value) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Coerces any value to a safe finite number, defaulting to 0 for invalid values.
 * Handles null, undefined, strings, bigints, and non-finite numbers safely.
 *
 * @param {*} value - The value to coerce to a number
 * @returns {number} A finite number, or 0 if coercion fails
 *
 * @example
 * coerceToNumber("123")      // Returns 123
 * coerceToNumber(123n)       // Returns 123
 * coerceToNumber(null)       // Returns 0
 * coerceToNumber(Infinity)   // Returns 0
 * coerceToNumber("abc")      // Returns 0
 */
export function coerceToNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Safely converts a value to a string, returning null for null/undefined.
 *
 * @param {*} value - The value to convert to string
 * @returns {string|null} The string value or null
 *
 * @example
 * toString(123)        // Returns "123"
 * toString(null)       // Returns null
 * toString(undefined)  // Returns null
 */
export function toString(value) {
  return value === undefined || value === null ? null : String(value);
}
