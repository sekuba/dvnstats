import { clampInteger, parseOptionalPositiveInt } from "../../../core.js";
import { POPULAR_OAPPS_WINDOW_QUERY } from "../../../queries/popularOAppsWindow.js";

export function createPopularOAppsWindowConfig(coordinator) {
  return {
    label: "Hot OApps",
    description: "Rank OApps by packets in a configurable time window",
    query: POPULAR_OAPPS_WINDOW_QUERY,

    initialize: ({ card }) => {
      const unitSelect = card.querySelector('select[name="windowUnit"]');
      if (unitSelect && !unitSelect.value) {
        unitSelect.value = "days";
      }
    },

    buildVariables: (card) => {
      const windowValueInput = card.querySelector('input[name="windowValue"]');
      const windowUnitSelect = card.querySelector('select[name="windowUnit"]');
      const resultLimitInput = card.querySelector('input[name="resultLimit"]');
      const fetchLimitInput = card.querySelector('input[name="fetchLimit"]');

      const rawWindowValue = clampInteger(windowValueInput?.value, 1, 365, 7);
      const windowUnit = windowUnitSelect?.value ?? "days";
      const unitSeconds = {
        minutes: 60,
        hours: 3600,
        days: 86400,
      };
      const secondsPerUnit = unitSeconds[windowUnit] ?? unitSeconds.days;
      const windowSeconds = rawWindowValue * secondsPerUnit;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const fromTimestamp = Math.max(nowSeconds - windowSeconds, 0);

      const resultLimit = clampInteger(resultLimitInput?.value, 1, 200, 20);
      const fetchLimitRaw = fetchLimitInput?.value?.trim();
      const fetchLimitParsed = parseOptionalPositiveInt(fetchLimitRaw);
      const fetchLimit =
        Number.isFinite(fetchLimitParsed) && fetchLimitParsed > 0
          ? Math.min(fetchLimitParsed, 200000)
          : null;

      const windowLabel = `${rawWindowValue}${windowUnit.charAt(0)}`;

      return {
        variables: {
          fromTimestamp: String(fromTimestamp),
          ...(fetchLimit ? { fetchLimit } : {}),
        },
        meta: {
          limitLabel: `window=${windowLabel}, top=${resultLimit}, sample=${fetchLimit ?? "∞"}`,
          summary: `Top ${resultLimit} • last ${windowLabel}`,
          windowSeconds,
          windowLabel,
          fromTimestamp,
          nowTimestamp: nowSeconds,
          resultLimit,
          fetchLimit,
        },
      };
    },

    processResponse: (payload, meta) => {
      const packets = payload?.data?.PacketDelivered ?? [];
      const result = coordinator.oappFormatter.aggregatePopularOapps(packets, meta);
      const coverage = describeSampleCoverage(packets, meta);

      if (!coverage.truncated) {
        return {
          rows: result.rows,
          meta: {
            ...meta,
            summary: result.meta.summary,
            popularOappsSummary: { ...result.meta.popularOappsSummary, coverage },
          },
        };
      }

      // Never label a truncated sample as the full requested window.
      const warning = `Sample covers last ${coverage.coveredLabel} of requested ${coverage.requestedLabel} — raise the packet sample limit`;
      return {
        rows: result.rows,
        meta: {
          ...meta,
          label: `Hot OApps — truncated: last ${coverage.coveredLabel} of ${coverage.requestedLabel}`,
          summary: `Top ${result.rows.length} • ${warning}`,
          warning,
          popularOappsSummary: { ...result.meta.popularOappsSummary, coverage },
        },
      };
    },
  };
}

/**
 * The query returns the newest `fetchLimit` packets. If that limit was hit and the
 * oldest returned packet is newer than the window start, only part of the window
 * was scanned.
 */
function describeSampleCoverage(packets, meta) {
  const fetchLimit = meta?.fetchLimit ?? null;
  const fromTimestamp = Number(meta?.fromTimestamp ?? 0);
  const nowTimestamp = Number(meta?.nowTimestamp ?? Math.floor(Date.now() / 1000));
  const requestedLabel = meta?.windowLabel || formatDuration(nowTimestamp - fromTimestamp);

  let oldestTimestamp = null;
  for (const packet of packets) {
    const ts = Number(packet?.blockTimestamp);
    if (Number.isFinite(ts) && (oldestTimestamp === null || ts < oldestTimestamp)) {
      oldestTimestamp = ts;
    }
  }

  const truncated =
    Boolean(fetchLimit) &&
    packets.length >= fetchLimit &&
    oldestTimestamp !== null &&
    oldestTimestamp > fromTimestamp;
  const coveredSeconds = truncated ? Math.max(nowTimestamp - oldestTimestamp, 0) : null;

  return {
    truncated,
    oldestTimestamp,
    coveredSeconds,
    coveredLabel: truncated ? formatDuration(coveredSeconds) : requestedLabel,
    requestedLabel,
  };
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(Math.floor(Number(totalSeconds) || 0), 0);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
