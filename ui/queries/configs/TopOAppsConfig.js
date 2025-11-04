import { clampInteger, parseOptionalPositiveInt } from "../../../core.js";
import { createFormattedCell } from "../../../formatters/cellFormatters.js";
import { TOP_OAPPS_QUERY } from "../../../queries/topOApps.js";

export function createTopOAppsConfig(coordinator) {
  return {
    label: "Top OApps",
    description: "Ordered by total packets received",
    query: TOP_OAPPS_QUERY,

    buildVariables: (card) => {
      const limitInput = card.querySelector('input[name="limit"]');
      const minPacketsInput = card.querySelector('input[name="minPackets"]');

      const rawLimit = limitInput?.value?.trim() ?? "";
      const parsedLimit = parseOptionalPositiveInt(rawLimit);
      const minPackets = clampInteger(minPacketsInput?.value, 0, Number.MAX_SAFE_INTEGER, 0);

      const variables = {
        minPackets: String(minPackets),
      };
      if (Number.isFinite(parsedLimit)) {
        variables.limit = parsedLimit;
      }

      return {
        variables,
        meta: {
          limitLabel: Number.isFinite(parsedLimit) ? `limit=${parsedLimit}` : "limit=∞",
        },
      };
    },

    extractRows: (data) =>
      (data?.OAppStats ?? []).map((row) => {
        const chainDisplay = coordinator.getChainDisplayLabel(row.localEid) || row.localEid || "—";
        return {
          ...row,
          id: coordinator.formatOAppIdCell(row.id),
          localEid: createFormattedCell([chainDisplay], row.localEid),
        };
      }),
  };
}
