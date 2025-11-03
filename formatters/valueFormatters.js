/**
 * Value Formatting Utilities
 * Functions for formatting scalar values, numbers, percentages, and timestamps
 */

const HASH_PATTERN = /^0x[a-f0-9]{16,}$/i;

/**
 * Converts scalar values (numbers, bigints, booleans) to strings
 */
export function stringifyScalar(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value ?? "";
}

/**
 * Formats Unix timestamp values into human-readable format
 * @param {number|string} value - Unix timestamp (seconds or milliseconds)
 * @returns {Object|null} - Object with primary (ISO), secondary (unix), and copyValue
 */
export function formatTimestampValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const millis = numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;

  return {
    primary: date.toISOString().replace("T", " ").replace("Z", " UTC"),
    secondary: `unix ${value}`,
    copyValue: String(value),
  };
}

/**
 * Formats integers with thousands separators
 * @param {number} value - Numeric value to format
 * @returns {string} - Formatted integer string
 */
export function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return String(value ?? 0);
  }
  return Math.round(value).toLocaleString();
}

/**
 * Formats decimal values as percentages
 * @param {number} value - Decimal value (0.0 to 1.0)
 * @returns {string} - Formatted percentage string
 */
export function formatPercent(value) {
  const percent = Math.max(0, Math.min(1, Number(value) || 0));
  return `${(percent * 100).toFixed(percent * 100 >= 10 ? 0 : 1)}%`;
}

/**
 * Detects if a value looks like a cryptographic hash
 * @param {string} column - Column name
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function looksLikeHash(column, value) {
  const lower = column.toLowerCase();
  return (
    lower.includes("hash") ||
    lower.includes("tx") ||
    (typeof value === "string" && HASH_PATTERN.test(value))
  );
}

/**
 * Detects if a column name suggests timestamp data
 * @param {string} column - Column name
 * @returns {boolean}
 */
export function looksLikeTimestampColumn(column) {
  const lower = column.toLowerCase();
  return lower.includes("timestamp") || lower.endsWith("time");
}

/**
 * Detects if a column name suggests EID (endpoint ID) data
 * @param {string} column - Column name
 * @returns {boolean}
 */
export function looksLikeEidColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "eid") {
    return true;
  }
  return lower.endsWith("_eid") || lower.includes("eid_");
}
