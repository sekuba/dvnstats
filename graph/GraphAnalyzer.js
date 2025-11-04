import { APP_CONFIG } from "../config.js";
import { AddressUtils } from "../utils/AddressUtils.js";

export class GraphAnalyzer {
  constructor({ getChainDisplayLabel }) {
    this.getChainDisplayLabel =
      typeof getChainDisplayLabel === "function" ? getChainDisplayLabel : () => "";
  }

  /**
   * Calculate edge security info, including DVN counts, blocking status, and combinations
   */
  calculateEdgeSecurityInfo(edges, nodesById) {
    const edgeSecurityInfo = [];
    let maxRequiredDVNsInWeb = 0;
    let maxEdgePacketCount = 0;
    let totalEdgePacketCount = 0;
    const combinationStatsMap = new Map();

    for (const edge of edges) {
      const fromNode = nodesById.get(edge.from);
      const toNode = nodesById.get(edge.to);
      const isUntrackedTarget = Boolean(toNode) && !toNode.isTracked;
      let requiredDVNCount = 0;
      let requiredDVNAddresses = [];
      let requiredDVNLabels = [];
      let optionalDVNLabels = [];
      let optionalDVNCount = 0;
      let optionalDVNThreshold = 0;
      let usesSentinel = false;
      let isBlocked = false;
      let blockReason = null;
      const libraryStatusEdge = edge.libraryStatus ?? null;
      let libraryStatusValue = libraryStatusEdge;
      const syntheticEdge = Boolean(edge.synthetic);
      let peerStateHint = edge.peerStateHint ?? null;

      if (edge.blockReasonHint === "implicit-block") {
        isBlocked = true;
        blockReason = "implicit-block";
      } else if (edge.blockReasonHint === "explicit-block") {
        isBlocked = true;
        blockReason = "zero-peer";
      } else if (edge.blockReasonHint === "stale-peer") {
        isBlocked = true;
        blockReason = "stale-peer";
      }

      if (!blockReason && edge.isStalePeer) {
        isBlocked = true;
        blockReason = "stale-peer";
      }

      let hasSecurityConfig = false;
      let config = null;

      if (toNode?.securityConfigs && toNode.securityConfigs.length > 0) {
        config = toNode.securityConfigs.find((cfg) => String(cfg.srcEid) === String(edge.srcEid));
        if (config) {
          hasSecurityConfig = true;
          requiredDVNCount = config.requiredDVNCount || 0;
          requiredDVNAddresses = config.requiredDVNs || [];
          requiredDVNLabels = config.requiredDVNLabels || config.requiredDVNs || [];
          optionalDVNLabels = config.optionalDVNLabels || config.optionalDVNs || [];
          optionalDVNCount =
            config.optionalDVNCount ||
            (Array.isArray(optionalDVNLabels) ? optionalDVNLabels.length : 0);
          optionalDVNThreshold = config.optionalDVNThreshold || 0;
          usesSentinel = Boolean(config.usesRequiredDVNSentinel);
          if (!peerStateHint && config.peerStateHint) {
            peerStateHint = config.peerStateHint;
          }
          const usesDefaultLibrary = config.usesDefaultLibrary !== false;
          const effectiveReceiveLibrary = config.effectiveReceiveLibrary || null;
          const hasEffectiveLibrary =
            Boolean(effectiveReceiveLibrary) && !AddressUtils.isZero(effectiveReceiveLibrary);
          const libraryOverrideVersionId =
            config.libraryOverrideVersionId !== undefined ? config.libraryOverrideVersionId : null;
          const hasLibraryOverride =
            libraryOverrideVersionId !== null && libraryOverrideVersionId !== undefined;
          const defaultLibraryFallback = usesDefaultLibrary && !hasLibraryOverride;

          libraryStatusValue = config.libraryStatus ?? libraryStatusEdge;

          if (
            !isBlocked &&
            defaultLibraryFallback &&
            libraryStatusValue === "none" &&
            !hasEffectiveLibrary
          ) {
            isBlocked = true;
            blockReason = "missing-library";
          }

          if (!isBlocked && requiredDVNAddresses.some((addr) => this.isDeadAddress(addr))) {
            isBlocked = true;
            blockReason = "dead-dvn";
          }
          if (!isBlocked && requiredDVNLabels.some((label) => this.isBlockingDvnLabel(label))) {
            isBlocked = true;
            blockReason = "blocking-dvn";
          }
        }
      }

      if (!isBlocked) {
        if (peerStateHint === "explicit-blocked") {
          isBlocked = true;
          blockReason = "zero-peer";
        } else if (peerStateHint === "implicit-blocked") {
          isBlocked = true;
          blockReason = "implicit-block";
        }
      }

      if (
        !isBlocked &&
        ((edge.peerRaw && this.isZeroPeer(edge.peerRaw)) ||
          (config && config.peer && this.isZeroPeer(config.peer)))
      ) {
        isBlocked = true;
        blockReason = "zero-peer";
      }

      if (!isBlocked && hasSecurityConfig && requiredDVNCount > maxRequiredDVNsInWeb) {
        maxRequiredDVNsInWeb = requiredDVNCount;
      }

      if (!isBlocked) {
        const fromId = typeof edge.from === "string" ? edge.from : "";
        const fromAddress = fromId.split("_").at(-1) || "";
        if (AddressUtils.isZero(fromAddress)) {
          isBlocked = true;
          if (!blockReason) {
            blockReason = "implicit-block";
          }
        }
      }

      const normalizedRequiredNames = (requiredDVNLabels || [])
        .map((name) =>
          name === null || name === undefined ? "" : String(name).trim().toLowerCase(),
        )
        .filter(Boolean)
        .sort();

      const combinationFingerprint = hasSecurityConfig
        ? JSON.stringify({
            required: requiredDVNCount,
            names: normalizedRequiredNames,
            sentinel: usesSentinel,
          })
        : null;

      const isUnknownSecurity = !hasSecurityConfig && isUntrackedTarget;

      const routeFromLabel = this.resolveNodeChainLabel(fromNode, edge.from, edge.srcEid);
      const routeToLabel = this.resolveNodeChainLabel(toNode, edge.to, toNode?.localEid);

      const packetCountValue = edge.routePacketCount ?? (config ? config.routePacketCount : null);
      const packetCountNumber = Number(packetCountValue);
      const packetCount =
        Number.isFinite(packetCountNumber) && packetCountNumber > 0 ? packetCountNumber : 0;

      const packetShareValue = edge.routePacketShare ?? (config ? config.routePacketShare : null);
      const packetShareNumber = Number(packetShareValue);
      const packetShare =
        Number.isFinite(packetShareNumber) && packetShareNumber > 0 ? packetShareNumber : 0;

      const packetPercentValue =
        edge.routePacketPercent ?? (config ? config.routePacketPercent : null);
      const packetPercentNumber = Number(packetPercentValue);
      const packetPercent =
        Number.isFinite(packetPercentNumber) && packetPercentNumber > 0
          ? packetPercentNumber
          : packetShare > 0
            ? packetShare * 100
            : 0;

      const lastPacketBlockRaw =
        edge.routeLastPacketBlock ?? (config ? config.routeLastPacketBlock : null);
      const lastPacketBlockNumber = Number(lastPacketBlockRaw);
      const lastPacketBlock =
        Number.isFinite(lastPacketBlockNumber) && lastPacketBlockNumber > 0
          ? lastPacketBlockNumber
          : null;

      const lastPacketTimestampRaw =
        edge.routeLastPacketTimestamp ?? (config ? config.routeLastPacketTimestamp : null);
      const lastPacketTimestampNumber = Number(lastPacketTimestampRaw);
      const lastPacketTimestamp =
        Number.isFinite(lastPacketTimestampNumber) && lastPacketTimestampNumber > 0
          ? lastPacketTimestampNumber
          : null;

      if (packetCount > 0) {
        totalEdgePacketCount += packetCount;
        if (packetCount > maxEdgePacketCount) {
          maxEdgePacketCount = packetCount;
        }
      }

      const info = {
        edge,
        requiredDVNCount,
        requiredDVNAddresses,
        requiredDVNLabels,
        normalizedRequiredNames,
        optionalDVNLabels,
        optionalDVNCount,
        optionalDVNThreshold,
        usesSentinel,
        combinationFingerprint,
        hasSecurityConfig,
        isUnknownSecurity,
        isBlocked,
        blockReason,
        peerStateHint,
        libraryStatus: libraryStatusValue,
        synthetic: config?.synthetic ?? syntheticEdge,
        routeFromLabel,
        routeToLabel,
        differsFromPopular: false,
        matchesPopularCombination: false,
        differenceReasons: [],
        packetCount,
        packetShare,
        packetPercent,
        lastPacketBlock,
        lastPacketTimestamp,
        sourceType: config?.sourceType ?? edge.sourceType ?? null,
      };

      edgeSecurityInfo.push(info);

      if (!isBlocked && hasSecurityConfig) {
        let entry = combinationStatsMap.get(combinationFingerprint);
        if (!entry) {
          entry = {
            fingerprint: combinationFingerprint,
            count: 0,
            requiredDVNCount,
            normalizedNames: normalizedRequiredNames,
            labelsSample: requiredDVNLabels.slice(),
            usesSentinel,
            edges: [],
            toNodes: new Set(),
            fromNodes: new Set(),
            srcEids: new Set(),
            optionalCounts: new Set(),
            optionalThresholds: new Set(),
            sampleInfo: {
              requiredDVNLabels: requiredDVNLabels.slice(),
              requiredDVNCount,
              optionalDVNLabels: optionalDVNLabels.slice(),
              optionalDVNCount,
              optionalDVNThreshold,
              usesSentinel,
            },
          };
          combinationStatsMap.set(combinationFingerprint, entry);
        }
        entry.count += 1;
        entry.edges.push(info);
        entry.toNodes.add(edge.to);
        entry.fromNodes.add(edge.from);
        if (edge.srcEid !== undefined && edge.srcEid !== null) {
          entry.srcEids.add(String(edge.srcEid));
        }
        entry.optionalCounts.add(optionalDVNCount || 0);
        entry.optionalThresholds.add(optionalDVNThreshold || 0);
      }
    }

    const combinationStatsList = Array.from(combinationStatsMap.values());
    const totalActiveEdges = combinationStatsList.reduce((sum, entry) => sum + entry.count, 0);

    // Determine dominant combination (prefer non-sentinel sets)
    let dominantEntry = null;
    const primaryPool = combinationStatsList.filter((entry) => !entry.usesSentinel);
    const fallbackPool = primaryPool.length > 0 ? primaryPool : combinationStatsList;
    if (fallbackPool.length > 0) {
      dominantEntry = [...fallbackPool].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.requiredDVNCount !== a.requiredDVNCount) {
          return b.requiredDVNCount - a.requiredDVNCount;
        }
        return a.fingerprint.localeCompare(b.fingerprint);
      })[0];
      dominantEntry.share = totalActiveEdges > 0 ? dominantEntry.count / totalActiveEdges : 0;
    }

    const dominantFingerprint = dominantEntry?.fingerprint ?? null;

    for (const info of edgeSecurityInfo) {
      const matchesPopular =
        info.hasSecurityConfig &&
        Boolean(dominantFingerprint) &&
        !info.isBlocked &&
        !info.usesSentinel &&
        info.combinationFingerprint === dominantFingerprint;

      info.matchesPopularCombination = matchesPopular;

      const differsDueToSentinel = info.hasSecurityConfig && info.usesSentinel;
      const differsDueToCombination =
        info.hasSecurityConfig &&
        Boolean(dominantFingerprint) &&
        !info.isBlocked &&
        info.combinationFingerprint !== dominantFingerprint;

      info.differsFromPopular =
        info.hasSecurityConfig &&
        !info.isBlocked &&
        (differsDueToSentinel || differsDueToCombination);

      if (differsDueToCombination && dominantEntry) {
        if (info.requiredDVNCount !== dominantEntry.requiredDVNCount) {
          info.differenceReasons.push(
            `required DVN count ${info.requiredDVNCount} vs dominant ${dominantEntry.requiredDVNCount}`,
          );
        }
        if (
          !this.areStringArraysEqual(info.normalizedRequiredNames, dominantEntry.normalizedNames)
        ) {
          info.differenceReasons.push("validator set differs");
        }
      }

      if (differsDueToSentinel) {
        const quorumLabel =
          info.optionalDVNCount > 0
            ? `${info.optionalDVNThreshold}/${info.optionalDVNCount}`
            : `${info.optionalDVNThreshold}`;
        info.differenceReasons.push(`sentinel quorum ${quorumLabel}`);
      }

      if (
        info.hasSecurityConfig &&
        !info.isBlocked &&
        maxRequiredDVNsInWeb > 0 &&
        info.requiredDVNCount < maxRequiredDVNsInWeb
      ) {
        info.differenceReasons.push(
          `requires ${info.requiredDVNCount} vs web max ${maxRequiredDVNsInWeb}`,
        );
      }
    }

    const combinationStats = combinationStatsList.map((entry) => ({
      fingerprint: entry.fingerprint,
      count: entry.count,
      share: totalActiveEdges > 0 ? entry.count / totalActiveEdges : 0,
      requiredDVNCount: entry.requiredDVNCount,
      normalizedNames: entry.normalizedNames,
      labelsSample: entry.labelsSample,
      usesSentinel: entry.usesSentinel,
      edges: entry.edges,
      toNodes: Array.from(entry.toNodes),
      fromNodes: Array.from(entry.fromNodes),
      srcEids: Array.from(entry.srcEids),
      optionalCounts: Array.from(entry.optionalCounts),
      optionalThresholds: Array.from(entry.optionalThresholds),
      optionalLabelsSample: entry.sampleInfo?.optionalDVNLabels ?? [],
      sampleInfo: entry.sampleInfo,
    }));

    const invMaxPacket = maxEdgePacketCount > 0 ? 1 / maxEdgePacketCount : 0;
    const invTotalPacket = totalEdgePacketCount > 0 ? 1 / totalEdgePacketCount : 0;
    for (const info of edgeSecurityInfo) {
      info.packetStrength = invMaxPacket > 0 ? info.packetCount * invMaxPacket : 0;
      info.packetWeight = invTotalPacket > 0 ? info.packetCount * invTotalPacket : 0;
    }

    return {
      edgeSecurityInfo,
      maxRequiredDVNsInWeb,
      combinationStats,
      dominantCombination: dominantEntry,
      maxEdgePacketCount,
      totalEdgePacketCount,
    };
  }

  calculateMaxMinRequiredDVNsForNodes(nodes) {
    let max = 0;

    for (const node of nodes) {
      if (node.isDangling || !node.securityConfigs?.length) continue;

      const nonBlockedConfigs = node.securityConfigs.filter(
        (cfg) => !this.configHasBlockingDvn(cfg),
      );

      if (nonBlockedConfigs.length > 0) {
        const min = Math.min(
          ...nonBlockedConfigs.map((c) =>
            Number.isFinite(c.requiredDVNCount) ? c.requiredDVNCount : 0,
          ),
        );
        if (min > max) max = min;
      }
    }

    return max;
  }

  isDeadAddress(address) {
    return AddressUtils.isDead(address);
  }

  isBlockingDvnLabel(label) {
    if (label === null || label === undefined) {
      return false;
    }
    return String(label).trim().toLowerCase() === "lzdeaddvn";
  }

  configHasBlockingDvn(config) {
    if (!config) {
      return false;
    }
    const requiredAddresses = Array.isArray(config.requiredDVNs) ? config.requiredDVNs : [];
    const requiredLabels = Array.isArray(config.requiredDVNLabels) ? config.requiredDVNLabels : [];
    return (
      requiredAddresses.some((addr) => this.isDeadAddress(addr)) ||
      requiredLabels.some((label) => this.isBlockingDvnLabel(label))
    );
  }

  isZeroPeer(peerAddress) {
    return AddressUtils.isZero(peerAddress);
  }

  findBlockedNodes(nodes, edgeSecurityInfo) {
    const incomingEdges = new Map();
    for (const info of edgeSecurityInfo) {
      const toNodeId = info.edge.to;
      if (!incomingEdges.has(toNodeId)) {
        incomingEdges.set(toNodeId, []);
      }
      incomingEdges.get(toNodeId).push(info);
    }

    const blocked = new Set();
    for (const node of nodes) {
      const incoming = incomingEdges.get(node.id) || [];

      if (node.depth === 0) continue;

      if (incoming.length > 0) {
        const allBlocked = incoming.every((info) => info.isBlocked);
        if (allBlocked) {
          blocked.add(node.id);
        }
      } else if (node.isDangling) {
        blocked.add(node.id);
      }
    }

    return blocked;
  }

  areStringArraysEqual(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b)) {
      return Array.isArray(a) === Array.isArray(b);
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  getNodeSecurityMetrics(node) {
    const configs = Array.isArray(node?.securityConfigs) ? node.securityConfigs : [];
    const nonBlockedConfigs = configs.filter((cfg) => !this.configHasBlockingDvn(cfg));

    const minRequiredDVNs =
      nonBlockedConfigs.length > 0
        ? Math.min(
            ...nonBlockedConfigs.map((c) =>
              Number.isFinite(c.requiredDVNCount) ? c.requiredDVNCount : 0,
            ),
          )
        : 0;

    return {
      minRequiredDVNs,
      hasBlockedConfig: configs.some((cfg) => this.configHasBlockingDvn(cfg)),
    };
  }

  resolveNodeChainLabel(node, nodeId, fallbackEid) {
    let chainSource = null;
    if (node && node.localEid !== undefined && node.localEid !== null && node.localEid !== "") {
      chainSource = node.localEid;
    } else if (node && typeof node.id === "string" && node.id.includes("_")) {
      chainSource = node.id.split("_")[0];
    } else if (typeof nodeId === "string" && nodeId.includes("_")) {
      chainSource = nodeId.split("_")[0];
    } else if (fallbackEid !== undefined && fallbackEid !== null && fallbackEid !== "") {
      chainSource = fallbackEid;
    }

    if (chainSource === null || chainSource === undefined || chainSource === "") {
      return "";
    }

    const normalized = typeof chainSource === "string" ? chainSource : String(chainSource);
    const label = this.formatChainLabel(normalized);
    return label || normalized;
  }

  formatChainLabel(chainId) {
    if (chainId === undefined || chainId === null || chainId === "") {
      return "";
    }
    const display = this.getChainDisplayLabel(chainId);
    if (display) {
      // Strip out the EID number in parentheses for cleaner display
      return display.replace(/\s*\(\d+\)$/, "");
    }
    const str = String(chainId);
    if (str.startsWith("eid-")) {
      const suffix = str.slice(4);
      return suffix ? `EID ${suffix}` : "EID";
    }
    return `EID ${str}`;
  }
}
