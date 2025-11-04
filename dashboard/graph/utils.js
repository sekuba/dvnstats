
export function shortenAddress(value) {
  if (!value) {
    return "";
  }
  const str = String(value);
  if (str.length <= 12) {
    return str;
  }
  return `${str.slice(0, 6)}..${str.slice(-4)}`;
}

/**
 * Simple string hash function for deterministic variation
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash | 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Append a row to a summary dl element
 */
export function appendSummaryRow(list, label, value) {
  if (!list || (!value && value !== 0)) return;
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = String(value);
  list.append(dt, dd);
}

export function describeCombination(combination) {
  if (!combination) {
    return "";
  }

  const sample = combination.sampleInfo || {};
  const requiredCount = combination.requiredDVNCount ?? sample.requiredDVNCount ?? 0;
  const requiredLabels =
    (Array.isArray(sample.requiredDVNLabels) && sample.requiredDVNLabels.length
      ? sample.requiredDVNLabels
      : combination.labelsSample) || [];

  const base =
    requiredLabels.length > 0
      ? `${requiredCount} required: ${requiredLabels.join(", ")}`
      : `${requiredCount} required DVNs`;

  if (!combination.usesSentinel) {
    return base;
  }

  const optionalLabels =
    (Array.isArray(sample.optionalDVNLabels) && sample.optionalDVNLabels.length
      ? sample.optionalDVNLabels
      : combination.optionalLabelsSample) || [];
  const optionalCount =
    sample.optionalDVNCount ??
    (Array.isArray(combination.optionalCounts) && combination.optionalCounts.length
      ? combination.optionalCounts[0]
      : 0);
  const optionalThreshold =
    sample.optionalDVNThreshold ??
    (Array.isArray(combination.optionalThresholds) && combination.optionalThresholds.length
      ? combination.optionalThresholds[0]
      : 0);

  const quorumLabel =
    optionalCount > 0 ? `${optionalThreshold}/${optionalCount}` : `${optionalThreshold}`;
  const optionalText = optionalLabels.length > 0 ? ` → ${optionalLabels.join(", ")}` : "";

  return `${base} (sentinel, quorum ${quorumLabel}${optionalText})`;
}

export function findMostConnectedNode(nodes, edges) {
  const edgeCounts = new Map();

  
  for (const edge of edges) {
    edgeCounts.set(edge.from, (edgeCounts.get(edge.from) || 0) + 1);
    edgeCounts.set(edge.to, (edgeCounts.get(edge.to) || 0) + 1);
  }

  
  let maxCount = 0;
  let mostConnected = nodes[0]?.id || null;

  for (const node of nodes) {
    if (!node.isTracked) continue;
    const count = edgeCounts.get(node.id) || 0;
    if (count > maxCount) {
      maxCount = count;
      mostConnected = node.id;
    }
  }

  return mostConnected;
}
