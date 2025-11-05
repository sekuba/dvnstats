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
