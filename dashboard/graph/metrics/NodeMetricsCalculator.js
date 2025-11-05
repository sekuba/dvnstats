import { AddressUtils } from "../../utils/AddressUtils.js";
import { coerceToNumber } from "../../utils/NumberUtils.js";

export class NodeMetricsCalculator {
  constructor({ getOAppAlias, formatChainLabel, areStringArraysEqual }) {
    this.getOAppAlias = getOAppAlias;
    this.formatChainLabel = formatChainLabel;
    this.areStringArraysEqual = areStringArraysEqual;
  }

  calculateMetrics(webData, analysis = {}) {
    const nodes = Array.isArray(webData?.nodes) ? webData.nodes : [];

    if (!nodes.length) {
      return [];
    }

    const blockedNodes =
      analysis?.blockedNodes instanceof Set
        ? analysis.blockedNodes
        : new Set(Array.isArray(analysis?.blockedNodes) ? analysis.blockedNodes : []);

    const edgeSecurityInfo = Array.isArray(analysis?.edgeSecurityInfo)
      ? analysis.edgeSecurityInfo
      : [];
    const dominantCombination = analysis?.dominantCombination || null;
    const combinationFingerprint = dominantCombination?.fingerprint ?? null;

    const edgesByTo = new Map();
    const edgesByFrom = new Map();
    for (const info of edgeSecurityInfo) {
      if (!edgesByTo.has(info.edge.to)) {
        edgesByTo.set(info.edge.to, []);
      }
      edgesByTo.get(info.edge.to).push(info);

      if (!edgesByFrom.has(info.edge.from)) {
        edgesByFrom.set(info.edge.from, []);
      }
      edgesByFrom.get(info.edge.from).push(info);
    }

    const normalizeNames = (labels) =>
      Array.isArray(labels)
        ? labels
            .map((label) =>
              label === null || label === undefined ? "" : String(label).trim().toLowerCase(),
            )
            .filter(Boolean)
            .sort()
        : [];

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
        if (edge.blockReason === "stale-peer") {
          blockReasonSet.add("Stale peer");
        } else if (edge.blockReason === "zero-peer") {
          blockReasonSet.add("Zero peer");
        } else if (edge.blockReason === "implicit-block") {
          blockReasonSet.add("No peer configured");
        } else if (edge.blockReason === "dead-dvn") {
          blockReasonSet.add("Dead DVN");
        } else if (edge.blockReason === "blocking-dvn") {
          blockReasonSet.add("Blocking DVN");
        } else if (edge.blockReason === "missing-library") {
          blockReasonSet.add("Missing default receive library");
        } else {
          blockReasonSet.add("Blocked route");
        }
      }

      const allowedSrcEids = new Set();
      const registerAllowed = (eid) => {
        if (eid !== undefined && eid !== null) {
          allowedSrcEids.add(String(eid));
        }
      };
      activeIncoming.forEach((edge) => registerAllowed(edge?.edge?.srcEid));
      blockedIncoming.forEach((edge) => registerAllowed(edge?.edge?.srcEid));

      const configDetails = (node.securityConfigs || [])
        .map((cfg) => {
          const normalizedSrcEid =
            cfg.srcEid !== undefined && cfg.srcEid !== null ? String(cfg.srcEid) : null;
          if (
            allowedSrcEids.size > 0 &&
            (!normalizedSrcEid || !allowedSrcEids.has(normalizedSrcEid))
          ) {
            return null;
          }
          const requiredLabels = cfg.requiredDVNLabels || cfg.requiredDVNs || [];
          const requiredAddresses = cfg.requiredDVNs || [];
          const normalized = normalizeNames(requiredLabels);
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

          const requiredPairs = requiredLabels.map((label, idx) => ({
            label: label || "(unknown)",
            address: requiredAddresses[idx] || null,
          }));

          const optionalLabels = cfg.optionalDVNLabels || cfg.optionalDVNs || [];
          const optionalAddresses = cfg.optionalDVNs || [];
          const optionalPairs = optionalLabels.map((label, idx) => ({
            label: label || "(unknown)",
            address: optionalAddresses[idx] || null,
          }));
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
            packetCount:
              cfg.routePacketCount !== undefined && cfg.routePacketCount !== null
                ? Number(cfg.routePacketCount)
                : 0,
            packetShare:
              cfg.routePacketShare !== undefined && cfg.routePacketShare !== null
                ? Number(cfg.routePacketShare)
                : 0,
            packetPercent:
              cfg.routePacketPercent !== undefined && cfg.routePacketPercent !== null
                ? Number(cfg.routePacketPercent)
                : 0,
            lastPacketBlock: cfg.routeLastPacketBlock ?? null,
            lastPacketTimestamp: cfg.routeLastPacketTimestamp ?? null,
            libraryStatus: cfg.libraryStatus ?? "unknown",
            peerStateHint: cfg.peerStateHint ?? null,
            synthetic: !!(cfg.synthetic),
            usesDefaultLibrary: cfg.usesDefaultLibrary !== false,
            effectiveReceiveLibrary: cfg.effectiveReceiveLibrary || null,
            defaultLibraryVersionId:
              cfg.defaultLibraryVersionId !== undefined ? cfg.defaultLibraryVersionId : null,
            libraryOverrideVersionId:
              cfg.libraryOverrideVersionId !== undefined ? cfg.libraryOverrideVersionId : null,
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

  prepareRenameActions(nodeMetrics, requestUniformAlias) {
    if (!requestUniformAlias || !nodeMetrics.length) {
      return null;
    }

    const zeroAddresses = new Set([AddressUtils.constants.ZERO, AddressUtils.constants.ZERO_PEER]);
    const renameTargets = [];
    const seenRenameTargets = new Set();

    for (const metric of nodeMetrics) {
      if (!metric || typeof metric.id !== "string") {
        continue;
      }
      const trimmedId = metric.id.trim();
      if (!trimmedId || seenRenameTargets.has(trimmedId)) {
        continue;
      }
      const parts = trimmedId.split("_");
      if (parts.length < 2) {
        continue;
      }
      const rawAddr = parts[parts.length - 1];
      const addr = AddressUtils.normalizeSafe(rawAddr) || "";
      if (!addr.startsWith("0x")) {
        continue;
      }
      if (zeroAddresses.has(addr.toLowerCase())) {
        continue;
      }
      renameTargets.push({
        oappId: trimmedId,
        address: addr,
        alias: metric.alias || null,
      });
      seenRenameTargets.add(trimmedId);
    }

    return renameTargets.length > 0 ? { targets: renameTargets, requestUniformAlias } : null;
  }
}
