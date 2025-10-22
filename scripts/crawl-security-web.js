#!/usr/bin/env node

/**
 * Web of Security Crawler
 *
 * Crawls the OApp security network starting from a seed OApp ID.
 * Builds a graph of security relationships by following PacketDelivered
 * connections and resolving security configs.
 *
 * Usage:
 *   node scripts/crawl-security-web.js <oappId> [options]
 *
 * Options:
 *   --depth <n>        Maximum crawl depth (default: 2)
 *   --limit <n>        Max packets per node to sample (default: 100)
 *   --output <file>    Output JSON file (default: web-of-security.json)
 *   --endpoint <url>   GraphQL endpoint (default: http://localhost:8080/v1/graphql)
 *   --secret <key>     Hasura admin secret
 */

const GRAPHQL_ENDPOINT = process.env.GRAPHQL_ENDPOINT || 'http://localhost:8080/v1/graphql';
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET || 'testing';

// EID to chainId mapping - need to build from layerzero.json
const eidToChainIdMap = new Map();
const chainIdToEidMap = new Map();

async function loadLayerZeroMetadata() {
  const fs = require('fs').promises;
  const path = require('path');

  try {
    const layerzeroPath = path.join(__dirname, '..', 'layerzero.json');
    const content = await fs.readFile(layerzeroPath, 'utf-8');
    const data = JSON.parse(content);

    // Build EID <-> chainId mappings from layerzero.json
    for (const [chainKey, chainData] of Object.entries(data)) {
      if (!chainData || typeof chainData !== 'object') continue;

      const chainDetails = chainData.chainDetails || {};
      const nativeChainId = chainDetails.nativeChainId;

      if (!nativeChainId) continue;

      if (Array.isArray(chainData.deployments)) {
        for (const deployment of chainData.deployments) {
          if (!deployment || !deployment.eid) continue;

          const eid = String(deployment.eid);
          const chainId = String(nativeChainId);

          eidToChainIdMap.set(eid, chainId);
          chainIdToEidMap.set(chainId, eid);
        }
      }
    }

    console.log(`Loaded ${eidToChainIdMap.size} EID->chainId mappings`);
  } catch (error) {
    console.warn('Failed to load layerzero.json, EID mappings may be incomplete:', error.message);
  }
}

function eidToChainId(eid) {
  return eidToChainIdMap.get(String(eid)) || null;
}

function normalizeAddress(address) {
  if (!address) return null;

  // Remove leading zeros padding (addresses are often padded to 32 bytes in events)
  let cleaned = String(address).toLowerCase();
  if (cleaned.startsWith('0x')) {
    cleaned = cleaned.substring(2);
  }

  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');

  // Ensure it's a valid 40-char hex address
  if (cleaned.length === 0) return null;
  if (cleaned.length > 40) {
    // Take last 40 chars (address is at the end)
    cleaned = cleaned.substring(cleaned.length - 40);
  }

  return '0x' + cleaned.padStart(40, '0');
}

function makeOAppId(chainId, address) {
  const normalized = normalizeAddress(address);
  if (!normalized || !chainId) return null;
  return `${chainId}_${normalized}`;
}

async function graphqlQuery(query, variables) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (result.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(result.errors, null, 2)}`);
  }

  return result.data;
}

async function getSenders(oappId, limit = 100) {
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

  const data = await graphqlQuery(query, { oappId, limit });
  return data.PacketDelivered || [];
}

async function getSecurityConfig(oappId) {
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

  const data = await graphqlQuery(query, { oappId });
  return {
    configs: data.OAppSecurityConfig || [],
    oapp: data.OApp?.[0] || null,
  };
}

async function getDvnMetadata() {
  const query = `
    query GetDvnMetadata {
      DvnMetadata {
        id
        chainId
        address
        name
      }
    }
  `;

  const data = await graphqlQuery(query, {});
  return data.DvnMetadata || [];
}

function buildDvnLookup(dvnMetadata) {
  const lookup = new Map();

  for (const dvn of dvnMetadata) {
    if (!dvn.address) continue;

    const key = `${dvn.chainId}_${dvn.address.toLowerCase()}`;
    lookup.set(key, dvn.name || dvn.address);

    // Also add address-only key as fallback
    lookup.set(dvn.address.toLowerCase(), dvn.name || dvn.address);
  }

  return lookup;
}

function resolveDvnNames(dvnAddresses, chainId, dvnLookup) {
  if (!Array.isArray(dvnAddresses)) return [];

  return dvnAddresses.map(addr => {
    const key = `${chainId}_${addr.toLowerCase()}`;
    return dvnLookup.get(key) || dvnLookup.get(addr.toLowerCase()) || addr;
  });
}

async function crawlSecurityWeb(seedOAppId, options = {}) {
  const maxDepth = options.depth || 2;
  const packetLimit = options.limit || 100;

  console.log(`Starting web crawl from ${seedOAppId}`);
  console.log(`Max depth: ${maxDepth}, Packet sample limit: ${packetLimit}`);

  await loadLayerZeroMetadata();

  const dvnMetadata = await getDvnMetadata();
  const dvnLookup = buildDvnLookup(dvnMetadata);
  console.log(`Loaded ${dvnMetadata.length} DVN metadata entries`);

  const nodes = new Map();
  const edges = new Map();
  const visited = new Set();
  const queue = [{ oappId: seedOAppId, depth: 0 }];

  while (queue.length > 0) {
    const { oappId, depth } = queue.shift();

    if (visited.has(oappId)) continue;
    visited.add(oappId);

    console.log(`\nProcessing [depth=${depth}]: ${oappId}`);

    // Get security config for this node
    const { configs, oapp } = await getSecurityConfig(oappId);

    // Store node info
    const nodeData = {
      id: oappId,
      chainId: oapp?.chainId || oappId.split('_')[0],
      address: oapp?.address || oappId.split('_')[1],
      totalPacketsReceived: oapp?.totalPacketsReceived || 0,
      isTracked: configs.length > 0,
      depth,
      securityConfigs: [],
    };

    // Process each security config (one per source EID)
    for (const config of configs) {
      const requiredDVNs = Array.isArray(config.effectiveRequiredDVNs)
        ? config.effectiveRequiredDVNs
        : [];
      const optionalDVNs = Array.isArray(config.effectiveOptionalDVNs)
        ? config.effectiveOptionalDVNs
        : [];

      const requiredDVNNames = resolveDvnNames(requiredDVNs, config.chainId, dvnLookup);
      const optionalDVNNames = resolveDvnNames(optionalDVNs, config.chainId, dvnLookup);

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
    console.log(`  Added node: ${configs.length} security configs, isTracked=${nodeData.isTracked}`);

    // If we haven't reached max depth, crawl senders
    if (depth < maxDepth) {
      const packets = await getSenders(oappId, packetLimit);
      console.log(`  Found ${packets.length} packets`);

      // Deduplicate senders by (srcEid, sender)
      const senderSet = new Map();
      for (const packet of packets) {
        const key = `${packet.srcEid}_${packet.sender}`;
        if (!senderSet.has(key)) {
          senderSet.set(key, packet);
        }
      }

      console.log(`  Unique senders: ${senderSet.size}`);

      for (const [key, packet] of senderSet.entries()) {
        const srcChainId = eidToChainId(packet.srcEid);

        if (!srcChainId) {
          console.log(`  Skipping sender: unknown chainId for srcEid=${packet.srcEid}`);
          continue;
        }

        const senderOAppId = makeOAppId(srcChainId, packet.sender);

        if (!senderOAppId) {
          console.log(`  Skipping sender: invalid address ${packet.sender}`);
          continue;
        }

        // Record edge
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

        // Queue sender for crawling if not visited
        if (!visited.has(senderOAppId)) {
          queue.push({ oappId: senderOAppId, depth: depth + 1 });
        }
      }
    }
  }

  // Identify dangling nodes (referenced in edges but not in nodes)
  const danglingNodes = new Set();
  for (const edge of edges.values()) {
    if (!nodes.has(edge.from)) {
      danglingNodes.add(edge.from);
    }
    if (!nodes.has(edge.to)) {
      danglingNodes.add(edge.to);
    }
  }

  // Add dangling nodes with minimal info
  for (const oappId of danglingNodes) {
    const [chainId, address] = oappId.split('_');
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

  console.log(`\nCrawl complete:`);
  console.log(`  Nodes: ${nodes.size} (${danglingNodes.size} dangling)`);
  console.log(`  Edges: ${edges.size}`);

  return {
    seed: seedOAppId,
    crawlDepth: maxDepth,
    packetLimit,
    timestamp: new Date().toISOString(),
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Web of Security Crawler

Usage:
  node scripts/crawl-security-web.js <oappId> [options]

Options:
  --depth <n>        Maximum crawl depth (default: 2)
  --limit <n>        Max packets per node to sample (default: 100)
  --output <file>    Output JSON file (default: web-of-security.json)
  --endpoint <url>   GraphQL endpoint (default: http://localhost:8080/v1/graphql)
  --secret <key>     Hasura admin secret

Example:
  node scripts/crawl-security-web.js 8453_0x5634c4a5fed09819e3c46d86a965dd9447d86e47 --depth 2 --output web.json
    `);
    process.exit(0);
  }

  const seedOAppId = args[0];
  const options = {
    depth: 2,
    limit: 100,
    output: 'web-of-security.json',
  };

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--depth' && args[i + 1]) {
      options.depth = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (args[i] === '--endpoint' && args[i + 1]) {
      process.env.GRAPHQL_ENDPOINT = args[i + 1];
      i++;
    } else if (args[i] === '--secret' && args[i + 1]) {
      process.env.HASURA_ADMIN_SECRET = args[i + 1];
      i++;
    }
  }

  try {
    const webData = await crawlSecurityWeb(seedOAppId, options);

    const fs = require('fs').promises;
    await fs.writeFile(options.output, JSON.stringify(webData, null, 2));

    console.log(`\nWeb data written to ${options.output}`);
  } catch (error) {
    console.error('Crawl failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { crawlSecurityWeb };
