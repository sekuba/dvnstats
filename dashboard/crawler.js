/**
 * Security Web Crawler for LayerZero OApps
 * Performs breadth-first traversal of the packet delivery graph
 */

import { CONFIG } from "./config.js";
import { makeOAppId, normalizeAddress } from "./core.js";

/**
 * Crawls the security web starting from a seed OApp
 */
export class SecurityWebCrawler {
  constructor(client, chainMetadata, dvnRegistry) {
    this.client = client;
    this.chainMetadata = chainMetadata;
    this.dvnRegistry = dvnRegistry;
  }

  /**
   * Main crawl function
   */
  async crawl(seedOAppId, options = {}) {
    const maxDepth = options.depth || CONFIG.CRAWLER.DEFAULT_DEPTH;
    const packetLimit = options.limit || CONFIG.CRAWLER.DEFAULT_LIMIT;
    const onProgress = options.onProgress || (() => {});

    onProgress("Initializing crawl...");

    // Verify metadata is loaded
    console.log(`[SecurityWebCrawler] Starting crawl with ${this.chainMetadata.eidToChainId.size} EID mappings`);
    if (this.chainMetadata.eidToChainId.size === 0) {
      console.warn("[SecurityWebCrawler] No EID mappings loaded! Attempting to load...");
      await this.chainMetadata.load();
      console.log(`[SecurityWebCrawler] After load: ${this.chainMetadata.eidToChainId.size} EID mappings`);
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

      const nodeData = {
        id: oappId,
        chainId: oapp?.chainId || oappId.split("_")[0],
        address: oapp?.address || oappId.split("_")[1],
        totalPacketsReceived: oapp?.totalPacketsReceived || 0,
        isTracked: configs.length > 0,
        depth,
        securityConfigs: [],
      };

      for (const config of configs) {
        const requiredDVNs = Array.isArray(config.effectiveRequiredDVNs)
          ? config.effectiveRequiredDVNs
          : [];
        const optionalDVNs = Array.isArray(config.effectiveOptionalDVNs)
          ? config.effectiveOptionalDVNs
          : [];

        const requiredDVNNames = this.dvnRegistry.resolveMany(
          requiredDVNs,
          config.chainId,
        );
        const optionalDVNNames = this.dvnRegistry.resolveMany(
          optionalDVNs,
          config.chainId,
        );

        nodeData.securityConfigs.push({
          srcEid: config.eid,
          requiredDVNCount: config.effectiveRequiredDVNCount || 0,
          requiredDVNs: requiredDVNNames,
          optionalDVNCount: config.effectiveOptionalDVNCount || 0,
          optionalDVNs: optionalDVNNames,
          optionalDVNThreshold: config.effectiveOptionalDVNThreshold || 0,
          usesRequiredDVNSentinel: config.usesRequiredDVNSentinel || false,
          isConfigTracked: config.isConfigTracked || false,
        });
      }

      nodes.set(oappId, nodeData);

      // Continue crawling if not at max depth
      if (depth < maxDepth) {
        const packets = await this.getSenders(oappId, packetLimit);

        const senderSet = new Map();
        for (const packet of packets) {
          const key = `${packet.srcEid}_${packet.sender}`;
          if (!senderSet.has(key)) {
            senderSet.set(key, packet);
          }
        }

        for (const packet of senderSet.values()) {
          const srcChainId = this.chainMetadata.resolveChainId(packet.srcEid);

          if (!srcChainId) {
            console.log(
              `Skipping sender: unknown chainId for srcEid=${packet.srcEid}`,
            );
            continue;
          }

          const senderOAppId = makeOAppId(srcChainId, packet.sender);

          if (!senderOAppId) {
            console.log(`Skipping sender: invalid address ${packet.sender}`);
            continue;
          }

          const edgeKey = `${senderOAppId}->${oappId}`;
          const existingEdge = edges.get(edgeKey);

          if (existingEdge) {
            existingEdge.packetCount += 1;
          } else {
            edges.set(edgeKey, {
              from: senderOAppId,
              to: oappId,
              srcEid: packet.srcEid,
              srcChainId,
              packetCount: 1,
            });
          }

          if (!visited.has(senderOAppId)) {
            queue.push({ oappId: senderOAppId, depth: depth + 1 });
          }
        }
      }
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
      const [chainId, address] = oappId.split("_");
      nodes.set(oappId, {
        id: oappId,
        chainId,
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
      packetLimit,
      timestamp: new Date().toISOString(),
      nodes: Array.from(nodes.values()),
      edges: Array.from(edges.values()),
    };
  }

  /**
   * Fetches senders (sources) for a given OApp
   */
  async getSenders(oappId, limit = 100) {
    const query = `
      query GetSenders($oappId: String!, $limit: Int!) {
        PacketDelivered(
          where: { oappId: { _eq: $oappId } }
          order_by: { blockTimestamp: desc }
          limit: $limit
        ) {
          sender
          srcEid
          receiver
          oappId
        }
      }
    `;

    const data = await this.client.query(query, { oappId, limit });
    return data.PacketDelivered || [];
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
          chainId
          oapp
          effectiveRequiredDVNCount
          effectiveRequiredDVNs
          effectiveOptionalDVNCount
          effectiveOptionalDVNs
          effectiveOptionalDVNThreshold
          isConfigTracked
          usesRequiredDVNSentinel
        }
        OApp(where: { id: { _eq: $oappId } }) {
          id
          chainId
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
}
