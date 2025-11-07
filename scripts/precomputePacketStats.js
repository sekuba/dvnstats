#!/usr/bin/env node

/**
 * Precompute packet statistics from all PacketDelivered records
 * Uses incremental processing to handle millions of packets without memory issues
 * Saves results to dashboard/data/packet-stats.json
 */

const fs = require('fs');
const path = require('path');

const GRAPHQL_ENDPOINT = process.env.GRAPHQL_ENDPOINT || 'https://shinken.business/v1/graphql';
const BATCH_SIZE = 5000;
const OUTPUT_PATH = path.join(__dirname, '../dashboard/data/packet-stats.json');

async function fetchPacketBatch(offset, limit) {
  const query = `
    query FetchPackets($offset: Int!, $limit: Int!) {
      PacketDelivered(
        order_by: { blockTimestamp: desc }
        limit: $limit
        offset: $offset
      ) {
        localEid
        srcEid
        blockTimestamp
        usesDefaultLibrary
        usesDefaultConfig
        effectiveRequiredDVNs
        effectiveOptionalDVNs
        effectiveRequiredDVNCount
        effectiveOptionalDVNCount
        isConfigTracked
      }
    }
  `;

  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { offset, limit } })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  return data.data.PacketDelivered || [];
}

/**
 * Process packets incrementally to avoid memory overflow
 */
async function computeStatisticsIncremental() {
  console.log('Computing statistics incrementally...');

  // Initialize accumulators
  let total = 0;
  let allDefault = 0;
  let defaultLibOnly = 0;
  let defaultConfigOnly = 0;
  let tracked = 0;

  const dvnCombos = new Map();
  const dvnCounts = new Map();
  const optionalDvnCounts = new Map();
  const chainCounts = new Map();
  const srcChainCounts = new Map();

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  let offset = 0;
  let hasMore = true;
  let batchCount = 0;

  while (hasMore) {
    const batch = await fetchPacketBatch(offset, BATCH_SIZE);

    if (batch.length === 0) {
      hasMore = false;
      break;
    }

    batchCount++;

    // Process this batch
    for (const packet of batch) {
      total++;

      // All-default configuration
      if (packet.usesDefaultLibrary && packet.usesDefaultConfig) {
        allDefault++;
      }

      if (packet.usesDefaultLibrary) {
        defaultLibOnly++;
      }

      if (packet.usesDefaultConfig) {
        defaultConfigOnly++;
      }

      if (packet.isConfigTracked) {
        tracked++;
      }

      // DVN combinations (required DVNs only)
      const requiredDVNs = Array.isArray(packet.effectiveRequiredDVNs)
        ? packet.effectiveRequiredDVNs
        : [];

      if (requiredDVNs.length > 0) {
        const sortedDvns = [...requiredDVNs].sort();
        const comboKey = sortedDvns.join(',');
        dvnCombos.set(comboKey, (dvnCombos.get(comboKey) || 0) + 1);
      }

      // DVN count buckets
      const requiredCount = packet.effectiveRequiredDVNCount ?? requiredDVNs.length;
      dvnCounts.set(requiredCount, (dvnCounts.get(requiredCount) || 0) + 1);

      const optionalCount = packet.effectiveOptionalDVNCount ?? 0;
      optionalDvnCounts.set(optionalCount, (optionalDvnCounts.get(optionalCount) || 0) + 1);

      // Chain tracking
      const localEid = String(packet.localEid);
      chainCounts.set(localEid, (chainCounts.get(localEid) || 0) + 1);

      const srcEid = String(packet.srcEid);
      srcChainCounts.set(srcEid, (srcChainCounts.get(srcEid) || 0) + 1);

      // Time range
      const timestamp = Number(packet.blockTimestamp);
      if (!Number.isNaN(timestamp)) {
        if (timestamp < earliest) earliest = timestamp;
        if (timestamp > latest) latest = timestamp;
      }
    }

    offset += batch.length;
    console.log(`  Processed batch ${batchCount}: ${total.toLocaleString()} packets total`);

    // Stop if we got less than batch size (last page)
    if (batch.length < BATCH_SIZE) {
      hasMore = false;
    }

    // Allow garbage collection between batches
    await new Promise(resolve => setImmediate(resolve));
  }

  console.log(`\nTotal packets processed: ${total.toLocaleString()}`);

  if (total === 0) {
    return {
      total: 0,
      computedAt: new Date().toISOString(),
      allDefaultPercentage: 0,
      defaultLibPercentage: 0,
      defaultConfigPercentage: 0,
      trackedPercentage: 0,
      dvnCombinations: [],
      dvnCountBuckets: [],
      optionalDvnCountBuckets: [],
      timeRange: { earliest: null, latest: null },
      chainBreakdown: [],
      srcChainBreakdown: [],
    };
  }

  // Convert to arrays and sort
  console.log('Finalizing results...');

  const dvnCombinations = Array.from(dvnCombos.entries())
    .map(([combo, count]) => ({
      dvns: combo.split(','),
      count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  const dvnCountBuckets = Array.from(dvnCounts.entries())
    .map(([count, packets]) => ({
      requiredDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.requiredDvnCount - b.requiredDvnCount);

  const optionalDvnCountBuckets = Array.from(optionalDvnCounts.entries())
    .map(([count, packets]) => ({
      optionalDvnCount: count,
      packetCount: packets,
      percentage: (packets / total) * 100,
    }))
    .sort((a, b) => a.optionalDvnCount - b.optionalDvnCount);

  const chainBreakdown = Array.from(chainCounts.entries())
    .map(([eid, count]) => ({
      localEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  const srcChainBreakdown = Array.from(srcChainCounts.entries())
    .map(([eid, count]) => ({
      srcEid: eid,
      packetCount: count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.packetCount - a.packetCount);

  return {
    total,
    computedAt: new Date().toISOString(),
    allDefaultPercentage: (allDefault / total) * 100,
    defaultLibPercentage: (defaultLibOnly / total) * 100,
    defaultConfigPercentage: (defaultConfigOnly / total) * 100,
    trackedPercentage: (tracked / total) * 100,
    dvnCombinations,
    dvnCountBuckets,
    optionalDvnCountBuckets,
    chainBreakdown,
    srcChainBreakdown,
    timeRange: {
      earliest: earliest === Number.POSITIVE_INFINITY ? null : earliest,
      latest: latest === Number.NEGATIVE_INFINITY ? null : latest,
    },
  };
}

async function main() {
  try {
    console.log('=== Packet Statistics Precomputation ===\n');
    console.log(`Endpoint: ${GRAPHQL_ENDPOINT}`);
    console.log(`Batch size: ${BATCH_SIZE.toLocaleString()}\n`);

    // Compute statistics incrementally
    const stats = await computeStatisticsIncremental();

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Save to file
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(stats, null, 2));
    console.log(`\nStatistics saved to: ${OUTPUT_PATH}`);
    console.log(`\nSummary:`);
    console.log(`  Total packets: ${stats.total.toLocaleString()}`);
    console.log(`  All-default: ${stats.allDefaultPercentage.toFixed(2)}%`);
    console.log(`  Unique DVN combos: ${stats.dvnCombinations.length.toLocaleString()}`);
    console.log(`  Chains: ${stats.chainBreakdown.length}`);

    if (stats.timeRange.earliest && stats.timeRange.latest) {
      const days = Math.floor((stats.timeRange.latest - stats.timeRange.earliest) / 86400);
      console.log(`  Time range: ${new Date(stats.timeRange.earliest * 1000).toISOString().split('T')[0]} to ${new Date(stats.timeRange.latest * 1000).toISOString().split('T')[0]} (${days.toLocaleString()} days)`);
    }

    console.log('\n✓ Done!');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
