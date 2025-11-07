import { parseOptionalPositiveInt } from "../../../core.js";
import { PACKET_STATISTICS_QUERY } from "../../../queries/packetStatistics.js";

/**
 * Compute statistics from PacketDelivered data
 */
function computeStatistics(packets) {
  const total = packets.length;

  if (total === 0) {
    return {
      total: 0,
      allDefaultPercentage: 0,
      defaultLibPercentage: 0,
      defaultConfigPercentage: 0,
      trackedPercentage: 0,
      dvnCombinations: [],
      dvnCountBuckets: [],
      optionalDvnCountBuckets: [],
      timeRange: { earliest: null, latest: null },
    };
  }

  // Count packets with all-default configuration
  let allDefault = 0;
  let defaultLibOnly = 0;
  let defaultConfigOnly = 0;
  let tracked = 0;

  // Track DVN combinations (required DVNs only, as they are security critical)
  const dvnCombos = new Map(); // key: sorted DVN addresses joined, value: count

  // Count packets by number of required DVNs
  const dvnCounts = new Map(); // key: DVN count, value: packet count
  const optionalDvnCounts = new Map(); // key: optional DVN count, value: packet count

  // Track time range
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const packet of packets) {
    // All-default configuration
    if (packet.usesDefaultLibrary && packet.usesDefaultConfig) {
      allDefault++;
    }

    if (packet.usesDefaultLibrary) {
      defaultLibOnly++;
    }

    if (packet.usesDefaultConfig) {
      defaultConfigOnly++;
    }

    if (packet.isConfigTracked) {
      tracked++;
    }

    // DVN combinations (required DVNs only)
    const requiredDVNs = Array.isArray(packet.effectiveRequiredDVNs)
      ? packet.effectiveRequiredDVNs
      : [];

    if (requiredDVNs.length > 0) {
      const sortedDvns = [...requiredDVNs].sort();
      const comboKey = sortedDvns.join(",");
      dvnCombos.set(comboKey, (dvnCombos.get(comboKey) || 0) + 1);
    }

    // DVN count buckets
    const requiredCount = packet.effectiveRequiredDVNCount ?? requiredDVNs.length;
    dvnCounts.set(requiredCount, (dvnCounts.get(requiredCount) || 0) + 1);

    const optionalCount = packet.effectiveOptionalDVNCount ?? 0;
    optionalDvnCounts.set(optionalCount, (optionalDvnCounts.get(optionalCount) || 0) + 1);

    // Time range
    const timestamp = Number(packet.blockTimestamp);
    if (!Number.isNaN(timestamp)) {
      if (timestamp < earliest) earliest = timestamp;
      if (timestamp > latest) latest = timestamp;
    }
  }

  // Convert DVN combinations to sorted array
  const dvnCombinations = Array.from(dvnCombos.entries())
    .map(([combo, count]) => ({
      dvns: combo.split(","),
      count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Convert DVN count buckets to sorted array
  const dvnCountBuckets = Array.from(dvnCounts.entries())
    .map(([count, packets]) => ({
      requiredDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.requiredDvnCount - b.requiredDvnCount);

  const optionalDvnCountBuckets = Array.from(optionalDvnCounts.entries())
    .map(([count, packets]) => ({
      optionalDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.optionalDvnCount - b.optionalDvnCount);

  return {
    total,
    allDefaultPercentage: (allDefault / total) * 100,
    defaultLibPercentage: (defaultLibOnly / total) * 100,
    defaultConfigPercentage: (defaultConfigOnly / total) * 100,
    trackedPercentage: (tracked / total) * 100,
    dvnCombinations,
    dvnCountBuckets,
    optionalDvnCountBuckets,
    timeRange: {
      earliest: earliest === Number.POSITIVE_INFINITY ? null : earliest,
      latest: latest === Number.NEGATIVE_INFINITY ? null : latest,
    },
  };
}

function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(Number(timestamp) * 1000);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}

function formatDvnAddress(address) {
  if (!address) return "—";
  return `${address.substring(0, 6)}…${address.substring(address.length - 4)}`;
}

export function createPacketStatisticsConfig(coordinator) {
  return {
    label: "Packet Statistics",
    description: "Pre-computed statistics from PacketDelivered data",
    query: PACKET_STATISTICS_QUERY,

    buildVariables: (card) => {
      const timeWindowInput = card.querySelector('input[name="timeWindow"]');
      const timeUnitSelect = card.querySelector('select[name="timeUnit"]');
      const limitInput = card.querySelector('input[name="sampleLimit"]');

      const timeWindowValue = Number.parseInt(timeWindowInput?.value || "0", 10);
      const timeUnit = timeUnitSelect?.value || "all";
      const rawLimit = limitInput?.value?.trim() ?? "";
      const parsedLimit = parseOptionalPositiveInt(rawLimit);

      let minTimestamp = 0;
      const now = Math.floor(Date.now() / 1000);

      if (timeUnit !== "all" && timeWindowValue > 0) {
        const multipliers = {
          days: 86400,
          months: 2592000, // 30 days
          years: 31536000, // 365 days
        };
        minTimestamp = now - timeWindowValue * (multipliers[timeUnit] || 0);
      }

      const variables = { minTimestamp };
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        variables.limit = parsedLimit;
      }

      let timeRangeLabel = "All time";
      if (timeUnit !== "all" && timeWindowValue > 0) {
        timeRangeLabel = `Last ${timeWindowValue} ${timeUnit}`;
      }

      return {
        variables,
        meta: {
          timeRangeLabel,
          sampleLimit: parsedLimit,
        },
      };
    },

    processResponse: async (payload, meta) => {
      const packets = payload?.data?.PacketDelivered ?? [];
      const stats = computeStatistics(packets);

      // Prepare visualization data
      const rows = [
        {
          metric: "Total Packets Analyzed",
          value: stats.total.toLocaleString(),
          detail: meta.timeRangeLabel,
        },
        {
          metric: "All-Default Config Usage",
          value: `${stats.allDefaultPercentage.toFixed(2)}%`,
          detail: `${Math.round((stats.allDefaultPercentage / 100) * stats.total).toLocaleString()} packets use both default library and default ULN config`,
        },
        {
          metric: "Default Library Usage",
          value: `${stats.defaultLibPercentage.toFixed(2)}%`,
          detail: `${Math.round((stats.defaultLibPercentage / 100) * stats.total).toLocaleString()} packets`,
        },
        {
          metric: "Default Config Usage",
          value: `${stats.defaultConfigPercentage.toFixed(2)}%`,
          detail: `${Math.round((stats.defaultConfigPercentage / 100) * stats.total).toLocaleString()} packets`,
        },
        {
          metric: "Tracked Library Usage",
          value: `${stats.trackedPercentage.toFixed(2)}%`,
          detail: `${Math.round((stats.trackedPercentage / 100) * stats.total).toLocaleString()} packets use ReceiveUln302`,
        },
      ];

      if (stats.timeRange.earliest && stats.timeRange.latest) {
        rows.push({
          metric: "Time Range",
          value: `${formatTimestamp(stats.timeRange.earliest)} to ${formatTimestamp(stats.timeRange.latest)}`,
          detail: `${Math.floor((stats.timeRange.latest - stats.timeRange.earliest) / 86400)} days`,
        });
      }

      return {
        rows,
        meta: {
          ...meta,
          renderMode: "statistics",
          statistics: stats,
          dvnLabels: coordinator.chainMetadata, // Pass metadata for DVN resolution
        },
      };
    },
  };
}
