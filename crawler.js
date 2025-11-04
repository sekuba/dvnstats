import { APP_CONFIG } from "./config.js";
import { splitOAppId, normalizeKey } from "./core.js";
import { AddressUtils } from "./utils/AddressUtils.js";
import { resolveOAppSecurityConfigs } from "./resolver.js";

export class SecurityGraphCrawler {
  constructor(client, chainMetadata) {
    this.client = client;
    this.chainMetadata = chainMetadata;
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
      const batchData = await this.fetchSecurityConfigBatch(batchIds);

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

        const totalRoutePackets = routeStatsRaw.reduce((acc, stat) => {
          const value = Number(stat?.packetCount);
          return acc + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);

        const routeStatsMap = new Map();
        routeStatsRaw.forEach((stat) => {
          const key = normalizeKey(stat?.srcEid ?? stat?.eid);
          if (!key) return;
          const count = Number(stat?.packetCount);
          const packetCount = Number.isFinite(count) && count > 0 ? count : 0;
          const share = totalRoutePackets > 0 ? packetCount / totalRoutePackets : 0;
          routeStatsMap.set(key, {
            srcEid: key,
            packetCount,
            share,
            percent: share > 0 ? share * 100 : 0,
            lastPacketBlock:
              stat?.lastPacketBlock !== undefined && stat?.lastPacketBlock !== null
                ? Number(stat.lastPacketBlock)
                : null,
            lastPacketTimestamp:
              stat?.lastPacketTimestamp !== undefined && stat?.lastPacketTimestamp !== null
                ? Number(stat.lastPacketTimestamp)
                : null,
          });
        });

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

          const requiredDVNLabels = this.chainMetadata.resolveDvnNames(
            requiredDVNs,
            cfgLocalEid !== undefined && cfgLocalEid !== null ? { localEid: cfgLocalEid } : {},
          );
          const optionalDVNLabels = this.chainMetadata.resolveDvnNames(
            optionalDVNs,
            cfgLocalEid !== undefined && cfgLocalEid !== null ? { localEid: cfgLocalEid } : {},
          );

          const peerDetails = this.derivePeer(cfg);
          const routeMetric = cfgSrcEid ? routeStatsMap.get(cfgSrcEid) : null;

          const securityEntry = {
            id: cfg.id ?? null,
            srcEid: cfg?.eid ?? null,
            localEid: cfgLocalEid,
            requiredDVNCount: cfg?.effectiveRequiredDVNCount ?? 0,
            requiredDVNs,
            requiredDVNLabels,
            optionalDVNCount: cfg?.effectiveOptionalDVNCount ?? 0,
            optionalDVNs,
            optionalDVNLabels,
            optionalDVNThreshold: cfg?.effectiveOptionalDVNThreshold ?? 0,
            usesRequiredDVNSentinel: cfg?.usesRequiredDVNSentinel ?? false,
            libraryStatus: cfg?.libraryStatus ?? "unknown",
            peer: cfg?.peer ?? null,
            peerStateHint: cfg?.peerStateHint ?? null,
            peerOAppId: peerDetails?.oappId ?? null,
            peerLocalEid: peerDetails?.localEid ?? null,
            peerAddress: peerDetails?.address ?? null,
            sourceType: cfg?.sourceType ?? "materialized",
            synthetic: Boolean(cfg?.synthetic),
            fallbackFields: Array.isArray(cfg?.fallbackFields) ? cfg.fallbackFields : [],
            routePacketCount: routeMetric?.packetCount ?? 0,
            routePacketShare: routeMetric?.share ?? 0,
            routePacketPercent: routeMetric?.percent ?? 0,
            routeLastPacketBlock: routeMetric?.lastPacketBlock ?? null,
            routeLastPacketTimestamp: routeMetric?.lastPacketTimestamp ?? null,
            attachedCandidate: false,
            unresolvedPeer:
              !peerDetails?.oappId && !(peerDetails && peerDetails.isZeroPeer) && !cfg.peerOappId,
          };

          if (!this.shouldIncludeSecurityEntry(securityEntry)) {
            continue;
          }

          const isBlockingFallback =
            securityEntry.synthetic &&
            securityEntry.peerStateHint === "implicit-blocked" &&
            !securityEntry.peerOAppId;

          securityEntry.isBlockingFallback = isBlockingFallback;

          node.securityConfigs.push(securityEntry);

          if (!isBlockingFallback || securityEntry.peerOAppId) {
            let edgeFromId = securityEntry.peerOAppId;
            if (!edgeFromId && securityEntry.peerLocalEid) {
              edgeFromId = `${securityEntry.peerLocalEid}_${AddressUtils.constants.ZERO}`;
            }

            const context = {
              config: securityEntry,
              edgeFrom: edgeFromId,
              edgeTo: oappId,
              peerInfo: peerDetails,
              peerRaw: peerDetails?.rawPeer ?? null,
              peerLocalEid: securityEntry.peerLocalEid,
              queueNext: securityEntry.peerOAppId,
              isOutbound: true,
              peerStateHint: securityEntry.peerStateHint ?? peerDetails?.peerStateHint ?? null,
              routeMetric,
              sourceType: securityEntry.sourceType,
              libraryStatus: securityEntry.libraryStatus,
              synthetic: securityEntry.synthetic,
              entryRef: securityEntry,
              attached: false,
            };
            securityEntry.attachedCandidate = true;
            outboundContexts.push(context);
          }
        }

        const inboundContexts = inboundConfigs
          .filter((cfg) => cfg?.oappId && cfg.oappId !== oappId)
          .map((cfg) => {
            const remoteId = cfg.oappId;
            const { localEid: remoteLocalEid, address: remoteAddress } = splitOAppId(remoteId);

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

            const peerDetails = this.derivePeer(cfg);

            if (!blockReasonHint) {
              const peerState =
                cfg?.peerStateHint ?? (peerDetails ? peerDetails.peerStateHint : null) ?? null;
              const hasResolvedPeer = Boolean(peerDetails?.oappId || cfg?.peerOappId);
              const isZeroPeer = peerDetails?.isZeroPeer === true;
              if (peerState === "explicit-blocked" || isZeroPeer) {
                blockReasonHint = "explicit-block";
              } else if (!hasResolvedPeer) {
                if (peerState === "implicit-blocked" || Boolean(cfg?.synthetic)) {
                  blockReasonHint = "implicit-block";
                }
              }
            }

            return {
              config: cfg,
              edgeFrom: remoteId,
              edgeTo: oappId,
              peerInfo: peerDetails,
              peerRaw: peerDetails?.rawPeer ?? cfg?.peer ?? null,
              peerLocalEid: remoteLocalEid ?? null,
              queueNext: remoteId,
              isStalePeer,
              blockReasonHint,
              isOutbound: false,
              peerStateHint: cfg?.peerStateHint ?? peerDetails?.peerStateHint ?? null,
              libraryStatus: cfg?.libraryStatus ?? null,
              synthetic: Boolean(cfg?.synthetic),
            };
          });

        nodes.set(oappId, node);

        this.addPeerEdges({
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

        this.finalizeNodeMetrics({
          node,
          routeStatsMap,
          outboundContexts,
          originalSecuritySummary: securitySummary,
          edgesMap: edges,
        });
      }
    }

    this.addDanglingNodes(nodes, edges);
    onProgress(`Complete: ${nodes.size} nodes, ${edges.size} edges`);

    return {
      seed: seedOAppId,
      crawlDepth: maxDepth,
      timestamp: new Date().toISOString(),
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  addDanglingNodes(nodes, edges) {
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

  async fetchSecurityConfigBatch(oappIds) {
    if (!Array.isArray(oappIds) || oappIds.length === 0) {
      return {
        origin: new Map(),
        referencing: new Map(),
        oapps: new Map(),
        peerRecordsByOapp: new Map(),
        defaultLibraries: new Map(),
        defaultConfigs: new Map(),
        oappLibraries: new Map(),
        oappConfigs: new Map(),
        routeStats: new Map(),
      };
    }

    const uniqueIds = Array.from(new Set(oappIds));
    const localEidSet = new Set();
    uniqueIds.forEach((id) => {
      const { localEid } = splitOAppId(id);
      if (localEid === null || localEid === undefined) {
        return;
      }
      const numeric = Number(localEid);
      if (Number.isFinite(numeric)) {
        localEidSet.add(numeric);
      }
    });
    const localEids = Array.from(localEidSet);

    const query = `
      query GetSecurityConfigBatch($oappIds: [String!]!, $localEids: [numeric!]) {
        origin: OAppSecurityConfig(where: { oappId: { _in: $oappIds } }) {
          id
          oappId
          eid
          localEid
          oapp
          effectiveReceiveLibrary
          effectiveConfirmations
          effectiveRequiredDVNCount
          effectiveOptionalDVNCount
          effectiveOptionalDVNThreshold
          effectiveRequiredDVNs
          effectiveOptionalDVNs
          libraryStatus
          usesDefaultLibrary
          usesDefaultConfig
          usesRequiredDVNSentinel
          fallbackFields
          defaultLibraryVersionId
          defaultConfigVersionId
          libraryOverrideVersionId
          configOverrideVersionId
          lastComputedBlock
          lastComputedTimestamp
          lastComputedByEventId
          lastComputedTransactionHash
          peer
          peerOappId
          peerTransactionHash
          peerLastUpdatedBlock
          peerLastUpdatedTimestamp
          peerLastUpdatedEventId
        }
        referencing: OAppSecurityConfig(where: { peerOappId: { _in: $oappIds } }) {
          id
          oappId
          eid
          localEid
          oapp
          effectiveReceiveLibrary
          effectiveConfirmations
          effectiveRequiredDVNCount
          effectiveOptionalDVNCount
          effectiveOptionalDVNThreshold
          effectiveRequiredDVNs
          effectiveOptionalDVNs
          libraryStatus
          usesDefaultLibrary
          usesDefaultConfig
          usesRequiredDVNSentinel
          fallbackFields
          defaultLibraryVersionId
          defaultConfigVersionId
          libraryOverrideVersionId
          configOverrideVersionId
          lastComputedBlock
          lastComputedTimestamp
          lastComputedByEventId
          lastComputedTransactionHash
          peer
          peerOappId
          peerTransactionHash
          peerLastUpdatedBlock
          peerLastUpdatedTimestamp
          peerLastUpdatedEventId
        }
        OAppStats(where: { id: { _in: $oappIds } }) {
          id
          localEid
          address
          totalPacketsReceived
        }
        OAppPeer(where: { oappId: { _in: $oappIds } }) {
          id
          oappId
          eid
          peer
          peerOappId
          fromPacketDelivered
          lastUpdatedBlock
          lastUpdatedTimestamp
          lastUpdatedByEventId
          transactionHash
        }
        OAppRouteStats(where: { oappId: { _in: $oappIds } }) {
          id
          oappId
          srcEid
          packetCount
          lastPacketBlock
          lastPacketTimestamp
        }
        OAppReceiveLibrary(where: { oappId: { _in: $oappIds } }) {
          oappId
          eid
          library
          lastUpdatedByEventId
          lastUpdatedBlock
          lastUpdatedTimestamp
          transactionHash
        }
        OAppUlnConfig(where: { oappId: { _in: $oappIds } }) {
          oappId
          eid
          confirmations
          requiredDVNCount
          optionalDVNCount
          optionalDVNThreshold
          requiredDVNs
          optionalDVNs
          lastUpdatedByEventId
          lastUpdatedBlock
          lastUpdatedTimestamp
          transactionHash
        }
        DefaultReceiveLibrary(where: { localEid: { _in: $localEids } }) {
          localEid
          eid
          library
          lastUpdatedByEventId
          lastUpdatedBlock
          lastUpdatedTimestamp
          transactionHash
        }
        DefaultUlnConfig(where: { localEid: { _in: $localEids } }) {
          localEid
          eid
          confirmations
          requiredDVNCount
          optionalDVNCount
          optionalDVNThreshold
          requiredDVNs
          optionalDVNs
          lastUpdatedByEventId
          lastUpdatedBlock
          lastUpdatedTimestamp
          transactionHash
        }
      }
    `;

    const variables = { oappIds: uniqueIds, localEids };
    const data = await this.client.query(query, variables);

    const originMap = new Map();
    (data.origin || []).forEach((cfg) => {
      const key = String(cfg.oappId);
      if (!originMap.has(key)) originMap.set(key, []);
      originMap.get(key).push(cfg);
    });

    const referencingMap = new Map();
    (data.referencing || []).forEach((cfg) => {
      const key = cfg.peerOappId ? String(cfg.peerOappId) : null;
      if (!key) return;
      if (!referencingMap.has(key)) referencingMap.set(key, []);
      referencingMap.get(key).push(cfg);
    });

    const oappMap = new Map();
    (data.OAppStats || []).forEach((oapp) => {
      oappMap.set(String(oapp.id), oapp);
    });

    const peerRecordsByOapp = new Map();
    (data.OAppPeer || []).forEach((peer) => {
      const oappKey = String(peer.oappId);
      const eidKey = peer.eid !== undefined && peer.eid !== null ? String(peer.eid) : "__unknown__";
      if (!peerRecordsByOapp.has(oappKey)) {
        peerRecordsByOapp.set(oappKey, new Map());
      }
      peerRecordsByOapp.get(oappKey).set(eidKey, peer);
    });

    const defaultLibraryMap = new Map();
    (data.DefaultReceiveLibrary || []).forEach((row) => {
      const key = String(row.localEid);
      if (!defaultLibraryMap.has(key)) defaultLibraryMap.set(key, []);
      defaultLibraryMap.get(key).push(row);
    });

    const defaultConfigMap = new Map();
    (data.DefaultUlnConfig || []).forEach((row) => {
      const key = String(row.localEid);
      if (!defaultConfigMap.has(key)) defaultConfigMap.set(key, []);
      defaultConfigMap.get(key).push(row);
    });

    const oappLibraryMap = new Map();
    (data.OAppReceiveLibrary || []).forEach((row) => {
      const key = String(row.oappId);
      if (!oappLibraryMap.has(key)) oappLibraryMap.set(key, []);
      oappLibraryMap.get(key).push(row);
    });

    const oappConfigMap = new Map();
    (data.OAppUlnConfig || []).forEach((row) => {
      const key = String(row.oappId);
      if (!oappConfigMap.has(key)) oappConfigMap.set(key, []);
      oappConfigMap.get(key).push(row);
    });

    const routeStatsMap = new Map();
    (data.OAppRouteStats || []).forEach((row) => {
      const key = String(row.oappId);
      if (!routeStatsMap.has(key)) routeStatsMap.set(key, []);
      routeStatsMap.get(key).push(row);
    });

    return {
      origin: originMap,
      referencing: referencingMap,
      oapps: oappMap,
      peerRecordsByOapp,
      defaultLibraries: defaultLibraryMap,
      defaultConfigs: defaultConfigMap,
      oappLibraries: oappLibraryMap,
      oappConfigs: oappConfigMap,
      routeStats: routeStatsMap,
    };
  }

  derivePeer(config) {
    if (!config) {
      return null;
    }

    const rawPeer = config.peer ?? null;
    const peerStateHint = config.peerStateHint ?? null;
    const normalizedRaw = AddressUtils.normalizeSafe(rawPeer);

    const explicitZero = AddressUtils.isZero(normalizedRaw);
    const isImplicitBlock =
      peerStateHint === "implicit-blocked" || peerStateHint === "not-configured";
    const isExplicitBlock = peerStateHint === "explicit-blocked";
    const isZeroPeer = explicitZero || isExplicitBlock || isImplicitBlock;

    const eid =
      config.eid !== undefined && config.eid !== null
        ? String(config.eid)
        : config.localEid !== undefined && config.localEid !== null
          ? String(config.localEid)
          : null;

    if (isZeroPeer || (!rawPeer && isImplicitBlock)) {
      return {
        rawPeer,
        localEid: eid,
        address: null,
        oappId: null,
        resolved: false,
        isZeroPeer: true,
        peerStateHint: peerStateHint ?? (explicitZero ? "explicit-blocked" : "implicit-blocked"),
      };
    }

    const peerOappId = config.peerOappId || null;
    if (!peerOappId) {
      if (!rawPeer) {
        return null;
      }
      return {
        rawPeer,
        localEid: eid,
        address: AddressUtils.normalizeSafe(rawPeer),
        oappId: null,
        resolved: false,
        isZeroPeer: false,
        peerStateHint: peerStateHint ?? null,
      };
    }

    const { localEid: peerLocalEid, address } = splitOAppId(peerOappId);
    if (AddressUtils.isZero(address)) {
      return {
        rawPeer,
        localEid: peerLocalEid || eid,
        address: null,
        oappId: null,
        resolved: false,
        isZeroPeer: true,
        peerStateHint: peerStateHint ?? "explicit-blocked",
      };
    }

    return {
      rawPeer,
      localEid: peerLocalEid || null,
      address: address || null,
      oappId: address ? peerOappId : null,
      resolved: Boolean(address),
      isZeroPeer: false,
      peerStateHint: peerStateHint ?? null,
    };
  }

  shouldIncludeSecurityEntry(entry) {
    if (!entry) {
      return false;
    }

    const synthetic = Boolean(entry.synthetic);
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

      if (!entry.peerOAppId) {
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

  finalizeNodeMetrics({
    node,
    routeStatsMap,
    outboundContexts = [],
    originalSecuritySummary = null,
    edgesMap = null,
  }) {
    const normalize = (value) => (value === undefined || value === null ? null : String(value));

    const allowedSrcEids = new Set(
      node.securityConfigs
        .map((entry) => normalize(entry.srcEid))
        .filter((value) => value !== null),
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

    const totalRoutePackets = filteredRouteStats.reduce((acc, stat) => {
      const packetCount = Number(stat.packetCount);
      return acc + (Number.isFinite(packetCount) && packetCount >= 0 ? packetCount : 0);
    }, 0);

    filteredRouteStats.forEach((stat) => {
      const packetCount = Number(stat.packetCount);
      const safeCount = Number.isFinite(packetCount) && packetCount >= 0 ? packetCount : 0;
      const share = totalRoutePackets > 0 ? safeCount / totalRoutePackets : 0;
      stat.packetCount = safeCount;
      stat.share = share;
      stat.percent = share > 0 ? share * 100 : 0;
    });

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
              metric && metric.lastPacketTimestamp !== undefined
                ? metric.lastPacketTimestamp
                : null;
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

  addPeerEdges({ oappId, depth, maxDepth, queue, pending, visited, edges, contexts }) {
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
        Boolean(contextConfig.unresolvedPeer) ||
        Boolean(peerInfo?.unresolvedPeer) ||
        (!peerRaw && !contextConfig.peerOAppId && peerStateHint === "implicit-blocked");
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
        edges.set(key, {
          from: edgeFrom,
          to: edgeTo,
          srcEid,
          peerRaw,
          peerLocalEid,
          peerOAppId: edgeFrom,
          peerStateHint,
          blockReasonHint: resolvedBlockReason,
          isStalePeer: Boolean(context.isStalePeer),
          libraryStatus: context.libraryStatus ?? contextConfig.libraryStatus ?? null,
          synthetic: Boolean(context.synthetic ?? contextConfig.synthetic),
          sourceType: context.sourceType ?? contextConfig.sourceType ?? null,
          routePacketCount: routeMetric?.packetCount ?? configRouteMetric?.routePacketCount ?? 0,
          routePacketShare: routeMetric?.share ?? configRouteMetric?.routePacketShare ?? 0,
          routePacketPercent: routeMetric?.percent ?? configRouteMetric?.routePacketPercent ?? 0,
          routeLastPacketBlock:
            routeMetric?.lastPacketBlock ?? configRouteMetric?.routeLastPacketBlock ?? null,
          routeLastPacketTimestamp:
            routeMetric?.lastPacketTimestamp ?? configRouteMetric?.routeLastPacketTimestamp ?? null,
        });
        context.attached = true;
      } else {
        if (existing.srcEid === null || existing.srcEid === undefined) {
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

        const bestRouteCount = existing.routePacketCount ?? 0;
        if (routeMetric && routeMetric.packetCount > bestRouteCount) {
          existing.routePacketCount = routeMetric.packetCount;
          existing.routePacketShare = routeMetric.share ?? existing.routePacketShare;
          existing.routePacketPercent = routeMetric.percent ?? existing.routePacketPercent;
          existing.routeLastPacketBlock =
            routeMetric.lastPacketBlock ?? existing.routeLastPacketBlock;
          existing.routeLastPacketTimestamp =
            routeMetric.lastPacketTimestamp ?? existing.routeLastPacketTimestamp;
        }
        if (
          configRouteMetric &&
          configRouteMetric.routePacketCount > (existing.routePacketCount ?? 0)
        ) {
          existing.routePacketCount = configRouteMetric.routePacketCount;
          existing.routePacketShare = configRouteMetric.routePacketShare;
          existing.routePacketPercent = configRouteMetric.routePacketPercent;
          existing.routeLastPacketBlock = configRouteMetric.routeLastPacketBlock;
          existing.routeLastPacketTimestamp = configRouteMetric.routeLastPacketTimestamp;
        }
        context.attached = true;
      }

      const nextId = context.queueNext;
      if (nextId && depth < maxDepth && !visited.has(nextId) && !pending.has(nextId)) {
        queue.push({ oappId: nextId, depth: depth + 1 });
        pending.add(nextId);
      }
    }
  }
}
