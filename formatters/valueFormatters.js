
const HASH_PATTERN = /^0x[a-f0-9]{16,}$/i;

export function stringifyScalar(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value ?? "";
}

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

export function formatInteger(value) {
  if (!Number.isFinite(value)) {
    return String(value ?? 0);
  }
  return Math.round(value).toLocaleString();
}

export function formatPercent(value) {
  const percent = Math.max(0, Math.min(1, Number(value) || 0));
  return `${(percent * 100).toFixed(percent * 100 >= 10 ? 0 : 1)}%`;
}

export function looksLikeHash(column, value) {
  const lower = column.toLowerCase();
  return (
    lower.includes("hash") ||
    lower.includes("tx") ||
    (typeof value === "string" && HASH_PATTERN.test(value))
  );
}

export function looksLikeTimestampColumn(column) {
  const lower = column.toLowerCase();
  return lower.includes("timestamp") || lower.endsWith("time");
}

export function looksLikeEidColumn(column) {
  const lower = column.toLowerCase();
  if (lower === "eid") {
    return true;
  }
  return lower.endsWith("_eid") || lower.includes("eid_");
}
