import { APP_CONFIG } from "./config.js";
import { bytes32ToAddress, makeOAppId, normalizeAddress } from "./core.js";

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

      const { configs, oapp } = await this.fetchSecurityConfig(oappId);
      const localEid =
        oapp?.localEid !== undefined && oapp?.localEid !== null
          ? String(oapp.localEid)
          : oappId.split("_")[0];

      const node = {
        id: oappId,
        localEid,
        address: oapp?.address || oappId.split("_")[1],
        totalPacketsReceived: oapp?.totalPacketsReceived || 0,
        isTracked: configs.length > 0,
        depth,
        securityConfigs: [],
      };

      const configContexts = configs.map((cfg) => {
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
          peer: peer?.rawPeer || null,
          peerOAppId: peer?.oappId || null,
          peerLocalEid: peer?.localEid || null,
          peerAddress: peer?.address || null,
          peerResolved: peer?.resolved || false,
        });
        return { config: cfg, peerInfo: peer };
      });

      nodes.set(oappId, node);
      this.addPeerEdges({ oappId, depth, maxDepth, queue, visited, edges, configContexts });
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
      const [localEid, address] = id.split("_");
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
        OAppSecurityConfig(where: { oappId: { _eq: $oappId } }) {
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
      configs: data.OAppSecurityConfig || [],
      oapp: data.OApp?.[0] || null,
    };
  }

  derivePeer(config) {
    if (!config.peer) return null;

    const eid = config.eid !== undefined && config.eid !== null ? String(config.eid) : null;
    if (!eid) {
      return {
        rawPeer: config.peer,
        localEid: null,
        address: null,
        oappId: `unknown-eid_${config.peer.toLowerCase()}`,
        resolved: false,
      };
    }

    const decoded = bytes32ToAddress(config.peer);
    if (decoded) {
      try {
        const normalized = normalizeAddress(decoded);
        return {
          rawPeer: config.peer,
          localEid: eid,
          address: normalized,
          oappId: makeOAppId(eid, normalized),
          resolved: true,
        };
      } catch (error) {
        console.debug("[Crawler] Failed to normalize peer", { peer: config.peer, decoded, error });
      }
    }

    return {
      rawPeer: config.peer,
      localEid: eid,
      address: null,
      oappId: `${eid}_${config.peer.toLowerCase()}`,
      resolved: false,
    };
  }

  addPeerEdges({ oappId, depth, maxDepth, queue, visited, edges, configContexts }) {
    for (const { config, peerInfo } of configContexts) {
      if (!peerInfo?.oappId) continue;

      const key = `${peerInfo.oappId}->${oappId}`;
      if (!edges.has(key)) {
        edges.set(key, {
          from: peerInfo.oappId,
          to: oappId,
          srcEid: config.eid,
          linkType: "peer",
          peerResolved: peerInfo.resolved,
          peerRaw: peerInfo.rawPeer,
          peerLocalEid: peerInfo.localEid,
        });
      }

      if (peerInfo.resolved && depth < maxDepth && !visited.has(peerInfo.oappId)) {
        queue.push({ oappId: peerInfo.oappId, depth: depth + 1 });
      }
    }
  }
}
