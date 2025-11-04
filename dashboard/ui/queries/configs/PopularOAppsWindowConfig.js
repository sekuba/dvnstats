/**
 * Popular OApps Window Query Configuration
 * Rank OApps by packets in a configurable time window
 */

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

      return {
        rows: result.rows,
        meta: {
          ...meta,
          summary: result.meta.summary,
          popularOappsSummary: result.meta.popularOappsSummary,
        },
      };
    },
  };
}
