import { APP_CONFIG } from "./config.js";
import { normalizeKey, splitOAppId } from "./core.js";
import { resolveOAppSecurityConfigs } from "./resolver.js";
import { CrawlerDataLoader } from "./security/crawler/CrawlerDataLoader.js";
import {
  addDanglingNodes,
  addPeerEdges,
  buildPeerInfo,
  finalizeNodeMetrics,
  shouldIncludeSecurityEntry,
} from "./security/crawler/CrawlerNodeUtils.js";
import {
  createSecurityEntry,
  createEdgeContext,
  createInboundEdgeContext,
} from "./security/factories/SecurityEntryFactory.js";
import { normalizeSecurityConfig } from "./security/SecurityConfigNormalizer.js";
import { AddressUtils } from "./utils/AddressUtils.js";
import { resolveDvnLabels } from "./utils/DvnUtils.js";
import { createRouteStatsMap } from "./utils/MetricsUtils.js";

const sanitizePeerOAppId = (value) => {
  if (!value) {
    return null;
  }
  const str = String(value);
  const underscoreIndex = str.indexOf("_");
  if (underscoreIndex === -1) {
    return AddressUtils.isZero(str) ? null : str;
  }
  const addressPart = str.slice(underscoreIndex + 1);
  return AddressUtils.isZero(addressPart) ? null : str;
};

export class SecurityGraphCrawler {
  constructor(client, chainMetadata) {
    this.client = client;
    this.chainMetadata = chainMetadata;
    this.loader = new CrawlerDataLoader(client);
  }

  async crawl(seedOAppId, options = {}) {
    const maxDepth = options.depth || APP_CONFIG.CRAWLER.DEFAULT_DEPTH;
    const onProgress = options.onProgress || (() => {});
    const batchSize = APP_CONFIG.CRAWLER.BATCH_SIZE || 16;

    onProgress("Initializing...");

    const endpoints = this.chainMetadata.listLocalEndpoints();
    console.log(`[Crawler] Starting with ${endpoints.length} endpoint mappings`);
    if (!endpoints.length) {
      console.warn("[Crawler] No metadata loaded, attempting load...");
      await this.chainMetadata.load();
    }

    const nodes = new Map();
    const edges = new Map();
    const visited = new Set();
    const pending = new Set([seedOAppId]);
    const queue = [{ oappId: seedOAppId, depth: 0 }];

    let count = 0;

    while (queue.length) {
      const batch = [];
      while (queue.length && batch.length < batchSize) {
        const next = queue.shift();
        if (!next) continue;
        pending.delete(next.oappId);
        if (visited.has(next.oappId)) continue;
        batch.push(next);
      }

      if (!batch.length) continue;

      const batchIds = batch.map((item) => item.oappId);
      const batchData = await this.loader.fetchBatch(batchIds);

      for (const { oappId, depth } of batch) {
        if (visited.has(oappId)) continue;
        visited.add(oappId);

        count += 1;
        onProgress(`Processing node ${count} [depth=${depth}]: ${oappId}`);

        const configs = batchData.origin.get(oappId) ?? [];
        const inboundConfigs = batchData.referencing.get(oappId) ?? [];
        const oapp = batchData.oapps.get(oappId) ?? null;

        const { localEid: fallbackLocalEid, address: fallbackAddress } = splitOAppId(oappId);
        const resolvedLocalEid =
          oapp?.localEid !== undefined && oapp?.localEid !== null
            ? String(oapp.localEid)
            : fallbackLocalEid;
        const localEid = resolvedLocalEid ? String(resolvedLocalEid) : null;
        const resolvedAddress = oapp?.address || fallbackAddress || "unknown";

        const peerRecords = batchData.peerRecordsByOapp.get(oappId) ?? new Map();
        const peersArray = Array.from(peerRecords.values());
        const fromPacketDelivered = peersArray.some((peer) => peer.fromPacketDelivered === true);

        const defaultLibraries =
          localEid && batchData.defaultLibraries.has(localEid)
            ? batchData.defaultLibraries.get(localEid)
            : [];
        const defaultConfigs =
          localEid && batchData.defaultConfigs.has(localEid)
            ? batchData.defaultConfigs.get(localEid)
            : [];
        const oappLibraries = batchData.oappLibraries.get(oappId) ?? [];
        const oappConfigs = batchData.oappConfigs.get(oappId) ?? [];
        const routeStatsRaw = batchData.routeStats.get(oappId) ?? [];

        const { routeStatsMap, totalRoutePackets } = createRouteStatsMap(
          routeStatsRaw,
          normalizeKey,
        );

        const resolution = resolveOAppSecurityConfigs({
          oappId,
          localEid,
          oappAddress: resolvedAddress,
          securityConfigs: configs,
          defaultReceiveLibraries: defaultLibraries,
          defaultUlnConfigs: defaultConfigs,
          oappPeers: peersArray,
          oappReceiveLibraries: oappLibraries,
          oappUlnConfigs: oappConfigs,
          routeStats: routeStatsRaw,
        });

        const resolvedConfigs = Array.isArray(resolution?.rows) ? resolution.rows : [];
        const securitySummary = resolution?.summary ?? null;

        const totalPacketsValue = Number(oapp?.totalPacketsReceived);
        const totalPacketsReceived =
          Number.isFinite(totalPacketsValue) && totalPacketsValue > 0 ? totalPacketsValue : 0;

        const node = {
          id: oappId,
          localEid,
          address: resolvedAddress,
          totalPacketsReceived,
          totalRoutePackets,
          isTracked: configs.length > 0,
          fromPacketDelivered,
          depth,
          securityConfigs: [],
          securitySummary,
          routeStats: Array.from(routeStatsMap.values()),
        };

        const outboundContexts = [];

        for (const cfg of resolvedConfigs) {
          const cfgSrcEid = normalizeKey(cfg?.eid);
          const cfgLocalEid =
            cfg?.localEid !== undefined && cfg?.localEid !== null ? String(cfg.localEid) : localEid;
          const requiredDVNs = Array.isArray(cfg?.effectiveRequiredDVNs)
            ? cfg.effectiveRequiredDVNs
            : [];
          const optionalDVNs = Array.isArray(cfg?.effectiveOptionalDVNs)
            ? cfg.effectiveOptionalDVNs
            : [];

          const requiredDVNLabels = resolveDvnLabels(requiredDVNs, this.chainMetadata, {
            localEid: cfgLocalEid,
          });
          const optionalDVNLabels = resolveDvnLabels(optionalDVNs, this.chainMetadata, {
            localEid: cfgLocalEid,
          });

          const peerDetails = buildPeerInfo(cfg);
          const routeMetric = cfgSrcEid ? routeStatsMap.get(cfgSrcEid) : null;

          const securityEntry = createSecurityEntry({
            config: cfg,
            peerDetails,
            routeMetric,
            localEid: cfgLocalEid,
            requiredDVNs,
            requiredDVNLabels,
            optionalDVNs,
            optionalDVNLabels,
          });

          const sanitizedPeerOappId = sanitizePeerOAppId(securityEntry.peerOappId);
          securityEntry.peerOappId = sanitizedPeerOappId ?? undefined;

          if (!shouldIncludeSecurityEntry(securityEntry)) {
            continue;
          }

          const isBlockingFallback =
            securityEntry.synthetic &&
            securityEntry.peerStateHint === "implicit-blocked" &&
            !securityEntry.peerOappId;

          securityEntry.isBlockingFallback = isBlockingFallback;

          node.securityConfigs.push(securityEntry);

          if (!isBlockingFallback || securityEntry.peerOappId) {
            let edgeFromId = securityEntry.peerOappId;
            if (!edgeFromId && securityEntry.peerLocalEid) {
              edgeFromId = `${securityEntry.peerLocalEid}_${AddressUtils.constants.ZERO}`;
            }

            const queueNextId = sanitizePeerOAppId(securityEntry.peerOappId);

            const context = createEdgeContext({
              config: securityEntry,
              edgeFrom: edgeFromId,
              edgeTo: oappId,
              peerInfo: peerDetails,
              peerRaw: peerDetails?.rawPeer ?? cfg?.peer ?? null,
              peerLocalEid: securityEntry.peerLocalEid,
              queueNext: queueNextId,
              isOutbound: true,
              peerStateHint: securityEntry.peerStateHint ?? peerDetails?.peerStateHint ?? null,
              routeMetric,
              sourceType: securityEntry.sourceType,
              libraryStatus: securityEntry.libraryStatus,
              synthetic: securityEntry.synthetic,
            });
            context.entryRef = securityEntry;
            context.attached = false;
            securityEntry.attachedCandidate = true;
            outboundContexts.push(context);
          }
        }

        const inboundContexts = inboundConfigs
          .map((cfg) => {
            if (!cfg?.oappId || cfg.oappId === oappId) {
              return null;
            }

            const sanitizedInboundOAppId = sanitizePeerOAppId(cfg.oappId);
            if (!sanitizedInboundOAppId) {
              return null;
            }

            const { localEid: remoteLocalEid, address: remoteAddress } =
              splitOAppId(sanitizedInboundOAppId);

            const remotePeerRecords =
              batchData.peerRecordsByOapp.get(sanitizedInboundOAppId) ?? null;
            const peerRecordKey = normalizeKey(cfg?.eid);
            const peerRecord =
              (remotePeerRecords && peerRecordKey ? remotePeerRecords.get(peerRecordKey) : null) ??
              remotePeerRecords?.get("__unknown__") ??
              null;

            const normalizedInboundRaw = normalizeSecurityConfig({
              eid: cfg.eid,
              config: cfg,
              peerRecord,
              oappId: sanitizedInboundOAppId,
              oappAddress: cfg.oapp,
              localEid: cfg.localEid,
            });
            const normalizedInbound =
              normalizedInboundRaw && normalizedInboundRaw.peerOappId !== undefined
                ? {
                    ...normalizedInboundRaw,
                    peerOappId: sanitizePeerOAppId(normalizedInboundRaw.peerOappId),
                  }
                : normalizedInboundRaw;

            const peerDetails = buildPeerInfo(normalizedInbound);

            let isStalePeer = false;
            let blockReasonHint = null;

            if (remoteLocalEid) {
              const ourConfigForThisSrc = node.securityConfigs.find(
                (c) => normalizeKey(c.srcEid) === normalizeKey(remoteLocalEid),
              );
              if (ourConfigForThisSrc) {
                const ourPeerAddress = AddressUtils.normalizeSafe(ourConfigForThisSrc.peerAddress);
                const remoteAddr = AddressUtils.normalizeSafe(remoteAddress);
                const ourPeerState = ourConfigForThisSrc.peerStateHint ?? null;

                if (ourPeerAddress && remoteAddr && ourPeerAddress !== remoteAddr) {
                  isStalePeer = true;
                  blockReasonHint = "stale-peer";
                } else if (ourPeerState === "explicit-blocked") {
                  blockReasonHint = "explicit-block";
                } else if (ourPeerState === "implicit-blocked") {
                  blockReasonHint = "implicit-block";
                }
              }
            }

            if (!blockReasonHint) {
              const peerState =
                normalizedInbound?.peerStateHint ??
                (peerDetails ? peerDetails.peerStateHint : null) ??
                null;
              const hasResolvedPeer = !!(peerDetails?.oappId || normalizedInbound?.peerOappId);
              const isZeroPeer = peerDetails?.isZeroPeer === true;
              if (peerState === "explicit-blocked" || isZeroPeer) {
                blockReasonHint = "explicit-block";
              } else if (!hasResolvedPeer) {
                if (peerState === "implicit-blocked" || !!normalizedInbound?.synthetic) {
                  blockReasonHint = "implicit-block";
                }
              }
            }

            const context = createInboundEdgeContext({
              normalizedInbound,
              peerDetails,
              sanitizedInboundOAppId,
              oappId,
              remoteLocalEid,
              isStalePeer,
            });
            context.blockReasonHint = blockReasonHint;
            return context;
          })
          .filter(Boolean);

        nodes.set(oappId, node);

        addPeerEdges({
          oappId,
          depth,
          maxDepth,
          queue,
          pending,
          visited,
          edges,
          contexts: [...outboundContexts, ...inboundContexts],
        });

        const attachedEntries = new Set();
        for (const context of outboundContexts) {
          if (context.entryRef && context.attached) {
            attachedEntries.add(context.entryRef);
          }
        }

        node.securityConfigs = node.securityConfigs.filter((entry) => {
          if (!entry.attachedCandidate) {
            return true;
          }
          return attachedEntries.has(entry);
        });

        finalizeNodeMetrics({
          node,
          routeStatsMap,
          outboundContexts,
          originalSecuritySummary: securitySummary,
          edgesMap: edges,
        });
      }
    }

    addDanglingNodes(nodes, edges);
    onProgress(`Complete: ${nodes.size} nodes, ${edges.size} edges`);

    return {
      seed: seedOAppId,
      crawlDepth: maxDepth,
      timestamp: new Date().toISOString(),
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }
}
