import { APP_CONFIG } from "./config.js";
import { splitOAppId } from "./core.js";

const ZERO_PEER_HEX = APP_CONFIG.ADDRESSES.ZERO_PEER.toLowerCase();
const ZERO_ADDRESS_HEX = APP_CONFIG.ADDRESSES.ZERO.toLowerCase();

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
    const dvnNameCache = new Map();

    const resolveDvnNamesCached = (addresses, localEidValue) => {
      const list = Array.isArray(addresses) ? addresses.filter(Boolean) : [];
      if (!list.length) return [];
      const key = `${localEidValue ?? ""}|${list.join(",").toLowerCase()}`;
      if (dvnNameCache.has(key)) {
        return dvnNameCache.get(key);
      }
      const context =
        localEidValue !== undefined && localEidValue !== null ? { localEid: localEidValue } : {};
      const names = this.chainMetadata.resolveDvnNames(list, context);
      dvnNameCache.set(key, names);
      return names;
    };

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
        const localEid =
          oapp?.localEid !== undefined && oapp?.localEid !== null
            ? String(oapp.localEid)
            : fallbackLocalEid;
        const resolvedAddress = oapp?.address || fallbackAddress || "unknown";

        const node = {
          id: oappId,
          localEid,
          address: resolvedAddress,
          totalPacketsReceived: oapp?.totalPacketsReceived || 0,
          isTracked: configs.length > 0,
          depth,
          securityConfigs: [],
        };

        const outboundContexts = configs.map((cfg) => {
          const peer = this.derivePeer(cfg);
          const requiredDVNs = Array.isArray(cfg.effectiveRequiredDVNs)
            ? cfg.effectiveRequiredDVNs
            : [];
          const optionalDVNs = Array.isArray(cfg.effectiveOptionalDVNs)
            ? cfg.effectiveOptionalDVNs
            : [];
          const cfgEid =
            cfg.localEid !== undefined && cfg.localEid !== null ? String(cfg.localEid) : localEid;
          const requiredDVNLabels = resolveDvnNamesCached(requiredDVNs, cfgEid);
          const optionalDVNLabels = resolveDvnNamesCached(optionalDVNs, cfgEid);
          const peerOAppId = peer?.oappId ?? null;

          // Create synthetic ID for blocked/unresolved peers so they appear in the graph
          let edgeFromId = peerOAppId;
          if (!peerOAppId && peer?.localEid) {
            // Use zero address to create a synthetic OApp ID for the blocked peer
            edgeFromId = `${peer.localEid}_${ZERO_ADDRESS_HEX}`;
          }

          node.securityConfigs.push({
            srcEid: cfg.eid,
            localEid: cfgEid,
            requiredDVNCount: cfg.effectiveRequiredDVNCount || 0,
            requiredDVNs,
            requiredDVNLabels,
            optionalDVNCount: cfg.effectiveOptionalDVNCount || 0,
            optionalDVNs,
            optionalDVNLabels,
            optionalDVNThreshold: cfg.effectiveOptionalDVNThreshold || 0,
            usesRequiredDVNSentinel: cfg.usesRequiredDVNSentinel || false,
            isConfigTracked: cfg.isConfigTracked || false,
            peer: cfg.peer ?? null,
            peerOAppId,
            peerLocalEid: peer?.localEid || null,
            peerAddress: peer?.address || null,
            peerResolved: peer?.resolved ?? Boolean(peerOAppId),
          });

          return {
            config: cfg,
            edgeFrom: edgeFromId,
            edgeTo: oappId,
            peerInfo: peer,
            peerResolved: peer?.resolved ?? Boolean(peerOAppId),
            peerRaw: peer?.rawPeer ?? cfg.peer ?? null,
            peerLocalEid: peer?.localEid || null,
            queueNext: peerOAppId,
            linkType: "peer",
          };
        });

        const inboundContexts = inboundConfigs
          .filter((cfg) => cfg?.oappId && cfg.oappId !== oappId)
          .map((cfg) => {
            const remoteId = cfg.oappId;
            const { localEid: remoteLocalEid, address: remoteAddress } = splitOAppId(remoteId);

            // Check if this is a stale peer: does our config for this srcEid point back to this remote node?
            let isStalePeer = false;
            if (remoteLocalEid) {
              const ourConfigForThisSrc = configs.find(
                (c) => String(c.eid) === String(remoteLocalEid),
              );
              if (ourConfigForThisSrc) {
                // We have a config for this srcEid - check if the peer matches
                const ourPeer = this.derivePeer(ourConfigForThisSrc);
                const ourPeerAddress = ourPeer?.address?.toLowerCase();
                const remoteAddr = remoteAddress?.toLowerCase();

                // If we have a peer set for this srcEid and it doesn't match this remote node, it's stale
                if (ourPeerAddress && remoteAddr && ourPeerAddress !== remoteAddr) {
                  isStalePeer = true;
                } else if (ourPeer?.isZeroPeer) {
                  // If our peer is set to zero, all inbound from this srcEid are blocked
                  isStalePeer = true;
                }
              }
            }

            return {
              config: cfg,
              edgeFrom: remoteId,
              edgeTo: oappId,
              peerInfo: null,
              peerResolved: true,
              peerRaw: cfg.peer ?? null,
              peerLocalEid: remoteLocalEid ?? null,
              queueNext: remoteId,
              linkType: "peer",
              isStalePeer,
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
        depth: -1,
        securityConfigs: [],
        totalPacketsReceived: 0,
      });
    }
  }

  async fetchSecurityConfigBatch(oappIds) {
    if (!Array.isArray(oappIds) || oappIds.length === 0) {
      return { origin: new Map(), referencing: new Map(), oapps: new Map() };
    }

    const uniqueIds = Array.from(new Set(oappIds));

    const query = `
      query GetSecurityConfigBatch($oappIds: [String!]!) {
        origin: OAppSecurityConfig(where: { oappId: { _in: $oappIds } }) {
          id
          oappId
          eid
          localEid
          oapp
          effectiveRequiredDVNCount
          effectiveRequiredDVNs
          effectiveOptionalDVNCount
          effectiveOptionalDVNs
          effectiveOptionalDVNThreshold
          isConfigTracked
          usesRequiredDVNSentinel
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
          effectiveRequiredDVNCount
          effectiveRequiredDVNs
          effectiveOptionalDVNCount
          effectiveOptionalDVNs
          effectiveOptionalDVNThreshold
          isConfigTracked
          usesRequiredDVNSentinel
          peer
          peerOappId
          peerTransactionHash
          peerLastUpdatedBlock
          peerLastUpdatedTimestamp
          peerLastUpdatedEventId
        }
        OApp(where: { id: { _in: $oappIds } }) {
          id
          localEid
          address
          totalPacketsReceived
        }
      }
    `;

    const data = await this.client.query(query, { oappIds: uniqueIds });

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
    (data.OApp || []).forEach((oapp) => {
      oappMap.set(String(oapp.id), oapp);
    });

    return {
      origin: originMap,
      referencing: referencingMap,
      oapps: oappMap,
    };
  }

  derivePeer(config) {
    const rawPeer = config.peer ?? null;
    const normalizedRaw = rawPeer ? String(rawPeer).toLowerCase() : null;
    const isZeroPeer = normalizedRaw === ZERO_PEER_HEX || normalizedRaw === ZERO_ADDRESS_HEX;

    if (isZeroPeer) {
      const eid = config.eid !== undefined && config.eid !== null ? String(config.eid) : null;
      return {
        rawPeer,
        localEid: eid,
        address: null,
        oappId: null,
        resolved: false,
        isZeroPeer: true,
      };
    }

    const peerOappId = config.peerOappId || null;
    if (!peerOappId) return null;

    const { localEid, address } = splitOAppId(peerOappId);
    if (address && address.toLowerCase() === ZERO_ADDRESS_HEX) {
      const eid = config.eid !== undefined && config.eid !== null ? String(config.eid) : null;
      return {
        rawPeer,
        localEid: eid,
        address: null,
        oappId: null,
        resolved: false,
        isZeroPeer: true,
      };
    }

    return {
      rawPeer,
      localEid: localEid || null,
      address: address || null,
      oappId: address ? peerOappId : null,
      resolved: Boolean(address),
    };
  }

  addPeerEdges({ oappId, depth, maxDepth, queue, pending, visited, edges, contexts }) {
    for (const context of contexts) {
      const edgeFrom = context.edgeFrom;
      const edgeTo = context.edgeTo || oappId;
      if (!edgeFrom || !edgeTo) continue;

      const key = `${edgeFrom}->${edgeTo}`;
      if (!edges.has(key)) {
        edges.set(key, {
          from: edgeFrom,
          to: edgeTo,
          srcEid: context.config?.eid,
          linkType: context.linkType || "peer",
          peerResolved:
            context.peerResolved ??
            (context.peerInfo ? context.peerInfo.resolved : undefined) ??
            null,
          peerRaw:
            context.peerRaw ?? (context.peerInfo ? context.peerInfo.rawPeer : undefined) ?? null,
          peerLocalEid:
            context.peerLocalEid ??
            (context.peerInfo ? context.peerInfo.localEid : undefined) ??
            null,
          peerOAppId: edgeFrom,
          isStalePeer: context.isStalePeer ?? false,
        });
      }

      const nextId = context.queueNext;
      if (nextId && depth < maxDepth && !visited.has(nextId) && !pending.has(nextId)) {
        queue.push({ oappId: nextId, depth: depth + 1 });
        pending.add(nextId);
      }
    }
  }
}
