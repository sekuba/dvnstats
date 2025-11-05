import { splitOAppId } from "../../core.js";
import { AddressUtils } from "../../utils/AddressUtils.js";
import {
  calculateTotalRoutePackets,
  enrichRouteStatsWithShares,
} from "../../utils/MetricsUtils.js";
import { isDefined, isNullish } from "../../utils/NumberUtils.js";
import { createGraphEdge } from "../factories/SecurityEntryFactory.js";

const ZERO_ADDRESS = AddressUtils.constants.ZERO;

function assignRouteMetrics(target, routeMetric, fallback = null) {
  target.routePacketCount = routeMetric?.packetCount ?? fallback?.routePacketCount ?? 0;
  target.routePacketShare = routeMetric?.share ?? fallback?.routePacketShare ?? 0;
  target.routePacketPercent = routeMetric?.percent ?? fallback?.routePacketPercent ?? 0;
  target.routeLastPacketBlock =
    routeMetric?.lastPacketBlock ?? fallback?.routeLastPacketBlock ?? null;
  target.routeLastPacketTimestamp =
    routeMetric?.lastPacketTimestamp ?? fallback?.routeLastPacketTimestamp ?? null;
}

function updateRouteMetricsIfBetter(target, routeMetric, configRouteMetric) {
  const currentCount = target.routePacketCount ?? 0;

  if (routeMetric && routeMetric.packetCount > currentCount) {
    target.routePacketCount = routeMetric.packetCount;
    target.routePacketShare = routeMetric.share ?? target.routePacketShare;
    target.routePacketPercent = routeMetric.percent ?? target.routePacketPercent;
    target.routeLastPacketBlock = routeMetric.lastPacketBlock ?? target.routeLastPacketBlock;
    target.routeLastPacketTimestamp = routeMetric.lastPacketTimestamp ?? target.routeLastPacketTimestamp;
  } else if (configRouteMetric && configRouteMetric.routePacketCount > currentCount) {
    target.routePacketCount = configRouteMetric.routePacketCount;
    target.routePacketShare = configRouteMetric.routePacketShare;
    target.routePacketPercent = configRouteMetric.routePacketPercent;
    target.routeLastPacketBlock = configRouteMetric.routeLastPacketBlock;
    target.routeLastPacketTimestamp = configRouteMetric.routeLastPacketTimestamp;
  }
}

const isZeroOAppId = (value) => {
  if (!value || typeof value !== "string") {
    return false;
  }
  const [, addressPart] = value.split("_");
  if (!addressPart) {
    return false;
  }
  return addressPart.toLowerCase() === ZERO_ADDRESS;
};

export function buildPeerInfo(config) {
  if (!config) {
    return null;
  }

  const rawPeer = config.peer ?? null;
  const peerStateHint = config.peerStateHint ?? null;
  const normalizedPeer = AddressUtils.normalizeSafe(rawPeer);
  let peerOappId = config.peerOappId ?? null;

  let derivedLocalEid = null;
  let derivedAddress = null;
  if (peerOappId) {
    const parsed = splitOAppId(peerOappId);
    derivedLocalEid = parsed.localEid ?? null;
    derivedAddress = parsed.address ?? null;
  } else if (isDefined(config.peerLocalEid)) {
    derivedLocalEid = String(config.peerLocalEid);
  } else if (isDefined(config.eid)) {
    derivedLocalEid = String(config.eid);
  } else if (isDefined(config.localEid)) {
    derivedLocalEid = String(config.localEid);
  }

  const isExplicitBlock = peerStateHint === "explicit-blocked";
  const isImplicitBlock = peerStateHint === "implicit-blocked";
  const isZeroPeer =
    AddressUtils.isZero(normalizedPeer) ||
    isExplicitBlock ||
    isImplicitBlock ||
    (!rawPeer && isImplicitBlock);

  if (derivedAddress && AddressUtils.isZero(derivedAddress)) {
    derivedAddress = null;
    peerOappId = null;
  }

  const resolved = !!(peerOappId && derivedAddress);

  return {
    rawPeer,
    normalizedPeer,
    localEid: derivedLocalEid,
    address: resolved ? derivedAddress : null,
    oappId: resolved ? peerOappId : null,
    resolved,
    isZeroPeer,
    peerStateHint,
  };
}

export function shouldIncludeSecurityEntry(entry) {
  if (!entry) {
    return false;
  }

  const synthetic = !!(entry.synthetic);
  const sourceType = entry.sourceType || null;
  const peerState = entry.peerStateHint || null;
  const hasMaterializedConfig = !synthetic || sourceType === "materialized";

  if (hasMaterializedConfig) {
    return true;
  }

  if (peerState === "explicit-blocked") {
    return true;
  }

  if (synthetic) {
    const required = Array.isArray(entry.requiredDVNs) ? entry.requiredDVNs : [];
    const optional = Array.isArray(entry.optionalDVNs) ? entry.optionalDVNs : [];
    const hasBlockingDvn = [...required, ...optional].some((addr) => AddressUtils.isDead(addr));

    if (!entry.peerOappId) {
      if (peerState === "explicit-blocked") {
        return true;
      }
      if (peerState === "implicit-blocked") {
        return hasBlockingDvn;
      }
      return hasBlockingDvn;
    }

    if (peerState === "explicit-blocked" || peerState === "implicit-blocked") {
      return hasBlockingDvn;
    }

    return true;
  }

  return false;
}

export function finalizeNodeMetrics({
  node,
  routeStatsMap,
  outboundContexts = [],
  originalSecuritySummary = null,
  edgesMap = null,
}) {
  const normalize = (value) => (value === undefined || value === null ? null : String(value));

  const allowedSrcEids = new Set(
    node.securityConfigs.map((entry) => normalize(entry.srcEid)).filter((value) => value !== null),
  );

  const filteredRouteStats = [];
  if (routeStatsMap) {
    for (const stat of routeStatsMap.values()) {
      const key = normalize(stat?.srcEid ?? stat?.eid);
      if (!key || !allowedSrcEids.has(key)) {
        continue;
      }
      filteredRouteStats.push({ ...stat });
    }
  }

  enrichRouteStatsWithShares(filteredRouteStats);
  const totalRoutePackets = calculateTotalRoutePackets(filteredRouteStats);

  const metricBySrc = new Map(
    filteredRouteStats.map((stat) => [normalize(stat.srcEid ?? stat.eid), stat]),
  );

  for (const entry of node.securityConfigs) {
    const metric = metricBySrc.get(normalize(entry.srcEid));
    if (metric) {
      entry.routePacketCount = metric.packetCount ?? 0;
      entry.routePacketShare = metric.share ?? 0;
      entry.routePacketPercent = metric.percent ?? 0;
      entry.routeLastPacketBlock =
        metric.lastPacketBlock !== undefined ? metric.lastPacketBlock : null;
      entry.routeLastPacketTimestamp =
        metric.lastPacketTimestamp !== undefined ? metric.lastPacketTimestamp : null;
    } else {
      entry.routePacketCount = 0;
      entry.routePacketShare = 0;
      entry.routePacketPercent = 0;
      entry.routeLastPacketBlock = null;
      entry.routeLastPacketTimestamp = null;
    }
  }

  outboundContexts.forEach((context) => {
    if (!context || !context.config) {
      return;
    }
    const metricKey = normalize(context.config.srcEid);
    const metric = metricBySrc.get(metricKey);
    context.routeMetric = metric ?? null;
    if (context.attached && edgesMap) {
      const edgeFrom = context.edgeFrom;
      const edgeTo = context.edgeTo || node.id;
      if (edgeFrom && edgeTo) {
        const edgeRecord = edgesMap.get(`${edgeFrom}->${edgeTo}`);
        if (edgeRecord) {
          edgeRecord.routePacketCount = metric?.packetCount ?? 0;
          edgeRecord.routePacketShare = metric?.share ?? 0;
          edgeRecord.routePacketPercent = metric?.percent ?? 0;
          edgeRecord.routeLastPacketBlock =
            metric && metric.lastPacketBlock !== undefined ? metric.lastPacketBlock : null;
          edgeRecord.routeLastPacketTimestamp =
            metric && metric.lastPacketTimestamp !== undefined ? metric.lastPacketTimestamp : null;
          if (context.config && context.config.unresolvedPeer && !edgeRecord.peerStateHint) {
            edgeRecord.peerStateHint = "implicit-blocked";
            edgeRecord.blockReasonHint = edgeRecord.blockReasonHint || "implicit-block";
          }
        }
      }
    }
  });

  node.routeStats = filteredRouteStats;
  node.totalRoutePackets = totalRoutePackets;

  const syntheticCount = node.securityConfigs.filter((entry) => entry.synthetic).length;
  const implicitBlocks = node.securityConfigs.filter(
    (entry) => entry.peerStateHint === "implicit-blocked",
  ).length;
  const explicitBlocks = node.securityConfigs.filter(
    (entry) => entry.peerStateHint === "explicit-blocked",
  ).length;

  node.securitySummary = {
    totalRoutes: node.securityConfigs.length,
    syntheticCount,
    implicitBlocks,
    explicitBlocks,
    original: originalSecuritySummary ?? null,
  };
  node.syntheticRouteCount = syntheticCount;
  node.implicitBlockCount = implicitBlocks;
  node.explicitBlockCount = explicitBlocks;
  node.totalResolvedRoutes = node.securityConfigs.length;
  node.isTracked = node.securityConfigs.some((entry) => !entry.synthetic);
}

export function addPeerEdges({
  oappId,
  depth,
  maxDepth,
  queue,
  pending,
  visited,
  edges,
  contexts,
}) {
  for (const context of contexts) {
    const edgeFrom = context.edgeFrom;
    const edgeTo = context.edgeTo || oappId;
    if (!edgeFrom || !edgeTo) {
      continue;
    }

    const key = `${edgeFrom}->${edgeTo}`;
    const contextConfig = context.config || {};
    const srcEid = context.isOutbound
      ? (contextConfig.srcEid ?? contextConfig.eid ?? contextConfig.localEid ?? null)
      : (contextConfig.localEid ?? contextConfig.eid ?? contextConfig.srcEid ?? null);

    const existing = edges.get(key);
    const peerInfo = context.peerInfo || null;
    const peerRaw =
      context.peerRaw ?? (peerInfo ? peerInfo.rawPeer : undefined) ?? contextConfig.peer ?? null;
    const peerLocalEid =
      context.peerLocalEid ??
      (peerInfo ? peerInfo.localEid : undefined) ??
      contextConfig.peerLocalEid ??
      null;
    const peerStateHint =
      context.peerStateHint ??
      (peerInfo ? peerInfo.peerStateHint : undefined) ??
      contextConfig.peerStateHint ??
      null;
    const blockReasonHint =
      context.blockReasonHint ??
      (peerInfo ? peerInfo.blockReasonHint : undefined) ??
      contextConfig.blockReasonHint ??
      null;
    let resolvedBlockReason = blockReasonHint;
    const unresolvedPeer =
      !!(contextConfig.unresolvedPeer) ||
      !!(peerInfo?.unresolvedPeer) ||
      (!peerRaw && !contextConfig.peerOappId && peerStateHint === "implicit-blocked");
    if (!resolvedBlockReason && unresolvedPeer) {
      resolvedBlockReason = "implicit-block";
    }
    if (resolvedBlockReason && !context.blockReasonHint) {
      context.blockReasonHint = resolvedBlockReason;
    }

    const routeMetric = context.routeMetric ?? null;
    const configRouteMetric =
      contextConfig && typeof contextConfig.routePacketCount === "number" ? contextConfig : null;

    if (!existing) {
      const newEdge = createGraphEdge({
        from: edgeFrom,
        to: edgeTo,
        srcEid,
        peerRaw,
        peerLocalEid,
        peerOappId: edgeFrom,
        peerStateHint,
        blockReasonHint: resolvedBlockReason,
        isStalePeer: !!context.isStalePeer,
        libraryStatus: context.libraryStatus ?? contextConfig.libraryStatus ?? null,
        synthetic: !!(context.synthetic ?? contextConfig.synthetic),
        sourceType: context.sourceType ?? contextConfig.sourceType ?? null,
      });
      assignRouteMetrics(newEdge, routeMetric, configRouteMetric);
      edges.set(key, newEdge);
      context.attached = true;
    } else {
      if (isNullish(existing.srcEid)) {
        existing.srcEid = srcEid;
      }
      if (!existing.peerRaw && peerRaw) {
        existing.peerRaw = peerRaw;
      }
      if (!existing.peerLocalEid && peerLocalEid) {
        existing.peerLocalEid = peerLocalEid;
      }
      if (!existing.peerStateHint && peerStateHint) {
        existing.peerStateHint = peerStateHint;
      }
      if (!existing.blockReasonHint && blockReasonHint) {
        existing.blockReasonHint = blockReasonHint;
      } else if (!existing.blockReasonHint && resolvedBlockReason) {
        existing.blockReasonHint = resolvedBlockReason;
      }
      if (!existing.libraryStatus && (context.libraryStatus || contextConfig.libraryStatus)) {
        existing.libraryStatus = context.libraryStatus ?? contextConfig.libraryStatus ?? null;
      }
      if (!existing.sourceType && (context.sourceType || contextConfig.sourceType)) {
        existing.sourceType = context.sourceType ?? contextConfig.sourceType ?? null;
      }
      if (context.isStalePeer) {
        existing.isStalePeer = true;
      }
      if (context.synthetic || contextConfig.synthetic) {
        existing.synthetic = true;
      }

      updateRouteMetricsIfBetter(existing, routeMetric, configRouteMetric);
      context.attached = true;
    }

    const nextId = context.queueNext;
    if (
      nextId &&
      !isZeroOAppId(nextId) &&
      depth < maxDepth &&
      !visited.has(nextId) &&
      !pending.has(nextId)
    ) {
      queue.push({ oappId: nextId, depth: depth + 1 });
      pending.add(nextId);
    }
  }
}

export function addDanglingNodes(nodes, edges) {
  const dangling = new Set();
  for (const edge of edges.values()) {
    if (!nodes.has(edge.from)) dangling.add(edge.from);
    if (!nodes.has(edge.to)) dangling.add(edge.to);
  }

  for (const id of dangling) {
    const { localEid, address } = splitOAppId(id);
    nodes.set(id, {
      id,
      localEid,
      address,
      isTracked: false,
      isDangling: true,
      fromPacketDelivered: false,
      depth: -1,
      securityConfigs: [],
      totalPacketsReceived: 0,
      totalRoutePackets: 0,
      securitySummary: null,
      routeStats: [],
      syntheticRouteCount: 0,
      implicitBlockCount: 0,
      explicitBlockCount: 0,
      totalResolvedRoutes: 0,
    });
  }
}
