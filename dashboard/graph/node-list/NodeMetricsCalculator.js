import { APP_CONFIG } from "../../config.js";
import { AddressUtils } from "../../utils/AddressUtils.js";
import {
  coerceToNumber,
  createLabelAddressPairs,
  ensureArray,
  isDefined,
  normalizeLabels,
} from "../../utils/NumberUtils.js";

/**
 * Calculates metrics for nodes based on graph analysis data
 * Extracted from NodeListView to follow single responsibility principle
 */
export class NodeMetricsCalculator {
  constructor({ getOAppAlias, formatChainLabel, areStringArraysEqual }) {
    this.getOAppAlias = typeof getOAppAlias === "function" ? getOAppAlias : () => null;
    this.formatChainLabel = typeof formatChainLabel === "function" ? formatChainLabel : () => "";
    this.areStringArraysEqual =
      typeof areStringArraysEqual === "function" ? areStringArraysEqual : () => false;
  }

  /**
   * Calculate comprehensive metrics for all nodes
   */
  calculateNodeMetrics(nodes, edgeSecurityInfo, blockedNodes, dominantCombination) {
    const edgesByTo = this.buildEdgesByToMap(edgeSecurityInfo);
    const edgesByFrom = this.buildEdgesByFromMap(edgeSecurityInfo);
    const combinationFingerprint = dominantCombination?.fingerprint ?? null;

    const nodeMetrics = nodes.map((node) => {
      const incoming = edgesByTo.get(node.id) || [];
      const outgoing = edgesByFrom.get(node.id) || [];
      const activeIncoming = incoming.filter((edge) => !edge.isBlocked);
      const blockedIncoming = incoming.filter((edge) => edge.isBlocked);
      const differenceEdges = activeIncoming.filter((edge) => edge.differsFromPopular);
      const sentinelEdges = activeIncoming.filter((edge) => edge.usesSentinel);

      const diffReasonSet = new Set();
      for (const edge of differenceEdges) {
        if (Array.isArray(edge.differenceReasons)) {
          for (const reason of edge.differenceReasons) {
            diffReasonSet.add(reason);
          }
        }
      }

      const blockReasonSet = new Set();
      for (const edge of blockedIncoming) {
        const label = APP_CONFIG.BLOCK_REASON_LABELS[edge.blockReason];
        if (label) {
          blockReasonSet.add(label);
        } else if (edge.blockReason) {
          blockReasonSet.add("Blocked route");
        }
      }

      const allowedSrcEids = new Set();
      const registerAllowed = (eid) => {
        if (isDefined(eid)) {
          allowedSrcEids.add(String(eid));
        }
      };

      activeIncoming.forEach((edgeInfo) => {
        const srcEid = edgeInfo?.edge?.srcEid;
        if (isDefined(srcEid)) {
          registerAllowed(srcEid);
        }
      });

      blockedIncoming.forEach((edgeInfo) => {
        const srcEid = edgeInfo?.edge?.srcEid;
        if (isDefined(srcEid)) {
          registerAllowed(srcEid);
        }
      });

      const configDetails = (node.securityConfigs || [])
        .map((cfg) => {
          const normalizedSrcEid = isDefined(cfg.srcEid) ? String(cfg.srcEid) : null;

          if (
            allowedSrcEids.size > 0 &&
            (!normalizedSrcEid || !allowedSrcEids.has(normalizedSrcEid))
          ) {
            return null;
          }
          const requiredLabels = cfg.requiredDVNLabels || cfg.requiredDVNs || [];
          const requiredAddresses = cfg.requiredDVNs || [];
          const normalized = normalizeLabels(requiredLabels);
          const fingerprint = JSON.stringify({
            required: cfg.requiredDVNCount || 0,
            names: normalized,
            sentinel: !!(cfg.usesRequiredDVNSentinel),
          });
          const matchesDominant =
            !!(combinationFingerprint) &&
            !cfg.usesRequiredDVNSentinel &&
            fingerprint === combinationFingerprint;
          const differsFromDominant = !!(combinationFingerprint) && !matchesDominant;
          const usesSentinel = !!(cfg.usesRequiredDVNSentinel);

          if (usesSentinel) {
            diffReasonSet.add(
              `sentinel quorum ${cfg.optionalDVNThreshold || 0}/${cfg.optionalDVNCount || 0}`,
            );
          } else if (differsFromDominant && dominantCombination) {
            if (cfg.requiredDVNCount !== dominantCombination.requiredDVNCount) {
              diffReasonSet.add(
                `required DVN count ${cfg.requiredDVNCount} vs dominant ${dominantCombination.requiredDVNCount ?? "?"}`,
              );
            }
            if (!this.areStringArraysEqual(normalized, dominantCombination.normalizedNames)) {
              diffReasonSet.add("validator set differs");
            }
          }

          const requiredPairs = createLabelAddressPairs(requiredLabels, requiredAddresses);

          const optionalLabels = cfg.optionalDVNLabels || cfg.optionalDVNs || [];
          const optionalAddresses = cfg.optionalDVNs || [];
          const optionalPairs = createLabelAddressPairs(optionalLabels, optionalAddresses);
          const optionalSummary =
            cfg.optionalDVNCount && cfg.optionalDVNCount > 0
              ? `${cfg.optionalDVNThreshold || 0}/${cfg.optionalDVNCount}`
              : cfg.optionalDVNThreshold
                ? `${cfg.optionalDVNThreshold}`
                : null;

          return {
            srcEid: cfg.srcEid,
            requiredDVNCount: cfg.requiredDVNCount || 0,
            requiredPairs,
            optionalPairs,
            optionalSummary,
            usesSentinel,
            matchesDominant,
            differsFromDominant,
            fingerprint,
            packetCount: isDefined(cfg.routePacketCount) ? Number(cfg.routePacketCount) : 0,
            packetShare: isDefined(cfg.routePacketShare) ? Number(cfg.routePacketShare) : 0,
            packetPercent: isDefined(cfg.routePacketPercent) ? Number(cfg.routePacketPercent) : 0,
            lastPacketBlock: cfg.routeLastPacketBlock ?? null,
            lastPacketTimestamp: cfg.routeLastPacketTimestamp ?? null,
            libraryStatus: cfg.libraryStatus ?? "unknown",
            peerStateHint: cfg.peerStateHint ?? null,
            synthetic: !!(cfg.synthetic),
          };
        })
        .filter(Boolean);

      const hasConfigDifference =
        differenceEdges.length > 0 || configDetails.some((detail) => detail.differsFromDominant);
      const hasSentinel =
        sentinelEdges.length > 0 || configDetails.some((detail) => detail.usesSentinel);

      const notes = new Set();
      if (blockedNodes.has(node.id)) {
        notes.add("Blocked");
      }
      if (!node.isTracked) {
        notes.add("Untracked");
      }
      if (node.isDangling) {
        notes.add("Dangling");
      }
      if (hasSentinel) {
        notes.add("Sentinel quorum");
      }
      if (node.isTracked && activeIncoming.length === 0 && !blockedNodes.has(node.id)) {
        notes.add("No active inbound edges");
      }

      const blockReasons = Array.from(blockReasonSet);
      if (blockedNodes.has(node.id) && blockReasons.length === 0 && node.isDangling) {
        blockReasons.push("Dangling peer (no config crawled)");
      }

      const endpointId =
        node.localEid ?? (typeof node.id === "string" ? node.id.split("_")[0] : "unknown");
      const chainLabel = this.formatChainLabel(endpointId) || endpointId;
      const totalPackets = coerceToNumber(node.totalPacketsReceived);
      const totalRoutePackets = Math.max(0, coerceToNumber(node.totalRoutePackets));
      const securitySummary = node.securitySummary || null;
      if (
        securitySummary &&
        Number(securitySummary.syntheticCount) === Number(securitySummary.totalRoutes) &&
        Number(securitySummary.totalRoutes) > 0
      ) {
        notes.add("Defaults only");
      }

      return {
        id: node.id,
        node,
        alias: this.getOAppAlias(node.id),
        chainLabel,
        depth: node.depth >= 0 ? node.depth : "—",
        isTracked: !!(node.isTracked),
        isDangling: !!(node.isDangling),
        fromPacketDelivered: !!(node.fromPacketDelivered),
        isBlocked: blockedNodes.has(node.id),
        totalPackets,
        totalRoutePackets,
        incoming,
        outgoing,
        activeIncoming,
        blockedIncoming,
        activeIncomingCount: activeIncoming.length,
        blockedIncomingCount: blockedIncoming.length,
        differenceEdges,
        sentinelEdges,
        diffReasonSummary: Array.from(diffReasonSet),
        blockReasons,
        configDetails,
        hasConfigDifference,
        hasSentinel,
        notes: Array.from(notes),
        securitySummary,
        syntheticRouteCount: securitySummary?.syntheticCount ?? 0,
        implicitBlockCount: securitySummary?.implicitBlocks ?? 0,
        explicitBlockCount: securitySummary?.explicitBlocks ?? 0,
      };
    });

    // Sort metrics: tracked first, then by packet count, then by ID
    nodeMetrics.sort((a, b) => {
      if (a.isTracked !== b.isTracked) {
        return a.isTracked ? -1 : 1;
      }
      const packetsA = Number.isFinite(a.totalPackets) ? a.totalPackets : 0;
      const packetsB = Number.isFinite(b.totalPackets) ? b.totalPackets : 0;
      if (packetsB !== packetsA) {
        return packetsB - packetsA;
      }
      return String(a.id).localeCompare(String(b.id));
    });

    return nodeMetrics;
  }

  /**
   * Build map of edges grouped by target node
   */
  buildEdgesByToMap(edgeSecurityInfo) {
    const edgesByTo = new Map();
    for (const info of edgeSecurityInfo) {
      if (!edgesByTo.has(info.edge.to)) {
        edgesByTo.set(info.edge.to, []);
      }
      edgesByTo.get(info.edge.to).push(info);
    }
    return edgesByTo;
  }

  /**
   * Build map of edges grouped by source node
   */
  buildEdgesByFromMap(edgeSecurityInfo) {
    const edgesByFrom = new Map();
    for (const info of edgeSecurityInfo) {
      if (!edgesByFrom.has(info.edge.from)) {
        edgesByFrom.set(info.edge.from, []);
      }
      edgesByFrom.get(info.edge.from).push(info);
    }
    return edgesByFrom;
  }
}
