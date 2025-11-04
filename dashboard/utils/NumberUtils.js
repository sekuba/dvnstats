
export function bigIntSafe(value) {
  try {
    return value !== undefined && value !== null ? BigInt(value) : null;
  } catch (error) {
    return null;
  }
}

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

export function toString(value) {
  return value === undefined || value === null ? null : String(value);
}
