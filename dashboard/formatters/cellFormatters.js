import { formatInteger, formatPercent, formatTimestampValue } from "./valueFormatters.js";

export function createFormattedCell(lines, copyValue, meta = {}) {
  const normalizedLines = Array.isArray(lines) ? lines : [lines];
  return {
    __formatted: true,
    lines: normalizedLines.map((line) => (line === null || line === undefined ? "" : String(line))),
    copyValue,
    meta,
    highlight: meta.highlight || false,
  };
}

/**
 * Formats route activity as a readable line
 * @param {Object} activity - Activity object with count and percentOfTotal
 * @returns {string} - Formatted activity string
 */
export function formatRouteActivityLine(activity) {
  const count = activity?.count ?? 0;
  const percent = activity?.percentOfTotal ?? 0;
  const countLabel = formatInteger(count);
  if (percent > 0) {
    return `${countLabel} packets (${formatPercent(percent)})`;
  }
  return `${countLabel} packets`;
}

/**
 * Formats update information (block, timestamp, eventId, txHash) into cell lines
 * @param {Object} params - Object with block, timestamp, eventId, txHash
 * @returns {Object} - Formatted cell object
 */
export function formatUpdateInfo({ block, timestamp, eventId, txHash }) {
  const lines = [];
  if (block !== undefined && block !== null) lines.push(`Block ${block}`);
  if (timestamp !== undefined && timestamp !== null) {
    const ts = formatTimestampValue(timestamp);
    if (ts) lines.push(ts.primary);
  }
  if (eventId) lines.push(eventId);
  if (txHash) {
    const hashStr = String(txHash);
    const truncated =
      hashStr.length > 20 ? `${hashStr.slice(0, 10)}…${hashStr.slice(-6)}` : hashStr;
    lines.push(`Tx ${truncated}`);
  }

  const copyValue = txHash || eventId || lines.join(" | ");
  return createFormattedCell(lines.length ? lines : ["—"], copyValue);
}

export function createEidBadge(chainDisplay, eid) {
  return createFormattedCell([chainDisplay], eid);
}
