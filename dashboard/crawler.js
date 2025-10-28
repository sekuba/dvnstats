import { APP_CONFIG } from "./config.js";
import { splitOAppId } from "./core.js";

export class SecurityGraphCrawler {
  constructor(client, chainMetadata) {
    this.client = client;
    this.chainMetadata = chainMetadata;
  }

  async crawl(seedOAppId, options = {}) {
    const maxDepth = options.depth || APP_CONFIG.CRAWLER.DEFAULT_DEPTH;
    const onProgress = options.onProgress || (() => {});

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
    const queue = [{ oappId: seedOAppId, depth: 0 }];
    let count = 0;

    while (queue.length) {
      const { oappId, depth } = queue.shift();
      if (visited.has(oappId)) continue;
      visited.add(oappId);

      count++;
      onProgress(`Processing node ${count} [depth=${depth}]: ${oappId}`);

      const { configs, inboundConfigs, oapp } = await this.fetchSecurityConfig(oappId);
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
        const context = { localEid: cfgEid };

        const requiredDVNNames = this.chainMetadata.resolveDvnNames(requiredDVNs, context);
        const optionalDVNNames = this.chainMetadata.resolveDvnNames(optionalDVNs, context);

        node.securityConfigs.push({
          srcEid: cfg.eid,
          localEid: cfgEid,
          requiredDVNCount: cfg.effectiveRequiredDVNCount || 0,
          requiredDVNs,
          requiredDVNLabels: requiredDVNNames,
          optionalDVNCount: cfg.effectiveOptionalDVNCount || 0,
          optionalDVNs,
          optionalDVNLabels: optionalDVNNames,
          optionalDVNThreshold: cfg.effectiveOptionalDVNThreshold || 0,
          usesRequiredDVNSentinel: cfg.usesRequiredDVNSentinel || false,
          isConfigTracked: cfg.isConfigTracked || false,
          peer: peer?.rawPeer ?? cfg.peer ?? null,
          peerOAppId: peer?.oappId ?? cfg.peerOappId ?? null,
          peerLocalEid: peer?.localEid || null,
          peerAddress: peer?.address || null,
          peerResolved: peer?.resolved ?? Boolean(cfg.peerOappId),
        });

        return {
          config: cfg,
          edgeFrom: peer?.oappId || null,
          edgeTo: oappId,
          peerInfo: peer,
          peerResolved: peer?.resolved ?? Boolean(cfg.peerOappId),
          peerRaw: peer?.rawPeer ?? cfg.peer ?? null,
          peerLocalEid: peer?.localEid || null,
          queueNext: peer?.resolved ? peer.oappId : null,
          linkType: "peer",
        };
      });

      const inboundContexts = inboundConfigs
        .filter((cfg) => cfg?.oappId && cfg.oappId !== oappId)
        .map((cfg) => {
          const remoteId = cfg.oappId;
          const { localEid: remoteLocalEid } = splitOAppId(remoteId);
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
          };
        });

      nodes.set(oappId, node);
      this.addPeerEdges({
        oappId,
        depth,
        maxDepth,
        queue,
        visited,
        edges,
        contexts: [...outboundContexts, ...inboundContexts],
      });
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

  async fetchSecurityConfig(oappId) {
    const query = `
      query GetSecurityConfig($oappId: String!) {
        origin: OAppSecurityConfig(where: { oappId: { _eq: $oappId } }) {
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
        referencing: OAppSecurityConfig(where: { peerOappId: { _eq: $oappId } }) {
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
        OApp(where: { id: { _eq: $oappId } }) {
          id
          localEid
          address
          totalPacketsReceived
        }
      }
    `;

    const data = await this.client.query(query, { oappId });
    return {
      configs: data.origin || [],
      inboundConfigs: data.referencing || [],
      oapp: data.OApp?.[0] || null,
    };
  }

  derivePeer(config) {
    const peerOappId = config.peerOappId || null;
    if (!peerOappId) return null;

    const { localEid, address } = splitOAppId(peerOappId);
    return {
      rawPeer: config.peer ?? null,
      localEid: localEid || null,
      address: address || null,
      oappId: peerOappId,
      resolved: true,
    };
  }

  addPeerEdges({ oappId, depth, maxDepth, queue, visited, edges, contexts }) {
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
            context.peerRaw ??
            (context.peerInfo ? context.peerInfo.rawPeer : undefined) ??
            null,
          peerLocalEid:
            context.peerLocalEid ??
            (context.peerInfo ? context.peerInfo.localEid : undefined) ??
            null,
          peerOAppId: edgeFrom,
        });
      }

      const nextId = context.queueNext;
      if (nextId && depth < maxDepth && !visited.has(nextId)) {
        const alreadyQueued = queue.some((item) => item.oappId === nextId);
        if (!alreadyQueued) {
          queue.push({ oappId: nextId, depth: depth + 1 });
        }
      }
    }
  }
}
