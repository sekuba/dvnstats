/**
 * Security Web Crawler for LayerZero OApps
 * Performs breadth-first traversal of the packet delivery graph
 */

import { CONFIG } from "./config.js";
import { makeOAppId, normalizeAddress, bytes32ToAddress } from "./core.js";

/**
 * Crawls the security web starting from a seed OApp
 */
export class SecurityWebCrawler {
  constructor(client, chainMetadata) {
    this.client = client;
    this.chainMetadata = chainMetadata;
  }

  /**
   * Main crawl function
   */
  async crawl(seedOAppId, options = {}) {
    const maxDepth = options.depth || CONFIG.CRAWLER.DEFAULT_DEPTH;
    const onProgress = options.onProgress || (() => {});

    onProgress("Initializing crawl...");

    // Verify metadata is loaded
    const knownEndpoints = this.chainMetadata.listLocalEndpoints();
    console.log(
      `[SecurityWebCrawler] Starting crawl with ${knownEndpoints.length} local endpoint mappings`,
    );
    if (knownEndpoints.length === 0) {
      console.warn(
        "[SecurityWebCrawler] No local endpoint metadata loaded! Attempting to load...",
      );
      await this.chainMetadata.load();
    }

    const nodes = new Map();
    const edges = new Map();
    const visited = new Set();
    const queue = [{ oappId: seedOAppId, depth: 0 }];

    let nodeCount = 0;

    while (queue.length > 0) {
      const { oappId, depth } = queue.shift();

      if (visited.has(oappId)) {
        continue;
      }
      visited.add(oappId);

      nodeCount++;
      onProgress(`Processing node ${nodeCount} [depth=${depth}]: ${oappId}`);

      const { configs, oapp } = await this.getSecurityConfig(oappId);

      const localEidRaw =
        oapp?.localEid !== undefined && oapp?.localEid !== null
          ? String(oapp.localEid)
          : oappId.split("_")[0];

      const nodeData = {
        id: oappId,
        localEid: localEidRaw,
        address: oapp?.address || oappId.split("_")[1],
        totalPacketsReceived: oapp?.totalPacketsReceived || 0,
        isTracked: configs.length > 0,
        depth,
        securityConfigs: [],
      };

      const configContexts = configs.map((config) => {
        const peerInfo = this.derivePeerFromConfig(config);
        const requiredDVNs = Array.isArray(config.effectiveRequiredDVNs)
          ? config.effectiveRequiredDVNs
          : [];
        const optionalDVNs = Array.isArray(config.effectiveOptionalDVNs)
          ? config.effectiveOptionalDVNs
          : [];

        const configLocalEid =
          config.localEid !== undefined && config.localEid !== null
            ? String(config.localEid)
            : localEidRaw;
        const dvnContext = {
          localEid: configLocalEid,
        };

        const requiredDVNNames = this.chainMetadata.resolveDvnNames(
          requiredDVNs,
          dvnContext,
        );
        const optionalDVNNames = this.chainMetadata.resolveDvnNames(
          optionalDVNs,
          dvnContext,
        );

        nodeData.securityConfigs.push({
          srcEid: config.eid,
          localEid: configLocalEid,
          requiredDVNCount: config.effectiveRequiredDVNCount || 0,
          requiredDVNs: requiredDVNs,
          requiredDVNLabels: requiredDVNNames,
          optionalDVNCount: config.effectiveOptionalDVNCount || 0,
          optionalDVNs: optionalDVNs,
          optionalDVNLabels: optionalDVNNames,
          optionalDVNThreshold: config.effectiveOptionalDVNThreshold || 0,
          usesRequiredDVNSentinel: config.usesRequiredDVNSentinel || false,
          isConfigTracked: config.isConfigTracked || false,
          peer: peerInfo?.rawPeer || null,
          peerOAppId: peerInfo?.oappId || null,
          peerLocalEid: peerInfo?.localEid || null,
          peerAddress: peerInfo?.address || null,
          peerResolved: peerInfo?.resolved || false,
        });
        return { config, peerInfo };
      });

      nodes.set(oappId, nodeData);

      this.addPeerEdges({
        currentOAppId: oappId,
        depth,
        maxDepth,
        queue,
        visited,
        edges,
        configContexts,
      });
    }

    // Add dangling nodes (referenced in edges but not crawled)
    const danglingNodes = new Set();
    for (const edge of edges.values()) {
      if (!nodes.has(edge.from)) {
        danglingNodes.add(edge.from);
      }
      if (!nodes.has(edge.to)) {
        danglingNodes.add(edge.to);
      }
    }

    for (const oappId of danglingNodes) {
      const [localEid, address] = oappId.split("_");
      nodes.set(oappId, {
        id: oappId,
        localEid,
        address,
        isTracked: false,
        isDangling: true,
        depth: -1,
        securityConfigs: [],
        totalPacketsReceived: 0,
      });
    }

    onProgress(`Crawl complete: ${nodes.size} nodes, ${edges.size} edges`);

    return {
      seed: seedOAppId,
      crawlDepth: maxDepth,
      timestamp: new Date().toISOString(),
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  /**
   * Fetches security config for a given OApp
   */
  async getSecurityConfig(oappId) {
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

  derivePeerFromConfig(config) {
    const peerHex = config.peer;
    if (!peerHex) {
      return null;
    }

    const eid = config.eid ?? null;
    const eidStr = eid !== null && eid !== undefined ? String(eid) : null;

    if (!eidStr) {
      const fallbackSuffix = peerHex ? peerHex.toLowerCase() : "unknown";
      const fallbackLocalId =
        eidStr !== null ? `eid-${eidStr}` : "unknown-eid";
      const fallbackOAppId = `${fallbackLocalId}_${fallbackSuffix}`;
      return {
        rawPeer: peerHex,
        localEid: eidStr,
        address: null,
        oappId: fallbackOAppId,
        resolved: false,
      };
    }

    let decoded = bytes32ToAddress(peerHex);
    if (decoded) {
      try {
        const normalized = normalizeAddress(decoded);
        const oappId = makeOAppId(eidStr, normalized);
        return {
          rawPeer: peerHex,
          localEid: eidStr,
          address: normalized,
          oappId,
          resolved: true,
        };
      } catch (error) {
        console.debug("[SecurityWebCrawler] Failed to normalize peer address", {
          peerHex,
          decoded,
          error,
        });
        decoded = null;
      }
    }

    // Fallback identifier for non-EVM peers; do not attempt to crawl further.
    return {
      rawPeer: peerHex,
      localEid: eidStr,
      address: null,
      oappId: `${eidStr}_${peerHex.toLowerCase()}`,
      resolved: false,
    };
  }

  addPeerEdges({
    currentOAppId,
    depth,
    maxDepth,
    queue,
    visited,
    edges,
    configContexts,
  }) {
    for (const { config, peerInfo } of configContexts) {
      if (!peerInfo || !peerInfo.oappId) {
        continue;
      }

      const edgeKey = `${peerInfo.oappId}->${currentOAppId}`;
      if (!edges.has(edgeKey)) {
        edges.set(edgeKey, {
          from: peerInfo.oappId,
          to: currentOAppId,
          srcEid: config.eid,
          linkType: "peer",
          peerResolved: peerInfo.resolved,
          peerRaw: peerInfo.rawPeer,
          peerLocalEid: peerInfo.localEid ?? null,
        });
      }

      if (peerInfo.resolved && depth < maxDepth && !visited.has(peerInfo.oappId)) {
        queue.push({ oappId: peerInfo.oappId, depth: depth + 1 });
      }
    }
  }
}
