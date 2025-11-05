import { clampInteger } from "../../../core.js";
import { formatTimestampValue } from "../../../formatters/valueFormatters.js";
import { isDefined } from "../../../utils/NumberUtils.js";
import { createFormattedCell } from "../../../formatters/cellFormatters.js";

export class OAppFormatter {
  constructor(aliasStore, getChainDisplayLabel) {
    this.aliasStore = aliasStore;
    this.getChainDisplayLabel = getChainDisplayLabel;
  }

  formatOAppIdCell(oappId) {
    if (!oappId) {
      return createFormattedCell(["—"], "");
    }
    const alias = this.aliasStore.get(oappId);
    const lines = alias ? [alias, `ID ${oappId}`] : [oappId];
    return createFormattedCell(lines, oappId, { oappId });
  }

  /**
   * Aggregates packet data to identify popular OApps
   * Groups packets by OApp, counts interactions, and formats results
   */
  aggregatePopularOapps(packets, options = {}) {
    const resultLimit = clampInteger(options.resultLimit, 1, 200, 20);
    const windowLabel = options.windowLabel || "";
    const fetchLimit = options.fetchLimit ?? null;

    const groups = new Map();
    packets.forEach((packet) => {
      if (!packet) return;

      const inferredKey =
        packet.oappId ||
        (packet.localEid && packet.receiver
          ? `${packet.localEid}_${packet.receiver.toLowerCase()}`
          : null);
      if (!inferredKey) return;

      const [localPart, addressPart] = inferredKey.split("_");
      const group = groups.get(inferredKey) ?? {
        oappId: inferredKey,
        localEid: localPart || String(packet.localEid ?? ""),
        address: (packet.receiver || addressPart || "").toLowerCase(),
        count: 0,
        eids: new Set(),
        lastTimestamp: 0,
        firstTimestamp: Number.MAX_SAFE_INTEGER,
        lastBlock: null,
      };

      group.count += 1;
      if (isDefined(packet.srcEid))
        group.eids.add(String(packet.srcEid));

      const timestamp = Number(packet.blockTimestamp ?? 0);
      if (Number.isFinite(timestamp)) {
        group.lastTimestamp = Math.max(group.lastTimestamp, timestamp);
        group.firstTimestamp = Math.min(group.firstTimestamp, timestamp);
      }

      const blockNumber = packet.blockNumber !== undefined ? Number(packet.blockNumber) : null;
      if (
        Number.isFinite(blockNumber) &&
        (group.lastBlock === null || blockNumber > group.lastBlock)
      ) {
        group.lastBlock = blockNumber;
      }

      groups.set(inferredKey, group);
    });

    const sortedGroups = Array.from(groups.values()).sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return (b.lastTimestamp || 0) - (a.lastTimestamp || 0);
    });

    const limited = sortedGroups.slice(0, resultLimit);
    const rows = limited.map((group, index) => {
      const chainDisplay = this.getChainDisplayLabel(group.localEid) || group.localEid || "—";
      const address = group.address || (group.oappId.split("_")[1] ?? "—");
      const eids = Array.from(group.eids).sort();

      const chainCell = createFormattedCell([chainDisplay], group.localEid);

      const oappCell = this.formatOAppIdCell(group.oappId);
      const addressCell = createFormattedCell([address], address);

      const eidLines = [`Count ${eids.length}`];
      const eidCopyValue = eids.join(", ");
      const eidCell = createFormattedCell(eidLines, eidCopyValue || `Count ${eids.length}`);

      const lastLines = [];
      if (group.lastTimestamp) {
        const ts = formatTimestampValue(group.lastTimestamp);
        if (ts) {
          lastLines.push(ts.primary);
          if (ts.secondary) {
            lastLines.push(ts.secondary);
          }
        }
      }
      if (isDefined(group.lastBlock)) {
        lastLines.push(`Block ${group.lastBlock}`);
      }
      const lastCell = createFormattedCell(
        lastLines.length ? lastLines : ["—"],
        String(group.lastTimestamp ?? ""),
      );

      return {
        Rank: String(index + 1),
        "OApp ID": oappCell,
        Endpoint: chainCell,
        Address: addressCell,
        Packets: String(group.count),
        "Unique incoming EIDs": eidCell,
        "Last Packet": lastCell,
      };
    });

    return {
      rows,
      meta: {
        summary: `Top ${rows.length} • last ${windowLabel || "window"}`,
        popularOappsSummary: {
          windowLabel,
          fromTimestamp: options.fromTimestamp ?? 0,
          toTimestamp: options.nowTimestamp ?? Math.floor(Date.now() / 1000),
          totalOapps: groups.size,
          sampledPackets: packets.length,
          returnedCount: rows.length,
          fetchLimit: fetchLimit ?? "∞",
        },
      },
    };
  }
}
