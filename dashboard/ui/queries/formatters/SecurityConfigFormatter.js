import { APP_CONFIG } from "../../../config.js";
import { splitOAppId } from "../../../core.js";
import { formatTimestampValue } from "../../../formatters/valueFormatters.js";
import { AddressUtils } from "../../../utils/AddressUtils.js";
import {
  createFormattedCell,
  formatRouteActivityLine,
  formatUpdateInfo,
} from "../../../formatters/cellFormatters.js";
import { resolveDvnLabels as _resolveDvnLabels } from "../../../utils/DvnUtils.js";
import { bigIntSafe, coerceToNumber, ensureArray, isNullish } from "../../../utils/NumberUtils.js";

const BLOCK_PRIORITY = [
  "peer-zero-explicit",
  "peer-zero-implicit",
  "required-dead-address",
  "required-dead-lz",
  "default-library-zero",
];

export class SecurityConfigFormatter {
  constructor(chainMetadata, aliasStore, getChainDisplayLabel, resolveDvnLabels) {
    this.chainMetadata = chainMetadata;
    this.aliasStore = aliasStore;
    this.getChainDisplayLabel = getChainDisplayLabel;
    this.resolveDvnLabels = resolveDvnLabels;
  }

  formatSecurityConfigRows(rows, meta) {
    const activityData = this.prepareRouteActivity(meta);

    const decorated = rows.map((row) => {
      const blockingReasons = this.identifyBlockingReasons(row, meta);
      const routeActivity = this.getRouteActivityForRow(row, activityData);
      return { row, blockingReasons, activity: routeActivity };
    });

    const nonBlocked = [];
    const blocked = [];

    decorated.forEach((entry) => {
      if (entry.blockingReasons.length === 0) {
        nonBlocked.push(entry);
      } else {
        blocked.push(entry);
      }
    });

    const requiredDvnValues = new Map();
    const optionalDvnValues = new Map();
    const fallbackValues = new Map();

    const nonBlockedWithKeys = nonBlocked.map((entry) => {
      const keys = this.buildHighlightKeys(entry.row);
      requiredDvnValues.set(keys.reqKey, (requiredDvnValues.get(keys.reqKey) || 0) + 1);
      optionalDvnValues.set(keys.optKey, (optionalDvnValues.get(keys.optKey) || 0) + 1);
      fallbackValues.set(keys.fallbackKey, (fallbackValues.get(keys.fallbackKey) || 0) + 1);
      return { ...entry, keys };
    });

    const mostCommonRequired = this.findMostCommon(requiredDvnValues);
    const mostCommonOptional = this.findMostCommon(optionalDvnValues);
    const mostCommonFallback = this.findMostCommon(fallbackValues);

    const formatted = [];

    nonBlockedWithKeys
      .sort((a, b) => {
        const aCount = a.activity.count;
        const bCount = b.activity.count;
        if (aCount !== bCount) {
          return bCount - aCount;
        }
        const aEid = bigIntSafe(a.row.eid);
        const bEid = bigIntSafe(b.row.eid);
        if (aEid !== null && bEid !== null) {
          return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
        }
        return String(a.row.eid).localeCompare(String(b.row.eid));
      })
      .forEach(({ row, keys, activity }) => {
        const highlightRequired =
          mostCommonRequired && keys.reqKey !== mostCommonRequired && mostCommonRequired !== null;
        const highlightOptional =
          mostCommonOptional && keys.optKey !== mostCommonOptional && mostCommonOptional !== null;
        const highlightFallback =
          mostCommonFallback &&
          keys.fallbackKey !== mostCommonFallback &&
          mostCommonFallback !== null;

        formatted.push(
          this.formatSecurityConfigRow(row, meta, {
            highlightRequired,
            highlightOptional,
            highlightFallback,
            routeActivity: activity,
            highlightColumns: new Set(),
          }),
        );
      });

    blocked
      .map((entry) => {
        const priorityIndex = entry.blockingReasons.length
          ? BLOCK_PRIORITY.findIndex((type) =>
              entry.blockingReasons.some((reason) => reason.type === type),
            )
          : BLOCK_PRIORITY.length;
        return {
          ...entry,
          priorityIndex: priorityIndex === -1 ? BLOCK_PRIORITY.length : priorityIndex,
        };
      })
      .sort((a, b) => {
        if (a.priorityIndex !== b.priorityIndex) {
          return a.priorityIndex - b.priorityIndex;
        }
        if (a.activity.count !== b.activity.count) {
          return b.activity.count - a.activity.count;
        }
        if (a.blockingReasons.length !== b.blockingReasons.length) {
          return a.blockingReasons.length - b.blockingReasons.length;
        }
        const aEid = bigIntSafe(a.row.eid);
        const bEid = bigIntSafe(b.row.eid);
        if (aEid !== null && bEid !== null) {
          return aEid < bEid ? -1 : aEid > bEid ? 1 : 0;
        }
        return String(a.row.eid).localeCompare(String(b.row.eid));
      })
      .forEach(({ row, blockingReasons, activity }) => {
        const highlightColumns = new Set(
          blockingReasons.map((reason) => reason.column).filter(Boolean),
        );
        formatted.push(
          this.formatSecurityConfigRow(row, meta, {
            highlightRequired: false,
            highlightOptional: false,
            highlightFallback: false,
            routeActivity: activity,
            highlightColumns,
          }),
        );
      });

    return formatted;
  }

  buildHighlightKeys(row) {
    return {
      reqKey: row.usesRequiredDVNSentinel
        ? "sentinel"
        : JSON.stringify(row.effectiveRequiredDVNs || []),
      optKey: JSON.stringify({
        dvns: row.effectiveOptionalDVNs || [],
        threshold: row.effectiveOptionalDVNThreshold,
      }),
      fallbackKey: JSON.stringify(row.fallbackFields || []),
    };
  }

  findMostCommon(valueMap) {
    let maxCount = 0;
    let mostCommon = null;
    valueMap.forEach((count, key) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = key;
      }
    });
    return mostCommon;
  }

  prepareRouteActivity(meta) {
    const stats = ensureArray(meta?.routeStats);
    const map = new Map();
    let summed = 0;

    stats.forEach((stat) => {
      const key = stat?.srcEid ?? stat?.eid;
      if (isNullish(key)) return;
      const normalizedKey = String(key);
      const count = coerceToNumber(stat?.packetCount);
      map.set(normalizedKey, {
        count,
        raw: stat,
      });
      summed += count;
    });

    let totalPackets = coerceToNumber(meta?.oappInfo?.totalPacketsReceived);
    if (!(totalPackets > 0)) {
      totalPackets = summed;
    }

    return {
      map,
      totalPackets,
    };
  }

  getRouteActivityForRow(row, activityData) {
    const key = row?.eid ?? null;
    const normalizedKey = isNullish(key) ? null : String(key);
    const entry = normalizedKey ? activityData.map.get(normalizedKey) : undefined;
    const count = entry?.count ?? 0;
    const totalPackets = activityData.totalPackets > 0 ? activityData.totalPackets : 0;
    const percentOfTotal = totalPackets > 0 ? count / totalPackets : 0;

    return {
      count,
      percentOfTotal,
      raw: entry?.raw ?? null,
      totalPackets,
    };
  }

  identifyBlockingReasons(row, meta) {
    const reasons = [];
    const seenTypes = new Set();

    const peerMap = meta?.peerMap instanceof Map ? meta.peerMap : null;
    let peerState = row.peerStateHint || null;
    if (!peerState) {
      const peerRecord = peerMap?.get(String(row.eid));
      const isZeroPeer = AddressUtils.isZero(row.peer);
      if (peerRecord) {
        if (isZeroPeer && !peerRecord.fromPacketDelivered) {
          peerState = "explicitly-blocked";
        } else if (peerRecord.fromPacketDelivered) {
          peerState = "auto-discovered";
        } else {
          peerState = "explicitly-set";
        }
      } else if (isZeroPeer) {
        peerState = "explicitly-blocked";
      }
    }

    if (peerState === "explicit-blocked" || peerState === "explicitly-blocked") {
      reasons.push({
        type: "peer-zero-explicit",
        label: "Peer blocked (explicit zero address)",
        column: "Peer",
      });
      seenTypes.add("peer-zero-explicit");
    } else if (peerState === "implicit-blocked") {
      reasons.push({
        type: "peer-zero-implicit",
        label: "Peer assumed blocked (no peer configured)",
        column: "Peer",
      });
      seenTypes.add("peer-zero-implicit");
    }

    const requiredDvns = ensureArray(row.effectiveRequiredDVNs);
    const normalizedRequired = requiredDvns
      .map((addr) => String(addr || "").toLowerCase())
      .filter(Boolean);
    const deadAddress = APP_CONFIG.ADDRESSES.DEAD.toLowerCase();

    if (normalizedRequired.includes(deadAddress) && !seenTypes.has("required-dead-address")) {
      reasons.push({
        type: "required-dead-address",
        label: "Required DVN includes 0x…dead sentinel",
        column: "Required DVNs",
      });
      seenTypes.add("required-dead-address");
    }

    if (requiredDvns.length > 0) {
      const contextLocalEid =
        row.localEid ??
        meta?.localEid ??
        (meta?.oappInfo && meta.oappInfo.localEid !== undefined ? meta.oappInfo.localEid : null);
      const resolvedNames = this.chainMetadata.resolveDvnNames(requiredDvns, {
        localEid: contextLocalEid ?? undefined,
      });
      const hasDeadDvnName = resolvedNames.some((name) =>
        typeof name === "string" ? name.toLowerCase().includes("lzdead") : false,
      );
      if (hasDeadDvnName && !seenTypes.has("required-dead-lz")) {
        reasons.push({
          type: "required-dead-lz",
          label: "Required DVN tagged as LZDeadDVN",
          column: "Required DVNs",
        });
        seenTypes.add("required-dead-lz");
      }
    }

    const libraryStatus = row.libraryStatus || "unknown";
    const noLibraryConfigured = !row.effectiveReceiveLibrary;
    const usesDefaultLibrary = row.usesDefaultLibrary !== false;
    const fallbackFields = Array.isArray(row.fallbackFields) ? row.fallbackFields : [];
    const defaultLibraryFallback = fallbackFields.includes("receiveLibrary");

    if (
      noLibraryConfigured &&
      (libraryStatus === "none" || usesDefaultLibrary || defaultLibraryFallback) &&
      !seenTypes.has("default-library-zero")
    ) {
      reasons.push({
        type: "default-library-zero",
        label: "Falling back to zero receive library (route disabled)",
        column: "Library",
      });
      seenTypes.add("default-library-zero");
    }

    return reasons;
  }

  formatSecurityConfigRow(
    row,
    meta,
    {
      highlightRequired = false,
      highlightOptional = false,
      highlightFallback = false,
      routeActivity = null,
      highlightColumns = new Set(),
    } = {},
  ) {
    const formatted = {};
    const chainDisplay = this.getChainDisplayLabel(row.eid) || row.eid || "—";
    formatted["Source EID"] = createFormattedCell([chainDisplay], row.eid);
    formatted.Library = this.formatLibraryDescriptor(row, highlightColumns.has("Library"));

    formatted["Required DVNs"] = this.formatRequiredDvns(
      row,
      meta,
      highlightRequired || highlightColumns.has("Required DVNs"),
    );

    formatted["Optional DVNs"] = this.formatOptionalDvns(row, meta, highlightOptional);

    formatted.Peer = this.formatPeer(
      row,
      meta.peerMap,
      highlightColumns.has("Peer"),
      routeActivity,
    );
    formatted["Peer Updated"] = this.formatPeerUpdate(row);
    formatted.Confirmations = this.formatConfirmations(row);

    formatted.Fallbacks = this.formatFallbackFields(
      row.fallbackFields,
      row.usesDefaultConfig,
      row.libraryStatus,
      highlightFallback || highlightColumns.has("Fallbacks"),
    );

    formatted["Last Update"] = this.formatLastComputed(row);

    return formatted;
  }

  formatLibraryDescriptor(row, highlight = false) {
    const address = row.effectiveReceiveLibrary || "—";
    const statusBits = [];

    const libraryStatus = row.libraryStatus || "unknown";
    const statusExplanations = {
      tracked: "TRACKED (ULN config available)",
      unsupported: "UNSUPPORTED (no ULN config)",
      none: "NOT CONFIGURED",
      unknown: "UNKNOWN STATUS",
    };
    statusBits.push(statusExplanations[libraryStatus] || libraryStatus);

    if (row.usesDefaultLibrary && row.effectiveReceiveLibrary) {
      statusBits.push("Uses default library");
    }
    if (!row.usesDefaultLibrary && row.libraryOverrideVersionId) {
      statusBits.push("Custom override");
    }

    const lines = [address];
    if (statusBits.length) {
      lines.push(statusBits.join(" • "));
    }

    return createFormattedCell(lines, address, { highlight });
  }

  formatRequiredDvns(row, meta, highlight = false) {
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    if (row.usesRequiredDVNSentinel) {
      return createFormattedCell(
        ["SENTINEL: 0 required DVNs", "Optional-only quorum"],
        "sentinel",
        { highlight },
      );
    }
    return this.formatDvnSet(
      row.effectiveRequiredDVNs,
      row.effectiveRequiredDVNCount,
      meta,
      row.localEid,
      [],
      highlight,
    );
  }

  formatOptionalDvns(row, meta, highlight = false) {
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    const count = row.effectiveOptionalDVNCount ?? 0;
    const threshold = row.effectiveOptionalDVNThreshold ?? "—";
    return this.formatDvnSet(
      row.effectiveOptionalDVNs,
      count,
      meta,
      row.localEid,
      [`Threshold ${threshold}`],
      highlight,
    );
  }

  formatDvnSet(addresses, count, meta, localEid, extraLines = [], highlight = false) {
    const addrs = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
    const lines = [`Count ${count ?? addrs.length ?? 0}`, ...extraLines];
    if (addrs.length) {
      lines.push(...this.resolveDvnLabels(addrs, meta, localEid ?? meta?.localEid ?? meta?.eid));
    }
    return createFormattedCell(lines, addrs.join(", ") || String(count), { highlight });
  }

  derivePeerContext(row) {
    const peerOappId = row.peerOappId ?? null;
    if (!peerOappId) {
      return null;
    }

    const { localEid, address } = splitOAppId(peerOappId);
    const endpointLabel =
      localEid !== null && localEid !== undefined
        ? this.getChainDisplayLabel(localEid) || `EID ${localEid}`
        : null;
    const alias = this.aliasStore.get(peerOappId) ?? null;

    return {
      peerHex: row.peer ?? null,
      localEid,
      endpointLabel,
      address,
      oappId: peerOappId,
      alias,
      copyValue: peerOappId,
    };
  }

  formatPeer(row, peerMap, highlight = false, routeActivity = null) {
    const ctx = this.derivePeerContext(row);
    const peerData = peerMap?.get(String(row.eid));
    const isZeroPeer = isZeroAddress(row.peer);

    let peerState = row.peerStateHint || null;
    if (!peerState) {
      if (peerData) {
        if (isZeroPeer && !peerData.fromPacketDelivered) {
          peerState = "explicitly-blocked";
        } else if (peerData.fromPacketDelivered) {
          peerState = "auto-discovered";
        } else {
          peerState = "explicitly-set";
        }
      } else if (isZeroPeer) {
        peerState = "explicitly-blocked";
      } else {
        peerState = "not-configured";
      }
    }

    if (peerState === "explicit") {
      peerState = "explicitly-set";
    }

    const lines = [];
    const stateLabels = {
      "not-configured": "Not configured",
      "auto-discovered": "Auto-discovered",
      "explicitly-set": "",
      "explicitly-blocked": "BLOCKED (zero address)",
      "implicit-blocked": "Assumed blocked (no peer configured)",
    };
    const primaryLabel = stateLabels[peerState] ?? peerState;
    if (primaryLabel) {
      lines.push(primaryLabel);
    }

    const isBlocked = peerState === "explicitly-blocked" || peerState === "implicit-blocked";
    if (peerState === "implicit-blocked") {
      lines.push("LayerZero default; some OApps may still accept traffic.");
    }

    let meterPercent = null;
    if (routeActivity) {
      meterPercent = Math.max(0, Math.min(1, routeActivity.percentOfTotal || 0));
      if (routeActivity.count > 0) {
        lines.push(formatRouteActivityLine(routeActivity));
      } else if (routeActivity.totalPackets > 0) {
        lines.push("0 packets (0%)");
      }
    }

    if (isBlocked) {
      const meta =
        meterPercent && meterPercent > 0 ? { highlight: true, meterPercent } : { highlight: true };
      return createFormattedCell(lines, "0x0", meta);
    }

    if (!ctx) {
      const meta = meterPercent && meterPercent > 0 ? { highlight, meterPercent } : { highlight };
      return createFormattedCell(lines, "", meta);
    }

    if (ctx.alias) {
      lines.push(ctx.alias);
    }
    if (ctx.oappId) {
      lines.push(ctx.oappId);
    } else if (ctx.peerHex) {
      lines.push(ctx.peerHex);
    }

    let meta =
      ctx.oappId || ctx.localEid
        ? {
            oappId: ctx.oappId ?? undefined,
            localEid: ctx.localEid ?? undefined,
            highlight,
          }
        : { highlight };
    if (meterPercent && meterPercent > 0) {
      meta = { ...meta, meterPercent };
    }
    return createFormattedCell(lines, ctx.copyValue, meta);
  }

  formatPeerUpdate(row) {
    return formatUpdateInfo({
      block: row.peerLastUpdatedBlock,
      timestamp: row.peerLastUpdatedTimestamp,
      eventId: row.peerLastUpdatedEventId,
      txHash: row.peerTransactionHash,
    });
  }

  formatConfirmations(row) {
    if (row.libraryStatus === "none" || row.libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "");
    }

    const confirmations = row.effectiveConfirmations ?? "—";
    const lines = [];

    // Check for sentinel value (2^64-1 = 18446744073709551615)
    const CONFIRMATIONS_SENTINEL = APP_CONFIG.SENTINEL_VALUES.CONFIRMATIONS_SENTINEL;
    if (String(confirmations) === CONFIRMATIONS_SENTINEL) {
      lines.push("SENTINEL: 0 confirmations");
      lines.push("Instant finality mode");
    } else {
      lines.push(String(confirmations));
    }

    return createFormattedCell(lines, String(confirmations));
  }

  formatFallbackFields(fields, usesDefaultConfig, libraryStatus, highlight = false) {
    if (libraryStatus === "none" || libraryStatus === "unsupported") {
      return createFormattedCell(["—", "No ULN config"], "", { highlight });
    }

    const names = Array.isArray(fields) ? fields : [];
    if (!names.length) {
      if (usesDefaultConfig) {
        return createFormattedCell(["All from default"], "default", { highlight });
      }
      return createFormattedCell(["None (fully custom)"], "", { highlight });
    }

    const map = {
      receiveLibrary: "library",
      confirmations: "confirmations",
      requiredDVNCount: "required count",
      requiredDVNs: "required dvns",
      optionalDVNCount: "optional count",
      optionalDVNs: "optional dvns",
      optionalDVNThreshold: "optional threshold",
    };

    const lines = names.map((name) => map[name] || name);
    return createFormattedCell(lines, names.join(", "), { highlight });
  }

  formatLastComputed(row) {
    return formatUpdateInfo({
      block: row.lastComputedBlock,
      timestamp: row.lastComputedTimestamp,
      eventId: row.lastComputedByEventId,
      txHash: row.lastComputedTransactionHash,
    });
  }
}
