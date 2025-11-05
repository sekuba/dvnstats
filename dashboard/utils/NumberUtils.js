/**
 * Checks if a value is neither null nor undefined
 * @param {*} value - The value to check
 * @returns {boolean} true if value is not null and not undefined
 */
export function isDefined(value) {
  return value !== undefined && value !== null;
}

/**
 * Checks if a value is null or undefined
 * @param {*} value - The value to check
 * @returns {boolean} true if value is null or undefined
 */
export function isNullish(value) {
  return value === undefined || value === null;
}

/**
 * Ensure value is an array
 * @param {*} value - The value to check
 * @returns {Array} The value if it's an array, otherwise an empty array
 */
export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalize an array of label strings (trim, lowercase, filter empty, sort)
 * @param {Array} labels - Array of label strings
 * @returns {Array} Normalized and sorted array of labels
 */
export function normalizeLabels(labels) {
  return ensureArray(labels)
    .map((label) => (isNullish(label) ? "" : String(label).trim().toLowerCase()))
    .filter(Boolean)
    .sort();
}

export function bigIntSafe(value) {
  try {
    return isDefined(value) ? BigInt(value) : null;
  } catch (error) {
    return null;
  }
}

export function coerceToNumber(value) {
  if (isNullish(value)) {
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

export function toString(value) {
  return isNullish(value) ? null : String(value);
}
